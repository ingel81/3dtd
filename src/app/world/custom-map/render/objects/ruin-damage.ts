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
 *   about the foot of the side it gives way to and sinks; `impact` gives
 *   at the foot, tips under its weight slowly then fast, its upper storeys
 *   lagging, hits the ground, rebounds, breaks where it hit into the bands
 *   of collapseCuts and crumbles under the dust of the impact; `buckle`
 *   first sags and shudders at the break line, then falls as `impact`. A piece is chosen per triangle from its anchor (a
 *   model's triangle middle packed into one float, ruinGeometry; an
 *   instance's middle for the raised walls, roofs and slabs, a constant of
 *   their material), so a triangle goes whole with one piece.
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
 * Destruction switches them): `tip` as before (sinks), `impact` tips under
 * its weight and breaks on the ground, `buckle` gives way first, then as
 * `impact`
 */
export const COLLAPSE_VARIANTS = ['tip', 'impact', 'buckle'] as const;
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

/**
 * How a ruin topples in `impact` and `buckle` (dmgTiming in the shader, the
 * same numbers): it holds `hold` seconds while the foot gives, then tips
 * under its weight, the angle `TILT0` times cosh(`omega` t), as a rod about
 * its foot does (omega from its length, quickened), until it lies at `lie`
 * (past level by as much as its stump lets it reach the ground) at
 * `impact` seconds; it rebounds, breaks and crumbles until `seconds`
 */
export interface FallTiming {
  hold: number;
  omega: number;
  lie: number;
  impact: number;
  seconds: number;
}

/** The angle a toppling ruin leaves its foot with, radians */
const TILT0 = 0.12;
/** After the impact: the rebound, the break and the crumbling under the dust, s */
const AFTER_IMPACT = 2.4;

export function fallTiming(s: RuinShape, v: number = DAMAGE_UNIFORMS.uCollapse.value): FallTiming {
  const hold = v > 1.5 ? 0.75 : 0.3;
  const length = Math.max(Math.fround(s.topY) - Math.fround(s.breakY), 2);
  const stump = Math.max(0, s.breakY - s.seatY);
  const omega = 1.4 * Math.sqrt(14.715 / length);
  const lie = Math.PI / 2 + Math.asin(Math.min(0.9, stump / length));
  const impact = hold + Math.acosh(lie / TILT0) / omega;
  return { hold, omega, lie, impact, seconds: impact + AFTER_IMPACT };
}

/** Seconds a ruin's fall takes in variant `v` (its index): `tip` its fallS, the others until crumbled (fallTiming) */
export function collapseSeconds(s: RuinShape, v: number = DAMAGE_UNIFORMS.uCollapse.value): number {
  return v < 0.5 ? s.fallS : fallTiming(s, v).seconds;
}

/**
 * Where and when a ruin falling in variant `v` hits the ground (group
 * frame): the middle of where it lies, its length along the heading, the
 * seconds after the fall's start; null for `tip`, which sinks
 */
export function fallImpact(
  s: RuinShape, v: number = DAMAGE_UNIFORMS.uCollapse.value,
): { x: number; y: number; z: number; dx: number; dz: number; length: number; delay: number } | null {
  if (v < 0.5) return null;
  const t = fallTiming(s, v);
  const length = Math.max(s.topY - s.breakY, 2);
  const along = s.reach + length * 0.5;
  const dx = Math.cos(s.heading);
  const dz = Math.sin(s.heading);
  return { x: s.cx + dx * along, y: s.seatY, z: s.cz + dz * along, dx, dz, length, delay: t.impact };
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
    fallS: fallSeconds(h),
    seatY: f.seatY,
    topY: f.seatY + h,
    // As aDamage holds it (writeDamage): the shader and collapseCuts read the same number
    roll: Math.floor(roll(seed, 4) * ROLL_STEPS) / ROLL_STEPS,
  };
}

/** The roll in steps of 1/4096: in aDamage.x past the stage, a quarter of it, without a bit lost */
const ROLL_STEPS = 4096;

/** The stump in aDamageB.w over the bite's radius (under 8 m): steps of 1/64 m, times 8 */
const STUMP_STEPS = 64;
const BITE_SPAN = 8;

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

/**
 * The three instance attributes of the damage, four floats per object each.
 * Three, not more: a ruin's material with merged parts (roughness and
 * metalness per vertex, vertex colours, a second uv for the occlusion)
 * draws instanced with fading levels, and a vertex shader has 16 attribute
 * slots (ruin-attributes.spec.ts counts them)
 */
