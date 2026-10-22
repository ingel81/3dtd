import type { WorldGroundDamage } from '../world-provider';
import type { RunStructure } from '../../sim/protocol/run-rules';
import type { MapHeightGrid } from './map-document';
import { craterCm } from '../../map-ops/impact-stamp';
import { rubbleCmAt, rubbleReach, rubbleShapeOf } from '../../utils/stamp-field';
import { craterMaxDepthCm } from '../../managers/game-state/crater-ledger';
import { RUBBLE } from '../../configs/destruction.config';
import { RUBBLE_COLOURS, RUBBLE_MATERIALS, type RubbleMaterial } from './rubble-material';

/** What a mark shows */
export const ImpactMarkKind = { Crater: 0, Rubble: 1 } as const;
export type ImpactMarkKind = (typeof ImpactMarkKind)[keyof typeof ImpactMarkKind];

/** A mark of the fight on the ground, map metres */
export interface ImpactMark {
  x: number;
  y: number;
  /** Its full width, m */
  size: number;
  /** Turn, rad */
  rotation: number;
  kind: ImpactMarkKind;
  /** 0..1: how deep a crater is for its radius, how high a heap */
  strength: number;
  /** Rolls its look, any number */
  seed: number;
  /** What rubble is of (RUBBLE_MATERIALS index); 0 for a crater */
  material: number;
}

/** Samples a side of a tile the ground is rebuilt in */
export const GROUND_TILE = 32;
/** Tiles the ground rebuilds at most per frame (CustomMapView.updateHeights of their union) */
export const GROUND_TILES_PER_FRAME = 2;
/** Centimetres a sample has to be torn up by to grow no grass */
export const BARE_FROM_CM = 10;
/** Around a standing tower the ground sinks no lower than the tower's foot, m */
export const TOWER_HOLD_M = 3;
/** A sample no tower holds: no floor under it */
const NO_FLOOR = -0x7fffffff;

/** A rectangle in map metres, as CustomMapView.updateHeights takes it */
export interface GroundRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * What the fight did to a custom map's ground, drawn (docs/DESTRUCTION_PLAN.md,
 * Z4): the craters and the rubble of fallen structures as the simulation has
 * them, stamped into the run's own height grid with the same shapes as its
 * StampField (map-ops/impact-stamp.ts), in whole centimetres.
 *
 * The grid's heights at the start stay as `base`; every stamp adds into
 * `sum`, so a stamp taken away (a crater deepened, a restore) leaves the
 * samples as they were and the order does not matter. Where a tower stands
 * the ground sinks no lower than the tower's foot, nor below the map's own
 * ground there (`TOWER_HOLD_M`): a crater beside a tower leaves it on its
 * footing, a deeper crater under a tower built in one leaves its floor. The
 * floor comes from the map and the tower alone, not from what was stamped
 * when the tower came, so a restore or a replay's jump, which stamps every
 * crater before the towers hold, draws the same ground as the run.
 *
 * Beside the ground it keeps `standing`, the heights the map's buildings,
 * walls and structures stand on: the map's own with the craters but not the
 * rubble (a stump at a crater's rim sinks with the ground, none rises on its
 * own heap), and the craters' centimetres alone per sample (craterCmAt).
 *
 * Changed samples are written per tile of GROUND_TILE samples, a few tiles a
 * frame (`flush`, GROUND_TILES_PER_FRAME), the samples changed in each frame's
 * tiles as one rectangle to the view (`apply`, CustomMapView.updateHeights): a rocket's
 * crater shows the next frame, a restore with every crater of a run spreads
 * over frames instead of rebuilding the whole ground in one.
 */
export class CustomMapGroundDamage implements WorldGroundDamage {
  private readonly columns: number;
  private readonly rows: number;
  private readonly cell: number;
  private readonly originX: number;
  private readonly originY: number;
  private readonly tilesX: number;
  /** The heights at the start, made with the first stamp */
  private base: Float32Array | null = null;
  /** Every stamp's centimetres, per sample */
  private sum: Int32Array | null = null;
  /** The craters' centimetres alone (their walls too, not the rubble), per sample */
  private craterSum: Int32Array | null = null;
  /**
   * The heights buildings, walls and structures stand on: the map's own and
   * the craters, not the rubble (CustomMapViewOptions.standingGround). Its
   * heights are written with the ground's (flush)
   */
  readonly standing: MapHeightGrid;
  /** Per sample the centimetres the towers holding it keep it at least (NO_FLOOR where none holds it) */
  private floor: Int32Array | null = null;
  /** 1 where the ground shows torn up (BARE_FROM_CM): no grass there */
  private bare: Uint8Array | null = null;
  /** Tiles whose samples changed, in the order they came */
  private readonly dirty = new Set<number>();
  /**
   * Per tile the samples changed in it since its last write (i0, j0, i1, j1):
   * the write and the view's rectangle cover those, not the whole tile. A
   * crater in a tile on the border would otherwise rebuild the apron round
   * the map (MapTerrainLayer.refreshApron) though no border sample moved.
   */
  private readonly changed: Int32Array;
  /** The towers holding the ground: map metres, `foot` the height their plinth stands on */
  private readonly towers = new Map<string, { x: number; y: number; foot: number }>();
  /** The marks over the stamps (impact-marks.ts): a crater by its middle, a heap by its structure */
  private readonly marks = new Map<string, ImpactMark>();
  private marksChanged = false;

