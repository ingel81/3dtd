import { BufferAttribute, BufferGeometry, DoubleSide, Matrix4, Mesh, ShaderMaterial, UniformsLib, UniformsUtils } from 'three';
import { SHADER_NOISE } from '../shader-noise';

/**
 * Waterfall sheets: per waterfall object a curved strip from its lip down to
 * its foot, the water streaking down it. Local frame of the object: the lip
 * runs along x at `height`, the water leaves towards +z (the object's front)
 * and falls to y = 0, bulging out a little as it drops. All sheets of a map
 * share one geometry buffer (merged in scene space) and one material.
 *
 * The sheet has no corners: its sides fray and spread as it falls, the lip
 * starts thin and the foot dissolves into the spray. Two layers of streaks
 * at different speeds and scales run down it (a fast bright front over a
 * slower body). Where the water lands on a pool, a disc of churning foam
 * lies on the pool's surface (`pool`, same mesh and material).
 */

export interface WaterfallSpec {
  /** Object matrix (position, rotation, scale) in the map group */
  matrix: Matrix4;
  /** Half width at scale 1 */
  radius: number;
  /** Drop height at scale 1 */
  height: number;
  /** Height of the pool's surface under the foot, in the object's frame; null on dry ground */
  pool?: number | null;
}

const ROWS = 16;
const COLS = 8;
/** Segments of the foam disc around its middle */
const DISC = 16;

export function buildWaterfalls(
  specs: WaterfallSpec[],
  time: { value: number },
  light: { value: number },
): Mesh<BufferGeometry, ShaderMaterial> {
  const pos: number[] = [];
  const uv: number[] = [];
  const across: number[] = [];
  // 0..1 down the sheet; -1 on a foam disc
  const fall: number[] = [];
  const index: number[] = [];
  const put = (e: number[], x: number, y: number, z: number): void => {
    pos.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
  };
  for (const spec of specs) {
    const e = spec.matrix.elements;
    const base = pos.length / 3;
    const out = Math.min(spec.height * 0.2, 3);
    for (let r = 0; r <= ROWS; r++) {
      const t = r / ROWS;
      // Out from the lip, then straight down with a slight bulge; a little wider as it falls
      const y = spec.height * (1 - t * t * 0.15 - t * 0.85);
      const z = out * Math.sqrt(t);
      const spread = 1 + t * 0.25;
      for (let c = 0; c <= COLS; c++) {
        put(e, (c / COLS - 0.5) * 2 * spec.radius * spread, y, z);
        uv.push((c / COLS) * spec.radius * 0.5, t * spec.height * 0.25);
        across.push(c / COLS);
        fall.push(t);
      }
    }
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const a = base + r * (COLS + 1) + c;
        const b = a + COLS + 1;
        index.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    if (spec.pool !== null && spec.pool !== undefined) {
      // Foam on the pool: a disc around the foot, a little above the surface
      const middle = pos.length / 3;
      const reach = spec.radius * 1.6;
      put(e, 0, spec.pool + 0.04, out);
      uv.push(0, 0);
      across.push(0.5);
      fall.push(-1);
      for (let k = 0; k < DISC; k++) {
        const a = (k / DISC) * Math.PI * 2;
        put(e, Math.cos(a) * reach, spec.pool + 0.04, out + Math.sin(a) * reach * 0.8);
        uv.push(Math.cos(a), Math.sin(a));
        across.push(0.5);
        fall.push(-1);
      }
      for (let k = 0; k < DISC; k++) index.push(middle, middle + 1 + k, middle + 1 + ((k + 1) % DISC));
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setAttribute('aAcross', new BufferAttribute(new Float32Array(across), 1));
  g.setAttribute('aFall', new BufferAttribute(new Float32Array(fall), 1));
  g.setIndex(index);
  g.computeBoundingSphere();

  const material = new ShaderMaterial({
    uniforms: UniformsUtils.merge([UniformsLib.fog]),
    vertexShader: WATERFALL_VERTEX,
    fragmentShader: WATERFALL_FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    fog: true,
  });
  material.uniforms['uTime'] = time;
  material.uniforms['uLight'] = light;
  material.name = 'custom-map-waterfall';
  const mesh = new Mesh(g, material);
  mesh.name = 'custom-map-waterfalls';
  mesh.renderOrder = 2;
  mesh.userData['losTransparent'] = true;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

const WATERFALL_VERTEX = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
attribute float aAcross;
attribute float aFall;
varying vec2 vUv;
varying float vAcross;
varying float vFall;
void main() {
  vUv = uv;
  vAcross = aAcross;
  vFall = aFall;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}
`;

const WATERFALL_FRAGMENT = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
uniform float uTime;
uniform float uLight;
varying vec2 vUv;
varying float vAcross;
varying float vFall;
${SHADER_NOISE}
void main() {
  #include <logdepthbuf_fragment>
  vec3 deep = vec3(0.32, 0.45, 0.5);
  vec3 white = vec3(0.92, 0.96, 0.97);
  vec3 color;
  float alpha;
  if (vFall < 0.0) {
    // Foam on the pool: churning rings that spread from the foot and break up towards the rim
    float r = length(vUv);
    float a = atan(vUv.y, vUv.x);
    float churn = valueNoise(vec2(a * 3.0, r * 6.0 - uTime * 1.4)) * 0.6 + valueNoise(vec2(a * 7.0 + 3.0, r * 11.0 - uTime * 2.2)) * 0.4;
    float foam = smoothstep(0.35, 0.75, churn + (1.0 - r) * 0.35);
    color = mix(deep, white, 0.5 + foam * 0.45) * uLight;
    alpha = foam * (1.0 - smoothstep(0.55, 1.0, r)) * 0.85;
  } else {
    // Two layers of streaks stretched along the fall, scrolling down: a slow body, a fast bright front
    vec2 p = vec2(vUv.x * 6.0, vUv.y * 1.2 - uTime * 1.3);
    float body = valueNoise(p * vec2(1.0, 0.25)) * 0.6 + valueNoise(p * vec2(2.3, 0.5) + 7.0) * 0.4;
    vec2 q = vec2(vUv.x * 9.0 + 4.0, vUv.y * 1.6 - uTime * 2.4);
    float front = valueNoise(q * vec2(1.0, 0.2)) * 0.7 + valueNoise(q * vec2(2.7, 0.6) + 11.0) * 0.3;
    float foam = max(smoothstep(0.45, 0.85, body), smoothstep(0.55, 0.85, front) * 0.9);
    // Lower down the water breaks into white
    foam = mix(foam, 1.0, smoothstep(0.55, 1.0, vFall) * 0.45);
    color = mix(deep, white, foam * 0.8 + 0.15) * uLight;
    // Sides fray, more as it falls and spreads; the lip starts thin, the foot dissolves into the spray
    float wobble = valueNoise(vec2(vAcross * 3.0, vUv.y * 0.7 - uTime * 1.3)) - 0.5;
    float edge = min(vAcross, 1.0 - vAcross) + wobble * (0.25 + 0.2 * vFall) + (body - 0.5) * 0.1;
    float side = smoothstep(0.02, 0.24 + 0.16 * vFall, edge);
    alpha = (0.5 + foam * 0.45) * smoothstep(0.0, 0.06, vFall) * (1.0 - smoothstep(0.82, 1.0, vFall + (front - 0.5) * 0.15)) * side;
  }
  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;