export type DamageArrays = readonly [Float32Array, Float32Array, Float32Array];

/** The damage attributes' names, in the order of DamageArrays */
export const DAMAGE_ATTRIBUTES = ['aDamage', 'aDamageB', 'aDamageC'] as const;

/** Empty damage arrays for `n` objects */
export function damageArrays(n: number): DamageArrays {
  return [new Float32Array(n * 4), new Float32Array(n * 4), new Float32Array(n * 4)];
}

/**
 * One object's damage at `i`: aDamage (stage plus a quarter of the roll,
 * fall start, heading, break height), aDamageB (bite centre; its radius
 * plus 8 times the stump in 1/64 m), aDamageC (middle x, z, reach, top).
 * The fall's seconds come from the height (ruinShape, dmgFallS)
 */
export function writeDamage([a, b, c]: DamageArrays, i: number, stage: number, fallStart: number, s: RuinShape): void {
  const at = i * 4;
  a[at] = stage + s.roll / 4;
  a[at + 1] = fallStart;
  a[at + 2] = s.heading;
  a[at + 3] = s.breakY;
  b[at] = s.biteX;
  b[at + 1] = s.biteY;
  b[at + 2] = s.biteZ;
  b[at + 3] = Math.min(s.biteR, BITE_SPAN - 0.01) + BITE_SPAN * Math.round(Math.max(0, s.breakY - s.seatY) * STUMP_STEPS);
  c[at] = s.cx;
  c[at + 1] = s.cz;
  c[at + 2] = s.reach;
  c[at + 3] = s.topY;
}