  constructor(
    private readonly grid: MapHeightGrid,
    width: number,
    depth: number,
    /** The heights changed in this rectangle: the view follows (CustomMapView.updateHeights) */
    private readonly apply: (rect: GroundRect) => void,
    /** The marks changed: every one as it stands (CustomMapView.setImpactMarks) */
    private readonly showMarks: (marks: Iterable<ImpactMark>) => void = () => undefined,
    /** What structure `id` is built of (CustomMapDestruction.materialOf) */
    private readonly materialOf: (id: string) => RubbleMaterial = () => 'plaster',
    /** The samples that show torn up, kept by reference (CustomMapView.setGroundBare) */
    private readonly showBare: (bare: Uint8Array) => void = () => undefined,
    /** Pieces thrown out of a falling structure (CustomMapView.throwDebris) */
    private readonly throwDebris: (x: number, y: number, radius: number, height: number, colour: readonly [number, number, number], count: number, seed: number) => void = () => undefined,
    /** A crater came, deepened or went in this rectangle (map metres): what stands in it may be gone (crater-obliteration.ts) */
    private readonly cratersChanged: (rect: GroundRect) => void = () => undefined,
    /** The game's clock, seconds: when a crater was dug (dug) */
    private readonly now: () => number = () => 0,
    /** What stands at map metres (x, y) before a hit (waterAt) */
    private readonly waterAtMap: (x: number, y: number) => 'water' | 'lava' | null = () => null,
  ) {
    this.standing = { ...grid, heights: grid.heights.slice() };
    this.columns = grid.columns;
    this.rows = grid.rows;
    this.cell = grid.cellSize;
    this.originX = -width / 2;
    this.originY = -depth / 2;
    this.tilesX = Math.ceil(this.columns / GROUND_TILE);
    this.changed = new Int32Array(this.tilesX * Math.ceil(this.rows / GROUND_TILE) * 4);
  }

  /** The craters as stamped now, by their middle (map dm): middle and radius in map metres */
  private readonly craterList = new Map<string, { x: number; y: number; radius: number; depthCm: number }>();
  /** Craters dug in the run since the last restore, by their middle: the game second they were dug */
  private readonly fresh = new Map<string, number>();
  /** Counts every change of the craters: who reads them sees whether they changed */
  craterVersion = 0;

  /** The craters as stamped now, by their middle */
  craters(): ReadonlyMap<string, { x: number; y: number; radius: number; depthCm: number }> {
    return this.craterList;
  }

  /** The game second crater `key` was dug, null for one known before (a restore: long ago) */
  dugAt(key: string): number | null {
    return this.fresh.get(key) ?? null;
  }

  dug(xDm: number, yDm: number): void {
    this.fresh.set(`c${xDm},${yDm}`, this.now());
    this.craterVersion++;
  }

  waterAt(xDm: number, yDm: number): 'water' | 'lava' | null {
    return this.waterAtMap(xDm / 10, yDm / 10);
  }

  /** Tiles waiting to be written */
  get pending(): number {
    return this.dirty.size;
  }

  crater(xDm: number, yDm: number, rDm: number, depthCm: number, sign: 1 | -1): void {
    const x = xDm / 10;
    const y = yDm / 10;
    const r = rDm / 10;
    const reach = r * 1.35;
    this.stamp(x, y, reach, reach, (sx, sy) => {
      const dx = sx - x;
      const dy = sy - y;
      return craterCm(dx * dx + dy * dy, r, depthCm) * sign;
    }, true);
    this.cratersChanged({ minX: x - reach, minY: y - reach, maxX: x + reach, maxY: y + reach });
    const key = `c${xDm},${yDm}`;
    if (sign < 0) this.craterList.delete(key);
    else this.craterList.set(key, { x, y, radius: r, depthCm });
    this.craterVersion++;
    if (sign < 0) this.marks.delete(key);
    else {
      const seed = ((xDm * 0.618 + yDm * 0.414) % 97) + 3;
      this.marks.set(key, { x, y, size: r * 2.8, rotation: seed, kind: ImpactMarkKind.Crater, strength: Math.min(1, depthCm / craterMaxDepthCm(rDm)), seed, material: 0 });
    }
    this.marksChanged = true;
  }

