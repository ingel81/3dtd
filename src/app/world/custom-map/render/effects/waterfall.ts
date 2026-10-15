import { BufferAttribute, BufferGeometry, DoubleSide, Matrix4, Mesh, ShaderMaterial, UniformsLib, UniformsUtils, Vector3 } from 'three';
import { SHADER_NOISE } from '../shader-noise';

/**
 * Waterfall sheets: per waterfall object a curved strip from its lip down to
 * its foot, the water streaking down it. Local frame of the object: the lip
 * runs along x at `height`, the water leaves towards +z (the object's front)
 * and falls to y = 0, bulging out a little as it drops. All sheets of a map
 * share one geometry buffer (merged in scene space) and one material.
 *
 * The sheet does not vanish into a slope (`fallReach`): where the rock falls
 * away below the lip as a steep slope rather than a wall (a river's cascade
 * over a slope), each row of it is pushed out until it hangs over the
 * ground and the river's ribbon, so the water pours down the face.
 *
 * The sheet has no corners: its sides fray and spread as it falls, the lip
 * starts thin and the foot dissolves into the spray. It bows out a little
 * in the middle, and a second, narrower sheet hangs just behind it with its
 * streaks shifted, so it reads as a body of water, not a card. Two layers
 * of streaks at different speeds and scales run down it (a fast bright
 * front over a slower body), with fine threads over them; between the
 * streaks the sheet thins out. At the lip the water is smooth and glassy,
 * a band of light where it bends over the edge, and breaks into streaks as
 * it falls. Where the water lands on a pool, a disc of churning foam
 * lies on the pool's surface (`pool`, same mesh and material) when the
 * water there is still; on a river sloping away below the foot it would
 * stand out of the surface. A step of a cascade gets none (effect-layer.ts):
 * its water runs on down the next sheet.
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
  /** How far out in front of the lip each row of the sheet hangs (fallReach), ROWS + 1 of them; the plain curve without */
  reach?: number[];
}

const ROWS = 16;
const COLS = 8;
/** Metres a row of the sheet may sink into the ground before it is pushed out over it */
const SINK = 0.25;
/** Metres a row hangs at least over a river's surface sloping down under it, so the ribbon does not hide it */
const LIFT = 0.2;
/** Metres a pushed row moves out per test */
const PUSH = 0.25;

/** How far out in front of the lip the plain sheet hangs, at 0..1 down it */
function plainReach(height: number, t: number): number {
  return Math.min(height * 0.2, 3) * Math.sqrt(t);
}

/** Height of a row 0..1 down the sheet over its foot, in the object's frame */
function rowHeight(height: number, t: number): number {
  return height * (1 - t * t * 0.15 - t * 0.85);
}

/**
 * How far out in front of the lip each row of a fall hangs, ROWS + 1 of
 * them, lip first: the plain curve, each row pushed out (never back) while
 * it lies in a face that falls away in front of it: ground more than SINK
 * over it, or a river's surface less than LIFT under it (a river's ribbon
 * runs down a cascade's slope and would hide the sheet). A fall over a wall
 * keeps its curve; one over a steep slope pours down the face, over the
 * ribbon. Ground or water that does not fall away in front (a bank, a
 * pool) stops the push: the foot of a fall lies in its pool. A row pushes
 * at most as far out as the fall drops (a slope gentler than that is
 * rapids, not a fall), so a misplaced sheet does not shoot out across the
 * land. Scene coordinates for `groundAt` and `levelAt` (x, z).
 */
export function fallReach(
  matrix: Matrix4,
  height: number,
  groundAt: (x: number, z: number) => number,
  levelAt: (x: number, z: number) => number | null = () => null,
): number[] {
  const e = matrix.elements;
  const most = height;
  const reach: number[] = [];
  const surface = (y: number, d: number): { ground: number; water: number } => {
    const x = e[4] * y + e[8] * d + e[12];
    const z = e[6] * y + e[10] * d + e[14];
    const ground = groundAt(x, z);
    return { ground, water: levelAt(x, z) ?? -Infinity };
  };
  let d = 0;
  for (let r = 0; r <= ROWS; r++) {
    const t = r / ROWS;
    const y = rowHeight(height, t);
    const level = e[13] + e[5] * y;
    d = Math.max(d, plainReach(height, t));
    while (d < most) {
      const here = surface(y, d);
      if (here.ground <= level + SINK && here.water <= level - LIFT) break;
      const ahead = surface(y, d + 1);
      // Only a face that falls away in front: not a bank, not a pool
      if (Math.max(ahead.ground, ahead.water) > Math.max(here.ground, here.water) - 0.5) break;
      d += PUSH;
    }
    reach.push(Math.min(d, most));
  }
  return reach;
}