/** A fall's seconds from a building's height (ruinShape; dmgFallS in the shader) */
export function fallSeconds(height: number): number {
  return Math.min(2.5, Math.max(1.2, 1.2 + height * 0.06));
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

/** A ruin's shape back from its damage attributes at `i` (writeDamage), the packed numbers as the shader reads them */
export function readDamage([a, b, c]: DamageArrays, i: number): RuinShape {
  const at = i * 4;
  const breakY = a[at + 3];
  const seatY = breakY - Math.floor(b[at + 3] / BITE_SPAN) / STUMP_STEPS;
  return {
    heading: a[at + 2],
    breakY,
    biteX: b[at],
    biteY: b[at + 1],
    biteZ: b[at + 2],
    biteR: b[at + 3] % BITE_SPAN,
    cx: c[at],
    cz: c[at + 1],
    reach: c[at + 2],
    fallS: fallSeconds(c[at + 3] - seatY),
    roll: (a[at] - Math.floor(a[at])) * 4,
    seatY,
    topY: c[at + 3],
  };
}

/** A model triangle's middle packed into one float (anchorCode): 0.4 m steps from (-51.2, -10, -51.2), 256 a side */
const ANCHOR_STEP = 0.4;
const ANCHOR_ORIGIN = [-51.2, -10, -51.2] as const;

/** A point of a model (its own metres) as one float, x + 256 y + 65536 z steps: exact in a float's 24 bits */
export function anchorCode(x: number, y: number, z: number): number {
  const step = (v: number, k: number) => Math.min(255, Math.max(0, Math.floor((v - ANCHOR_ORIGIN[k]) / ANCHOR_STEP)));
  return step(x, 0) + 256 * step(y, 1) + 65536 * step(z, 2);
}

/** The middle of the step of a point anchorCode packed (dmgAnchorLocal in the shader) */
export function anchorPoint(code: number): [number, number, number] {
  const z = Math.floor(code / 65536);
  const y = Math.floor((code - z * 65536) / 256);
  const x = code - z * 65536 - y * 256;
  return [x, y, z].map((v, k) => ANCHOR_ORIGIN[k] + (v + 0.5) * ANCHOR_STEP) as [number, number, number];
}

const anchored = new WeakMap<BufferGeometry, BufferGeometry>();

/**
 * A model's geometry as a ruin draws it: each triangle on corners of its
 * own, which carry its middle (anchorCode), so a collapse variant moves the
 * triangle whole with the piece its middle lies in. The middle rides as a
 * third value of `roughMetal` where the part has one (merged parts: its
 * material reads that, no attribute slot more) and in `aDamageAnchor` (the
 * shadow's depth material reads that). Made once per geometry, freed with it
 */
export function ruinGeometry(source: BufferGeometry): BufferGeometry {
  const known = anchored.get(source);
  if (known) return known;
  const g = source.index ? source.toNonIndexed() : source.clone();
  const p = g.getAttribute('position');
  const codes = new Float32Array(p.count);
  for (let v = 0; v + 2 < p.count; v += 3) {
    const mid = (axis: number) => (p.getComponent(v, axis) + p.getComponent(v + 1, axis) + p.getComponent(v + 2, axis)) / 3;
    codes[v] = codes[v + 1] = codes[v + 2] = anchorCode(mid(0), mid(1), mid(2));
  }
  g.setAttribute('aDamageAnchor', new BufferAttribute(codes, 1));
  const rm = g.getAttribute('roughMetal');
  if (rm) {
    const packed = new Float32Array(rm.count * 3);
    for (let v = 0; v < rm.count; v++) packed.set([rm.getX(v), rm.getY(v), codes[v]], v * 3);
    g.setAttribute('roughMetal', new BufferAttribute(packed, 3));
  }
  anchored.set(source, g);
  source.addEventListener('dispose', () => {
    g.dispose();
    anchored.delete(source);
  });
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
// What writeDamage packs: the roll past the stage, the stump over the bite's radius, the top in place of the seconds
float dmgRollOf(vec4 a) {
  return fract(a.x) * 4.0;
}
float dmgBiteR(vec4 b) {
  return mod(b.w, ${BITE_SPAN.toFixed(1)});
}
float dmgSeat(vec4 a, vec4 b) {
  return a.w - floor(b.w / ${BITE_SPAN.toFixed(1)}) / ${STUMP_STEPS.toFixed(1)};
}
// fallSeconds
float dmgFallS(vec4 a, vec4 b, vec4 c) {
  return clamp(1.2 + (c.w - dmgSeat(a, b)) * 0.06, 1.2, 2.5);
}
// fallTiming: (hold, omega, lie, impact)
vec4 dmgTiming(vec4 a, vec4 b, vec4 c) {
  float hold = uCollapse > 1.5 ? 0.75 : 0.3;
  float len = max(c.w - a.w, 2.0);
  float omega = 1.4 * sqrt(14.715 / len);
  float lie = 1.5708 + asin(min(0.9, max(0.0, a.w - dmgSeat(a, b)) / len));
  return vec4(hold, omega, lie, hold + acosh(lie / ${TILT0.toFixed(2)}) / omega);
}
// collapseSeconds
float damageDuration(vec4 a, vec4 b, vec4 c) {
  return uCollapse < 0.5 ? dmgFallS(a, b, c) : dmgTiming(a, b, c).w + ${AFTER_IMPACT.toFixed(2)};
}
`;

/** Attributes, the fall in each collapse variant and what the fragment needs */
const DAMAGE_VERTEX_PARS = /* glsl */ `
attribute vec4 aDamage;
attribute vec4 aDamageB;
attribute vec4 aDamageC;
uniform float uDamageTime;
${COLLAPSE_PARS}
${VARYINGS}
// A model triangle's middle back from its code (anchorPoint)
vec3 dmgAnchorLocal(float code) {
  float z = floor((code + 0.5) / 65536.0);
  float r = code - z * 65536.0;
  float y = floor((r + 0.5) / 256.0);
  float x = r - y * 256.0;
  return vec3(${ANCHOR_ORIGIN[0].toFixed(1)}, ${ANCHOR_ORIGIN[1].toFixed(1)}, ${ANCHOR_ORIGIN[2].toFixed(1)}) + (vec3(x, y, z) + 0.5) * ${ANCHOR_STEP.toFixed(1)};
}
// A roll of the ruin, 0 to 1 (collapseRoll: k and its multiplier)
float dmgRoll(float prime, float k) {
  return fract(dmgRollOf(aDamage) * prime + k * 0.618);
}
vec3 dmgAt(vec2 xz, float y) {
  return vec3(xz.x, y, xz.y);
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
// tip: whole about the foot of the side it gives way to, sinking as it goes
mat4 dmgFallTip(float t) {
  vec2 d = vec2(cos(aDamage.z), sin(aDamage.z));
  vec3 pivot = dmgAt(aDamageC.xy + d * aDamageC.z, aDamage.w);
  return dmgShift(vec3(0.0, -2.5 * t * t, 0.0)) * dmgTip(pivot, d, 1.4 * t * t);
}
// impact and buckle: the foot gives (a buckle sags further, slides back and shudders), it tips under its weight,
// slowly then fast, the upper storeys lagging (it bends, straight again once it lies), hits the ground past level,
// rebounds; where it hit it breaks into the bands of collapseCuts, those beyond the first slide on and apart with
// a hop, and it settles into the dust while the fragment crumbles it
vec3 dmgImpact(vec3 p, vec3 anchor, float s) {
  bool buckle = uCollapse > 1.5;
  vec4 tm = dmgTiming(aDamage, aDamageB, aDamageC);
  vec2 d = vec2(cos(aDamage.z), sin(aDamage.z));
  float base = aDamage.w;
  float stump = max(0.0, base - dmgSeat(aDamage, aDamageB));
  float len = max(aDamageC.w - base, 2.0);
  float give = smoothstep(0.0, tm.x, s);
  vec2 back = buckle ? -d * 0.35 * give : vec2(0.0);
  vec3 shift = vec3(back.x, -(buckle ? min(1.2, 0.3 * stump) : min(0.4, 0.12 * stump)) * give, back.y);
  float th = s < tm.x
    ? ${TILT0.toFixed(2)} * (s / tm.x) * (s / tm.x) + (buckle ? 0.012 * sin(s * 31.0) * give : 0.0)
    : min(tm.z, ${TILT0.toFixed(2)} * cosh(tm.y * (s - tm.x)));
  float bend = (buckle ? 0.28 : 0.15) * clamp((p.y - base) / len, 0.0, 1.0) * sin(3.14159 * clamp(th / tm.z, 0.0, 1.0));
  float k = s - tm.w;
  if (k > 0.0) {
    float j = min(k / 0.35, 1.0);
    th = tm.z - 0.05 * sin(j * 3.14159) * (1.0 - j);
    bend = 0.0;
    // The bands past the cuts its anchor lies over (collapseCuts)
    float hu = max(1.0, aDamageC.w - base);
    float n = step(base + hu * (0.45 + 0.2 * dmgRoll(29.0, 3.0)), anchor.y);
    if (hu > 4.0) n += step(base + hu * (0.38 + 0.14 * dmgRoll(7.0, 1.0)), anchor.y);
    if (hu > 9.0) n += step(base + hu * (0.68 + 0.12 * dmgRoll(13.0, 2.0)), anchor.y);
    float e = smoothstep(0.0, 0.3, k);
    vec2 across = vec2(-d.y, d.x);
    vec2 slide = (d * (0.8 + 0.8 * dmgRoll(53.0 + n, 5.0)) + across * (dmgRoll(41.0 + n, 4.0) - 0.5) * 1.2) * n * e;
    shift += vec3(slide.x, 0.4 * n * sin(min(k / 0.4, 1.0) * 3.14159) - 0.6 * smoothstep(0.8, ${AFTER_IMPACT.toFixed(2)}, k), slide.y);
    // Each band beyond the first rolls a little about the line it lies along, on the ground where it lies
    if (n > 0.5) {
      vec3 pivot = dmgAt(aDamageC.xy + d * aDamageC.z, base);
      vec3 ground = dmgAt(aDamageC.xy + d * (aDamageC.z + len * (n + 0.5) / 4.0), dmgSeat(aDamage, aDamageB));
      mat4 lying = dmgShift(shift) * dmgTip(pivot, d, th);
      return (dmgTip(ground + vec3(slide.x, 0.0, slide.y), across, (dmgRoll(67.0 + n, 6.0) - 0.5) * 0.5 * e) * lying * vec4(p, 1.0)).xyz;
    }
  }
  vec3 pivot = dmgAt(aDamageC.xy + d * aDamageC.z, base);
  return (dmgShift(shift) * dmgTip(pivot, d, th * (1.0 - bend)) * vec4(p, 1.0)).xyz;
}
// Where a point of the ruin is drawn (group frame): at rest, or with its piece (that of its anchor) as it falls.
// In impact and buckle a triangle across the break line goes whole with the side its anchor is on
vec3 damageMove(vec3 p, vec3 anchor) {
  if (aDamage.x < 2.5 || (uCollapse > 0.5 ? anchor.y : p.y) < aDamage.w) return p;
  float s = uDamageTime - aDamage.y;
  float dur = damageDuration(aDamage, aDamageB, aDamageC);
  if (s <= 0.0 || s >= dur) return p;
  if (uCollapse < 0.5) return (dmgFallTip(s / dur) * vec4(p, 1.0)).xyz;
  return dmgImpact(p, anchor, s);
}
void damageVaryings(vec3 rest, vec3 anchor) {
  vDmgP = rest;
  vDmgSide = step(aDamage.w, uCollapse > 0.5 ? anchor.y : rest.y);
  vDmg = aDamage;
  vDmgB = aDamageB;
  vDmgC = aDamageC;
}
`;

/** project_vertex with the fall between the instance and the model matrix (and the rest position for the fragment) */
const DAMAGE_PROJECT_VERTEX = /* glsl */ `
vec4 dmgRest = instanceMatrix * vec4(transformed, 1.0);
vec3 dmgAnchor = (instanceMatrix * vec4(DMG_ANCHOR, 1.0)).xyz;
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
  return length(q) - dmgBiteR(vDmgB) * (0.7 + jag);
}
// Metres to the nearest broken edge (bite or cut), large where there is none
float damageEdge() {
  float e = 1e3;
  if (vDmg.x > 1.5) e = damageBite(vDmgP);
  if (vDmg.x > 2.5 && (uDamageTime - vDmg.y) >= damageDuration(vDmg, vDmgB, vDmgC)) e = min(e, damageCut(vDmgP) - vDmgP.y);
  return e;
}
// How far a fallen piece has crumbled into dust, 0 to 1 and past (impact and buckle, from just after the impact)
float damageCrumble() {
  if (vDmg.x < 2.5 || uCollapse < 0.5 || vDmgSide < 0.5) return 0.0;
  float s = uDamageTime - vDmg.y;
  if (s >= damageDuration(vDmg, vDmgB, vDmgC)) return 0.0;
  return smoothstep(0.7, ${(AFTER_IMPACT - 0.05).toFixed(2)}, s - dmgTiming(vDmg, vDmgB, vDmgC).w) * 1.05;
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
    if ((uDamageTime - vDmg.y) < damageDuration(vDmg, vDmgB, vDmgC)) {
      // tip: the triangles across the line go; in impact and buckle one goes whole with the side its anchor is on,
      // what of one left standing reaches above goes
      if (uCollapse < 0.5 && vDmgSide > 0.002 && vDmgSide < 0.998) discard;
      if (uCollapse > 0.5 && vDmgSide < 0.5 && vDmgP.y > vDmg.w) discard;
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

/**
 * Where a vertex shader takes a piece's anchor from (DMG_ANCHOR, model
 * space): `fixed`, one point for every corner (an instance of a unit quad
 * goes whole); else a model triangle's code (ruinGeometry), from
 * `roughMetal` where the material reads that attribute already
 */
function anchorPars(vertexShader: string, fixed?: readonly [number, number, number]): { shader: string; pars: string } {
  // A ruin's windows are dark (DAMAGE_EMISSIVE_FRAGMENT): a merged part's glass share takes no attribute slot
  vertexShader = vertexShader.replace('attribute float nightGlow;', '#define nightGlow 0.0');
  if (fixed) return { shader: vertexShader, pars: `#define DMG_ANCHOR vec3(${fixed.map((v) => v.toFixed(4)).join(', ')})` };
  if (vertexShader.includes('attribute vec2 roughMetal;')) {
    const shader = vertexShader.replace('attribute vec2 roughMetal;', 'attribute vec3 roughMetal;').replace('vRoughMetal = roughMetal;', 'vRoughMetal = roughMetal.xy;');
    return { shader, pars: '#define DMG_ANCHOR dmgAnchorLocal(roughMetal.z)' };
  }
  return { shader: vertexShader, pars: 'attribute float aDamageAnchor;\n#define DMG_ANCHOR dmgAnchorLocal(aDamageAnchor)' };
}

/**
 * Shader GLSL for a material of a damaged building's mesh; wraps what
 * compiles it so far. `anchor`: the one anchor of a unit geometry's
 * instances (anchorPars)
 */
export function addDamage(material: Material, anchor?: readonly [number, number, number]): void {
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  DAMAGE_UNIFORMS.uCrackMap.value ??= crackTexture();
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    Object.assign(shader.uniforms, DAMAGE_UNIFORMS);
    const { shader: vertex, pars } = anchorPars(shader.vertexShader, anchor);
    shader.vertexShader = vertex
      .replace('#include <common>', `#include <common>\n${DAMAGE_VERTEX_PARS}\n${pars}`)
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
 * `vertex` runs first in begin_vertex (a raised wall's gable); `anchor` as
 * addDamage's
 */
export function damageDepthMaterial(key: string, pars = '', vertex = '', anchor?: readonly [number, number, number]): MeshDepthMaterial {
  const m = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, DAMAGE_UNIFORMS);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${pars}\n${DAMAGE_VERTEX_PARS}\n${anchorPars('', anchor).pars}`)
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