  rubble(structure: RunStructure, sign: 1 | -1): void {
    const shape = rubbleShapeOf(structure);
    const reach = rubbleReach(shape);
    this.stamp(shape.x, shape.z, reach.x, reach.z, (sx, sy) => rubbleCmAt(shape, sx, sy) * sign);
    const key = `r${structure.id}`;
    if (sign < 0) this.marks.delete(key);
    else {
      const size = 2 * (Math.max(shape.coreX, shape.coreZ) + shape.falloff);
      const seed = (structure.id.length * 13.7 + structure.lat * 9e5 + structure.lon * 7e5) % 89;
      this.marks.set(key, {
        x: shape.x, y: shape.z, size, rotation: structure.box?.[4] ?? 0, kind: ImpactMarkKind.Rubble,
        strength: shape.peakCm / RUBBLE.maxPeakCm, seed, material: RUBBLE_MATERIALS.indexOf(this.materialOf(structure.id)),
      });
    }
    this.marksChanged = true;
  }

  debris(x: number, y: number, radius: number, height: number, material: RubbleMaterial, seed: number): void {
    const count = Math.min(60, Math.round(10 + radius * 3 + height));
    this.throwDebris(x, y, radius, height, RUBBLE_COLOURS[material].grit, count, seed);
  }

  /** Every stamp off and every tower's hold let go: the ground as built, written over the next frames */
  clear(): void {
    const sum = this.sum;
    if (!sum) return;
    for (let k = 0; k < sum.length; k++) {
      if (sum[k] === 0 && this.craterSum![k] === 0 && this.floor![k] === NO_FLOOR) continue;
      this.markSample(k);
    }
    sum.fill(0);
    this.craterSum!.fill(0);
    this.floor!.fill(NO_FLOOR);
    this.towers.clear();
    this.marks.clear();
    this.craterList.clear();
    this.fresh.clear();
    this.craterVersion++;
    this.marksChanged = true;
    this.cratersChanged({ minX: this.originX, minY: this.originY, maxX: this.originX + (this.columns - 1) * this.cell, maxY: this.originY + (this.rows - 1) * this.cell });
  }

  /**
   * The craters' centimetres at map metres (`x`, `y`), between the samples
   * (negative in a pit, the walls a little positive); 0 before the first
   */
  craterCmAt(x: number, y: number): number {
    const c = this.craterSum;
    if (!c) return 0;
    const fx = Math.max(0, Math.min(this.columns - 1, (x - this.originX) / this.cell));
    const fy = Math.max(0, Math.min(this.rows - 1, (y - this.originY) / this.cell));
    const i = Math.min(this.columns - 2, Math.floor(fx));
    const j = Math.min(this.rows - 2, Math.floor(fy));
    const u = fx - i;
    const v = fy - j;
    const k = j * this.columns + i;
    return (c[k] * (1 - u) + c[k + 1] * u) * (1 - v) + (c[k + this.columns] * (1 - u) + c[k + this.columns + 1] * u) * v;
  }

  /**
   * Tower `id` stands at map metres (`x`, `y`) on a plinth whose foot is at
   * height `foot`: the ground round it sinks no lower from now on
   */
  holdTower(id: string, x: number, y: number, foot: number): void {
    if (this.towers.has(id)) return;
    const at = { x, y, foot };
    this.towers.set(id, at);
    // Before the first stamp nothing to hold yet: ensure() holds every tower then
    if (!this.floor) return;
    this.raiseFloor(at, true);
  }

  /** Tower `id` is gone: the ground round it follows the stamps again, as far as no other tower holds it */
  releaseTower(id: string): void {
    const at = this.towers.get(id);
    if (!at) return;
    this.towers.delete(id);
    const floor = this.floor;
    if (!floor) return;
    this.disc(at.x, at.y, (k) => {
      floor[k] = NO_FLOOR;
      this.markSample(k);
    });
    // The towers near enough to share samples with it lay their floors again
    const reach = 2 * TOWER_HOLD_M;
    for (const other of this.towers.values()) {
      if (Math.abs(other.x - at.x) <= reach && Math.abs(other.y - at.y) <= reach) this.raiseFloor(other, false);
    }
  }

  /** The floor of the tower at `at` laid into its samples: the map's own ground there, no higher than its foot */
  private raiseFloor(at: { x: number; y: number; foot: number }, mark: boolean): void {
    const floor = this.floor!;
    const base = this.base!;
    this.disc(at.x, at.y, (k) => {
      const cm = Math.round((Math.min(base[k], at.foot) - base[k]) * 100);
      if (cm <= floor[k]) return;
      floor[k] = cm;
      if (mark) this.markSample(k);
    });
  }