/** Where a fall's sheet ends, in the frame `matrix` places it in */
export function fallFoot(matrix: Matrix4, spec: { height: number; reach?: number[] }, out = new Vector3()): Vector3 {
  return out.set(0, 0, spec.reach?.[ROWS] ?? plainReach(spec.height, 1)).applyMatrix4(matrix);
}

/** Where a fall's sheet starts: its lip, at the first row's reach */
export function fallLip(matrix: Matrix4, spec: { height: number; reach?: number[] }, out = new Vector3()): Vector3 {
  return out.set(0, spec.height, spec.reach?.[0] ?? 0).applyMatrix4(matrix);
}

/** Segments of the foam disc around its middle */
const DISC = 16;

export function buildWaterfalls(
  specs: WaterfallSpec[],
  time: { value: number },
  light: { value: number },
  /** Level of the water at a scene point (x, z), null on dry ground: a foam disc only on still water */
  levelAt: (x: number, z: number) => number | null = () => null,
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
    const out = spec.reach?.[ROWS] ?? plainReach(spec.height, 1);
    // The front sheet bowed out in the middle, and a narrower one just behind it, its streaks shifted
    const bow = Math.min(spec.radius * 0.2, 0.6);
    for (const [width, back, shift] of [[1, 0, 0], [0.8, -Math.min(spec.radius * 0.15, 0.5), 3.7]]) {
      const base = pos.length / 3;
      for (let r = 0; r <= ROWS; r++) {
        const t = r / ROWS;
        // Out from the lip, then straight down with a slight bulge; a little wider as it falls
        const y = rowHeight(spec.height, t);
        // The back sheet hangs behind only where the front one keeps its curve; over a slope it would sink into it
        const plain = plainReach(spec.height, t);
        const reach = spec.reach?.[r] ?? plain;
        const z = reach + (reach > plain + 1e-6 ? 0 : back * Math.min(1, t * 4));
        const spread = (1 + t * 0.25) * width;
        for (let c = 0; c <= COLS; c++) {
          const a = c / COLS - 0.5;
          put(e, a * 2 * spec.radius * spread, y, z + bow * (1 - 4 * a * a) * Math.min(1, t * 3));
          uv.push((c / COLS) * spec.radius * 0.5 + shift, t * spec.height * 0.25 + shift);
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
    }
    if (spec.pool !== null && spec.pool !== undefined && still(e, spec.pool, out, spec.radius * 1.6, levelAt)) {
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

/**
 * Whether the water under a foam disc is still: its level at the rim (where
 * there is water) within 0.3 m of the level at the foot. A river falling
 * away below the foot gets no disc, a flat one would stand out of its slope.
 */
function still(e: number[], pool: number, out: number, reach: number, levelAt: (x: number, z: number) => number | null): boolean {
  for (let k = 0; k < DISC; k++) {
    const a = (k / DISC) * Math.PI * 2;
    const x = Math.cos(a) * reach;
    const z = out + Math.sin(a) * reach * 0.8;
    const level = levelAt(e[0] * x + e[8] * z + e[12], e[2] * x + e[10] * z + e[14]);
    if (level !== null && Math.abs(level - (e[13] + pool)) > 0.3) return false;
  }
  return true;
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
    // Fine threads running down over the streaks
    float threads = valueNoise(vec2(vUv.x * 26.0 + 2.0, vUv.y * 0.9 - uTime * 2.0));
    float foam = max(smoothstep(0.45, 0.85, body), smoothstep(0.55, 0.85, front) * 0.9);
    foam = clamp(foam + (threads - 0.5) * 0.35, 0.0, 1.0);
    // Smooth and glassy at the lip, breaking into streaks as it falls; lower down the water breaks into white
    float lip = 1.0 - smoothstep(0.0, 0.16, vFall);
    foam *= 1.0 - lip * 0.75;
    foam = mix(foam, 1.0, smoothstep(0.55, 1.0, vFall) * 0.45);
    // A band of light where the water bends over the edge
    float sheen = smoothstep(0.01, 0.05, vFall) * (1.0 - smoothstep(0.05, 0.13, vFall)) * (0.7 + 0.3 * threads);
    color = (mix(deep, white, foam * 0.8 + 0.15) + vec3(0.35, 0.4, 0.42) * sheen) * uLight;
    // Sides fray, more as it falls and spreads; the lip starts thin, the foot dissolves into the spray
    float wobble = valueNoise(vec2(vAcross * 3.0, vUv.y * 0.7 - uTime * 1.3)) - 0.5;
    float edge = min(vAcross, 1.0 - vAcross) + wobble * (0.25 + 0.2 * vFall) + (body - 0.5) * 0.1;
    float side = smoothstep(0.02, 0.24 + 0.16 * vFall, edge);
    alpha = (0.4 + foam * 0.55 + lip * 0.25) * smoothstep(0.0, 0.06, vFall) * (1.0 - smoothstep(0.82, 1.0, vFall + (front - 0.5) * 0.15)) * side;
  }
  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;
