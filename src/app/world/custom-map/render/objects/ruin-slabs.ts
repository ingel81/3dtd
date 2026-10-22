import { BoxGeometry, DoubleSide, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshStandardMaterial } from 'three';
import { roofHeights, type CatalogRoof } from '../../object-roof';
import type { RubbleMaterial } from '../../rubble-material';
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
 */

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

  constructor() {
    // Inside, out of the sky's light: some of the environment, so floors seen through a hole are not black
    const material = new MeshStandardMaterial({ roughness: 0.95, metalness: 0, side: DoubleSide, envMapIntensity: 0.6 });
    addDamage(material);
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
      const rects = footprint ? footprintRects(footprint.roof, (k * STOREY + HEADROOM) / f.sy, box, footprint.section?.((k * STOREY + SECTION_OVER) / f.sy)) : [box];
      if (rects.length) floors.push({ y: frame.seatY + (k ? k * STOREY : THICKNESS / 2), rects });
    }
    // A wall across each side long enough for two rooms, off the middle by the ruin's roll (its heading)
    const walls: { alongZ: boolean; at: number; from: number; to: number; height: number }[] = [];
    const tallest = frame.height * WALL_TOP;
    for (const [alongZ, half, roll] of [[true, Math.hypot(frame.ax, frame.az), 7.31], [false, Math.hypot(frame.bx, frame.bz), 3.17]] as const) {
      if (half <= ROOM_HALF) continue;
      const off = (fract(shape.heading * roll) - 0.5) * 0.6;
      const at = alongZ ? mx + hx * off : mz + hz * off;
      const [from, to] = alongZ ? [box.z0, box.z1] : [box.x0, box.x1];
      if (!footprint) {
        walls.push({ alongZ, at, from, to, height: tallest });
        continue;
      }
      const span = wallSpan(footprint.roof, alongZ, at, alongZ ? mz : mx, WALL_LEAST / f.sy, from, to, footprint.section?.(WALL_SECTION / f.sy));
      if (span) walls.push({ alongZ, at, from: span.from, to: span.to, height: Math.min(tallest, span.low * f.sy * 0.92) });
    }
    const count = floors.reduce((n, fl) => n + fl.rects.length, 0) + walls.length;
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
    for (const w of walls) {
      // Thin across its line, as long as its span along it, from the seat up
      const along = (w.from + w.to) / 2;
      const len = w.to - w.from;
      const [x, z] = w.alongZ ? [w.at, along] : [along, w.at];
      const [lx, lz] = w.alongZ ? [f.vx * len, f.vz * len] : [f.ux * len, f.uz * len];
      const [nx, nz] = w.alongZ ? [f.ux, f.uz] : [f.vx, f.vz];
      const n = Math.hypot(nx, nz) || 1;
      this.matrix.set(
        (nx / n) * WALL, 0, lx, f.ox + f.ux * x + f.vx * z,
        0, w.height, 0, frame.seatY + w.height / 2,
        (nz / n) * WALL, 0, lz, f.oz + f.uz * x + f.vz * z,
        0, 0, 0, 1,
      );
      put(WALL_COLOUR);
    }
    this.ruins.set(id, { count, matrices, damage, colours });
    this.flush();
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
    this.holed.delete(id);
    if (this.ruins.delete(id)) this.flush();
  }

  clear(): void {
    this.asked.clear();
    this.holed.clear();
    if (!this.ruins.size) return;
    this.ruins.clear();
    this.flush();
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

function fract(v: number): number {
  return v - Math.floor(v);
}
