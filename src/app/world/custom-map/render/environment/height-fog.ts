import { Color, Vector3, Vector4, type Material, type Texture, type WebGLProgramParametersWithUniforms } from 'three';
import { LAMP_LIGHT_FRAGMENT, LAMP_LIGHT_PARS, LAMP_LIGHT_UNIFORMS } from '../effects/lamp-light';
import { SHOT_LIGHT_PARS, SHOT_LIGHT_UNIFORMS, shotLightFragment } from '../../../../three-engine/shot-lights/shot-light-shader';

/**
 * Height fog with aerial perspective for the custom map's materials.
 *
 * The scene keeps a FogExp2 (fog colour, density, and the USE_FOG define),
 * but the map's own materials replace its fragment. Two layers of air, each
 * integrated along the view ray in closed form:
 * - ground haze, thinning with height above the map's ground (falloff
 *   `uFogFalloff` per metre): valleys and the plain sink into it, hill tops
 *   stand out;
 * - thin air with a scale height of 250 m (AIR_FALLOFF): the far land
 *   blues out when looked at flat, a camera high above looks down through
 *   little of it, so an overview stays clear.
 * The haze takes the sky's colour at the horizon in the direction the ray
 * runs (`uFogRing`, filled from the sky by CustomMapEnvironment): towards a
 * low sun its glow, away from it the sky's blue; the sky dome's foot fades
 * into the same colour, so the land runs into the sky without a band. No
 * step at the map's border: the land beyond it is landscape, hazed by its
 * distance like any other.
 *
 * Uniforms are shared by every patched material (one environment is
 * active at a time); CustomMapEnvironment sets them.
 */

/** Entries of the haze ring: the horizon's colour all round, every 15 degrees of azimuth */
export const FOG_RING = 24;
/** Falloff per metre of the thin air (a scale height of 250 m) */
export const AIR_FALLOFF = 1 / 250;
/** The thin air's share of the map's fog density, and where it starts (times uFogStart) */
export const AIR_SHARE = 0.8;
export const AIR_FROM = 1;

export const HEIGHT_FOG_UNIFORMS = {
  uFogFalloff: { value: 1 / 70 },
  uFogBase: { value: 0 },
  /**
   * The haze's colour (linear) towards FOG_RING azimuths, entry i at atan(z, x) = (i / FOG_RING - 0.5) * 2 pi
   * as the sky texture's columns run: the sky a little above the horizon, with the sun's glow
   */
  uFogRing: { value: new Float32Array(FOG_RING * 3).fill(0.6) },
  /** The map's own fog density (the scene's FogExp2 carries a matched one for other materials) */
  uFogDensity: { value: 0.001 },
  /**
   * The thin air's density: the map's, with the look's fog scale only in its square root (a swamp's thick ground
   * fog does not make its far air milk, clear mountain air still blues the range); none without air (the moon)
   */
  uFogAirDensity: { value: 0.001 },
  /** Metres of clear air before the haze starts: the game camera (150 to 300 m) looks through none */
  uFogStart: { value: 450 },
  /** The map's extent in the scene (centre x, z and half sizes): land beyond the border fades into the haze */
  uFogMap: { value: new Vector4(0, 0, 1e6, 1e6) },
  /**
   * The ground haze's own colour where the look has one (linear rgb, a how far it replaces the sky's): a swamp's
   * pale mist, a ruined city's dust. The thin air keeps the sky's colour
   */
  uFogMist: { value: new Vector4(1, 1, 1, 0) },
  /**
   * Night light on the map's lit materials: a floor under the light every surface keeps (linear, times its
   * colour), and a rim on the edges turned to the moon (`uNightDir`, scene space), so walls, roofs and trees
   * read against the dark from the game camera
   */
  uNightFloor: { value: new Color(0, 0, 0) },
  uNightRim: { value: new Color(0, 0, 0) },
  uNightDir: { value: new Vector3(0, 1, 0) },
  /** 0..1 dew on paved ways at night (materials with userData.nightSheen): smoother, so moon and lamps glint on them */
  uNightSheen: { value: 0 },
  /** Colour grade of the map's look, after the fog: contrast, saturation, and a multiply tint */
  uGradeContrast: { value: 1 },
  uGradeSaturation: { value: 1 },
  uGradeTint: { value: new Color(1, 1, 1) },
  /** Split toning of the look: a tint for the shadows and one for the lights */
  uGradeShadow: { value: new Color(1, 1, 1) },
  uGradeLight: { value: new Color(1, 1, 1) },
  /** 0..1 snow on surfaces facing up, and wetness (darker, glossier) */
  uSnowCover: { value: 0 },
  uWetness: { value: 0 },
};

