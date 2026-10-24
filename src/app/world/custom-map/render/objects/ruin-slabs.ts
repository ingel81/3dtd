import { BoxGeometry, DoubleSide, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshStandardMaterial } from 'three';
import { roofHeights, type CatalogRoof } from '../../object-roof';
import type { RubbleMaterial } from '../../rubble-material';
import type { GroundCut } from '../terrain/terrain-cuts';
import { CELLAR_STOREY } from '../../object-cellar';
import { addDamage, DAMAGE_ATTRIBUTES, damageArrays, damageDepthMaterial, writeDamage, type DamageArrays, type RuinFrame, type RuinShape } from './ruin-damage';

/**
 * The insides of the ruins (docs/DESTRUCTION_PLAN.md, Z2): a floor slab
 * every storey (3 m) and inner walls that split it into rooms, all in one
 * instanced mesh for every ruin of the map. They follow the building's
 * ground as its top grid holds it (the catalogue's `roof`, a raised
 * building's massRoof): a floor is a few boxes over the cells the building
 * stands higher than the floor over (footprintRects), within its ground
 * rectangle, so a round tower's floors stay inside its wall and a broken
 * high-rise has none where it is open; without a grid the rectangle. They
 * are cut by the same damage as the outer walls (ruin-damage.ts) with a
 * smaller bite, so floors and walls jut into the hole a little, and fall
 * with what stands above the break line. A
 * whole building hides its insides behind its walls, so only ruins from
 * stage 2 have any, and the battered ones a hole opened (setHoled): through
 * the hole the storeys show. Intact buildings pay nothing for them. The
 * ground floor has a slab too, so no grass shows inside.
 *
 * A building over a cellar (MapObject.cellar, object-cellar.ts; its
 * frame's `cellar` and `cellarStoreys`) has a floor in each of its storeys
 * and its inner walls reach down to the lowest, and while its insides show
 * the terrain is cut away inside its ground (cellarCuts, terrain-cuts.ts):
 * the hill under its floor, which its cellar walls hide on a whole building,
 * would fill the cellar seen through a hole. A fallen one keeps its cellar
 * as a pit: all the ground inside its walls cut away, the heap its rubble
 * raised included, and its rubble lies on its lowest floor (pitFloor,
 * rubble-pieces.ts).
 */

/** How far over the floor above a cellar the ground is cut away inside it, m: the slope is cut down to that floor */
const CUT_OVER = 0.15;
/** Over a fallen one's floor the ground is cut away inside it up to this, m: its rubble's heap too, an open pit */
const PIT_OVER = 8;
/** A fallen one's cellar is filled with its rubble up to this far under its floor, m: a little of it shows */
const FILL_UNDER = 0.55;
/** Its walls' stumps: the outer lining's top over the floor, the inner walls' over the fill, least and most, m */
const STUMP_OVER_FLOOR = 0.2;
const INNER_STUMP: readonly [number, number] = [0.15, 0.7];
/** The cellar's walls from inside: thick, so a hole or a pit shows their section and nothing through them, m */
const LINING = 0.32;
const LINING_COLOUR: readonly [number, number, number] = [0.27, 0.25, 0.22];
/** Storey height and slab thickness, m */
const STOREY = 3;
const THICKNESS = 0.24;
/** The slabs stop short of the ground rectangle's edges and of the bite's edge */
const INSET = 0.94;
const BITE = 0.82;
/** Inner walls: their thickness, and the shortest side of the rectangle (half of it, m) that gets one across */
const WALL = 0.18;
const ROOM_HALF = 2.5;
/** Inner walls in plaster, lighter than the floors (linear): seen through a hole, not black */
const WALL_COLOUR: readonly [number, number, number] = [0.36, 0.33, 0.29];
/** Inner walls reach this share of the building's height: below the eaves of a pitched roof, never through it */
const WALL_TOP = 0.62;
/** Over a floor the building stands at least this much higher (m), and over an inner wall's line this high, to have them */
const HEADROOM = 0.6;
const WALL_LEAST = 2.4;
/** Where a model's section is taken (m): over a floor, below the windows; for the inner walls over the seat */
const SECTION_OVER = 0.5;
const WALL_SECTION = 1.5;
/** A floor box narrower than this (m, model) is left out */
const LEAST_SIDE = 0.3;

