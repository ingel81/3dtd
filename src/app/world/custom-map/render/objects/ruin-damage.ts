import { MeshDepthMaterial, RGBADepthPacking, type Material, type Texture } from 'three';
import type { LosVertexPatch } from '../../../../three-engine/tower-shadow-mapper';
import { STRUCTURE_HEADING_STEPS } from '../../../../configs/destruction.config';
import { CRACK_TILE_M, crackTexture } from './crack-texture';

/**
 * How a damaged building looks (docs/DESTRUCTION_PLAN.md, Z2), in the shader
 * of its own model or raised walls: the simulation's stage per structure,
 * drawn from three vec4 per instance (`aDamage`, `aDamageB`, `aDamageC`,
 * written by `writeDamage`) in the frame of the layer's group, so a model
 * and a wall of a raised building read the same numbers.
 *
 * - stage 1: cracks (a drawn tile, crack-texture.ts, from three sides) and
 *   soot, denser on the side the building will give way to; windows dark
 * - stage 2: a bite out of a top corner, its edge ragged, charred and
 *   glowing in places; the inside shows its walls dimmed (the ruin's
 *   meshes are double-sided, intact buildings never are)
 * - stage 3: what stands above a ragged break line falls about the foot of
 *   the side it tips to, sinking as it goes (`fallS` seconds from
 *   `fallStart` on the view's clock, uDamageTime), and is gone where it
 *   lands; the stump stays, cut along the break line. The triangles that
 *   cross the line go while it falls (their corners part), the dust hides it
 *
 * Every number comes from the structure's id (`structureSeed`) and its
 * frame, so every partner and every replay sees the same ruin. The shapes
 * are worked out here once per object (`ruinShape`); the shader only adds
 * ragged edges and shading.
 */

/** A fall start long past: the ruin lies as it fell (after a load, a seek, a restore) */
export const FELL_LONG_AGO = -1e6;

/** Shared by every view: the clock falls run on (s) and the cracks */
export const DAMAGE_UNIFORMS: { uDamageTime: { value: number }; uCrackMap: { value: Texture | null } } = {
  uDamageTime: { value: 0 },
  uCrackMap: { value: null },
};

/** A building's footing in the layer's group frame: its middle, two half axes of its ground rectangle, its seat and height */
export interface RuinFrame {
  cx: number;
  cz: number;
  ax: number;
  az: number;
  bx: number;
  bz: number;
  seatY: number;
  height: number;
}

/** What a structure's damage looks like, in the group frame */
export interface RuinShape {
  /** Heading it gives way to (radians in the scene's x, z plane) */
  heading: number;
  /** Height of the break line (scene y): above it the building falls */
  breakY: number;
  /** The bite out of a top corner: centre and radius */
  biteX: number;
  biteY: number;
  biteZ: number;
  biteR: number;
  cx: number;
  cz: number;
  /** From the middle to the foot of the side it tips over (the pivot) */
  reach: number;
  /** Seconds the fall takes */
  fallS: number;
}

/** A number per structure id (FNV-1a), which the ruin is rolled from */
export function structureSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The number an object's ruin is rolled from: its map's `damageSeed` where it sets one, else its id */
export function ruinSeed(o: { id: string; damageSeed?: number }): number {
  return o.damageSeed === undefined ? structureSeed(o.id) : structureSeed(`${o.id}#${o.damageSeed}`);
}

