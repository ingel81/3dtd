import { BufferAttribute, MeshDepthMaterial, RGBADepthPacking, type BufferGeometry, type Material, type Texture } from 'three';
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
 * - stage 3: what stands above a ragged break line falls (from `fallStart`
 *   on the view's clock, uDamageTime) and is gone once it lies; the stump
 *   stays, cut along the break line. How it falls is one of the collapse
 *   variants (COLLAPSE_VARIANTS, uCollapse, E259), all in the vertex shader
 *   from the instance's numbers and the clock: `tip` (as before) tips whole
 *   about the foot of the side it gives way to and sinks; `sag` comes down
 *   storey by storey into itself; `chunks` breaks into pieces that tip
 *   apart, the back wall last; `tip-break` tips and breaks in bands that
 *   part and land. A piece is chosen per triangle from its anchor
 *   (aDamageAnchor, ruinGeometry), so a triangle goes whole with one piece.
 *   The triangles that cross the break line go while it falls, the dust
 *   hides it
 *
 * Every number comes from the structure's id (`structureSeed`) and its
 * frame, so every partner and every replay sees the same ruin. The shapes
 * are worked out here once per object (`ruinShape`); the shader only adds
 * ragged edges and shading.
 */

/** A fall start long past: the ruin lies as it fell (after a load, a seek, a restore) */
export const FELL_LONG_AGO = -1e6;

/**
 * How a building falls (E259, for the user to choose; the window
 * Destruction switches them): `tip` as before, `sag` into itself storey by
 * storey, `chunks` in pieces, `tip-break` tipping in bands that part
 */
export const COLLAPSE_VARIANTS = ['tip', 'sag', 'chunks', 'tip-break'] as const;
export type CollapseVariant = (typeof COLLAPSE_VARIANTS)[number];

/** Shared by every view: the clock falls run on (s), the cracks, the collapse variant (its index) */
export const DAMAGE_UNIFORMS: { uDamageTime: { value: number }; uCrackMap: { value: Texture | null }; uCollapse: { value: number } } = {
  uDamageTime: { value: 0 },
  uCrackMap: { value: null },
  uCollapse: { value: 0 },
};

/** The collapse variant every view draws from now on (a uniform: no program changes) */
export function setCollapseVariant(v: CollapseVariant): void {
  DAMAGE_UNIFORMS.uCollapse.value = Math.max(0, COLLAPSE_VARIANTS.indexOf(v));
}

export function collapseVariant(): CollapseVariant {
  return COLLAPSE_VARIANTS[DAMAGE_UNIFORMS.uCollapse.value] ?? 'tip';
}

/** Seconds a fall of `fallS` takes in variant `v` (its index): sagging is a little slower, pieces land, settle and crumble */
export function collapseSeconds(fallS: number, v: number = DAMAGE_UNIFORMS.uCollapse.value): number {
  return fallS * (v < 0.5 ? 1 : v < 1.5 ? 1.25 : 1.9);
}

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
  /** Seconds the fall takes in the variant `tip` (collapseSeconds for the others) */
  fallS: number;
  /** The seat and the top (scene y), and a roll 0 to 1 the collapse variants vary each building by */
  seatY: number;
  topY: number;
  roll: number;
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
    seatY: f.seatY,
    topY: f.seatY + h,
    // As the attribute holds it: the shader and collapseCuts read the same number
    roll: Math.fround(roll(seed, 4)),
  };
}

/** Multipliers of a ruin's roll, one per collapse roll (dmgRoll in the shader) */
const COLLAPSE_PRIMES = [1, 7, 13, 29, 41, 53, 67, 79, 97];

/**
 * The k-th of a ruin's rolls for the collapse variants, 0 to 1, as the
 * shader works it out (dmgRoll): plain arithmetic on the roll, so float and
 * double agree
 */
export function collapseRoll(roll: number, k: number): number {
  const v = roll * COLLAPSE_PRIMES[k] + k * 0.618;
  return v - Math.floor(v);
}