/** Slab colours by what the building is of (linear): concrete floors, timber in wood */
const SLAB_COLOURS: Record<RubbleMaterial, readonly [number, number, number]> = {
  plaster: [0.3, 0.27, 0.24],
  concrete: [0.31, 0.3, 0.28],
  metal: [0.25, 0.25, 0.25],
  brick: [0.3, 0.25, 0.22],
  stone: [0.31, 0.28, 0.25],
  wood: [0.24, 0.16, 0.1],
};

/**
 * A building's ground for its insides: its top grid (object-roof.ts) in
 * model space at scale 1, the model's ground rectangle (catalogue `box`:
 * middle x, z and half sides) and where the model's x and z axes lie in the
 * group frame (scaled, from its origin), with the scale of its heights
 */
export interface RuinFootprint {
  roof: CatalogRoof;
  box: readonly [number, number, number, number];
  ox: number;
  oz: number;
  ux: number;
  uz: number;
  vx: number;
  vz: number;
  sy: number;
  /** A model's section on the grid at a model height (modelSection): the walls below a battlement or eaves */
  section?: (y: number) => Uint8Array;
}

/** A box of a floor in model space: x and z from and to */
export interface FootprintRect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/**
 * The boxes a floor is made of: the cells of the grid that stand higher
 * than `above` (model metres at scale 1), as runs along each row, the rows
 * with the same run in one box, cut to `box` (model space). The grid holds
 * the middles of its cells, so the outline passes between one inside and
 * one outside: a run ends in the middle of its last cell, a box in the
 * middle of its first or last row where the row beyond has nothing over it.
 * With a `section` (modelSection) only its cells
 */
export function footprintRects(roof: CatalogRoof, above: number, box: FootprintRect, section?: Uint8Array): FootprintRect[] {
  const h = roofHeights(roof);
  const { columns, rows, cell } = roof;
  const inside = (i: number, j: number): boolean =>
    i >= 0 && j >= 0 && i < columns && j < rows && h[j * columns + i] >= above && (!section || section[j * columns + i] === 1);
  const free = (j: number, i0: number, i1: number): boolean => {
    for (let i = i0; i <= i1; i++) if (inside(i, j)) return false;
    return true;
  };
  const runs: [number, number][][] = [];
  for (let j = 0; j < rows; j++) {
    const row: [number, number][] = [];
    for (let i = 0; i < columns; i++) {
      if (!inside(i, j)) continue;
      const i0 = i;
      while (inside(i + 1, j)) i++;
      row.push([i0, i]);
    }
    runs.push(row);
  }
  const out: FootprintRect[] = [];
  for (let j = 0; j < rows; j++) {
    for (const [i0, i1] of runs[j]) {
      if (i0 < 0) continue;
      // Down the rows while the same run goes on, taken from them
      let j1 = j;
      while (j1 + 1 < rows) {
        const next = runs[j1 + 1].find((r) => r[0] === i0 && r[1] === i1);
        if (!next) break;
        next[0] = -1;
        j1++;
      }
      const x0 = Math.max(box.x0, roof.x + (i0 + 0.5) * cell);
      const x1 = Math.min(box.x1, roof.x + (i1 + 0.5) * cell);
      const z0 = Math.max(box.z0, roof.z + (j + (free(j - 1, i0, i1) ? 0.5 : 0)) * cell);
      const z1 = Math.min(box.z1, roof.z + (j1 + 1 - (free(j1 + 1, i0, i1) ? 0.5 : 0)) * cell);
      if (x1 - x0 >= LEAST_SIDE && z1 - z0 >= LEAST_SIDE) out.push({ x0, x1, z0, z1 });
    }
  }
  return out;
}

/**
 * Where an inner wall stands on the line along the model's z (`alongZ`, at
 * model x `at`) or x (at model z `at`): the run of the grid's cells on it
 * the building stands at least `least` high over that comes nearest `mid`
 * (along the line), from the middle of its first cell to that of its last,
 * cut to `from` and `to`; with the lowest height over it. Null for none.
 * With a `section` (modelSection) only its cells
 */