/**
 * Lava's glow on the objects near it (houses, rocks, trees by a lava flow):
 * the ground occlusion texture's lava closeness (channel A,
 * ground-occlusion.ts) read at the fragment's spot on the map, orange from
 * below, without lights. The view sets it where the map has lava; the
 * terrain glows by its own (userData.noLavaGlow).
 */
export const LAVA_GLOW_UNIFORMS = {
  uLavaGlowOn: { value: 0 },
  uLavaGlowTex: { value: null as Texture | null },
  /** Map metres to the texture's uv (as the terrain's uGridUv) */
  uLavaGridUv: { value: new Vector4() },
};

const LAVA_GLOW_PARS = /* glsl */ `
uniform float uLavaGlowOn;
uniform sampler2D uLavaGlowTex;
uniform vec4 uLavaGridUv;
`;

const LAVA_GLOW_FRAGMENT = /* glsl */ `
if (uLavaGlowOn > 0.5) {
  // The map lies at uFogMap.xy in the scene, scene x running against map x
  vec2 lavaAt = vec2(uFogMap.x - vFogWorldPos.x, vFogWorldPos.z - uFogMap.y);
  float lavaNear = texture2D(uLavaGlowTex, lavaAt * uLavaGridUv.xy + uLavaGridUv.zw).a;
  // Lit from below: faces turned down and sideways take the most
  float below = 0.2 + 0.8 * max(-dot(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz)), 0.0);
  totalEmissiveRadiance += vec3(1.0, 0.32, 0.06) * pow(lavaNear, 2.0) * 0.6 * below;
}
`;

export const HEIGHT_FOG_PARS = /* glsl */ `
uniform float uFogFalloff;
uniform float uFogBase;
uniform vec3 uFogRing[${FOG_RING}];
uniform float uFogDensity;
uniform float uFogAirDensity;
uniform float uFogStart;
uniform vec4 uFogMap;
uniform vec4 uFogMist;
uniform vec3 uNightFloor;
uniform vec3 uNightRim;
uniform vec3 uNightDir;
uniform float uNightSheen;
uniform float uGradeContrast;
uniform float uGradeSaturation;
uniform vec3 uGradeTint;
uniform vec3 uGradeShadow;
uniform vec3 uGradeLight;
uniform float uSnowCover;
uniform float uWetness;

// Mean density of a layer exp(-k * height) along a ray from height h0 to h1 (closed form of its integral):
// stable for any heights, where exp(-k h0) times the integral over exp(-k dy) overflowed high above a swamp
float fogLayer(float k, float h0, float h1) {
  float dk = k * (h1 - h0);
  return abs(dk) > 1e-4 ? (exp(-k * h0) - exp(-k * h1)) / dk : exp(-k * h0);
}

// The haze's colour (linear) towards a direction: the ring of horizon colours, between its two nearest entries
vec3 hazeColor(vec3 dir) {
  float ring = (atan(dir.z, dir.x) / (2.0 * PI) + 0.5) * ${FOG_RING.toFixed(1)} - 0.5;
  float ringAt = floor(ring);
  int i0 = int(mod(ringAt, ${FOG_RING.toFixed(1)}));
  int i1 = int(mod(ringAt + 1.0, ${FOG_RING.toFixed(1)}));
  return mix(uFogRing[i0], uFogRing[i1], ring - ringAt);
}

// The map's grade on a colour after colorspace_fragment: saturation, contrast around mid grey, tint.
// Graded in sRGB either way: into the canvas the colour is sRGB already, into the game's
// post-processing target (linear, OutputPass converts later) it is converted there and back, or
// the contrast would crush every dark linear value to black.
vec3 mapGrade(vec3 c) {
  bool linearOut = linearToOutputTexel(vec4(0.5)).r < 0.6;
  if (linearOut) c = pow(max(c, vec3(0.0)), vec3(1.0 / 2.2));
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uGradeSaturation);
  c = max(vec3(0.0), (c - 0.45) * uGradeContrast + 0.45);
  c *= uGradeTint;
  // Split toning: the shadows lean one way (mostly cool), the lights another (mostly warm)
  // (normalised to their luminance: they shift the hue, not the brightness)
  vec3 split = mix(uGradeShadow, uGradeLight, smoothstep(0.08, 0.75, l));
  c *= split / max(dot(split, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
  if (linearOut) c = pow(c, vec3(2.2));
  return c;
}
`;

