import type { SimSink } from '../../sim/core/sim-sink';
import type { RunStructure } from '../../sim/protocol/run-rules';
import { MAP_METERS_PER_DEGREE } from '../../world/custom-map/map-document';
import { structureHeading, structureStage, type StructureStage } from '../../configs/destruction.config';
import { DetMath } from '../../utils/det-math';
import { ringsContain } from '../../world/custom-map/object-mass';

/** Edge of a cell of the ledger's lookup grid, m (as CustomMapSurface's build blocking) */
export const STRUCTURE_CELL_M = 16;

/** What the ledger tells its owner (WorldDamage) */
export interface StructureEvents {
  /** Structure `index` went from stage `from` to `to` by damage (not by a restore or a new run) */
  staged(index: number, from: StructureStage, to: StructureStage): void;
  /** A tower stands on the roof of structure `index` (RunStructure.roof): it takes no damage */
  carried(index: number): boolean;
}

/** Numbers per roof in StructureLedger.roof: middle x, y, half extents, cos, sin */
const ROOF_STRIDE = 6;

const ascending = (a: number, b: number) => a - b;
const NO_HEADINGS = new Int16Array(0);

/** How far from map metres (`x`, `y`) the corners of `box` reach at most (IEEE `sqrt`, the same on every engine) */
function boxReach(box: readonly [number, number, number, number, number], x: number, y: number): number {
  const dx = box[0] - x;
  const dy = box[1] - y;
  return Math.sqrt(dx * dx + dy * dy) + Math.sqrt(box[2] * box[2] + box[3] * box[3]);
}

/**
 * The HP of a destructible world's structures in the simulation
 * (docs/DESTRUCTION_PLAN.md, TODO E131): whole numbers, the stage of each a
 * function of them (structureStage). Damage comes in by place (hit, fell);
 * a grid of STRUCTURE_CELL_M cells finds the structures in reach, so a hit
 * costs the few structures near it, not all of a city's thousands.
 *
 * The main thread hears the stages: all of them as one byte each in the run
 * rules' order (`structures.setStages`) after a load, a new run, a restore
 * or a replay's seek, and one stage at a time as it changes
 * (`structures.stage`), a few bytes however long the run. The owner hears
 * every change by damage (StructureEvents.staged) for what follows from it:
 * the moment of a fall, its rubble, the towers that see past it. Snapshots
 * and the state hash carry the HP.
 *
 * Each stage reached by a hit keeps that hit's heading (structureHeading):
 * the way it pushed the structure, which the look lets it give way to. The
 * stages go out with the headings; snapshots and the state hash carry them
 * once one is known, so a world never hit hashes and saves as before.
 */
export class StructureLedger {
  private structures: readonly RunStructure[] = [];
  /** Map metres, per structure */
  private x = new Float64Array(0);
  private y = new Float64Array(0);
  private radius = new Float64Array(0);
  /** How far from its middle its ground reaches, its box's corners included: the cells it is listed in */
  private extent = new Float64Array(0);
  private maxHp = new Int32Array(0);
  private startHp = new Int32Array(0);
  private hp = new Int32Array(0);
  private stage = new Uint8Array(0);
  /** Per structure the heading of the hit that brought its stage, -1 for none (structureHeading) */
  private heading = new Int16Array(0);
  /** Per structure whose roof carries towers its box (ROOF_STRIDE numbers), NaN for one without */
  private roof = new Float64Array(0);
  /** Per raised building its outline with the cos and sin of its turn (RunStructure.mass), null for one without */
  private outline: ({ x: number; y: number; scale: number; cos: number; sin: number; rings: readonly (readonly number[])[] } | null)[] = [];

  // The lookup grid: per cell its structures, as offsets into `items` (cellStart has one more entry than cells)
  private minX = 0;
  private minY = 0;
  private columns = 0;
  private rows = 0;
  private cellStart = new Int32Array(1);
  private items = new Int32Array(0);
  /** The query a structure was last visited by, so one in several cells counts once */
  private seen = new Uint32Array(0);
  private query = 0;
  /** The structures a query reached, in their order (scratch) */
  private readonly reached: number[] = [];

  constructor(
    private readonly sink: SimSink,
    private readonly events: StructureEvents,
  ) {}

