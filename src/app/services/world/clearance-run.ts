import {
  StationProbe,
  probeFreeSpace,
} from '../../utils/route-corridor';
import { SegmentApproach, nearestApproach, pointOnApproach, startsNearer } from '../../utils/carried-height';
import type { ApproachPoint } from '../../utils/route-cell';
import type { CorridorMeasurement } from './corridor-build';
import { corridorTrace, countLod, emptyLod, formatLod } from '../../utils/corridor-trace';

/**
 * The approach that station `t` (0 to 1 along a segment) lies on, from the
 * approaches of each route over the segment, as a point on it: the one with
 * the nearer start (startsNearer) where every route has the station on an
 * approach, else null. A cell two segments reach along their length takes
 * the lower surface, the ground over the stretch off a bridge end, and of
 * two approaches the nearer start (claimSegmentCells); the station measures
 * from where its cells stand, so the order of the routes does not decide
 * it. A segment of the leg to the HQ lies on an approach on every route.
 */
function stationApproach(byRoute: readonly (readonly SegmentApproach[])[], t: number): ApproachPoint | null {
  let nearest: ApproachPoint | null = null;
  for (const approaches of byRoute) {
    const approach = nearestApproach(approaches, t);
    if (approach === null) return null;
    const point = pointOnApproach(approach, t);
    if (nearest === null || startsNearer(point, nearest)) nearest = point;
  }
  return nearest;
}

/** A segment a clearance run measures: where its stations stand and what they found. */
export interface ClearanceSegment {
  key: string;
  /** Local start of the segment and the step to its end. */
  x: number;
  z: number;
  dx: number;
  dz: number;
  /** Stations on the segment; station k stands at (k + 0.5) / count of it. */
  count: number;
  onBridge: boolean;
  /**
   * Per route over the segment, the approaches it lies on (routeApproaches:
   * off a bridge end, on the leg to the HQ), with the route from their
   * starts as the route cells there take them. A station on an approach on
   * every route (stationApproach) measures from where those cells stand
   * (TerrainQueries.measureStreetClearance, `onApproach`).
   */
  approaches: SegmentApproach[][];
  /** Free space per station and side, NaN until measured, and what each station's rays found. */
  left: number[];
  right: number[];
  probes: (StationProbe | null)[];
}

/**
 * One clearance measurement, see PathAndRouteService.beginClearanceMeasurement.
 * Works through the stations without a measurement one after the other, so
 * a run cut into slices measures the same stations in the same order as one
 * that takes them all at once. The height carried along an approach it walks
 * once per slice and path (`walked`): the stations of a long leg to the HQ
 * would each walk it again from its start, and within a slice no tile
 * changes; a run cut into slices casts those columns again in each slice.
 * Keeps what it found to itself until commit().
 */
export class ClearanceRun implements CorridorMeasurement {
  /** The next station to look at. */
  private segment = 0;
  private station = 0;
  /** Stations the run set out to measure, for the log of a cancelled run. */
  private readonly planned: number;
  private probed = 0;
  private unmeasured = 0;
  /** Of those, stations whose tile is still coarser than maxTileError. */
  private coarse = 0;
  private slices = 0;
  /** Main-thread time in step() and commit(). */
  private busyMs = 0;
  private readonly startedAt = performance.now();
  /** How the run ended; null while it is open. */
  private end: 'commit' | 'cancel' | null = null;
  /** Local "x,z" of the stations that found no tile, not even beside themselves, for the log. */
  private readonly noTile: string[] = [];
  /** Positions of stations without a tile the log names; the rest it counts. */
  private static readonly MAX_LOGGED_STATIONS = 10;
  /** Tile geometric error of the stations probed, and the slices against their budget, for the corridor trace. */
  private readonly lod = emptyLod();
  private maxSliceMs = 0;
  private sliceMsTotal = 0;
  private overBudget = 0;
  private readonly budgets = new Set<number>();
  /** The height carried after each step along an approach path in this slice (carriedY), by its path. */
  private readonly walked = new Map<readonly { x: number; z: number }[], number[]>();

  constructor(
    private readonly segments: ClearanceSegment[],
    /** Rays a measured station casts, for the log. */
    private readonly raysPerStation: number,
    private readonly probeAt: (
      x: number, z: number, acrossX: number, acrossZ: number, onDeck: boolean, onApproach: ApproachPoint | null,
      walked: number[],
    ) => StationProbe | null,
    /** Stores what the run measured; true when that changes a corridor. */
    private readonly store: (segments: readonly ClearanceSegment[]) => boolean,
  ) {
    let planned = 0;
    for (const segment of segments) {
      for (let k = 0; k < segment.count; k++) if (Number.isNaN(segment.left[k])) planned++;
    }
    this.planned = planned;
    corridorTrace.log('clearance.start', { segments: segments.length, stations: planned });
  }

  get open(): boolean {
    return this.end === null;
  }

  /** Stations tried so far and the stations the run set out to measure. */
  get progress(): { done: number; total: number } {
    return { done: this.probed, total: this.planned };
  }

