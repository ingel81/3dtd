import { Color, MeshStandardMaterial, type IUniform, type WebGLProgramParametersWithUniforms } from 'three';

/**
 * Rubble masonry for the tower plinths: weathered quarry stones in lime
 * mortar, moss in patches along the joints, on the top and at the foot.
 *
 * A MeshStandardMaterial whose shader draws the stones procedurally
 * (onBeforeCompile), no textures. Being the standard material it keeps its
 * lights, fog, log depth (`logdepthbuf_*`) and output conversion
 * (`colorspace_fragment`, sRGB on the canvas, linear into the composer
 * target), so the plinth is lit like the tower models on it. The patch only
 * changes the albedo (after `color_fragment`), the roughness (after
 * `roughnessmap_fragment`) and the normal (after `normal_fragment_maps`,
 * a bump from the stone relief).
 *
 * The pattern is taken in world space: every plinth shows other stones, and
 * the preview shows the stones the placed plinth will have.
 */

/**
 * Tones of the masonry, sRGB like the colours in the configs. Color turns
 * them into the linear working space, which is what the shader computes in.
 */
const PLINTH_COLORS = {
  plinthStoneLight: 0xa39a8a,
  plinthStoneMid: 0x8c8475,
  plinthStoneDark: 0x6b665e,
  plinthMortar: 0xb8b0a0,
  plinthMoss: 0x56632c,
} as const;

/** Program cache key: all plinth materials share one shader program. */
const PLINTH_PROGRAM_KEY = 'tower-plinth';

const VERTEX_PARS = /* glsl */ `
varying vec3 vPlinthWorld;
varying vec3 vPlinthLocal;
varying vec3 vPlinthUp;
`;

const VERTEX_MAIN = /* glsl */ `
vPlinthLocal = transformed;
vPlinthUp = objectNormal;
vPlinthWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
`;

const FRAGMENT_PARS = /* glsl */ `
varying vec3 vPlinthWorld;
varying vec3 vPlinthLocal;
varying vec3 vPlinthUp;
uniform vec3 plinthStoneLight;
uniform vec3 plinthStoneMid;
uniform vec3 plinthStoneDark;
uniform vec3 plinthMortar;
uniform vec3 plinthMoss;

// Hashes without sine, stable for the large cell indices of world space.
float plinthHash1( vec3 p ) {
  p = fract( p * 0.1031 );
  p += dot( p, p.zyx + 31.32 );
  return fract( ( p.x + p.y ) * p.z );
}

vec3 plinthHash3( vec3 p ) {
  p = fract( p * vec3( 0.1031, 0.1030, 0.0973 ) );
  p += dot( p, p.yxz + 33.33 );
  return fract( ( p.xxy + p.yxx ) * p.zyx );
}

float plinthNoise( vec3 p ) {
  vec3 i = floor( p );
  vec3 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  float n000 = plinthHash1( i );
  float n100 = plinthHash1( i + vec3( 1.0, 0.0, 0.0 ) );
  float n010 = plinthHash1( i + vec3( 0.0, 1.0, 0.0 ) );
  float n110 = plinthHash1( i + vec3( 1.0, 1.0, 0.0 ) );
  float n001 = plinthHash1( i + vec3( 0.0, 0.0, 1.0 ) );
  float n101 = plinthHash1( i + vec3( 1.0, 0.0, 1.0 ) );
  float n011 = plinthHash1( i + vec3( 0.0, 1.0, 1.0 ) );
  float n111 = plinthHash1( i + vec3( 1.0, 1.0, 1.0 ) );
  return mix(
    mix( mix( n000, n100, f.x ), mix( n010, n110, f.x ), f.y ),
    mix( mix( n001, n101, f.x ), mix( n011, n111, f.x ), f.y ),
    f.z
  );
}

// Centre of the stone of cell g (relative to the cell of p).
vec3 plinthStoneCenter( vec3 n, vec3 g ) {
  return g + 0.15 + 0.7 * plinthHash3( n + g );
}

// The stones are the cells of a 3D Voronoi pattern. x: distance to the
// nearest joint (cell border), yzw: cell of the stone.
vec4 plinthStones( vec3 p ) {
  vec3 n = floor( p );
  vec3 f = fract( p );
  vec3 mg = vec3( 0.0 );
  vec3 mr = vec3( 0.0 );
  float md = 8.0;
  for ( int k = -1; k <= 1; k++ ) {
    for ( int j = -1; j <= 1; j++ ) {
      for ( int i = -1; i <= 1; i++ ) {
        vec3 g = vec3( float( i ), float( j ), float( k ) );
        vec3 r = plinthStoneCenter( n, g ) - f;
        float d = dot( r, r );
        if ( d < md ) {
          md = d;
          mr = r;
          mg = g;
        }
      }
    }
  }
  md = 8.0;
  for ( int k = -1; k <= 1; k++ ) {
    for ( int j = -1; j <= 1; j++ ) {
      for ( int i = -1; i <= 1; i++ ) {
        vec3 g = mg + vec3( float( i ), float( j ), float( k ) );
        vec3 r = plinthStoneCenter( n, g ) - f;
        vec3 diff = r - mr;
        if ( dot( diff, diff ) > 0.00001 ) {
          md = min( md, dot( 0.5 * ( mr + r ), normalize( diff ) ) );
        }
      }
    }
  }
  return vec4( md, n + mg );
}

// Bump from a height in metres, like three's perturbNormalArb.
vec3 plinthPerturbNormal( vec3 surfPos, vec3 surfNorm, float height, float faceDir ) {
  vec3 sigmaX = dFdx( surfPos );
  vec3 sigmaY = dFdy( surfPos );
  vec3 r1 = cross( sigmaY, surfNorm );
  vec3 r2 = cross( surfNorm, sigmaX );
  float det = dot( sigmaX, r1 ) * faceDir;
  vec3 grad = sign( det ) * ( dFdx( height ) * r1 + dFdy( height ) * r2 );
  return normalize( abs( det ) * surfNorm - grad );
}
`;