  /** The world's structures, at their start (standing, or as the map damaged them); none for a world where nothing falls */
  load(structures: readonly RunStructure[] | null): void {
    const list = structures ?? [];
    const n = list.length;
    this.structures = list;
    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
    this.radius = new Float64Array(n);
    this.extent = new Float64Array(n);
    this.maxHp = new Int32Array(n);
    this.startHp = new Int32Array(n);
    this.hp = new Int32Array(n);
    this.stage = new Uint8Array(n);
    this.heading = new Int16Array(n).fill(-1);
    this.roof = new Float64Array(n * ROOF_STRIDE).fill(NaN);
    this.outline = list.map((s) => s.mass
      ? { x: s.mass.x, y: s.mass.y, scale: s.mass.scale, cos: DetMath.cos(s.mass.turn), sin: DetMath.sin(s.mass.turn), rings: s.mass.rings }
      : null);
    this.seen = new Uint32Array(n);
    this.query = 0;
    list.forEach((s, i) => {
      this.x[i] = s.lon * MAP_METERS_PER_DEGREE;
      this.y[i] = s.lat * MAP_METERS_PER_DEGREE;
      this.radius[i] = s.radius;
      this.extent[i] = s.box ? Math.max(s.radius, boxReach(s.box, this.x[i], this.y[i])) : s.radius;
      this.maxHp[i] = Math.max(1, Math.round(s.hp));
      this.startHp[i] = Math.min(this.maxHp[i], Math.max(0, Math.round(s.start ?? s.hp)));
      if (s.roof) this.setRoof(i, s);
    });
    this.buildGrid();
    this.toStart();
  }

  private setRoof(i: number, s: RunStructure): void {
    const r = this.roof;
    const k = i * ROOF_STRIDE;
    if (s.box) {
      const [bx, by, hx, hy, turn] = s.box;
      r[k] = bx;
      r[k + 1] = by;
      r[k + 2] = hx;
      r[k + 3] = hy;
      r[k + 4] = DetMath.cos(turn);
      r[k + 5] = DetMath.sin(turn);
    } else {
      // No ground plan: a square as wide as the circle, unturned
      r[k] = this.x[i];
      r[k + 1] = this.y[i];
      r[k + 2] = r[k + 3] = s.radius;
      r[k + 4] = 1;
      r[k + 5] = 0;
    }
  }

  /** Each structure in the cells its ground covers (its circle, its box) */
  private buildGrid(): void {
    const n = this.structures.length;
    if (n === 0) {
      this.columns = this.rows = 0;
      this.cellStart = new Int32Array(1);
      this.items = new Int32Array(0);
      return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      minX = Math.min(minX, this.x[i] - this.extent[i]);
      minY = Math.min(minY, this.y[i] - this.extent[i]);
      maxX = Math.max(maxX, this.x[i] + this.extent[i]);
      maxY = Math.max(maxY, this.y[i] + this.extent[i]);
    }
    this.minX = minX;
    this.minY = minY;
    this.columns = Math.floor((maxX - minX) / STRUCTURE_CELL_M) + 1;
    this.rows = Math.floor((maxY - minY) / STRUCTURE_CELL_M) + 1;
    const counts = new Int32Array(this.columns * this.rows + 1);
    const visit = (i: number, each: (cell: number) => void) => {
      const i0 = this.col(this.x[i] - this.extent[i]);
      const i1 = this.col(this.x[i] + this.extent[i]);
      const j0 = this.row(this.y[i] - this.extent[i]);
      const j1 = this.row(this.y[i] + this.extent[i]);
      for (let j = j0; j <= j1; j++) for (let c = i0; c <= i1; c++) each(j * this.columns + c);
    };
    for (let i = 0; i < n; i++) visit(i, (cell) => counts[cell + 1]++);
    for (let k = 1; k < counts.length; k++) counts[k] += counts[k - 1];
    const fill = counts.slice(0, -1);
    this.items = new Int32Array(counts[counts.length - 1]);
    for (let i = 0; i < n; i++) visit(i, (cell) => (this.items[fill[cell]++] = i));
    this.cellStart = counts;
  }

  private col(x: number): number {
    return Math.min(this.columns - 1, Math.max(0, Math.floor((x - this.minX) / STRUCTURE_CELL_M)));
  }

