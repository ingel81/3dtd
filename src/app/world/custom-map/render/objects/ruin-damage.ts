import { MeshDepthMaterial, RGBADepthPacking, type Material, type Texture } from 'three';
import type { LosVertexPatch } from '../../../../three-engine/tower-shadow-mapper';
import { HOLE_SLOTS, STRUCTURE_HEADING_STEPS } from '../../../../configs/destruction.config';
import { RuinHoles } from './ruin-holes';
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
 * - stage 3 (from `fallStart` on the view's clock, uDamageTime): a building
 *   caves in on itself (E259): a ragged break line low inside and rising
 *   steeply to the walls (lower on the side of the hit); the foot gives
 *   with a shudder, then everything above the line falls straight down and
 *   a little inwards, heavily, and is gone where it lands: on the highest
 *   floor under the line (through up to two of them in patches of 4 m) or
 *   the ground. A slender tower (RuinShape.tower) tips instead, whole,
 *   about the foot of the side it gives way to, and sinks. A triangle is
 *   drawn only while all its corners fall alike: nothing stretches, the
 *   rims follow the mesh; the dust of the impact (fallImpact, the view)
 *   hides the change
 * - holes (E259): where heavy hits struck (StructureLedger.punch, whole
 *   numbers in the simulation), from stage 1 on, ragged, opening as the
 *   hit lands and growing with each hit near one (RUIN_HOLES, a row per
 *   ruin); over a large one a column sags onto the floor below; the
 *   cave-in's break line dips to them, so it starts where it was hit
 *
 * Every number comes from the structure's id (`structureSeed`) and its
 * frame, so every partner and every replay sees the same ruin. The shapes
 * are worked out here once per object (`ruinShape`); the shader only adds
 * ragged edges and shading.
 */

/** A fall start long past: the ruin lies as it fell (after a load, a seek, a restore) */
export const FELL_LONG_AGO = -1e6;

/**
 * How buildings fall, for the developer's comparison (the window
 * Destruction): `auto` by their shape (a slender tower tips, every other
 * building caves in), or all of them `tip` or `cave-in`
 */
export const COLLAPSE_VARIANTS = ['auto', 'tip', 'cave-in'] as const;
export type CollapseVariant = (typeof COLLAPSE_VARIANTS)[number];

/** The ruins' holes, a row per damaged structure (ruin-holes.ts) */
export const RUIN_HOLES = new RuinHoles();

/** Shared by every view: the clock falls run on (s), the cracks, the collapse mode (its index), the holes */
export const DAMAGE_UNIFORMS: {
  uDamageTime: { value: number };
  uCrackMap: { value: Texture | null };
  uCollapse: { value: number };
  uRuinHoles: { value: Texture };
} = {
  uDamageTime: { value: 0 },
  uCrackMap: { value: null },
  uCollapse: { value: 0 },
  uRuinHoles: { value: RUIN_HOLES.texture },
};
RUIN_HOLES.onTexture((t) => (DAMAGE_UNIFORMS.uRuinHoles.value = t));

/** Seconds the column over a large hole takes to come down */
const SAG_SECONDS = 2;

/** The collapse mode every view draws from now on (a uniform: no program changes) */
export function setCollapseVariant(v: CollapseVariant): void {
  DAMAGE_UNIFORMS.uCollapse.value = Math.max(0, COLLAPSE_VARIANTS.indexOf(v));
}

export function collapseVariant(): CollapseVariant {
  return COLLAPSE_VARIANTS[DAMAGE_UNIFORMS.uCollapse.value] ?? 'auto';
}

/** A tower tips where its height is more than this many times its narrower width */
const TOWER_SLENDER = 2.5;
/** A cave-in: the seconds its foot gives (with a shudder), how heavily it falls then (m/s², drop = g t²), its seconds at most */
const CAVE_HOLD = 0.35;
const CAVE_FALL = 2.6;
const CAVE_SECONDS = 4.5;

/** Whether a ruin tips (a tower) or caves in, in collapse mode `v` (its index; dmgTower in the shader) */
export function fallsAsTower(s: RuinShape, v: number = DAMAGE_UNIFORMS.uCollapse.value): boolean {
  return v > 1.5 ? false : v > 0.5 ? true : s.tower;
}

/** Seconds a ruin's fall takes: a tower's fallS, a cave-in CAVE_SECONDS (damageDuration in the shader) */
export function collapseSeconds(s: RuinShape, v: number = DAMAGE_UNIFORMS.uCollapse.value): number {
  return fallsAsTower(s, v) ? s.fallS : CAVE_SECONDS;
}

/**
 * Where and when a falling ruin comes down (group frame): the middle of
 * where it lands, its length along the heading, the seconds after the
 * fall's start. A cave-in lands in its own footprint as its first parts
 * reach the floors below them (half a second after its foot gave); a tower
 * beyond its foot, most of the way down
 */
export function fallImpact(
  s: RuinShape, v: number = DAMAGE_UNIFORMS.uCollapse.value,
): { x: number; y: number; z: number; dx: number; dz: number; length: number; delay: number } {
  const dx = Math.cos(s.heading);
  const dz = Math.sin(s.heading);
  const upper = Math.max(2, s.topY - s.breakY);
  if (fallsAsTower(s, v)) {
    const along = s.reach + upper * 0.4;
    return { x: s.cx + dx * along, y: s.seatY, z: s.cz + dz * along, dx, dz, length: upper, delay: s.fallS * 0.7 };
  }
  return { x: s.cx, y: s.seatY, z: s.cz, dx, dz, length: 2 * s.reach, delay: CAVE_HOLD + 0.5 };
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
  /** The seat and the top (scene y), and a roll 0 to 1 each building's cave-in is varied by */
  seatY: number;
  topY: number;
  roll: number;
  /** Slender: it tips about its foot instead of caving in (TOWER_SLENDER) */
  tower: boolean;
  /** Its row in RUIN_HOLES, -1 for none (the layer sets it) */
  holeRow: number;
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
    tower: h > TOWER_SLENDER * 2 * Math.min(lenA, lenB),
    holeRow: -1,
  };
}