  /** Write the waiting tiles, at most `maxTiles`, and tell the view their rectangle */
  flush(maxTiles = GROUND_TILES_PER_FRAME): void {
    if (this.marksChanged) {
      this.marksChanged = false;
      this.showMarks(this.marks.values());
    }
    if (this.dirty.size === 0) return;
    const base = this.base!;
    const sum = this.sum!;
    const floor = this.floor!;
    const bare = this.bare!;
    const craters = this.craterSum!;
    const heights = this.grid.heights;
    const standing = this.standing.heights;
    let i0 = Infinity, j0 = Infinity, i1 = -Infinity, j1 = -Infinity;
    let done = 0;
    for (const tile of this.dirty) {
      if (done++ >= maxTiles) break;
      this.dirty.delete(tile);
      const c = this.changed;
      const a0 = c[tile * 4];
      const b0 = c[tile * 4 + 1];
      const a1 = c[tile * 4 + 2];
      const b1 = c[tile * 4 + 3];
      for (let j = b0; j <= b1; j++) {
        for (let i = a0; i <= a1; i++) {
          const k = j * this.columns + i;
          const cm = Math.max(sum[k], floor[k]);
          heights[k] = base[k] + cm / 100;
          standing[k] = base[k] + craters[k] / 100;
          bare[k] = cm >= BARE_FROM_CM || cm <= -BARE_FROM_CM ? 1 : 0;
        }
      }
      i0 = Math.min(i0, a0);
      j0 = Math.min(j0, b0);
      i1 = Math.max(i1, a1);
      j1 = Math.max(j1, b1);
    }
    this.showBare(bare);
    this.apply({
      minX: this.originX + i0 * this.cell,
      minY: this.originY + j0 * this.cell,
      maxX: this.originX + i1 * this.cell,
      maxY: this.originY + j1 * this.cell,
    });
  }

  /** The arrays, made with the first stamp: the heights now are the base */
  private ensure(): void {
    if (this.sum) return;
    const n = this.columns * this.rows;
    this.base = this.grid.heights.slice();
    this.sum = new Int32Array(n);
    this.craterSum = new Int32Array(n);
    this.floor = new Int32Array(n).fill(NO_FLOOR);
    this.bare = new Uint8Array(n);
    // Towers that came before the first stamp: the ground is as built, nothing to write yet
    for (const at of this.towers.values()) this.raiseFloor(at, false);
  }

  private stamp(x: number, y: number, reachX: number, reachY: number, cm: (sx: number, sy: number) => number, crater = false): void {
    this.ensure();
    const sum = this.sum!;
    const craters = this.craterSum!;
    const i0 = Math.max(0, Math.ceil((x - reachX - this.originX) / this.cell));
    const i1 = Math.min(this.columns - 1, Math.floor((x + reachX - this.originX) / this.cell));
    const j0 = Math.max(0, Math.ceil((y - reachY - this.originY) / this.cell));
    const j1 = Math.min(this.rows - 1, Math.floor((y + reachY - this.originY) / this.cell));
    for (let j = j0; j <= j1; j++) {
      const sy = this.originY + j * this.cell;
      for (let i = i0; i <= i1; i++) {
        const v = cm(this.originX + i * this.cell, sy);
        if (v === 0) continue;
        const k = j * this.columns + i;
        sum[k] += v;
        if (crater) craters[k] += v;
        this.markSample(k);
      }
    }
  }

  /** Every sample within TOWER_HOLD_M of map metres (`x`, `y`) */
  private disc(x: number, y: number, each: (k: number) => void): void {
    const r = TOWER_HOLD_M;
    const i0 = Math.max(0, Math.ceil((x - r - this.originX) / this.cell));
    const i1 = Math.min(this.columns - 1, Math.floor((x + r - this.originX) / this.cell));
    const j0 = Math.max(0, Math.ceil((y - r - this.originY) / this.cell));
    const j1 = Math.min(this.rows - 1, Math.floor((y + r - this.originY) / this.cell));
    for (let j = j0; j <= j1; j++) {
      const dy = this.originY + j * this.cell - y;
      for (let i = i0; i <= i1; i++) {
        const dx = this.originX + i * this.cell - x;
        if (dx * dx + dy * dy <= r * r) each(j * this.columns + i);
      }
    }
  }

  private markSample(k: number): void {
    const i = k % this.columns;
    const j = (k - i) / this.columns;
    const tile = Math.floor(j / GROUND_TILE) * this.tilesX + Math.floor(i / GROUND_TILE);
    const c = this.changed;
    const at = tile * 4;
    if (!this.dirty.has(tile)) {
      this.dirty.add(tile);
      c[at] = c[at + 2] = i;
      c[at + 1] = c[at + 3] = j;
      return;
    }
    if (i < c[at]) c[at] = i;
    if (j < c[at + 1]) c[at + 1] = j;
    if (i > c[at + 2]) c[at + 2] = i;
    if (j > c[at + 3]) c[at + 3] = j;
  }
}