/** The k-th roll of a seed, 0 to 1 */
function roll(seed: number, k: number): number {
  let h = Math.imul(seed ^ Math.imul(k + 1, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * The scene heading (radians in the x, z plane) of a structure's heading
 * step in map space (STRUCTURE_HEADING_STEPS, structureHeading), null for
 * none: scene x is map -x, scene z map y
 */
export function sceneHeading(step: number): number | null {
  if (step < 0) return null;
  const a = (step / STRUCTURE_HEADING_STEPS) * Math.PI * 2;
  return Math.atan2(Math.sin(a), -Math.cos(a));
}

/**
 * A structure's ruin from its seed and frame; it gives way to `heading`
 * (scene radians, the hit that brought its stage), or one its seed rolls
 */
export function ruinShape(seed: number, f: RuinFrame, heading: number | null = null): RuinShape {
  heading ??= roll(seed, 0) * Math.PI * 2;
  const dx = Math.cos(heading);
  const dz = Math.sin(heading);
  const da = f.ax * dx + f.az * dz;
  const db = f.bx * dx + f.bz * dz;
  // The stump: 1.5 to 4 m, never more than 55 % of the building
  const h = Math.max(0.5, f.height);
  const stump = Math.min(h * 0.55, 1.5 + roll(seed, 1) * 2.5);
  // The top corner on the side it gives way to, a little inside it
  const sa = da >= 0 ? 1 : -1;
  const sb = db >= 0 ? 1 : -1;
  const lenA = Math.hypot(f.ax, f.az);
  const lenB = Math.hypot(f.bx, f.bz);
  const inset = 0.75 + roll(seed, 2) * 0.15;
  return {
    heading,
    breakY: f.seatY + stump,
    biteX: f.cx + (sa * f.ax + sb * f.bx) * inset,
    biteY: f.seatY + h * (0.82 + roll(seed, 3) * 0.18),
    biteZ: f.cz + (sa * f.az + sb * f.bz) * inset,
    biteR: Math.min(7, Math.max(1.2, Math.min(h * 0.6, (lenA + lenB) * 0.7))),
    cx: f.cx,
    cz: f.cz,
    reach: Math.abs(da) + Math.abs(db),
    fallS: Math.min(2.5, Math.max(1.2, 1.2 + h * 0.06)),
  };
}

/** The three instance attributes of the damage, four floats per object each */
export type DamageArrays = readonly [Float32Array, Float32Array, Float32Array];

/**
 * One object's damage at `i`: aDamage (stage, fall start, heading, break
 * height), aDamageB (bite centre, radius), aDamageC (middle x, z, reach,
 * fall seconds)
 */
export function writeDamage([a, b, c]: DamageArrays, i: number, stage: number, fallStart: number, s: RuinShape): void {
  const at = i * 4;
  a[at] = stage;
  a[at + 1] = fallStart;
  a[at + 2] = s.heading;
  a[at + 3] = s.breakY;
  b[at] = s.biteX;
  b[at + 1] = s.biteY;
  b[at + 2] = s.biteZ;
  b[at + 3] = s.biteR;
  c[at] = s.cx;
  c[at + 1] = s.cz;
  c[at + 2] = s.reach;
  c[at + 3] = s.fallS;
}

/** Smouldering nests at once, the newest ruins' (docs/DESTRUCTION_PLAN.md) */
export const RUIN_EMBERS = 12;

/** Where a ruin smoulders: low in its bite inside the walls, in a fallen one's stump (group frame) */
export function emberPoint<T extends { x: number; y: number; z: number }>(s: RuinShape, seatY: number, fallen: boolean, out: T): T {
  const k = 0.35;
  out.x = s.biteX + (s.cx - s.biteX) * k;
  out.z = s.biteZ + (s.cz - s.biteZ) * k;
  out.y = Math.max(seatY + 0.4, Math.min(s.biteY - s.biteR * 0.75, fallen ? s.breakY - 0.6 : Infinity));
  return out;
}

/** A ruin's shape back from its damage attributes at `i` (writeDamage) */
export function readDamage([a, b, c]: DamageArrays, i: number): RuinShape {
  const at = i * 4;
  return {
    heading: a[at + 2],
    breakY: a[at + 3],
    biteX: b[at],
    biteY: b[at + 1],
    biteZ: b[at + 2],
    biteR: b[at + 3],
    cx: c[at],
    cz: c[at + 1],
    reach: c[at + 2],
    fallS: c[at + 3],
  };
}

const VARYINGS = /* glsl */ `
varying vec3 vDmgP;
varying float vDmgSide;
varying vec4 vDmg;
varying vec4 vDmgB;
varying vec4 vDmgC;
`;

/** Attributes, the fall and what the fragment needs */
const DAMAGE_VERTEX_PARS = /* glsl */ `
attribute vec4 aDamage;
attribute vec4 aDamageB;
attribute vec4 aDamageC;
uniform float uDamageTime;
${VARYINGS}
// The fall of what stands above the break line: about the foot of the side it tips to, sinking as it goes
mat4 damageFall(float side) {
  float t = (uDamageTime - aDamage.y) / aDamageC.w;
  if (aDamage.x < 2.5 || side < 0.5 || t <= 0.0 || t >= 1.0) return mat4(1.0);
  vec2 d = vec2(cos(aDamage.z), sin(aDamage.z));
  vec3 pivot = vec3(aDamageC.x + d.x * aDamageC.z, aDamage.w, aDamageC.y + d.y * aDamageC.z);
  // Turning about k = up x d tips the top towards d
  vec3 k = vec3(d.y, 0.0, -d.x);
  float th = 1.4 * t * t;
  float c = cos(th);
  float s = sin(th);
  float ic = 1.0 - c;
  mat3 r = mat3(
    c + k.x * k.x * ic, k.y * k.x * ic + k.z * s, k.z * k.x * ic - k.y * s,
    k.x * k.y * ic - k.z * s, c + k.y * k.y * ic, k.z * k.y * ic + k.x * s,
    k.x * k.z * ic + k.y * s, k.y * k.z * ic - k.x * s, c + k.z * k.z * ic);
  vec3 move = pivot - r * pivot - vec3(0.0, 2.5 * t * t, 0.0);
  return mat4(vec4(r[0], 0.0), vec4(r[1], 0.0), vec4(r[2], 0.0), vec4(move, 1.0));
}
void damageVaryings(vec3 rest) {
  vDmgP = rest;
  vDmgSide = step(aDamage.w, rest.y);
  vDmg = aDamage;
  vDmgB = aDamageB;
  vDmgC = aDamageC;
}
`;

/** project_vertex with the fall between the instance and the model matrix (and the rest position for the fragment) */
const DAMAGE_PROJECT_VERTEX = /* glsl */ `
vec4 dmgRest = instanceMatrix * vec4(transformed, 1.0);
damageVaryings(dmgRest.xyz);
mat4 dmgInstance = damageFall(vDmgSide) * instanceMatrix;
vec4 mvPosition = modelViewMatrix * (dmgInstance * vec4(transformed, 1.0));
gl_Position = projectionMatrix * mvPosition;
`;

const DAMAGE_WORLDPOS_VERTEX = /* glsl */ `
#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
vec4 worldPosition = modelMatrix * (dmgInstance * vec4(transformed, 1.0));
#endif
`;

/** What every damaged surface's fragment knows: the ragged edges, the cut and what is left of a wall's edge */
const DAMAGE_FRAGMENT_PARS = /* glsl */ `
uniform float uDamageTime;
${VARYINGS}
float dmgHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float dmgNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(dmgHash(i), dmgHash(i + vec2(1.0, 0.0)), f.x), mix(dmgHash(i + vec2(0.0, 1.0)), dmgHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// Height of the ragged break line at a point: broken masonry, not a saw cut
float damageCut(vec3 p) {
  return vDmg.w + (dmgNoise(p.xz * 0.8 + vDmg.z) - 0.5) * 1.3 + (dmgNoise(p.xz * 3.3) - 0.5) * 0.45;
}
// How far a point lies outside the bite, m (negative inside): its edge jagged by angle and height
float damageBite(vec3 p) {
  vec3 q = p - vDmgB.xyz;
  float a = atan(q.z, q.x);
  float jag = dmgNoise(vec2(a * 2.6, q.y * 0.9) + vDmg.z * 3.0) * 0.55 + dmgNoise(vec2(a * 9.0, q.y * 3.1)) * 0.25;
  return length(q) - vDmgB.w * (0.7 + jag);
}
// Metres to the nearest broken edge (bite or cut), large where there is none
float damageEdge() {
  float e = 1e3;
  if (vDmg.x > 1.5) e = damageBite(vDmgP);
  if (vDmg.x > 2.5 && (uDamageTime - vDmg.y) >= vDmgC.w) e = min(e, damageCut(vDmgP) - vDmgP.y);
  return e;
}
// Soot on the surface, which is matte (DAMAGE_COLOR_FRAGMENT sets it, the roughness reads it)
float dmgSoot = 0.0;
// Throws away what the damage took: the bite, while falling the triangles across the line, afterwards what stood above it
void damageClip() {
  if (vDmg.x < 1.5) return;
  if (damageBite(vDmgP) < 0.0) discard;
  if (vDmg.x > 2.5) {
    if ((uDamageTime - vDmg.y) < vDmgC.w) {
      if (vDmgSide > 0.002 && vDmgSide < 0.998) discard;
    } else if (vDmgP.y > damageCut(vDmgP)) discard;
  }
}
`;

/** Cracks and soot from stage 1, the inside dimmed, edges charred */
const DAMAGE_COLOR_FRAGMENT = /* glsl */ `
if (vDmg.x > 0.5) {
  vec3 toMid = vDmgP - vec3(vDmgC.x, vDmgP.y, vDmgC.y);
  vec2 dir = vec2(cos(vDmg.z), sin(vDmg.z));
  // The side it gives way to cracks first
  float lean = smoothstep(-0.3, 0.9, dot(normalize(toMid.xz + vec2(1e-4)), dir));
  float strength = (vDmg.x > 1.5 ? 1.0 : 0.7) * (0.45 + 0.55 * lean);
  // The crack tile from three sides, by the surface's facing
  vec3 fn = abs(normalize(cross(dFdx(vDmgP), dFdy(vDmgP))));
  fn /= fn.x + fn.y + fn.z + 1e-4;
  vec3 cp = vDmgP / ${CRACK_TILE_M.toFixed(1)};
  vec2 cr = texture2D(uCrackMap, cp.zy).rg * fn.x + texture2D(uCrackMap, cp.xz).rg * fn.y + texture2D(uCrackMap, cp.xy).rg * fn.z;
  float lines = max(cr.g, cr.r * smoothstep(0.3, 0.8, strength));
  // Soot in patches on that side, and round the broken edges
  float edge = damageEdge();
  float soot = smoothstep(0.6, 0.9, dmgNoise(vDmgP.xz * 0.35 + vDmgP.y * 0.25 + vDmg.z)) * strength * 0.5;
  soot = max(soot, (1.0 - smoothstep(0.0, 1.3, edge)) * 0.85);
  dmgSoot = soot;
  diffuseColor.rgb *= (1.0 - 0.75 * lines * strength) * (1.0 - 0.7 * soot);
  // The inside: the same wall, out of the light
  if (!gl_FrontFacing) diffuseColor.rgb *= 0.6;
}
`;

/** Lit windows go dark from stage 1; embers glow along a stage-2 ruin's edges */
const DAMAGE_EMISSIVE_FRAGMENT = /* glsl */ `
if (vDmg.x > 0.5) {
  totalEmissiveRadiance *= 0.0;
  if (vDmg.x > 1.5) {
    // Glowing in a few places along the broken edges, less once it has fallen
    float e = damageEdge();
    float spots = smoothstep(0.72, 0.88, dmgNoise(vDmgP.xz * 1.6 + vDmgP.y * 1.1 + vDmg.z));
    float flicker = 0.7 + 0.3 * sin(uDamageTime * 3.1 + dot(vDmgP, vec3(1.7, 2.3, 1.1)));
    float heat = vDmg.x > 2.5 ? 0.55 : 1.0;
    totalEmissiveRadiance += vec3(1.0, 0.3, 0.05) * (1.0 - smoothstep(0.0, 0.22, e)) * spots * flicker * heat * 1.5;
  }
}
`;

/** Shader GLSL for a material of a damaged building's mesh; wraps what compiles it so far */
export function addDamage(material: Material): void {
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  DAMAGE_UNIFORMS.uCrackMap.value ??= crackTexture();
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    Object.assign(shader.uniforms, DAMAGE_UNIFORMS);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${DAMAGE_VERTEX_PARS}`)
      .replace('#include <project_vertex>', DAMAGE_PROJECT_VERTEX)
      .replace('#include <worldpos_vertex>', DAMAGE_WORLDPOS_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${DAMAGE_FRAGMENT_PARS}\nuniform sampler2D uCrackMap;`)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\ndamageClip();')
      .replace('#include <roughnessmap_fragment>', `${DAMAGE_COLOR_FRAGMENT}\n#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 1.0, dmgSoot);`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>\n${DAMAGE_EMISSIVE_FRAGMENT}`);
  };
  material.customProgramCacheKey = () => `${prevKey.call(material)}-damage`;
}

/**
 * The sun's shadow of a damaged building: falls and discards as it does.
 * `vertex` runs first in begin_vertex (a raised wall's gable)
 */
export function damageDepthMaterial(key: string, pars = '', vertex = ''): MeshDepthMaterial {
  const m = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, DAMAGE_UNIFORMS);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${pars}\n${DAMAGE_VERTEX_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${vertex}`)
      .replace('#include <project_vertex>', DAMAGE_PROJECT_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${DAMAGE_FRAGMENT_PARS}`)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\ndamageClip();');
  };
  m.customProgramCacheKey = () => `damage-depth-${key}`;
  return m;
}

/** The towers' line of sight through a ruin: what is gone does not block (the fall itself it sees at rest) */
export const DAMAGE_LOS: LosVertexPatch = {
  key: 'ruin-damage',
  pars: `attribute vec4 aDamage;\nattribute vec4 aDamageB;\nattribute vec4 aDamageC;\n${VARYINGS}`,
  vertex: /* glsl */ `{
    vec4 dmgRest = localPos;
    #ifdef USE_INSTANCING
    dmgRest = instanceMatrix * dmgRest;
    #endif
    vDmgP = dmgRest.xyz;
    vDmgSide = step(aDamage.w, dmgRest.y);
    vDmg = aDamage;
    vDmgB = aDamageB;
    vDmgC = aDamageC;
  }`,
  uniforms: DAMAGE_UNIFORMS,
  fragmentPars: DAMAGE_FRAGMENT_PARS,
  fragment: 'damageClip();',
  doubleSided: true,
};