export function wallSpan(
  roof: CatalogRoof, alongZ: boolean, at: number, mid: number, least: number, from: number, to: number, section?: Uint8Array,
): { from: number; to: number; low: number } | null {
  const h = roofHeights(roof);
  const { columns, rows, cell } = roof;
  const line = Math.floor((at - (alongZ ? roof.x : roof.z)) / cell);
  if (line < 0 || line >= (alongZ ? columns : rows)) return null;
  const n = alongZ ? rows : columns;
  const height = (k: number): number => {
    const c = alongZ ? k * columns + line : line * columns + k;
    return !section || section[c] === 1 ? h[c] : NaN;
  };
  const origin = alongZ ? roof.z : roof.x;
  let best: { from: number; to: number; low: number } | null = null;
  let nearest = Infinity;
  for (let k = 0; k < n; k++) {
    if (!(height(k) >= least)) continue;
    const k0 = k;
    let low = height(k);
    while (k + 1 < n && height(k + 1) >= least) low = Math.min(low, height(++k));
    const a = Math.max(from, origin + (k0 + 0.5) * cell);
    const b = Math.min(to, origin + (k + 0.5) * cell);
    if (b - a < LEAST_SIDE) continue;
    const off = mid < a ? a - mid : mid > b ? mid - b : 0;
    if (off < nearest) {
      nearest = off;
      best = { from: a, to: b, low };
    }
  }
  return best;
}

interface RuinFloors {
  count: number;
  matrices: Float32Array;
  damage: DamageArrays;
  colours: Float32Array;
}

export class RuinSlabs {
  readonly mesh: InstancedMesh;
  private readonly ruins = new Map<string, RuinFloors>();
  /** What each building's insides were last asked with (set), built or not: a hole that opens builds them */
  private readonly asked = new Map<string, Parameters<RuinSlabs['set']>>();
  /** The buildings with a hole in them */
  private readonly holed = new Set<string>();
  private readonly matrix = new Matrix4();
  private capacity = 0;
  /** Per building over a cellar whose insides show the ground cut away inside it, map space */
  private readonly cuts = new Map<string, GroundCut[]>();
  /** Per fallen building over a cellar: its pit's cuts and its lowest floor's top (scene y) */
  private readonly pits = new Map<string, { cuts: GroundCut[]; floor: number }>();