/** Fog for a fragment at world position `worldPos`, applied to gl_FragColor (needs HEIGHT_FOG_PARS) */
export function heightFogFragment(worldPos: string): string {
  return /* glsl */ `
#ifdef USE_FOG
{
  vec3 fogRay = ${worldPos} - cameraPosition;
  float fogDist = length(fogRay);
  // Heights of the camera and the fragment above the map's low ground (a camera below it counts as at -50 m)
  float fogFrom = max(cameraPosition.y - uFogBase, -50.0);
  float fogTo = max(${worldPos}.y - uFogBase, -50.0);
  // Clear air up to uFogStart (the game camera looks through none), then the ground haze and the thin air
  float ground = uFogDensity * max(fogDist - uFogStart, 0.0) * fogLayer(uFogFalloff, fogFrom, fogTo);
  float air = uFogAirDensity * max(fogDist - uFogStart * ${AIR_FROM.toFixed(1)}, 0.0) * ${AIR_SHARE.toFixed(3)} * fogLayer(${AIR_FALLOFF.toFixed(7)}, fogFrom, fogTo);
  float fogFactor = 1.0 - exp(-max(2.0 * (ground + air), 0.0));
  // Fog is applied in output space (as three does); the ring is linear. Converting fogColor again lifted every
  // haze into a pale band, so the ring's colour is converted once here, untouched by the tone mapping like
  // three's fog colour
  vec3 hazeLinear = hazeColor(fogRay / max(fogDist, 1e-3));
  // The ground haze in the look's mist colour, by its share of the haze here
  hazeLinear = mix(hazeLinear, uFogMist.rgb, uFogMist.a * ground / max(ground + air, 1e-6));
  vec3 haze = linearToOutputTexel(vec4(hazeLinear, 1.0)).rgb;
  gl_FragColor.rgb = mix(gl_FragColor.rgb, haze, fogFactor);
}
#endif
gl_FragColor.rgb = mapGrade(gl_FragColor.rgb);
`;
}

function layerMean(k: number, h0: number, h1: number): number {
  const dk = k * (h1 - h0);
  return Math.abs(dk) > 1e-4 ? (Math.exp(-k * h0) - Math.exp(-k * h1)) / dk : Math.exp(-k * h0);
}

/**
 * The optical depth heightFogFragment gives a fragment at height `pointY`
 * seen from `eyeY` over `dist` metres (scene heights): factor 1 - exp(-it)
 */
export function heightFogAmount(eyeY: number, pointY: number, dist: number): number {
  const u = HEIGHT_FOG_UNIFORMS;
  const from = Math.max(eyeY - u.uFogBase.value, -50);
  const to = Math.max(pointY - u.uFogBase.value, -50);
  const start = u.uFogStart.value;
  const ground = u.uFogDensity.value * Math.max(dist - start, 0) * layerMean(u.uFogFalloff.value, from, to);
  const air = u.uFogAirDensity.value * Math.max(dist - start * AIR_FROM, 0) * AIR_SHARE * layerMean(AIR_FALLOFF, from, to);
  return 2 * (ground + air);
}

/**
 * Night light on every lit map material (HEIGHT_FOG_UNIFORMS.uNightFloor,
 * uNightRim): a cool floor of light, a little more on faces turned up, and
 * a rim where a face turns away from the viewer towards the moon. Both 0 by
 * day: a uniform branch skips it.
 */
const NIGHT_LIGHT_FRAGMENT = /* glsl */ `
if (uNightFloor.b + uNightRim.b > 0.0) {
  vec3 nightUp = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  float nightFacingUp = clamp(dot(normal, nightUp) * 0.5 + 0.5, 0.0, 1.0);
  float nightEdge = 1.0 - clamp(dot(normal, normalize(vViewPosition)) * -1.0, 0.0, 1.0);
  float nightToMoon = clamp(dot(normal, normalize((viewMatrix * vec4(uNightDir, 0.0)).xyz)) * 0.6 + 0.4, 0.0, 1.0);
  totalEmissiveRadiance += diffuseColor.rgb * uNightFloor * (0.6 + 0.4 * nightFacingUp)
    // the rim on walls, roofs and crowns, not on level ground seen flat (the far land would glow)
    + (diffuseColor.rgb * 0.7 + 0.03) * uNightRim * pow(nightEdge, 3.0) * nightToMoon * (1.0 - smoothstep(0.55, 0.85, dot(normal, nightUp)));
}
`;

