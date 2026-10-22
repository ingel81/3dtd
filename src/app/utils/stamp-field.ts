import { craterCm, rubbleCm, rubbleLump } from '../map-ops/impact-stamp';
import { RUBBLE } from '../configs/destruction.config';
import type { RunStructure } from '../sim/protocol/run-rules';
import { MAP_METERS_PER_DEGREE } from '../world/custom-map/map-document';
import { DetMath } from './det-math';

/** Edge of a field cell, m: the route grid's (GlobalRouteGrid.CELL_SIZE), so a cell of the one is a cell of the other */
export const STAMP_CELL_M = 2;

/** The route cells' grid indices, first and last on each axis (GlobalRouteGrid.cellSpan) */
export interface CellSpan {
  minIx: number;
  minIz: number;
  maxIx: number;
  maxIz: number;
}

/** Map degrees to the local frame (EllipsoidSync.geoToLocalSimpleInto), written into `out` */
export type ToLocal = (lat: number, lon: number, out: { x: number; z: number }) => void;

/** A crater in the local frame: its middle, radius (m), depth (cm) */
export interface CraterStamp {
  x: number;
  z: number;
  radius: number;
  depthCm: number;
}

/**
 * A heap of rubble in the local frame: its middle, the turn of its ground
 * plan (cos, sin, of the map's rotation), the half extents its full height
 * covers, how far it runs out past them (m) and its top (cm)
 */
export interface RubbleStamp {
  x: number;
  z: number;
  cos: number;
  sin: number;
  coreX: number;
  coreZ: number;
  falloff: number;
  peakCm: number;
  /** Its middle in map metres: the lumps go by the map's patches (rubbleLump) */
  mapX: number;
  mapY: number;
}

/** Bit of a packed cell: rubble high enough to slow the enemies (RUBBLE.brakeFromCm) */
const BRAKE_BIT = 1;

/**
 * What the craters and the rubble of a run did to the ground under the
 * routes (docs/DESTRUCTION_PLAN.md, decided 2026-10-18): per route cell
 * (STAMP_CELL_M) the centimetres every stamp adds up to and whether rubble
 * lies there that slows the enemies. The simulation's enemies stand that
 * much higher or lower and walk slower on rubble; the main thread's lines of
 * sight probe the same (GlobalRouteGrid.setStandOffset). Both build their
 * field from the same stamps with the same code, so they agree to the
 * centimetre.
 *
 * Whole centimetres, summed: a stamp added and taken away again leaves the
 * cells as they were, and the order the stamps come in does not matter, so
 * a restore that stamps everything anew comes to the same cells as the run
 * did one stamp at a time. A cell's shape value comes from map-ops/impact-
 * stamp.ts at its middle, out of `+ - * /` only, the same bits on every engine.
 *
 * Covers the box of the route cells only, where enemies walk: a few hundred
 * KB on the largest maps, made when the first stamp lands. Reading it is one
 * index and one load (heightAt, brakeAt).
 */
export class StampField {
  private readonly columns: number;
  private readonly rows: number;
  private readonly minIx: number;
  private readonly minIz: number;
  /** Every stamp's centimetres summed, per cell */
  private readonly ground: Int32Array;
  /** The rubble's centimetres alone, per cell: whether it slows */
  private readonly rubble: Int32Array;
  /** What the readers load: the ground's centimetres shifted up one bit, BRAKE_BIT for rubble that slows */
  private readonly packed: Int32Array;

  constructor(span: CellSpan) {
    this.minIx = span.minIx;
    this.minIz = span.minIz;
    this.columns = Math.max(1, span.maxIx - span.minIx + 1);
    this.rows = Math.max(1, span.maxIz - span.minIz + 1);
    const n = this.columns * this.rows;
    this.ground = new Int32Array(n);
    this.rubble = new Int32Array(n);
    this.packed = new Int32Array(n);
  }

  /** Bytes the field holds */
  get bytes(): number {
    return this.ground.byteLength * 3;
  }

  /** Metres the stamps raise (or lower) the ground at local (x, z); 0 off the field */
  heightAt(x: number, z: number): number {
    return (this.cell(x, z) >> 1) / 100;
  }

  /**
   * heightAt between the cells' middles (bilinear, 0 off the field): what the
   * drawn ground shows, which takes the same shapes on its own finer grid.
   * heightAt holds a cell's middle over its whole 2 m, a step of up to a
   * metre and more on a crater's wall. For drawing only; the simulation
   * reads heightAt
   */
  heightBetween(x: number, z: number): number {
    const fx = x / STAMP_CELL_M - 0.5 - this.minIx;
    const fz = z / STAMP_CELL_M - 0.5 - this.minIz;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const a = this.cellAt(i, j) * (1 - u) + this.cellAt(i + 1, j) * u;
    const b = this.cellAt(i, j + 1) * (1 - u) + this.cellAt(i + 1, j + 1) * u;
    return (a * (1 - v) + b * v) / 100;
  }