  constructor(
    /** The cuts changed (cellarCuts) */
    private readonly cutsChanged: () => void = () => undefined,
  ) {
    // Inside, out of the sky's light: some of the environment, so floors seen through a hole are not black
    const material = new MeshStandardMaterial({ roughness: 0.95, metalness: 0, side: DoubleSide, envMapIntensity: 0.6 });
    addDamage(material, { slab: true });
    this.mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), material, 1);
    this.mesh.name = 'ruin-slabs';
    this.mesh.customDepthMaterial = damageDepthMaterial('slab');
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.userData['losTransparent'] = true;
    this.grow(16);
    this.flush();
  }

  /**
   * Ruin `id`'s floors and inner walls anew: none below stage 2 unless a
   * hole is in it (setHoled), a fallen one's floors those well inside its
   * stump. They follow `footprint` where the building has one, else its
   * ground rectangle in `frame`
   */
  set(id: string, frame: RuinFrame, shape: RuinShape, stage: number, fallStart: number, material: RubbleMaterial, footprint: RuinFootprint | null = null): void {
    this.asked.set(id, [id, frame, shape, stage, fallStart, material, footprint]);
    if (stage < 2 && !this.holed.has(id)) {
      this.setCuts(id, null);
      this.pits.delete(id);
      if (this.ruins.delete(id)) this.flush();
      return;
    }
    // Model space: the footprint's, else the ground rectangle's own (half sides of 1)
    const f = footprint ?? { box: [0, 0, 1, 1] as const, ox: frame.cx, oz: frame.cz, ux: frame.ax, uz: frame.az, vx: frame.bx, vz: frame.bz, sy: 1 };
    const [mx, mz, hx, hz] = f.box;
    const box: FootprintRect = { x0: mx - hx * INSET, x1: mx + hx * INSET, z0: mz - hz * INSET, z1: mz + hz * INSET };
    const top = stage >= 3 ? shape.breakY - frame.seatY - 1 : frame.height - 1.2;
    const floors: { y: number; rects: FootprintRect[] }[] = [];
    // From the ground floor up: a slab over the ground inside, so no grass shows through a hole
    for (let k = 0; k * STOREY <= top; k++) {
      // A fallen one's ground floor over a cellar went down into its pit
      if (k === 0 && stage >= 3 && (frame.cellar ?? 0) > 0) continue;
      const rects = footprint ? footprintRects(footprint.roof, (k * STOREY + HEADROOM) / f.sy, box, footprint.section?.((k * STOREY + SECTION_OVER) / f.sy)) : [box];
      if (rects.length) floors.push({ y: frame.seatY + (k ? k * STOREY : THICKNESS / 2), rects });
    }
    // Over a cellar: a floor each storey down as the ground floor's (object-cellar.ts), and the ground inside its whole
    // ground cut away, while it stands as when it fell: a pit its rubble lies in
    const cellar = frame.cellar ?? 0;
    const cellarStoreys = cellar > 0 ? (frame.cellarStoreys ?? 1) : 0;
    let cuts: GroundCut[] | null = null;
    let inner: FootprintRect[] = [];
    let outline: FootprintRect[] = [];
    const fallen = stage >= 3;
    const cellarFoot = frame.seatY - cellarStoreys * CELLAR_STOREY;
    const fillY = frame.seatY - FILL_UNDER;
    // A fallen one's fill: one block from the cellar's foot up
    const fills: { y: number; height: number; rects: FootprintRect[] }[] = [];
    if (cellar > 0) {
      const section = footprint?.section?.(SECTION_OVER / f.sy);
      inner = footprint ? footprintRects(footprint.roof, HEADROOM / f.sy, box, section) : [box];
      // A fallen one's cellar filled with its rubble almost to the top (its floors under it unseen), a standing one's
      // storeys with their floors
      if (fallen) {
        if (inner.length) fills.push({ y: cellarFoot, height: fillY - cellarFoot, rects: inner });
      } else {
        for (let k = 1; k <= cellarStoreys && inner.length; k++) floors.push({ y: frame.seatY - k * CELLAR_STOREY + THICKNESS / 2, rects: inner });
      }
      const whole: FootprintRect = { x0: mx - hx, x1: mx + hx, z0: mz - hz, z1: mz + hz };
      outline = footprint ? footprintRects(footprint.roof, HEADROOM / f.sy, whole, section) : [whole];
      cuts = outline.map((r) => cellarCut(f, r, frame.seatY + (fallen ? PIT_OVER : CUT_OVER)));
    }
    if (cuts && fallen) this.pits.set(id, { cuts, floor: fillY });
    else this.pits.delete(id);
    this.setCuts(id, cuts);
    // A wall across each side long enough for two rooms, off the middle by the ruin's roll (its heading)
    const walls: { alongZ: boolean; at: number; from: number; to: number; height: number; foot: number; thick?: number; colour?: readonly [number, number, number] }[] = [];
    const tallest = frame.height * WALL_TOP;
    for (const [alongZ, half, roll] of [[true, Math.hypot(frame.ax, frame.az), 7.31], [false, Math.hypot(frame.bx, frame.bz), 3.17]] as const) {
      if (half <= ROOM_HALF) continue;
      const off = (fract(shape.heading * roll) - 0.5) * 0.6;
      const at = alongZ ? mx + hx * off : mz + hz * off;
      const [from, to] = alongZ ? [box.z0, box.z1] : [box.x0, box.x1];
      if (!footprint) {
        walls.push({ alongZ, at, from, to, height: tallest, foot: frame.seatY });
        continue;
      }
      const span = wallSpan(footprint.roof, alongZ, at, alongZ ? mz : mx, WALL_LEAST / f.sy, from, to, footprint.section?.(WALL_SECTION / f.sy));
      if (span) walls.push({ alongZ, at, from: span.from, to: span.to, height: Math.min(tallest, span.low * f.sy * 0.92), foot: frame.seatY });
    }
    // The cellar's inner walls on the same lines, from its lowest floor up to the ground floor's slab, where its
    // floors reach (the inner rectangles)
    if (cellarStoreys && inner.length) {
      const depth = cellarStoreys * CELLAR_STOREY;
      const above = walls.splice(0);
      // A fallen one's walls over the ground went down into its pit with the floor they stood on
      if (stage < 3) walls.push(...above);
      for (const w of above) {
        const runs = inner.filter((r) => (w.alongZ ? r.x0 <= w.at && w.at <= r.x1 : r.z0 <= w.at && w.at <= r.z1));
        for (const r of runs) {
          const [from, to] = w.alongZ ? [Math.max(w.from, r.z0), Math.min(w.to, r.z1)] : [Math.max(w.from, r.x0), Math.min(w.to, r.x1)];
          if (to - from < LEAST_SIDE) continue;
          // A fallen one's: a stump over the fill, broken at a height of its own
          const stump = INNER_STUMP[0] + fract(w.at * 3.7 + from * 1.3 + shape.heading) * (INNER_STUMP[1] - INNER_STUMP[0]);
          walls.push({ alongZ: w.alongZ, at: w.at, from, to, height: fallen ? fillY + stump - cellarFoot : depth, foot: cellarFoot });
        }
      }
    }
    // The outer walls from inside (cellarLining): thick, from the cellar's foot to over its floor
    if (cellarStoreys && outline.length) {
      const scale = Math.hypot(f.ux, f.uz) || 1;
      const top = frame.seatY + (fallen ? STUMP_OVER_FLOOR : 0);
      for (const l of cellarLining(outline, LINING / scale)) walls.push({ ...l, height: top - cellarFoot, foot: cellarFoot, thick: LINING, colour: LINING_COLOUR });
    }
    const count = floors.reduce((n, fl) => n + fl.rects.length, 0) + fills.reduce((n, fl) => n + fl.rects.length, 0) + walls.length;
    if (!count) {
      this.delete(id);
      return;
    }
    const matrices = new Float32Array(count * 16);
    const damage = damageArrays(count);
    const colours = new Float32Array(count * 3);
    const bitten = { ...shape, biteR: shape.biteR * BITE };
    let k = 0;
    const put = (colour: readonly [number, number, number]): void => {
      this.matrix.toArray(matrices, k * 16);
      writeDamage(damage, k, stage, fallStart, bitten);
      colours.set(colour, k * 3);
      k++;
    };
    for (const fl of floors) {
      for (const r of fl.rects) {
        const x = (r.x0 + r.x1) / 2;
        const z = (r.z0 + r.z1) / 2;
        const w = r.x1 - r.x0;
        const d = r.z1 - r.z0;
        this.matrix.set(
          f.ux * w, 0, f.vx * d, f.ox + f.ux * x + f.vx * z,
          0, THICKNESS, 0, fl.y,
          f.uz * w, 0, f.vz * d, f.oz + f.uz * x + f.vz * z,
          0, 0, 0, 1,
        );
        put(SLAB_COLOURS[material]);
      }
    }
    // The fill: a block from the cellar's foot to its top, lighter than a floor (the rubble's dust)
    const fillColour = SLAB_COLOURS[material].map((c) => c * 1.15) as [number, number, number];
    for (const fl of fills) {
      for (const r of fl.rects) {
        const x = (r.x0 + r.x1) / 2;
        const z = (r.z0 + r.z1) / 2;
        const w = r.x1 - r.x0;
        const d = r.z1 - r.z0;
        this.matrix.set(
          f.ux * w, 0, f.vx * d, f.ox + f.ux * x + f.vx * z,
          0, fl.height, 0, fl.y + fl.height / 2,
          f.uz * w, 0, f.vz * d, f.oz + f.uz * x + f.vz * z,
          0, 0, 0, 1,
        );
        put(fillColour);
      }
    }
    for (const w of walls) {
      // Thin across its line, as long as its span along it, from the seat up
      const along = (w.from + w.to) / 2;
      const len = w.to - w.from;
      const [x, z] = w.alongZ ? [w.at, along] : [along, w.at];
      const [lx, lz] = w.alongZ ? [f.vx * len, f.vz * len] : [f.ux * len, f.uz * len];
      const [nx, nz] = w.alongZ ? [f.ux, f.uz] : [f.vx, f.vz];
      const n = Math.hypot(nx, nz) || 1;
      const thick = w.thick ?? WALL;
      this.matrix.set(
        (nx / n) * thick, 0, lx, f.ox + f.ux * x + f.vx * z,
        0, w.height, 0, w.foot + w.height / 2,
        (nz / n) * thick, 0, lz, f.oz + f.uz * x + f.vz * z,
        0, 0, 0, 1,
      );
      put(w.colour ?? WALL_COLOUR);
    }
    this.ruins.set(id, { count, matrices, damage, colours });
    this.flush();
  }

  /**
   * The top of the lowest floor (scene y) of the fallen building whose pit holds map point (`x`, `y`), null
   * for none: its rubble lies there (rubble-pieces.ts)
   */
  pitFloor(x: number, y: number): number | null {
    for (const pit of this.pits.values()) if (pit.cuts.some((c) => insideCutRect(c, x, y))) return pit.floor;
    return null;
  }

  /** Whether building `id` has a hole in it: its insides show from stage 1 then */
  setHoled(id: string, holed: boolean): void {
    if (holed === this.holed.has(id)) return;
    if (holed) this.holed.add(id);
    else this.holed.delete(id);
    const asked = this.asked.get(id);
    if (asked) this.set(...asked);
  }

  delete(id: string): void {
    this.asked.delete(id);
    this.pits.delete(id);
    this.holed.delete(id);
    this.setCuts(id, null);
    if (this.ruins.delete(id)) this.flush();
  }

  clear(): void {
    this.asked.clear();
    this.pits.clear();
    this.holed.clear();
    if (this.cuts.size) {
      this.cuts.clear();
      this.cutsChanged();
    }
    if (!this.ruins.size) return;
    this.ruins.clear();
    this.flush();
  }

  /** The ground cut away inside the cellars of the standing ruins whose insides show, map space */
  cellarCuts(): GroundCut[] {
    return [...this.cuts.values()].flat();
  }

  /** Building `id`'s cuts (null: none), and a word when they changed */
  private setCuts(id: string, cuts: GroundCut[] | null): void {
    const had = this.cuts.get(id);
    if (!cuts?.length) {
      if (this.cuts.delete(id)) this.cutsChanged();
      return;
    }
    if (had && had.length === cuts.length && had.every((c, k) => sameCut(c, cuts[k]))) return;
    this.cuts.set(id, cuts);
    this.cutsChanged();
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshStandardMaterial).dispose();
    this.mesh.customDepthMaterial?.dispose();
    this.mesh.dispose();
  }

  /** Room for `n` slabs: the instance arrays anew */
  private grow(n: number): void {
    this.capacity = n;
    const g = this.mesh.geometry;
    this.mesh.instanceMatrix = new InstancedBufferAttribute(new Float32Array(n * 16), 16);
    this.mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(n * 3), 3);
    for (const name of DAMAGE_ATTRIBUTES) g.setAttribute(name, new InstancedBufferAttribute(new Float32Array(n * 4), 4));
  }

  /**
   * Every ruin's slabs into the arrays. Without any the mesh hides with
   * one empty instance, which the warm-up shows to build its programs
   */
  private flush(): void {
    let total = 0;
    for (const r of this.ruins.values()) total += r.count;
    if (total > this.capacity) {
      // The arrays anew: three keeps the old buffers' GPU copies until they are disposed with the geometry's
      const old = this.mesh.geometry;
      this.mesh.geometry = old.clone();
      old.dispose();
      this.grow(Math.max(total, this.capacity * 2));
    }
    const g = this.mesh.geometry;
    const m = this.mesh.instanceMatrix.array as Float32Array;
    const colours = this.mesh.instanceColor!.array as Float32Array;
    const attrs = DAMAGE_ATTRIBUTES.map((name) => g.getAttribute(name) as InstancedBufferAttribute);
    let n = 0;
    for (const r of this.ruins.values()) {
      m.set(r.matrices, n * 16);
      attrs.forEach((a, k) => (a.array as Float32Array).set(r.damage[k], n * 4));
      colours.set(r.colours, n * 3);
      n += r.count;
    }
    this.mesh.count = Math.max(1, n);
    this.mesh.visible = n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
    for (const a of attrs) a.needsUpdate = true;
  }
}