/**
 * The heights (scene y, rising) where a fallen building's upper part comes
 * apart in the variants that break it across (`chunks` above its middle,
 * `tip-break` in bands), as the shader cuts them: a raised building's walls
 * are split there, so each piece of wall lies in one piece
 */
export function collapseCuts(s: RuinShape): number[] {
  const hu = Math.max(1, s.topY - s.breakY);
  const out = [s.breakY + hu * (0.45 + 0.2 * collapseRoll(s.roll, 3))];
  if (hu > 4) out.push(s.breakY + hu * (0.38 + 0.14 * collapseRoll(s.roll, 1)));
  if (hu > 9) out.push(s.breakY + hu * (0.68 + 0.12 * collapseRoll(s.roll, 2)));
  return out.sort((a, b) => a - b);
}

/** The four instance attributes of the damage, four floats per object each */
export type DamageArrays = readonly [Float32Array, Float32Array, Float32Array, Float32Array];

/** The damage attributes' names, in the order of DamageArrays */
export const DAMAGE_ATTRIBUTES = ['aDamage', 'aDamageB', 'aDamageC', 'aDamageD'] as const;

/** Empty damage arrays for `n` objects */
export function damageArrays(n: number): DamageArrays {
  return [new Float32Array(n * 4), new Float32Array(n * 4), new Float32Array(n * 4), new Float32Array(n * 4)];
}

/**
 * One object's damage at `i`: aDamage (stage, fall start, heading, break
 * height), aDamageB (bite centre, radius), aDamageC (middle x, z, reach,
 * fall seconds), aDamageD (roll, seat, top)
 */
export function writeDamage([a, b, c, d]: DamageArrays, i: number, stage: number, fallStart: number, s: RuinShape): void {
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
  d[at] = s.roll;
  d[at + 1] = s.seatY;
  d[at + 2] = s.topY;
  d[at + 3] = 0;
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
export function readDamage([a, b, c, d]: DamageArrays, i: number): RuinShape {
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
    roll: d[at],
    seatY: d[at + 1],
    topY: d[at + 2],
  };
}

const anchored = new WeakMap<BufferGeometry, BufferGeometry>();

/**
 * A model's geometry as a ruin draws it: each triangle on corners of its
 * own, which carry its middle (aDamageAnchor), so a collapse variant moves
 * the triangle whole with the piece its middle lies in. Made once per
 * geometry, freed with it
 */
export function ruinGeometry(source: BufferGeometry): BufferGeometry {
  const known = anchored.get(source);
  if (known) return known;
  const g = source.index ? source.toNonIndexed() : source.clone();
  const p = g.getAttribute('position');
  const anchor = new Float32Array(p.count * 3);
  for (let v = 0; v + 2 < p.count; v += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const m = (p.getComponent(v, axis) + p.getComponent(v + 1, axis) + p.getComponent(v + 2, axis)) / 3;
      anchor[v * 3 + axis] = anchor[(v + 1) * 3 + axis] = anchor[(v + 2) * 3 + axis] = m;
    }
  }
  g.setAttribute('aDamageAnchor', new BufferAttribute(anchor, 3));
  anchored.set(source, g);
  source.addEventListener('dispose', () => {
    g.dispose();
    anchored.delete(source);
  });
  return g;
}

/** A unit geometry of a ruin's instances, every corner anchored at (`x`, `y`, `z`): each instance goes whole */
export function anchoredGeometry(source: BufferGeometry, x: number, y: number, z: number): BufferGeometry {
  const g = source.clone();
  const n = g.getAttribute('position').count;
  const anchor = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) anchor.set([x, y, z], v * 3);
  g.setAttribute('aDamageAnchor', new BufferAttribute(anchor, 3));
  return g;
}

const VARYINGS = /* glsl */ `
varying vec3 vDmgP;
varying float vDmgSide;
varying vec4 vDmg;
varying vec4 vDmgB;
varying vec4 vDmgC;
`;

