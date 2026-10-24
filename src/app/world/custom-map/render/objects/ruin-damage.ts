import { DoubleSide, MeshDepthMaterial, RGBADepthPacking, type Material, type Texture } from 'three';
import type { LosVertexPatch } from '../../../../three-engine/tower-shadow-mapper';
import { HOLE_SLOTS, STRUCTURE_HEADING_STEPS } from '../../../../configs/destruction.config';
import { RuinHoles } from './ruin-holes';
import { crackTexture } from './crack-texture';
import { seedOf } from '../../../../utils/seeded-random';
import { BITE_SPAN, CAVE_HOLD, CAVE_SECONDS, DAMAGE_COLOR_FRAGMENT, DAMAGE_DEPTH_FRAGMENT, DAMAGE_EMISSIVE_FRAGMENT, DAMAGE_FRAGMENT_PARS, DAMAGE_NORMAL_FRAGMENT, DAMAGE_PROJECT_VERTEX, DAMAGE_VERTEX_PARS, DAMAGE_WORLDPOS_VERTEX, STUMP_STEPS, VARYINGS } from './ruin-damage-shaders';

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
  uHoleSlots: { value: number };
} = {
  uDamageTime: { value: 0 },
  uCrackMap: { value: null },
  uCollapse: { value: 0 },
  uRuinHoles: { value: RUIN_HOLES.texture },
  uHoleSlots: { value: HOLE_SLOTS },
};
RUIN_HOLES.onTexture((t) => (DAMAGE_UNIFORMS.uRuinHoles.value = t));

/** The collapse mode every view draws from now on (a uniform: no program changes) */
export function setCollapseVariant(v: CollapseVariant): void {
  DAMAGE_UNIFORMS.uCollapse.value = Math.max(0, COLLAPSE_VARIANTS.indexOf(v));
}

export function collapseVariant(): CollapseVariant {
  return COLLAPSE_VARIANTS[DAMAGE_UNIFORMS.uCollapse.value] ?? 'auto';
}

/** A tower tips where its height is more than this many times its narrower width */
const TOWER_SLENDER = 2.5;

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
  /**
   * Its cellar under the seat (MapObject.cellar, object-cellar.ts): metres to its foot and its storeys, their
   * floors and the ground cut away inside it (ruin-slabs.ts)
   */
  cellar?: number;
  cellarStoreys?: number;
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
  return seedOf(id);
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

/**
 * What a ruin's material is of: `core` under its plaster (brick, or concrete
 * for concrete and metal facades), `slab` for the floors and inner walls
 * (ruin-slabs.ts: concrete, all of it inside, reinforcement in the breaks)
 */
export interface DamageLook {
  core?: 'brick' | 'concrete';
  slab?: boolean;
}

/** Shader GLSL for a material of a damaged building's mesh; wraps what compiles it so far */
export function addDamage(material: Material, look: DamageLook = {}): void {
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  DAMAGE_UNIFORMS.uCrackMap.value ??= crackTexture();
  const defines = `${look.slab ? '#define DMG_SLAB\n' : ''}${look.core === 'concrete' ? '#define DMG_CORE_CONCRETE\n' : ''}`;
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    Object.assign(shader.uniforms, DAMAGE_UNIFORMS);
    // A ruin's windows are dark (DAMAGE_EMISSIVE_FRAGMENT): a merged part's glass share takes no attribute slot
    shader.vertexShader = shader.vertexShader
      .replace('attribute float nightGlow;', '#define nightGlow 0.0')
      .replace('#include <common>', `#include <common>\n${defines}${DAMAGE_VERTEX_PARS}`)
      .replace('#include <project_vertex>', DAMAGE_PROJECT_VERTEX)
      .replace('#include <worldpos_vertex>', DAMAGE_WORLDPOS_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${defines}${DAMAGE_FRAGMENT_PARS}\nuniform sampler2D uCrackMap;`)
      .replace('#include <logdepthbuf_fragment>', `#include <logdepthbuf_fragment>\n${DAMAGE_DEPTH_FRAGMENT}`)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\ndamageClip();')
      .replace('#include <roughnessmap_fragment>', `${DAMAGE_COLOR_FRAGMENT}\n#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 1.0, dmgSoot);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${DAMAGE_NORMAL_FRAGMENT}`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>\n${DAMAGE_EMISSIVE_FRAGMENT}`);
  };
  material.customProgramCacheKey = () => `${prevKey.call(material)}-damage${look.slab ? '-slab' : ''}${look.core === 'concrete' ? '-concrete' : ''}`;
}

/** A ruin's material: the damage in its shader (what is under its plaster), its inside drawn */
export function asRuin(m: Material, core: DamageLook['core'] = 'brick'): void {
  addDamage(m, { core });
  m.side = DoubleSide;
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