  step(budgetMs: number): boolean {
    if (this.end) return true;
    const start = performance.now();
    this.slices++;
    this.walked.clear();
    let here = 0;
    for (let segment = this.next(); segment; segment = this.next()) {
      // Stop before a station that would run past the budget, going by what
      // the stations so far cost (a column and a ray per height and side).
      const elapsed = performance.now() - start;
      if (here > 0 && elapsed + (this.busyMs + elapsed) / this.probed > budgetMs) break;
      this.probe(segment);
      here++;
    }
    const sliceMs = performance.now() - start;
    this.busyMs += sliceMs;
    this.maxSliceMs = Math.max(this.maxSliceMs, sliceMs);
    this.sliceMsTotal += sliceMs;
    this.budgets.add(budgetMs);
    if (sliceMs > budgetMs) this.overBudget++;
    // Against its own budget, not LONG_STEP_MS: these slices aim at budgetMs.
    corridorTrace.cost('clearance.slice', sliceMs, { stations: here, budgetMs }, budgetMs);
    return this.next() === null;
  }

  commit(): boolean {
    if (this.end) return false;
    this.end = 'commit';
    const start = performance.now();
    const changed = this.store(this.segments);
    const storeMs = performance.now() - start;
    this.busyMs += storeMs;
    const rays = this.raysPerStation * (this.probed - this.unmeasured);
    if (this.segments.length > 0) {
      console.log(
        `[Corridor] clearance: segments=${this.segments.length} stations=${this.probed} unmeasured=${this.unmeasured} ` +
        `(coarse tile ${this.coarse}) rays=${rays} changed=${changed} ` +
        `in ${this.busyMs.toFixed(1)}ms slices=${this.slices} wall=${(performance.now() - this.startedAt).toFixed(1)}ms` +
        (this.noTile.length > 0 ? ` noTile=${this.noTileList()}` : ''),
      );
    }
    // A run without segments too, for the trace: the build asked and there was nothing left to measure.
    if (corridorTrace.enabled) {
      corridorTrace.noteChange([], rays);
      corridorTrace.log('clearance.commit', {
        segments: this.segments.length, stations: this.probed, unmeasured: this.unmeasured, coarse: this.coarse, rays, changed,
        lod: formatLod(this.lod), ...this.sliceStats(), busyMs: this.busyMs,
        wallMs: performance.now() - this.startedAt,
      });
      corridorTrace.cost('clearance.commit', storeMs);
    }
    return changed;
  }

  cancel(reason: string): void {
    if (this.end) return;
    this.end = 'cancel';
    if (corridorTrace.enabled) {
      corridorTrace.log('clearance.cancel', { reason, segments: this.segments.length, stations: this.probed, of: this.planned, ...this.sliceStats() });
    }
    if (this.segments.length === 0) return;
    console.log(
      `[Corridor] clearance cancelled (${reason}): stations=${this.probed} of ${this.planned} in ${this.busyMs.toFixed(1)}ms ` +
      `slices=${this.slices} wall=${(performance.now() - this.startedAt).toFixed(1)}ms, corridor unchanged`,
    );
  }

  /**
   * The slices against their budget, for the corridor trace. A slice takes
   * at least one station whatever the budget, so a slow station runs past
   * it (`overBudget`); `budgetMs` lists the budgets the slices had.
   */
  private sliceStats(): Record<string, unknown> {
    return {
      slices: this.slices,
      budgetMs: [...this.budgets].join('/'),
      overBudget: this.overBudget,
      maxSliceMs: this.maxSliceMs,
      meanSliceMs: this.slices > 0 ? this.sliceMsTotal / this.slices : 0,
      msPerStation: this.probed > 0 ? this.sliceMsTotal / this.probed : 0,
    };
  }

  /** The segment of the next station without a measurement, `station` its index there; null when none is left. */
  private next(): ClearanceSegment | null {
    while (this.segment < this.segments.length) {
      const segment = this.segments[this.segment];
      while (this.station < segment.count) {
        if (Number.isNaN(segment.left[this.station])) return segment;
        this.station++;
      }
      this.segment++;
      this.station = 0;
    }
    return null;
  }

  /** The first MAX_LOGGED_STATIONS positions of noTile, then how many more there are. */
  private noTileList(): string {
    const max = ClearanceRun.MAX_LOGGED_STATIONS;
    const more = this.noTile.length - max;
    return this.noTile.slice(0, max).join(';') + (more > 0 ? `;+${more}` : '');
  }

  /** Measure the station next() found and move past it. */
  private probe(segment: ClearanceSegment): void {
    const k = this.station++;
    const t = (k + 0.5) / segment.count;
    const x = segment.x + segment.dx * t;
    const z = segment.z + segment.dz * t;
    // On an approach: from the start nearest the station, as for a route cell there
    const approach = segment.onBridge ? null : stationApproach(segment.approaches, t);
    let walked: number[] = [];
    if (approach !== null) {
      walked = this.walked.get(approach.path) ?? walked;
      this.walked.set(approach.path, walked);
    }
    // (-dz, dx) points right of the direction of travel.
    const probe = this.probeAt(x, z, -segment.dz, segment.dx, segment.onBridge, approach, walked);
    segment.probes[k] = probe;
    this.probed++;
    countLod(this.lod, probe?.tileError ?? Infinity);
    if (probe?.unmeasured === 'coarse tile') this.coarse++;
    if (probe?.unmeasured === 'no tile') this.noTile.push(`${x.toFixed(1)},${z.toFixed(1)}`);
    const free = probeFreeSpace(probe, 'left');
    if (Number.isNaN(free)) {
      this.unmeasured++;
      return;
    }
    segment.left[k] = free;
    segment.right[k] = probeFreeSpace(probe, 'right');
  }
}