/**
 * The cut of rectangle `r` (model space of footprint `f`, at scale 1) up to
 * height `top`: an opening of terrain-cuts.ts, straight up (no arch), from
 * its side at z0 along its z. The group frame is the scene's (x is map -x,
 * z map y, map-coords.ts)
 */
function cellarCut(f: { ox: number; oz: number; ux: number; uz: number; vx: number; vz: number }, r: FootprintRect, top: number): GroundCut {
  const at = (x: number, z: number) => ({ x: -(f.ox + f.ux * x + f.vx * z), y: f.oz + f.uz * x + f.vz * z });
  const mid = (r.x0 + r.x1) / 2;
  const front = at(mid, r.z0);
  const back = at(mid, r.z1);
  const side = at(r.x1, r.z0);
  const length = Math.hypot(back.x - front.x, back.y - front.y) || 1e-6;
  return {
    x: front.x,
    y: front.y,
    dx: (back.x - front.x) / length,
    dy: (back.y - front.y) / length,
    halfWidth: Math.hypot(side.x - front.x, side.y - front.y),
    length,
    springY: top,
    rise: 0,
  };
}

/**
 * The cellar's outer walls seen from inside: along each side of the
 * building's ground rectangles (model space) where no other rectangle goes
 * on beyond it, a wall `thick` deep inside the side. As inner walls: the line
 * it stands on (`alongZ`: at model x `at`, along z) and its span
 */