  private row(y: number): number {
    return Math.min(this.rows - 1, Math.max(0, Math.floor((y - this.minY) / STRUCTURE_CELL_M)));
  }

  /** A new run: every structure as the map has it at the start */
  reset(): void {
    if (this.structures.length === 0) return;
    this.toStart();
  }

  private toStart(): void {
    this.hp.set(this.startHp);
    this.heading.fill(-1);
    this.restage();
  }

  get size(): number {
    return this.structures.length;
  }

  /** The structures the run rules brought, in their order */
  list(): readonly RunStructure[] {
    return this.structures;
  }

  /** Map metres of structure `index` */
  xOf(index: number): number {
    return this.x[index];
  }

  yOf(index: number): number {
    return this.y[index];
  }

  /**
   * Take `amount` (whole HP) off every structure that still stands within
   * `reach` m plus its radius of map metres (`x`, `y`) and carries no
   * tower; how many changed their stage
   */
  hit(x: number, y: number, reach: number, amount: number): number {
    if (amount <= 0 || this.structures.length === 0) return 0;
    let changed = 0;
    for (const i of this.near(x, y, reach)) if (this.damage(i, amount, x, y)) changed++;
    return changed;
  }

  /** Every structure within `reach` m plus its radius of (`x`, `y`) falls, but one that carries a tower; how many fell */
  fell(x: number, y: number, reach: number): number {
    if (this.structures.length === 0) return 0;
    let fallen = 0;
    for (const i of this.near(x, y, reach)) if (this.damage(i, this.hp[i], x, y)) fallen++;
    return fallen;
  }

  /**
   * The standing structures within `reach` m plus their radius of map
   * metres (`x`, `y`), in the run rules' order: the order damage acts in, so
   * what follows from it (falls, sight requests) comes in the same order on
   * every client. A scratch list, valid until the next call
   */
  near(x: number, y: number, reach: number): readonly number[] {
    const reached = this.reached;
    reached.length = 0;
    if (this.columns === 0) return reached;
    const q = ++this.query;
    const i0 = this.col(x - reach);
    const i1 = this.col(x + reach);
    const j0 = this.row(y - reach);
    const j1 = this.row(y + reach);
    for (let j = j0; j <= j1; j++) {
      for (let c = i0; c <= i1; c++) {
        const cell = j * this.columns + c;
        for (let k = this.cellStart[cell]; k < this.cellStart[cell + 1]; k++) {
          const i = this.items[k];
          if (this.seen[i] === q) continue;
          this.seen[i] = q;
          if (this.hp[i] <= 0) continue;
          const r = reach + this.radius[i];
          const dx = this.x[i] - x;
          const dy = this.y[i] - y;
          if (dx * dx + dy * dy <= r * r) reached.push(i);
        }
      }
    }
    if (reached.length > 1) reached.sort(ascending);
    return reached;
  }

  /**
   * The standing structure nearest map metres (`x`, `y`) whose ground comes
   * within `reach` m, that a hit can damage (no tower on its roof); -1 for
   * none. Nearest by its middle; of two alike the first in the run rules'
   * order, on every client the same.
   */
  nearestTarget(x: number, y: number, reach: number): number {
    let best = -1;
    let bestSq = Infinity;
    for (const i of this.near(x, y, reach)) {
      const dx = this.x[i] - x;
      const dy = this.y[i] - y;
      const sq = dx * dx + dy * dy;
      if (sq < bestSq && this.takesDamage(i)) {
        best = i;
        bestSq = sq;
      }
    }
    return best;
  }

  /** Structure `index` stands and a hit would damage it: no tower on its roof */
  takesDamage(index: number): boolean {
    if (index < 0 || index >= this.structures.length || this.hp[index] <= 0) return false;
    return Number.isNaN(this.roof[index * ROOF_STRIDE]) || !this.events.carried(index);
  }

  /** Ground radius of structure `index`, m */
  radiusOf(index: number): number {
    return this.radius[index];
  }