/** The roll in steps of 1/4096: in aDamage.x past the stage, a quarter of it, without a bit lost */
const ROLL_STEPS = 4096;

/** The stump in aDamageB.w over the bite's radius (under 8 m): steps of 1/64 m, times 8 */
const STUMP_STEPS = 64;
const BITE_SPAN = 8;

/** Multipliers of a ruin's roll, one per collapse roll */
const COLLAPSE_PRIMES = [1, 7, 13, 29, 41, 53, 67, 79, 97];

/** The k-th of a ruin's rolls, 0 to 1: plain arithmetic on the roll, as a shader would do it */
export function collapseRoll(roll: number, k: number): number {
  const v = roll * COLLAPSE_PRIMES[k] + k * 0.618;
  return v - Math.floor(v);
}

/**
 * The heights (scene y, rising) where a fallen raised building's walls are
 * split besides its break line: corners at these heights let the upper
 * walls fall in pieces as the cave-in's line passes them (a wall is a quad,
 * and a triangle only falls whole)
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
 * fall start, heading plus 8 times its hole row and one, break height), aDamageB (bite centre; its radius
 * plus 8 times the stump in 1/64 m), aDamageC (middle x, z, reach, top;
 * the reach negative for a tower).
 * The fall's seconds come from the height (ruinShape, dmgFallS)
 */
