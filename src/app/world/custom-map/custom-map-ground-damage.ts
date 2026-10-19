import type { WorldGroundDamage } from '../world-provider';
import type { RunStructure } from '../../sim/protocol/run-rules';
import type { MapHeightGrid } from './map-document';
import { craterCm } from '../../map-ops/impact-stamp';
import { rubbleCmAt, rubbleReach, rubbleShapeOf } from '../../utils/stamp-field';
import { craterMaxDepthCm } from '../../managers/game-state/crater-ledger';
import { RUBBLE } from '../../configs/destruction.config';
import { RUBBLE_MATERIALS, type RubbleMaterial } from './rubble-material';

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
/** Around a standing tower the ground keeps the height it had when the tower came, m */
export const TOWER_HOLD_M = 3;

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
 * the ground keeps the height it had when the tower came (`TOWER_HOLD_M`):
 * a crater beside a tower leaves it on its footing, a tower built in a
 * crater does not see the floor rise under it.
 *
 * Changed samples are written per tile of GROUND_TILE samples, a few tiles a
 * frame (`flush`, GROUND_TILES_PER_FRAME), each frame's tiles as one
 * rectangle to the view (`apply`, CustomMapView.updateHeights): a rocket's
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
  /** Towers holding a sample, and the centimetres it shows while held */
  private held: Uint8Array | null = null;
  private frozen: Int32Array | null = null;
  /** 1 where the ground shows torn up (BARE_FROM_CM): no grass there */
  private bare: Uint8Array | null = null;
  /** Tiles whose samples changed, in the order they came */
  private readonly dirty = new Set<number>();
  /** The towers holding the ground: map metres */
  private readonly towers = new Map<string, { x: number; y: number }>();
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
  ) {
    this.columns = grid.columns;
    this.rows = grid.rows;
    this.cell = grid.cellSize;
    this.originX = -width / 2;
    this.originY = -depth / 2;
    this.tilesX = Math.ceil(this.columns / GROUND_TILE);
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
    });
    const key = `c${xDm},${yDm}`;
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

  /** Every stamp off and every tower's hold let go: the ground as built, written over the next frames */
  clear(): void {
    const sum = this.sum;
    if (!sum) return;
    for (let k = 0; k < sum.length; k++) {
      if (sum[k] === 0 && this.held![k] === 0) continue;
      this.markSample(k);
    }
    sum.fill(0);
    this.held!.fill(0);
    this.frozen!.fill(0);
    this.towers.clear();
    this.marks.clear();
    this.marksChanged = true;
  }

  /** Tower `id` stands at map metres (`x`, `y`): the ground round it keeps its height from now on */
  holdTower(id: string, x: number, y: number): void {
    if (this.towers.has(id)) return;
    this.towers.set(id, { x, y });
    // Before the first stamp nothing to hold yet: ensure() holds every tower then
    if (!this.sum) return;
    const held = this.held!;
    const frozen = this.frozen!;
    const sum = this.sum!;
    this.disc(x, y, (k) => {
      if (held[k]++ === 0) frozen[k] = sum[k];
    });
  }

  /** Tower `id` is gone: the ground round it follows the stamps again */
  releaseTower(id: string): void {
    const at = this.towers.get(id);
    if (!at) return;
    this.towers.delete(id);
    const held = this.held;
    if (!held) return;
    this.disc(at.x, at.y, (k) => {
      if (held[k] > 0 && --held[k] === 0 && this.frozen![k] !== this.sum![k]) this.markSample(k);
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
    const held = this.held!;
    const frozen = this.frozen!;
    const bare = this.bare!;
    const heights = this.grid.heights;
    let i0 = Infinity, j0 = Infinity, i1 = -Infinity, j1 = -Infinity;
    let done = 0;
    for (const tile of this.dirty) {
      if (done++ >= maxTiles) break;
      this.dirty.delete(tile);
      const ti = tile % this.tilesX;
      const tj = (tile - ti) / this.tilesX;
      const a0 = ti * GROUND_TILE;
      const b0 = tj * GROUND_TILE;
      const a1 = Math.min(this.columns - 1, a0 + GROUND_TILE - 1);
      const b1 = Math.min(this.rows - 1, b0 + GROUND_TILE - 1);
      for (let j = b0; j <= b1; j++) {
        for (let i = a0; i <= a1; i++) {
          const k = j * this.columns + i;
          const cm = held[k] > 0 ? frozen[k] : sum[k];
          heights[k] = base[k] + cm / 100;
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
    this.held = new Uint8Array(n);
    this.frozen = new Int32Array(n);
    this.bare = new Uint8Array(n);
    // Towers that came before the first stamp hold the ground as built
    for (const [, at] of this.towers) this.disc(at.x, at.y, (k) => this.held![k]++);
  }

  private stamp(x: number, y: number, reachX: number, reachY: number, cm: (sx: number, sy: number) => number): void {
    this.ensure();
    const sum = this.sum!;
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
        if (this.held![k] === 0) this.markSample(k);
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
    this.dirty.add(Math.floor(j / GROUND_TILE) * this.tilesX + Math.floor(i / GROUND_TILE));
  }
}