  /**
   * `amount` off structure `index` by a hit at map metres (`x`, `y`) unless
   * it carries a tower; whether its stage changed (and took the hit's heading)
   */
  private damage(index: number, amount: number, x: number, y: number): boolean {
    if (this.hp[index] <= 0 || amount <= 0) return false;
    if (!Number.isNaN(this.roof[index * ROOF_STRIDE]) && this.events.carried(index)) return false;
    this.hp[index] = Math.max(0, this.hp[index] - amount);
    const to = structureStage(this.hp[index], this.maxHp[index]);
    const from = this.stage[index] as StructureStage;
    if (to === from) return false;
    this.stage[index] = to;
    const heading = structureHeading(this.x[index] - x, this.y[index] - y, DetMath.atan2);
    if (heading >= 0) this.heading[index] = heading;
    this.sink.structures.stage(index, to, this.heading[index]);
    this.events.staged(index, from, to);
    return true;
  }

  /**
   * Whether map metres (`x`, `y`) lie on the roof of structure `index`
   * (RunStructure.roof): within its box, and for a raised building within
   * its outline, not in a courtyard
   */
  onRoof(index: number, x: number, y: number): boolean {
    const r = this.roof;
    const k = index * ROOF_STRIDE;
    if (Number.isNaN(r[k])) return false;
    // In the box's own axes, as CustomMapSurface's covers()
    const ox = x - r[k];
    const oy = y - r[k + 1];
    const cos = r[k + 4];
    const sin = r[k + 5];
    if (Math.abs(-ox * cos - oy * sin) > r[k + 2] || Math.abs(-ox * sin + oy * cos) > r[k + 3]) return false;
    const m = this.outline[index];
    if (!m) return true;
    // Into the model's x and z at scale 1 (object-ground.ts toModel)
    const dx = (x - m.x) / m.scale;
    const dy = (y - m.y) / m.scale;
    return ringsContain(m.rings, -dx * m.cos - dy * m.sin, -dx * m.sin + dy * m.cos);
  }

  /**
   * Whether map metres (`x`, `y`) lie on the roof of a structure that has
   * fallen: a tower ordered onto that roof finds none (the building fell in
   * the tick the order acts in) and is not placed
   */
  fallenRoofAt(x: number, y: number): boolean {
    if (this.columns === 0) return false;
    const cell = this.row(y) * this.columns + this.col(x);
    for (let k = this.cellStart[cell]; k < this.cellStart[cell + 1]; k++) {
      const i = this.items[k];
      if (this.hp[i] <= 0 && this.onRoof(i, x, y)) return true;
    }
    return false;
  }

  /** HP in the order of the run rules, for a snapshot */
  hpList(): number[] {
    return Array.from(this.hp);
  }

  /** The HP as a view, for the state hash without a copy */
  hpView(): Int32Array {
    return this.hp;
  }

  /** The headings for a snapshot; absent while none is known, so a world never hit saves as before */
  headingList(): number[] | undefined {
    return this.heading.some((h) => h >= 0) ? Array.from(this.heading) : undefined;
  }

  /** The headings for the state hash: empty while none is known */
  headingView(): Int16Array {
    return this.heading.some((h) => h >= 0) ? this.heading : NO_HEADINGS;
  }

  /**
   * HP and headings back from a snapshot (hpList, headingList); a snapshot
   * without HP starts every structure as the map has it, one without
   * headings knows none
   */
  restore(hp: readonly number[] | undefined, headings?: readonly number[]): void {
    for (let i = 0; i < this.structures.length; i++) {
      const saved = hp?.[i];
      this.hp[i] = typeof saved === 'number' && Number.isFinite(saved)
        ? Math.min(this.maxHp[i], Math.max(0, Math.round(saved)))
        : this.startHp[i];
      const h = headings?.[i];
      this.heading[i] = typeof h === 'number' && Number.isInteger(h) && h >= 0 && h < 256 ? h : -1;
    }
    this.restage();
  }

  /** The stages from the HP, and the main thread hears all of them */
  private restage(): void {
    for (let i = 0; i < this.structures.length; i++) this.stage[i] = structureStage(this.hp[i], this.maxHp[i]);
    this.publish();
  }

  /** Tell the main thread every structure's stage, one byte each in the run rules' order, with the headings */
  publish(): void {
    if (this.structures.length === 0) return;
    this.sink.structures.setStages(this.stage.slice(), this.heading.slice());
  }

  /** Every structure's stage, a view in the run rules' order */
  stages(): Uint8Array {
    return this.stage;
  }
}