/** What the vertex and fragment shaders both know of a collapse: its variant (uCollapse) and how long it takes */
const COLLAPSE_PARS = /* glsl */ `
uniform float uCollapse;
// collapseSeconds
float damageSeconds(float fallS) {
  return fallS * (uCollapse < 0.5 ? 1.0 : uCollapse < 1.5 ? 1.25 : 1.9);
}
`;

/** Attributes, the fall in each collapse variant and what the fragment needs */
const DAMAGE_VERTEX_PARS = /* glsl */ `
attribute vec4 aDamage;
attribute vec4 aDamageB;
attribute vec4 aDamageC;
attribute vec4 aDamageD;
attribute vec3 aDamageAnchor;
uniform float uDamageTime;
${COLLAPSE_PARS}
${VARYINGS}
// A roll of the ruin, 0 to 1 (collapseRoll: k and its multiplier)
float dmgRoll(float prime, float k) {
  return fract(aDamageD.x * prime + k * 0.618);
}
vec3 dmgHash3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
vec3 dmgAt(vec2 xz, float y) {
  return vec3(xz.x, y, xz.y);
}
vec2 dmgTurn(vec2 d, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * d.x - s * d.y, s * d.x + c * d.y);
}
mat4 dmgShift(vec3 v) {
  return mat4(vec4(1.0, 0.0, 0.0, 0.0), vec4(0.0, 1.0, 0.0, 0.0), vec4(0.0, 0.0, 1.0, 0.0), vec4(v, 1.0));
}
// Turning by th about the level line across d through the pivot: the top towards d (k = up x d)
mat4 dmgTip(vec3 pivot, vec2 d, float th) {
  vec3 k = vec3(d.y, 0.0, -d.x);
  float c = cos(th);
  float s = sin(th);
  float ic = 1.0 - c;
  mat3 r = mat3(
    c + k.x * k.x * ic, k.y * k.x * ic + k.z * s, k.z * k.x * ic - k.y * s,
    k.x * k.y * ic - k.z * s, c + k.y * k.y * ic, k.z * k.y * ic + k.x * s,
    k.x * k.z * ic + k.y * s, k.y * k.z * ic - k.x * s, c + k.z * k.z * ic);
  return mat4(vec4(r[0], 0.0), vec4(r[1], 0.0), vec4(r[2], 0.0), vec4(pivot - r * pivot, 1.0));
}
// Turning by a about the upright through a point
mat4 dmgYaw(vec2 at, float a) {
  float c = cos(a);
  float s = sin(a);
  mat3 r = mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
  vec3 p = vec3(at.x, 0.0, at.y);
  return mat4(vec4(r[0], 0.0), vec4(r[1], 0.0), vec4(r[2], 0.0), vec4(p - r * p, 1.0));
}
// A piece toppling about its foot from s seconds on (acc rad/s^2 until it lies at maxTh), going down drop m onto
// the ground as it comes to lie, a jolt where it lands: (angle, metres down)
vec2 dmgTopple(float s, float acc, float maxTh, float drop) {
  if (s <= 0.0) return vec2(0.0);
  float th = min(maxTh, acc * s * s);
  float after = s - sqrt(0.75 * maxTh / acc);
  float down = 0.0;
  if (after > 0.0) {
    float fall = sqrt(2.0 * max(drop, 0.05) / 9.81) + 0.15;
    float f = min(1.0, after / fall);
    down = drop * f * f;
    float k = (after - fall) / 0.45;
    if (k > 0.0 && k < 1.0) {
      float jolt = sin(k * 3.14159) * (1.0 - k);
      th += 0.07 * jolt;
      down -= min(0.4, 0.15 * drop) * jolt;
    }
  }
  return vec2(th, down);
}
// tip: whole about the foot of the side it gives way to, sinking as it goes
mat4 dmgFallTip(float t) {
  vec2 d = vec2(cos(aDamage.z), sin(aDamage.z));
  vec3 pivot = dmgAt(aDamageC.xy + d * aDamageC.z, aDamage.w);
  return dmgShift(vec3(0.0, -2.5 * t * t, 0.0)) * dmgTip(pivot, d, 1.4 * t * t);
}
// sag: down into itself storey by storey from the top, the side it leans to first; what is down is crushed,
// bulges out and goes into the stump at the end. Each point on its own: the walls stay whole as they crumple
vec3 dmgSag(vec3 p, float t) {
  float base = aDamage.w;
  float top = max(aDamageD.z, base + 1.0);
  float hu = top - base;
  vec2 c = aDamageC.xy;
  vec2 lean = dmgTurn(vec2(cos(aDamage.z), sin(aDamage.z)), (dmgRoll(41.0, 4.0) - 0.5) * 2.0);
  float storeys = max(1.0, floor(hu / 3.0 + 0.5));
  // Each storey a quick drop and a short hold, faster as it goes
  float run = pow(clamp(t / 0.8, 0.0, 1.0), 1.0 + 0.5 * dmgRoll(53.0, 5.0)) * storeys;
  float k = min(floor(run), storeys);
  float down = min(1.0, (k + smoothstep(0.0, 0.6, run - k)) / storeys);
  float slant = -dot(p.xz - c, lean) * (0.08 + 0.12 * dmgRoll(67.0, 6.0)) * (1.0 - down);
  float front = max(base, top - hu * down + slant);
  if (p.y <= front) return p;
  float end = smoothstep(0.8, 1.0, t);
  float y = front + (p.y - front) * 0.14 * (1.0 - end) - end * 0.7;
  float crushed = p.y - y;
  vec2 out2 = p.xz - c;
  vec2 xz = p.xz + (out2 / (length(out2) + 1e-3) * min(1.4, crushed * 0.06) + lean * min(1.8, crushed * 0.04)) * (1.0 - end);
  vec3 h = dmgHash3(p) - 0.5;
  xz += h.xy * min(0.8, crushed * 0.08);
  y += h.z * min(0.5, crushed * 0.05);
  return vec3(xz.x, y, xz.y);
}
// chunks: the upper part breaks into pieces (a cut across its heading, one along it, its top half over the
// middle) that tip apart one after the other and land; the back wall stands a moment longer and falls into the hole
vec3 dmgChunks(vec3 p, vec3 anchor, float s) {
  vec2 d = vec2(cos(aDamage.z), sin(aDamage.z));
  vec2 c = aDamageC.xy;
  float reach = max(aDamageC.z, 1.0);
  float base = aDamage.w;
  float seat = aDamageD.y;
  float hu = max(aDamageD.z - base, 1.0);
  vec2 q = anchor.xz - c;
  float along = dot(q, d);
  float across = dot(q, vec2(-d.y, d.x));
  float backCut = -reach * (0.25 + 0.25 * dmgRoll(41.0, 4.0));
  float sideCut = reach * (dmgRoll(53.0, 5.0) - 0.5) * 0.5;
  float midCut = base + hu * (0.45 + 0.2 * dmgRoll(29.0, 3.0));
  float acc = 1.5 * clamp(10.0 / hu, 0.5, 1.6);
  bool firstLeft = dmgRoll(67.0, 6.0) < 0.5;
  vec2 dir = d;
  vec3 pivot;
  float start = 0.0;
  float twist = 0.0;
  float maxTh = 1.5;
  float drop = base - seat;
  float rate = acc;
  if (along < backCut && hu > 3.0) {
    pivot = dmgAt(c + d * backCut, base);
    start = 0.7 + 0.5 * dmgRoll(79.0, 7.0);
    maxTh = 1.2;
    drop *= 0.8;
  } else {
    bool left = across < sideCut;
    float turn = (left ? 1.0 : -1.0) * (0.2 + 0.3 * dmgRoll(left ? 97.0 : 79.0, 8.0));
    dir = dmgTurn(d, turn);
    pivot = dmgAt(c + dir * reach, base);
    bool first = left == firstLeft;
    start = first ? 0.0 : 0.15 + 0.25 * dmgRoll(97.0, 2.0);
    twist = turn * 0.5;
    if (first && anchor.y > midCut) {
      // Its top breaks off before it, turns more and goes further
      pivot = dmgAt(c + dir * reach, midCut);
      start = -0.15;
      twist = turn * 1.6;
      drop = midCut - seat;
      rate = acc * 1.3;
    }
  }
  vec2 f = dmgTopple(s - start, rate, maxTh, drop);
  mat4 m = dmgShift(vec3(0.0, -f.y, 0.0)) * dmgTip(pivot, dir, f.x) * dmgYaw(pivot.xz, twist * min(1.0, f.x / maxTh));
  return (m * vec4(p, 1.0)).xyz;
}
// tip-break: tips about the foot of the side it gives way to and breaks in two or three bands (collapseCuts) that
// lag behind (their joints open in front), lands flat, the bands slid apart, and settles
vec3 dmgTipBreak(vec3 p, vec3 anchor, float s) {
  vec2 d = vec2(cos(aDamage.z), sin(aDamage.z));
  vec2 c = aDamageC.xy;
  float reach = max(aDamageC.z, 1.0);
  float base = aDamage.w;
  float hu = max(aDamageD.z - base, 1.0);
  float maxTh = 1.52;
  vec2 f = dmgTopple(s, 1.2 * clamp(10.0 / hu, 0.5, 1.6), maxTh, base - aDamageD.y);
  float lie = clamp(f.x / maxTh, 0.0, 1.0);
  float kink = sin(3.14159 * lie);
  vec2 back = c - d * reach;
  mat4 bend = mat4(1.0);
  vec2 slide = vec2(0.0);
  float b1 = base + hu * (0.38 + 0.14 * dmgRoll(7.0, 1.0));
  float b2 = base + hu * (0.68 + 0.12 * dmgRoll(13.0, 2.0));
  if (hu > 4.0 && anchor.y > b1) {
    bend = dmgTip(dmgAt(back, b1), d, -kink * (0.18 + 0.14 * dmgRoll(41.0, 4.0))) * dmgYaw(c, (dmgRoll(53.0, 5.0) - 0.5) * 0.5 * lie);
    slide += d * (0.8 + 1.2 * dmgRoll(67.0, 6.0));
  }
  if (hu > 9.0 && anchor.y > b2) {
    bend = bend * dmgTip(dmgAt(back, b2), d, -kink * (0.22 + 0.16 * dmgRoll(79.0, 7.0))) * dmgYaw(c, (dmgRoll(97.0, 8.0) - 0.5) * 0.6 * lie);
    slide += d * (1.0 + 1.5 * dmgRoll(97.0, 3.0)) + vec2(-d.y, d.x) * (dmgRoll(41.0, 2.0) - 0.5) * 1.5;
  }
  slide *= smoothstep(0.6, 1.0, lie);
  mat4 m = dmgShift(vec3(slide.x, -f.y, slide.y)) * dmgTip(dmgAt(c + d * reach, base), d, f.x) * bend;
  return (m * vec4(p, 1.0)).xyz;
}
// Where a point of the ruin is drawn (group frame): at rest, or with its piece (that of its anchor) as it falls.
// In chunks and tip-break a triangle across the break line goes whole with the side its anchor is on
vec3 damageMove(vec3 p, vec3 anchor) {
  if (aDamage.x < 2.5 || (uCollapse > 1.5 ? anchor.y : p.y) < aDamage.w) return p;
  float s = uDamageTime - aDamage.y;
  float dur = damageSeconds(aDamageC.w);
  if (s <= 0.0 || s >= dur) return p;
  if (uCollapse < 0.5) return (dmgFallTip(s / dur) * vec4(p, 1.0)).xyz;
  if (uCollapse < 1.5) return dmgSag(p, s / dur);
  if (uCollapse < 2.5) return dmgChunks(p, anchor, s);
  return dmgTipBreak(p, anchor, s);
}
void damageVaryings(vec3 rest, vec3 anchor) {
  vDmgP = rest;
  vDmgSide = step(aDamage.w, uCollapse > 1.5 ? anchor.y : rest.y);
  vDmg = aDamage;
  vDmgB = aDamageB;
  vDmgC = aDamageC;
}
`;