export function writeDamage([a, b, c]: DamageArrays, i: number, stage: number, fallStart: number, s: RuinShape): void {
  const at = i * 4;
  a[at] = stage + s.roll / 4;
  a[at + 1] = fallStart;
  // The heading within (-pi, pi], so the row reads back (dmgHoleRow)
  a[at + 2] = Math.atan2(Math.sin(s.heading), Math.cos(s.heading)) + 8 * (s.holeRow + 1);
  a[at + 3] = s.breakY;
  b[at] = s.biteX;
  b[at + 1] = s.biteY;
  b[at + 2] = s.biteZ;
  b[at + 3] = Math.min(s.biteR, BITE_SPAN - 0.01) + BITE_SPAN * Math.round(Math.max(0, s.breakY - s.seatY) * STUMP_STEPS);
  c[at] = s.cx;
  c[at + 1] = s.cz;
  c[at + 2] = Math.max(0.01, s.reach) * (s.tower ? -1 : 1);
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
  const row = Math.floor((a[at + 2] + 4) / 8);
  return {
    heading: a[at + 2] - 8 * row,
    holeRow: row - 1,
    breakY,
    biteX: b[at],
    biteY: b[at + 1],
    biteZ: b[at + 2],
    biteR: b[at + 3] % BITE_SPAN,
    cx: c[at],
    cz: c[at + 1],
    reach: Math.abs(c[at + 2]),
    fallS: fallSeconds(c[at + 3] - seatY),
    roll: (a[at] - Math.floor(a[at])) * 4,
    seatY,
    topY: c[at + 3],
    tower: c[at + 2] < 0,
  };
}