  /** The ground's centimetres of the field's cell (i, j), 0 off the field */
  private cellAt(i: number, j: number): number {
    if (i < 0 || j < 0 || i >= this.columns || j >= this.rows) return 0;
    return this.packed[j * this.columns + i] >> 1;
  }

  /** The share of its pace an enemy walks at local (x, z): RUBBLE.brake on rubble that slows, else 1 */
  brakeAt(x: number, z: number): number {
    return (this.cell(x, z) & BRAKE_BIT) !== 0 ? RUBBLE.brake : 1;
  }

  private cell(x: number, z: number): number {
    const ix = Math.floor(x / STAMP_CELL_M) - this.minIx;
    const iz = Math.floor(z / STAMP_CELL_M) - this.minIz;
    if (ix < 0 || iz < 0 || ix >= this.columns || iz >= this.rows) return 0;
    return this.packed[iz * this.columns + ix];
  }

  /** Add (`sign` 1) or take away (-1) a crater; whether it reached a cell of the field */
  crater(c: CraterStamp, sign: 1 | -1): boolean {
    const reach = c.radius * 1.35;
    return this.stamp(c.x, c.z, reach, reach, false, (dx, dz) => craterCm(dx * dx + dz * dz, c.radius, c.depthCm) * sign);
  }

  /** Add (`sign` 1) or take away (-1) a heap of rubble; whether it reached a cell of the field */
  rubbleHeap(r: RubbleStamp, sign: 1 | -1): boolean {
    const reachX = Math.abs(r.cos) * r.coreX + Math.abs(r.sin) * r.coreZ + r.falloff;
    const reachZ = Math.abs(r.sin) * r.coreX + Math.abs(r.cos) * r.coreZ + r.falloff;
    return this.stamp(r.x, r.z, reachX, reachZ, true, (dx, dz) => {
      // Into the ground plan's own axes (CustomMapSurface's covers, with local x the map's -x)
      const mx = Math.max(0, Math.abs(dx * r.cos - dz * r.sin) - r.coreX);
      const mz = Math.max(0, Math.abs(dx * r.sin + dz * r.cos) - r.coreZ);
      // The lumps by the map point: local x is the map's -x
      return rubbleCm(mx * mx + mz * mz, r.falloff, r.peakCm * rubbleLump(r.mapX - dx, r.mapY + dz)) * sign;
    });
  }

  /** Every cell flat again */
  clear(): void {
    this.ground.fill(0);
    this.rubble.fill(0);
    this.packed.fill(0);
    this.mark(0, this.columns - 1, 0, this.rows - 1);
  }

  /**
   * The grid indices of the cells the stamps changed since the last take,
   * null for none: what the main thread draws on the cells follows them
   * (GlobalRouteGrid.stampsChanged)
   */
  takeChanged(): CellSpan | null {
    if (this.changed === null) return null;
    const c = this.changed;
    this.changed = null;
    return { minIx: c.minIx + this.minIx, minIz: c.minIz + this.minIz, maxIx: c.maxIx + this.minIx, maxIz: c.maxIz + this.minIz };
  }

  /** Changed since the last take, in the field's own indices; null for nothing */
  private changed: CellSpan | null = null;

  private mark(i0: number, i1: number, j0: number, j1: number): void {
    const c = this.changed;
    if (c === null) this.changed = { minIx: i0, maxIx: i1, minIz: j0, maxIz: j1 };
    else {
      c.minIx = Math.min(c.minIx, i0);
      c.maxIx = Math.max(c.maxIx, i1);
      c.minIz = Math.min(c.minIz, j0);
      c.maxIz = Math.max(c.maxIz, j1);
    }
  }