/** project_vertex with the fall between the instance and the model matrix (and the rest position for the fragment) */
const DAMAGE_PROJECT_VERTEX = /* glsl */ `
vec4 dmgRest = instanceMatrix * vec4(transformed, 1.0);
vec3 dmgAnchor = (instanceMatrix * vec4(aDamageAnchor, 1.0)).xyz;
damageVaryings(dmgRest.xyz, dmgAnchor);
vec4 dmgMoved = vec4(damageMove(dmgRest.xyz, dmgAnchor), 1.0);
vec4 mvPosition = modelViewMatrix * dmgMoved;
gl_Position = projectionMatrix * mvPosition;
`;

const DAMAGE_WORLDPOS_VERTEX = /* glsl */ `
#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
vec4 worldPosition = modelMatrix * dmgMoved;
#endif
`;

/** What every damaged surface's fragment knows: the ragged edges, the cut and what is left of a wall's edge */
const DAMAGE_FRAGMENT_PARS = /* glsl */ `
uniform float uDamageTime;
${COLLAPSE_PARS}
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
  if (vDmg.x > 2.5 && (uDamageTime - vDmg.y) >= damageSeconds(vDmgC.w)) e = min(e, damageCut(vDmgP) - vDmgP.y);
  return e;
}
// How far a falling piece has crumbled into dust, 0 to 1 and past (chunks and tip-break, once it has landed)
float damageCrumble() {
  if (vDmg.x < 2.5 || uCollapse < 1.5 || vDmgSide < 0.5) return 0.0;
  float t = (uDamageTime - vDmg.y) / damageSeconds(vDmgC.w);
  return t < 1.0 ? smoothstep(0.62, 0.97, t) * 1.05 : 0.0;
}
// The grain it crumbles by, on the surface at rest
float dmgGrain(vec3 p) {
  return dmgNoise(p.xz * 1.3 + p.y * 0.9) * 0.7 + dmgNoise(p.xy * 4.1 + p.z * 1.7) * 0.3;
}
// Soot on the surface, which is matte (DAMAGE_COLOR_FRAGMENT sets it, the roughness reads it)
float dmgSoot = 0.0;
// Throws away what the damage took: the bite, while falling the triangles across the line, afterwards what stood above it
void damageClip() {
  if (vDmg.x < 1.5) return;
  if (damageBite(vDmgP) < 0.0) discard;
  if (vDmg.x > 2.5) {
    if ((uDamageTime - vDmg.y) < damageSeconds(vDmgC.w)) {
      // tip: the triangles across the line go; sag moves each point on its own, they stay whole; in chunks and
      // tip-break one goes whole with the side its anchor is on, what of one left standing reaches above goes
      if (uCollapse < 0.5 && vDmgSide > 0.002 && vDmgSide < 0.998) discard;
      if (uCollapse > 1.5 && vDmgSide < 0.5 && vDmgP.y > vDmg.w) discard;
      float crumble = damageCrumble();
      if (crumble > 0.0 && dmgGrain(vDmgP) < crumble) discard;
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
  // Dark along where a landed piece crumbles
  float crumble = damageCrumble();
  if (crumble > 0.0) diffuseColor.rgb *= 1.0 - 0.55 * (1.0 - smoothstep(crumble, crumble + 0.18, dmgGrain(vDmgP)));
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