export function cellarLining(rects: readonly FootprintRect[], thick: number): { alongZ: boolean; at: number; from: number; to: number }[] {
  const out: { alongZ: boolean; at: number; from: number; to: number }[] = [];
  const eps = 0.02;
  for (const r of rects) {
    // Per side: along z or x, its line, which way is in, its span
    const sides: [boolean, number, number, number, number][] = [
      [true, r.x0, 1, r.z0, r.z1], [true, r.x1, -1, r.z0, r.z1], [false, r.z0, 1, r.x0, r.x1], [false, r.z1, -1, r.x0, r.x1],
    ];
    for (const [alongZ, line, inward, from, to] of sides) {
      // Where another rectangle reaches past this side, the side is inside the building: no wall there
      const beyond = (o: FootprintRect): boolean => {
        const [lo, hi] = alongZ ? [o.x0, o.x1] : [o.z0, o.z1];
        return inward > 0 ? lo < line - eps && hi >= line - eps : hi > line + eps && lo <= line + eps;
      };
      const covered = rects
        .filter((o) => o !== r && beyond(o))
        .map((o) => (alongZ ? [o.z0, o.z1] : [o.x0, o.x1]) as [number, number])
        .sort((a, b) => a[0] - b[0]);
      let at = from;
      for (const [c0, c1] of [...covered, [to, to] as [number, number]]) {
        const end = Math.min(c0, to);
        if (end - at >= LEAST_SIDE) out.push({ alongZ, at: line + (inward * thick) / 2, from: at, to: end });
        at = Math.max(at, c1);
        if (at >= to) break;
      }
    }
  }
  return out;
}

/** Whether map point (`x`, `y`) lies within cut `c`'s ground (its front face's width, its length in) */
function insideCutRect(c: GroundCut, x: number, y: number): boolean {
  const along = (x - c.x) * c.dx + (y - c.y) * c.dy;
  const across = Math.abs(-(x - c.x) * c.dy + (y - c.y) * c.dx);
  return along >= 0 && along <= c.length && across <= c.halfWidth;
}

function sameCut(a: GroundCut, b: GroundCut): boolean {
  return a.x === b.x && a.y === b.y && a.dx === b.dx && a.dy === b.dy && a.halfWidth === b.halfWidth && a.length === b.length && a.springY === b.springY;
}

function fract(v: number): number {
  return v - Math.floor(v);
}