const VARYINGS = /* glsl */ `
varying vec3 vDmgP;
varying float vDmgSide;
varying vec4 vDmg;
varying vec4 vDmgB;
varying vec4 vDmgC;
varying float vDmgFall;
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
// Whether this ruin tips (fallsAsTower), and its reach (the sign is the tower's flag)
bool dmgTower(vec4 c) {
  return uCollapse > 1.5 ? false : uCollapse > 0.5 ? true : c.z < 0.0;
}
float dmgReach(vec4 c) {
  return abs(c.z);
}
// collapseSeconds
float damageDuration(vec4 a, vec4 b, vec4 c) {
  return dmgTower(c) ? dmgFallS(a, b, c) : ${CAVE_SECONDS.toFixed(2)};
}
float dmgHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float dmgNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(dmgHash(i), dmgHash(i + vec2(1.0, 0.0)), f.x), mix(dmgHash(i + vec2(0.0, 1.0)), dmgHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
uniform sampler2D uRuinHoles;
// What writeDamage packs into the heading: the ruin's row in RUIN_HOLES (-1 none), and the heading itself
float dmgHoleRow(vec4 a) {
  return floor((a.z + 4.0) / 8.0) - 1.0;
}
float dmgHeading(vec4 a) {
  return a.z - 8.0 * floor((a.z + 4.0) / 8.0);
}
// Hole k of a row: centre and radius; the time it opened or grew, its rim's number
vec4 dmgHole(float row, int k) {
  return texelFetch(uRuinHoles, ivec2(k * 2, int(row)), 0);
}
vec4 dmgHoleTime(float row, int k) {
  return texelFetch(uRuinHoles, ivec2(k * 2 + 1, int(row)), 0);
}
// Metres outside the ruin's holes at p (negative inside), a little wider than high, the rims ragged by angle and
// height, each opening as it is hit; 1e3 for a ruin without
float dmgHoles(vec3 p, vec4 a) {
  float row = dmgHoleRow(a);
  float best = 1e3;
  if (row < 0.0) return best;
  for (int k = 0; k < ${HOLE_SLOTS}; k++) {
    vec4 h = dmgHole(row, k);
    if (h.w <= 0.0) continue;
    vec4 t = dmgHoleTime(row, k);
    vec3 q = p - h.xyz;
    float ang = atan(q.z, q.x);
    float jag = dmgNoise(vec2(ang * 2.6, q.y * 0.9) + t.y) * 0.55 + dmgNoise(vec2(ang * 9.0, q.y * 3.1) + t.y) * 0.25;
    float open = smoothstep(0.0, 0.3, uDamageTime - t.x);
    best = min(best, length(q * vec3(1.0, 1.25, 1.0)) - h.w * open * (0.7 + jag));
  }
  return best;
}
// Over a large hole (2.2 m and more) a ragged column of 0.8 its radius, from 0.4 to 2.6 radii over its middle,
// comes down onto the floor under it (floorY): when it starts to, or -1 where p lies in no such column
float dmgSagStart(vec3 p, vec4 a, out float floorY) {
  floorY = 0.0;
  float row = dmgHoleRow(a);
  if (row < 0.0) return -1.0;
  for (int k = 0; k < ${HOLE_SLOTS}; k++) {
    vec4 h = dmgHole(row, k);
    if (h.w < 2.2) continue;
    vec4 t = dmgHoleTime(row, k);
    vec2 q = p.xz - h.xz;
    float reach = h.w * 0.8 * (0.8 + 0.4 * dmgNoise(vec2(atan(q.y, q.x) * 1.7, t.y)));
    if (length(q) < reach && p.y > h.y + h.w * 0.4 && p.y < h.y + h.w * 2.6) {
      floorY = h.y - h.w * 0.5;
      return t.x + 0.25;
    }
  }
  return -1.0;
}
// cave-in: the break line, low ragged stumps inside rising steeply to the walls (6 m and a quarter of the height
// over the seat at most), those on the side of the hit (against the heading) lower, dipping to the holes; its rim
// ragged by angle only, so nothing stays standing as an island
float dmgCaveCut(vec3 p, vec4 a, vec4 b, vec4 c) {
  float seat = dmgSeat(a, b);
  float roll = dmgRollOf(a) * 17.0;
  vec2 off = p.xz - c.xy;
  float dist = length(off);
  vec2 dir = off / max(dist, 1e-3);
  float r = dist / max(dmgReach(c), 1.0);
  float rn = r + (dmgNoise(dir * 0.9 + 10.0 + roll) - 0.5) * 0.45 + (dmgNoise(dir * 3.5 + 20.0 + roll) - 0.5) * 0.06;
  float stump = max(1.2, a.w - seat);
  float cut = seat + max(1.2, stump * (0.25 + 1.0 * dmgNoise(p.xz / 4.0 + roll) + 0.35 * dmgNoise(p.xz / 1.1 + roll * 2.0)));
  float outer = max(0.0, (rn - 0.55) / 0.4);
  float away = 0.55 + 0.45 * dot(dir, vec2(cos(dmgHeading(a)), sin(dmgHeading(a))));
  float walls = min(c.w - seat, 6.0 + 0.25 * (c.w - seat));
  cut += outer * outer * walls * away;
  // Down to the holes: where it was hit it gives way first
  float row = dmgHoleRow(a);
  if (row >= 0.0) {
    for (int k = 0; k < ${HOLE_SLOTS}; k++) {
      vec4 h = dmgHole(row, k);
      if (h.w > 0.0) cut = min(cut, max(seat + 0.8, h.y - 0.6 * h.w + 0.7 * length(p.xz - h.xz)));
    }
  }
  return cut;
}
// cave-in: where a falling part comes to rest, the highest floor (a storey of 3 m) under the break line, through up
// to two of them in patches of 4 m; else the ground
float dmgCaveLanding(vec3 p, float cut, vec4 a, vec4 b, vec4 c) {
  float seat = dmgSeat(a, b);
  float k = floor((min(cut, p.y) - seat - 0.2) / 3.0);
  k = min(k, floor((c.w - seat - 1.2) / 3.0));
  k -= floor(dmgHash(floor(p.xz / 4.0) + dmgRollOf(a) * 31.0) * 2.5);
  return k >= 1.0 ? seat + k * 3.0 : seat;
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
  vec2 d = vec2(cos(dmgHeading(aDamage)), sin(dmgHeading(aDamage)));
  vec3 pivot = dmgAt(aDamageC.xy + d * dmgReach(aDamageC), aDamage.w);
  return dmgShift(vec3(0.0, -2.5 * t * t, 0.0)) * dmgTip(pivot, d, 1.4 * t * t);
}
// cave-in: what stands above the break line falls as one (one motion: no triangle stretches): the foot gives a
// quarter metre with a shudder, then it comes down heavily, straight and a little inwards, until it reaches where it
// lands (dmgCaveLanding) and is gone (vDmgFall 0: the fragment draws it only while every corner falls)
vec3 dmgCaveFall(vec3 p) {
  float s = uDamageTime - aDamage.y;
  if (s <= 0.0 || s >= ${CAVE_SECONDS.toFixed(2)}) return p;
  float cut = dmgCaveCut(p, aDamage, aDamageB, aDamageC);
  if (p.y <= cut) return p;
  float give = smoothstep(0.0, ${CAVE_HOLD.toFixed(2)}, s);
  float f = max(0.0, s - ${CAVE_HOLD.toFixed(2)});
  float drop = 0.25 * give + 0.03 * sin(s * 47.0) * (1.0 - give) + ${CAVE_FALL.toFixed(2)} * f * f;
  if (p.y - drop < dmgCaveLanding(p, cut, aDamage, aDamageB, aDamageC) + 0.3) return p;
  vDmgFall = 1.0;
  vec2 inward = (aDamageC.xy - p.xz) * min(0.25, 0.08 * f);
  return p + vec3(inward.x, -drop, inward.y);
}
// Holed (stage 1 and 2): the column over a large hole comes down until it reaches the floor under the hole
vec3 dmgSag(vec3 p) {
  float floorY;
  float start = dmgSagStart(p, aDamage, floorY);
  if (start < 0.0) return p;
  float f = uDamageTime - start;
  if (f <= 0.0 || f >= ${SAG_SECONDS.toFixed(1)}) return p;
  float drop = ${CAVE_FALL.toFixed(2)} * f * f;
  if (p.y - drop < floorY + 0.3) return p;
  vDmgFall = 1.0;
  return p - vec3(0.0, drop, 0.0);
}
// Where a point of the ruin is drawn (group frame): at rest, or as it falls
vec3 damageMove(vec3 p) {
  if (aDamage.x < 0.5) return p;
  if (aDamage.x < 2.5) return dmgSag(p);
  if (!dmgTower(aDamageC)) return dmgCaveFall(p);
  if (p.y < aDamage.w) return p;
  float s = uDamageTime - aDamage.y;
  float dur = damageDuration(aDamage, aDamageB, aDamageC);
  if (s <= 0.0 || s >= dur) return p;
  return (dmgFallTip(s / dur) * vec4(p, 1.0)).xyz;
}
void damageVaryings(vec3 rest) {
  vDmgP = rest;
  vDmgSide = step(aDamage.w, rest.y);
  vDmgFall = 0.0;
  vDmg = aDamage;
  vDmgB = aDamageB;
  vDmgC = aDamageC;
}
`;