/**
 * Snow and wetness on the map's materials (before lighting): snow settles on
 * whatever faces up, broken up by a little noise; wet surfaces are darker
 * and glossier.
 */
const SURFACE_WEATHER_COLOR = /* glsl */ `
float surfaceUp = 1.0;
#if defined(SURFACE_VIEW_NORMAL)
// A material that finds its normal per pixel names it (an impostor's baked one): its card's normal faced up
surfaceUp = dot(SURFACE_VIEW_NORMAL, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz));
#elif !defined(FLAT_SHADED)
surfaceUp = dot(normalize(vNormal), normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz));
#endif
if (uSnowCover > 0.0) {
  vec2 sp = vFogWorldPos.xz * 0.7;
  float grain = fract(sin(dot(floor(sp), vec2(12.9898, 78.233))) * 43758.5453) * 0.15 + sin(sp.x * 0.37 + sp.y * 0.21) * 0.08;
  float snow = smoothstep(0.75 - uSnowCover * 0.55, 0.95 - uSnowCover * 0.45, surfaceUp + grain) * min(1.0, uSnowCover * 1.6);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.95), snow);
}
diffuseColor.rgb *= 1.0 - uWetness * 0.3;
`;

const SURFACE_WEATHER_ROUGHNESS = /* glsl */ `
roughnessFactor = mix(roughnessFactor, min(roughnessFactor, 0.35), uWetness * smoothstep(0.2, 0.8, surfaceUp));
#ifdef NIGHT_SHEEN
roughnessFactor = mix(roughnessFactor, min(roughnessFactor, 0.4), uNightSheen * smoothstep(0.2, 0.8, surfaceUp));
#endif
`;

const patched = new WeakSet<Material>();

/**
 * Makes a standard (or any built-in) material use the height fog. Chains
 * an existing onBeforeCompile; patching twice does nothing.
 */
export function addHeightFog(material: Material): void {
  if (patched.has(material)) return;
  patched.add(material);
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
    prev.call(material, shader, renderer);
    Object.assign(shader.uniforms, HEIGHT_FOG_UNIFORMS, LAVA_GLOW_UNIFORMS, LAMP_LIGHT_UNIFORMS, SHOT_LIGHT_UNIFORMS);
    const lit = shader.fragmentShader.includes('#include <emissivemap_fragment>');
    const lavaGlow = !material.userData['noLavaGlow'] && lit;
    // Lamps, torches and fires light every lit surface near them (effects/lamp-light.ts), the terrain too, so do the
    // shots (three-engine/shot-lights), and the night's floor and moon rim (NIGHT_LIGHT_FRAGMENT)
    const glow = `${lavaGlow ? LAVA_GLOW_FRAGMENT : ''}\n${lit ? `${LAMP_LIGHT_FRAGMENT}\n${shotLightFragment('vFogWorldPos')}\n${NIGHT_LIGHT_FRAGMENT}` : ''}`;
    shader.vertexShader = shader.vertexShader
      .replace('#include <fog_pars_vertex>', '#include <fog_pars_vertex>\nvarying vec3 vFogWorldPos;')
      .replace(
        '#include <fog_vertex>',
        /* glsl */ `#include <fog_vertex>
        #ifdef USE_INSTANCING
        vFogWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
        vFogWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`,
      );
    shader.fragmentShader = `${material.userData['nightSheen'] ? '#define NIGHT_SHEEN\n' : ''}${shader.fragmentShader}`
      .replace('#include <fog_pars_fragment>', `#include <fog_pars_fragment>\nvarying vec3 vFogWorldPos;\n${HEIGHT_FOG_PARS}\n${LAVA_GLOW_PARS}\n${LAMP_LIGHT_PARS}\n${SHOT_LIGHT_PARS}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${glow}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${SURFACE_WEATHER_COLOR}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${SURFACE_WEATHER_ROUGHNESS}`)
      // The terrain replaces the roughness chunk and leaves this marker
      .replace('// map-roughness-done', SURFACE_WEATHER_ROUGHNESS)
      .replace('#include <fog_fragment>', heightFogFragment('vFogWorldPos'));
  };
  material.customProgramCacheKey = () => `${prevKey.call(material)}-hfog5${material.userData['nightSheen'] ? 's' : ''}`;
}