  private stamp(x: number, z: number, reachX: number, reachZ: number, rubble: boolean, cm: (dx: number, dz: number) => number): boolean {
    const i0 = Math.max(0, Math.floor((x - reachX) / STAMP_CELL_M) - this.minIx);
    const i1 = Math.min(this.columns - 1, Math.floor((x + reachX) / STAMP_CELL_M) - this.minIx);
    const j0 = Math.max(0, Math.floor((z - reachZ) / STAMP_CELL_M) - this.minIz);
    const j1 = Math.min(this.rows - 1, Math.floor((z + reachZ) / STAMP_CELL_M) - this.minIz);
    let touched = false;
    for (let j = j0; j <= j1; j++) {
      const dz = (j + this.minIz + 0.5) * STAMP_CELL_M - z;
      for (let i = i0; i <= i1; i++) {
        const v = cm((i + this.minIx + 0.5) * STAMP_CELL_M - x, dz);
        if (v === 0) continue;
        const k = j * this.columns + i;
        this.ground[k] += v;
        if (rubble) this.rubble[k] += v;
        this.packed[k] = (this.ground[k] << 1) | (this.rubble[k] >= RUBBLE.brakeFromCm ? BRAKE_BIT : 0);
        touched = true;
      }
    }
    if (touched) this.mark(i0, i1, j0, j1);
    return touched;
  }
}

/** The stamp of crater entry `xDm, yDm, rDm, depthCm` (CraterLedger) in the local frame */
export function craterStampOf(xDm: number, yDm: number, rDm: number, depthCm: number, toLocal: ToLocal): CraterStamp {
  const at = { x: 0, z: 0 };
  toLocal(yDm / 10 / MAP_METERS_PER_DEGREE, xDm / 10 / MAP_METERS_PER_DEGREE, at);
  return { x: at.x, z: at.z, radius: rDm / 10, depthCm };
}

/**
 * The heap a fallen structure leaves: over its ground plan where it has one
 * (RUBBLE.core of it at full height, running out RUBBLE.spillM plus some of
 * its width past it), else over a circle of its radius times RUBBLE.spill;
 * its top RUBBLE.heightShare of its height, held in cm
 */
export function rubbleStampOf(s: RunStructure, toLocal: ToLocal): RubbleStamp {
  const at = { x: 0, z: 0 };
  const peakCm = Math.min(RUBBLE.maxPeakCm, Math.max(RUBBLE.minPeakCm, Math.round(s.height * 100 * RUBBLE.heightShare)));
  if (!s.box) {
    toLocal(s.lat, s.lon, at);
    const mapX = s.lon * MAP_METERS_PER_DEGREE;
    const mapY = s.lat * MAP_METERS_PER_DEGREE;
    return { x: at.x, z: at.z, cos: 1, sin: 0, coreX: 0, coreZ: 0, falloff: s.radius * RUBBLE.spill, peakCm, mapX, mapY };
  }
  const [bx, by, hx, hy, turn] = s.box;
  toLocal(by / MAP_METERS_PER_DEGREE, bx / MAP_METERS_PER_DEGREE, at);
  return {
    x: at.x,
    z: at.z,
    cos: DetMath.cos(turn),
    sin: DetMath.sin(turn),
    coreX: hx * RUBBLE.core,
    coreZ: hy * RUBBLE.core,
    falloff: (1 - RUBBLE.core) * Math.min(hx, hy) + RUBBLE.spillM,
    peakCm,
    mapX: bx,
    mapY: by,
  };
}

/** A heap of rubble in map metres (the ground's own frame, x east as the map has it): RubbleStamp's numbers, `z` the map's y */
export type RubbleShape = RubbleStamp;

/** The heap of rubbleStampOf in map metres, for the ground the main thread draws (custom-map-ground-damage.ts) */
export function rubbleShapeOf(s: RunStructure): RubbleShape {
  return rubbleStampOf(s, (lat, lon, out) => {
    out.x = lon * MAP_METERS_PER_DEGREE;
    out.z = lat * MAP_METERS_PER_DEGREE;
  });
}

/**
 * Centimetres heap `shape` (rubbleShapeOf) raises map point (`x`, `y`):
 * the same as StampField's local rubbleHeap, the map's x being local -x
 */
export function rubbleCmAt(shape: RubbleShape, x: number, y: number): number {
  const dx = x - shape.x;
  const dy = y - shape.z;
  const mx = Math.max(0, Math.abs(-dx * shape.cos - dy * shape.sin) - shape.coreX);
  const mz = Math.max(0, Math.abs(-dx * shape.sin + dy * shape.cos) - shape.coreZ);
  return rubbleCm(mx * mx + mz * mz, shape.falloff, shape.peakCm * rubbleLump(x, y));
}

/** How far heap `shape` reaches from its middle along each axis, m (the box of samples it touches) */
export function rubbleReach(shape: RubbleShape): { x: number; z: number } {
  return {
    x: Math.abs(shape.cos) * shape.coreX + Math.abs(shape.sin) * shape.coreZ + shape.falloff,
    z: Math.abs(shape.sin) * shape.coreX + Math.abs(shape.cos) * shape.coreZ + shape.falloff,
  };
}