/** project_vertex with the fall between the instance and the model matrix (and the rest position for the fragment) */
const DAMAGE_PROJECT_VERTEX = /* glsl */ `
vec4 dmgRest = instanceMatrix * vec4(transformed, 1.0);
damageVaryings(dmgRest.xyz);
vec4 dmgMoved = vec4(damageMove(dmgRest.xyz), 1.0);
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
// Height of the ragged break line at a point: broken masonry, not a saw cut (a cave-in's dmgCaveCut)
float damageCut(vec3 p) {
  if (!dmgTower(vDmgC)) return dmgCaveCut(p, vDmg, vDmgB, vDmgC);
  return vDmg.w + (dmgNoise(p.xz * 0.8 + dmgHeading(vDmg)) - 0.5) * 1.3 + (dmgNoise(p.xz * 3.3) - 0.5) * 0.45;
}
// How far a point lies outside the bite, m (negative inside): its edge jagged by angle and height
float damageBite(vec3 p) {
  vec3 q = p - vDmgB.xyz;
  float a = atan(q.z, q.x);
  float jag = dmgNoise(vec2(a * 2.6, q.y * 0.9) + dmgHeading(vDmg) * 3.0) * 0.55 + dmgNoise(vec2(a * 9.0, q.y * 3.1)) * 0.25;
  return length(q) - dmgBiteR(vDmgB) * (0.7 + jag);
}
// Metres to the nearest broken edge (holes, else the bite; the cut), large where there is none
float damageEdge() {
  float e = dmgHoles(vDmgP, vDmg);
  if (e > 999.0 && vDmg.x > 1.5) e = damageBite(vDmgP);
  if (vDmg.x > 2.5 && (uDamageTime - vDmg.y) >= damageDuration(vDmg, vDmgB, vDmgC)) e = min(e, damageCut(vDmgP) - vDmgP.y);
  return e;
}
// Soot on the surface, which is matte (DAMAGE_COLOR_FRAGMENT sets it, the roughness reads it)
float dmgSoot = 0.0;
// Throws away what the damage took: the holes (a ruin without any its bite), the column over a large hole while it
// does not fall whole and once it came down, a fall's parts as below
void damageClip() {
  if (vDmg.x < 0.5) return;
  float holes = dmgHoles(vDmgP, vDmg);
  if (holes < 0.0) discard;
  if (holes > 999.0 && vDmg.x > 1.5 && damageBite(vDmgP) < 0.0) discard;
  if (vDmg.x < 2.5) {
    float floorY;
    float start = dmgSagStart(vDmgP, vDmg, floorY);
    if (start >= 0.0) {
      float f = uDamageTime - start;
      if (f >= 0.0 && !(f < ${SAG_SECONDS.toFixed(1)} && vDmgFall > 0.999)) discard;
    } else if (vDmgFall > 0.001) discard;
    return;
  }
  if (vDmg.x > 2.5 && !dmgTower(vDmgC)) {
    // cave-in: above the line only while all of it falls, below it nothing that falls along; afterwards above goes
    bool above = vDmgP.y > damageCut(vDmgP);
    if ((uDamageTime - vDmg.y) < ${CAVE_SECONDS.toFixed(2)}) {
      if (above ? vDmgFall < 0.999 : vDmgFall > 0.001) discard;
    } else if (above) discard;
    return;
  }
  if (vDmg.x > 2.5) {
    if ((uDamageTime - vDmg.y) < damageDuration(vDmg, vDmgB, vDmgC)) {
      // A tower: the triangles across the line go while it falls
      if (vDmgSide > 0.002 && vDmgSide < 0.998) discard;
    } else if (vDmgP.y > damageCut(vDmgP)) discard;
  }
}
`;