// Stones about 0.5 m long and 0.28 m high. vPlinthLocal.y = 0 is the lowest
// point of the footprint, where the plinth meets the ground.
const FRAGMENT_ALBEDO = /* glsl */ `
vec4 plinthCell = plinthStones( vPlinthWorld / vec3( 0.5, 0.28, 0.5 ) );
float plinthJoint = plinthCell.x;
float plinthRnd = plinthHash1( plinthCell.yzw + 17.0 );
float plinthRnd2 = plinthHash1( plinthCell.yzw + 53.0 );
// Relief and grain fade out once a pixel covers several centimetres
float plinthDetail = 1.0 - smoothstep( 0.03, 0.12, length( fwidth( vPlinthWorld ) ) );
float plinthMortarMask = 1.0 - smoothstep( 0.045, 0.075, plinthJoint );
float plinthGrain = plinthNoise( vPlinthWorld * 9.0 ) * 0.6 + plinthNoise( vPlinthWorld * 23.0 ) * 0.4;

vec3 plinthStone = mix( plinthStoneMid, plinthStoneLight, plinthRnd );
plinthStone = mix( plinthStone, plinthStoneDark, step( 0.78, plinthRnd2 ) * 0.8 );
plinthStone *= 0.82 + 0.3 * plinthGrain;
// Weathering: dark runoff streaks down the wall
float plinthStreak = plinthNoise( vPlinthWorld * vec3( 2.5, 0.35, 2.5 ) );
plinthStone *= 1.0 - 0.22 * smoothstep( 0.55, 0.85, plinthStreak );
vec3 plinthMortarColor = plinthMortar * ( 0.85 + 0.25 * plinthNoise( vPlinthWorld * 14.0 ) );

// Moss in patches: in the joints, on faces that look up, along the foot
float plinthUp = smoothstep( 0.35, 0.9, normalize( vPlinthUp ).y );
float plinthFoot = 1.0 - smoothstep( 0.0, 0.9, vPlinthLocal.y );
float plinthPatch = plinthNoise( vPlinthWorld * 1.7 ) * 0.65 + plinthNoise( vPlinthWorld * 5.3 ) * 0.35;
float plinthMossMask = smoothstep( 0.52, 0.72, plinthPatch )
  * max( max( plinthMortarMask * 0.75, plinthUp ), plinthFoot * 0.8 );

vec3 plinthAlbedo = mix( plinthStone, plinthMortarColor, plinthMortarMask );
plinthAlbedo = mix( plinthAlbedo, plinthMoss * ( 0.75 + 0.5 * plinthNoise( vPlinthWorld * 31.0 ) ), plinthMossMask );
diffuseColor.rgb *= plinthAlbedo;

float plinthRoughness = mix( mix( 0.86, 0.96, plinthMortarMask ), 1.0, plinthMossMask );
// Stones stand 2-3 cm proud of the mortar, rounded towards the joints
float plinthRelief = plinthDetail * (
  smoothstep( 0.02, 0.2, plinthJoint ) * ( 0.022 + 0.012 * plinthRnd )
  + plinthGrain * 0.004
  + plinthMossMask * 0.004
);
`;

const FRAGMENT_ROUGHNESS = /* glsl */ `
roughnessFactor = plinthRoughness;
`;

const FRAGMENT_NORMAL = /* glsl */ `
normal = plinthPerturbNormal( - vViewPosition, normal, plinthRelief, faceDirection );
`;

/** `code` right after the first `anchor` (a chunk include) in `source`. */
function after(source: string, anchor: string, code: string): string {
  return source.replace(anchor, `${anchor}\n${code}`);
}

/** Shader parameters as onBeforeCompile gets them, the part the patch touches. */
type PatchableShader = Pick<WebGLProgramParametersWithUniforms, 'vertexShader' | 'fragmentShader' | 'uniforms'>;

/** Put the masonry into the standard shader, see the module comment. */
export function patchPlinthShader(shader: PatchableShader, uniforms: Record<string, IUniform>): void {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = after(shader.vertexShader, '#include <common>', VERTEX_PARS);
  shader.vertexShader = after(shader.vertexShader, '#include <begin_vertex>', VERTEX_MAIN);
  shader.fragmentShader = after(shader.fragmentShader, '#include <common>', FRAGMENT_PARS);
  shader.fragmentShader = after(shader.fragmentShader, '#include <color_fragment>', FRAGMENT_ALBEDO);
  shader.fragmentShader = after(shader.fragmentShader, '#include <roughnessmap_fragment>', FRAGMENT_ROUGHNESS);
  shader.fragmentShader = after(shader.fragmentShader, '#include <normal_fragment_maps>', FRAGMENT_NORMAL);
}

/**
 * A plinth material. The placed plinths share one; the build preview takes
 * its own, which it makes see-through and tints.
 */
export function createPlinthMaterial(): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
  material.name = 'tower-plinth';
  const uniforms: Record<string, IUniform> = {};
  for (const [name, hex] of Object.entries(PLINTH_COLORS)) {
    uniforms[name] = { value: new Color(hex) };
  }
  material.onBeforeCompile = (shader) => patchPlinthShader(shader, uniforms);
  material.customProgramCacheKey = () => PLINTH_PROGRAM_KEY;
  return material;
}