/** Cracks and soot from stage 1, the inside dimmed, edges charred */
const DAMAGE_COLOR_FRAGMENT = /* glsl */ `
if (vDmg.x > 0.5) {
  vec3 toMid = vDmgP - vec3(vDmgC.x, vDmgP.y, vDmgC.y);
  vec2 dir = vec2(cos(dmgHeading(vDmg)), sin(dmgHeading(vDmg)));
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
  float soot = smoothstep(0.6, 0.9, dmgNoise(vDmgP.xz * 0.35 + vDmgP.y * 0.25 + dmgHeading(vDmg))) * strength * 0.5;
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
    float spots = smoothstep(0.72, 0.88, dmgNoise(vDmgP.xz * 1.6 + vDmgP.y * 1.1 + dmgHeading(vDmg)));
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
    // A ruin's windows are dark (DAMAGE_EMISSIVE_FRAGMENT): a merged part's glass share takes no attribute slot
    shader.vertexShader = shader.vertexShader
      .replace('attribute float nightGlow;', '#define nightGlow 0.0')
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
    vDmgFall = 0.0;
    vDmg = aDamage;
    vDmgB = aDamageB;
    vDmgC = aDamageC;
  }`,
  uniforms: DAMAGE_UNIFORMS,
  fragmentPars: DAMAGE_FRAGMENT_PARS,
  fragment: 'damageClip();',
  doubleSided: true,
};
