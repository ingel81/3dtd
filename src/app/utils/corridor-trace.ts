import { isDevMode } from '@angular/core';
import { cameraTimeline } from './camera-timeline';
import { haversineDistance } from './geo-utils';
import type { RouteWaypoint } from '../models/game.types';

/**
 * Corridor trace: one console line, `[CorridorTrace]`, for everything that
 * changes or may change the route corridor, its cells, their heights, the
 * waypoints and the route lines, with the seconds since the location load,
 * the event, its numbers and the chain of callers and reasons that led to it
 * (`tilesLoaded lod=7 -> convergence.settled -> refit.remeasure`). Rebuilds
 * carry a delta against the corridor before them. `__corridor.trace()`
 * prints the timeline of the current location load as a table,
 * `__corridor.trace(false)` turns the channel off. On in dev builds, off in
 * production builds and under vitest (a spec turns it on itself).
 *
 * How to read it: docs/ROUTE_CORRIDOR.md, "Trace".
 */

/** A corridor step longer than this in one frame gets a `[CorridorTrace] LONG` line. */
export const LONG_STEP_MS = 16;

/** A cell whose height moved more than this counts as moved (rebuild delta, height sweeps). */
export const HEIGHT_MOVE_M = 0.25;

/** A half width that changed by more than this counts as changed (rebuild delta). */
const WIDTH_CHANGE_M = 0.01;

/** Distance between the points the rebuild delta compares the half widths at, as the stations. */
const WIDTH_STEP_M = 2;

/** Oldest entries drop out beyond this. */
const MAX_ENTRIES = 5000;

/**
 * Tile geometric error of the columns a run or a sweep used, in four
 * buckets: `fine` up to 2 m (finer than the route corridor region asks
 * for, the camera's tiles), `region` up to 5 m (the region target and
 * maxTileError), `coarse` above, `none` without a tile.
 */
export interface LodHistogram {
  fine: number;
  region: number;
  coarse: number;
  none: number;
}

export const emptyLod = (): LodHistogram => ({ fine: 0, region: 0, coarse: 0, none: 0 });

/** Count one column of `geometricError` (Infinity: no tile) into `lod`. */
export function countLod(lod: LodHistogram, geometricError: number): void {
  if (!Number.isFinite(geometricError)) lod.none++;
  else if (geometricError <= 2) lod.fine++;
  else if (geometricError <= 5) lod.region++;
  else lod.coarse++;
}

/** `2m:12,5m:200,coarse:0,none:24`, the buckets of LodHistogram. */
export function formatLod(lod: LodHistogram): string {
  return `2m:${lod.fine},5m:${lod.region},coarse:${lod.coarse},none:${lod.none}`;
}

/** How far the tiles of the route corridor region are refined (RouteCorridorRegion.lodState). */
export interface RegionLod {
  /** Active tiles that reach the region. */
  tiles: number;
  /** Of those, at the region target or finer, or a leaf that cannot refine. */
  fine: number;
  /** Of those, 2 m or finer: loaded for the camera, below the region target. */
  finest: number;
  /** Of those, coarser than the target and still to refine. */
  coarse: number;
  /** Tiles queued, downloading or parsing, anywhere (the renderer counts no region). */
  pending: number;
}

/** Height per cell key, NaN for a cell without a height; see cellDelta. */
export type CellHeights = ReadonlyMap<number, number>;

/** What a rebuild did to the cells, see cellDelta. */
export interface CellDelta {
  added: number;
  removed: number;
  /** Cells in both with a height in both that moved more than HEIGHT_MOVE_M. */
  moved: number;
  maxMoveM: number;
  /** Cells in both that had a height and have none now, and the other way round. */
  lostHeight: number;
  gotHeight: number;
}

/** The cells `after` has and `before` had not, the other way round, and the heights that moved. */
export function cellDelta(before: CellHeights, after: CellHeights): CellDelta {
  const delta: CellDelta = { added: 0, removed: 0, moved: 0, maxMoveM: 0, lostHeight: 0, gotHeight: 0 };
  for (const [key, y] of after) {
    const old = before.get(key);
    if (old === undefined) {
      delta.added++;
    } else if (Number.isNaN(old) || Number.isNaN(y)) {
      if (!Number.isNaN(old)) delta.lostHeight++;
      else if (!Number.isNaN(y)) delta.gotHeight++;
    } else {
      const move = Math.abs(y - old);
      if (move > HEIGHT_MOVE_M) {
        delta.moved++;
        delta.maxMoveM = Math.max(delta.maxMoveM, move);
      }
    }
  }
  for (const key of before.keys()) if (!after.has(key)) delta.removed++;
  return delta;
}

/**
 * The half widths left and right of each route every WIDTH_STEP_M along it,
 * starting half a step in, from the waypoints of the segment there: what
 * the cells and the enemies read (RouteWaypoint.corridorLeft/Right). Keyed
 * by route id; per route left and right after each other, NaN where a
 * waypoint has none.
 */
export function widthProfile(paths: ReadonlyMap<string, readonly RouteWaypoint[]>): Map<string, number[]> {
  const profile = new Map<string, number[]>();
  for (const [id, path] of paths) {
    const widths: number[] = [];
    let along = 0;
    let next = WIDTH_STEP_M / 2;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      along += haversineDistance(a.lat, a.lon, b.lat, b.lon);
      for (; next < along; next += WIDTH_STEP_M) widths.push(a.corridorLeft ?? NaN, a.corridorRight ?? NaN);
    }
    profile.set(id, widths);
  }
  return profile;
}

/** How the half widths of two profiles differ, see widthDelta. */
export interface WidthDelta {
  /** Points compared, over every route. */
  points: number;
  /** Points where a side changed, or that only one of the two has (a route got longer or shorter). */
  changed: number;
  maxChangeM: number;
}

/** Where the half widths of `after` differ from `before`, point by point along each route. */
export function widthDelta(before: ReadonlyMap<string, readonly number[]>, after: ReadonlyMap<string, readonly number[]>): WidthDelta {
  const delta: WidthDelta = { points: 0, changed: 0, maxChangeM: 0 };
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(id) ?? [];
    const b = after.get(id) ?? [];
    const n = Math.max(a.length, b.length) / 2;
    delta.points += n;
    for (let k = 0; k < n; k++) {
      let changed = 2 * k + 1 >= a.length || 2 * k + 1 >= b.length;
      for (let side = 0; side < 2 && !changed; side++) {
        const was = a[2 * k + side];
        const is = b[2 * k + side];
        if (Number.isNaN(was) !== Number.isNaN(is)) {
          changed = true;
        } else if (!Number.isNaN(was) && Math.abs(is - was) > WIDTH_CHANGE_M) {
          changed = true;
          delta.maxChangeM = Math.max(delta.maxChangeM, Math.abs(is - was));
        }
      }
      if (changed) delta.changed++;
    }
  }
  return delta;
}

/** The corridor a rebuild starts from and ends with, see CorridorTrace.rebuilt. */
export interface CorridorSnapshot {
  cells: CellHeights;
  widths: ReadonlyMap<string, readonly number[]>;
  waypoints: number;
}

/** One event of the timeline, `__corridor.trace()`. */
export interface CorridorTraceEntry {
  /** Seconds since the location load. */
  s: number;
  event: string;
  detail: string;
  trigger: string;
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

/** `key=value` for each field; numbers to two decimals, objects as JSON, undefined left out. */
function formatDetail(detail: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(detail)) {
    if (value === undefined) continue;
    const text = typeof value === 'number' ? String(Number.isInteger(value) ? value : round2(value))
      : value !== null && typeof value === 'object' ? JSON.stringify(value)
      : String(value);
    parts.push(`${key}=${text}`);
  }
  return parts.join(' ');
}

/** True under vitest, which sets VITEST in the environment; no `process` in the browser. */
function underVitest(): boolean {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.['VITEST'] !== undefined;
}

export class CorridorTrace {
  private on: boolean;
  /** performance.now() at the location load, see begin(). */
  private t0 = 0;
  private label = 'page load';
  private readonly entries: CorridorTraceEntry[] = [];
  /** The trigger chain of the code running now, see within(). */
  private stack: readonly string[] = [];
  /** What changed the corridor data since the last rebuild, see noteChange(). */
  private readonly changedBy = new Set<string>();
  private raysSinceRebuild = 0;
  /** The route corridor region has been refined all through once since the location load. */
  private regionDone = false;

  constructor(enabled: boolean) {
    this.on = enabled;
    // The intro phases, the loading gate and the height cycles, which the camera timeline records anyway.
    cameraTimeline.listen((kind, data) => {
      if (/^(intro|loading|heights)\./.test(kind)) this.log(kind, data ?? {}, 'camera timeline');
    });
  }

  get enabled(): boolean {
    return this.on;
  }

  /** `__corridor.trace(true/false)`. */
  setEnabled(on: boolean): string {
    this.on = on;
    return `Corridor trace ${on ? 'on' : 'off'}`;
  }

  /** A location load starts: the clock starts at 0 and the timeline empties. */
  begin(label: string): void {
    this.t0 = performance.now();
    this.label = label;
    this.entries.length = 0;
    this.stack = [];
    this.changedBy.clear();
    this.raysSinceRebuild = 0;
    this.regionDone = false;
    this.log('load', { label }, label);
  }

  /**
   * The trigger chain now, to hand to within() or log() from a later frame
   * or timer; without a chain the callers from the stack. Empty while off.
   */
  capture(): string {
    if (!this.on) return '';
    return this.stack.join(' -> ') || `caller ${callers()}`;
  }

  /**
   * Run `fn` with `label` added to the trigger chain; with `from` (a chain
   * capture() took before a frame or a timer), on top of that chain instead
   * of the one running now.
   */
  within<T>(label: string, fn: () => T, from?: string): T {
    if (!this.on) return fn();
    const saved = this.stack;
    this.stack = from === undefined ? [...saved, label] : from ? [from, label] : [label];
    try {
      return fn();
    } finally {
      this.stack = saved;
    }
  }

  /**
   * Add `label` to the trigger chain until exit() with what this returns:
   * for a method with a body too long to wrap in within().
   */
  enter(label: string): readonly string[] {
    const saved = this.stack;
    if (this.on) this.stack = [...saved, label];
    return saved;
  }

  exit(saved: readonly string[]): void {
    this.stack = saved;
  }

  /**
   * One line and one timeline entry: `event`, its numbers and the trigger,
   * the chain running now unless given. Without a chain the caller's
   * callers from the stack stand in.
   */
  log(event: string, detail: Record<string, unknown> = {}, trigger?: string): void {
    if (!this.on) return;
    this.write('', event, detail, trigger);
  }

  /** A `LONG` line when `ms` spent on `step` in one frame is more than LONG_STEP_MS. */
  cost(step: string, ms: number, detail: Record<string, unknown> = {}, trigger?: string): void {
    if (!this.on || ms <= LONG_STEP_MS) return;
    this.write('LONG ', step, { ms, ...detail }, trigger);
  }

  /** What changed the corridor data (`measured`, `walkCaps`, `detourPlans`, ...) and new rays, for the next rebuild line. */
  noteChange(reasons: readonly string[], rays = 0): void {
    if (!this.on) return;
    for (const reason of reasons) this.changedBy.add(reason);
    this.raysSinceRebuild += rays;
  }

  /**
   * A settled tile batch (VisualizationFacadeService.onTilesLoaded): its
   * lodVersion and the refinement of the route corridor region, once
   * `region.complete` when no region tile is left to refine.
   */
  tiles(lodVersion: number, region: () => RegionLod | null): void {
    if (!this.on) return;
    const state = region();
    this.log('tiles', state ? { lod: lodVersion, ...state } : { lod: lodVersion, region: 'none' });
    if (state && state.tiles > 0 && state.coarse === 0 && !this.regionDone) {
      this.regionDone = true;
      this.log('region.complete', { tiles: state.tiles, finest: state.finest });
    }
  }

  /**
   * The line of a rebuild: what changed the data since the last one, the
   * rays that came in, what it did to the cells and the half widths, and
   * how long it took (`ms`, one frame).
   */
  rebuilt(before: CorridorSnapshot, after: CorridorSnapshot, detail: Record<string, unknown>, ms: number): void {
    if (!this.on) return;
    const t = performance.now();
    const cells = cellDelta(before.cells, after.cells);
    const widths = widthDelta(before.widths, after.widths);
    const deltaMs = performance.now() - t;
    this.log('rebuild', {
      by: [...this.changedBy].join('+') || 'none',
      rays: this.raysSinceRebuild,
      cells: `${before.cells.size}->${after.cells.size}`,
      added: cells.added,
      removed: cells.removed,
      moved: cells.moved,
      maxMoveM: cells.maxMoveM,
      lostHeight: cells.lostHeight,
      gotHeight: cells.gotHeight,
      widthPoints: `${widths.changed}/${widths.points}`,
      maxWidthChangeM: widths.maxChangeM,
      waypoints: `${before.waypoints}->${after.waypoints}`,
      ...detail,
      ms,
      deltaMs,
    });
    this.cost('rebuild', ms);
    this.changedBy.clear();
    this.raysSinceRebuild = 0;
  }

  /** `__corridor.trace()`: the timeline of this location load as a table. */
  print(): string {
    console.table(this.entries);
    return `${this.entries.length} corridor events since ${this.label}${this.on ? '' : ' (trace is off: __corridor.trace(true))'}`;
  }

  /** The timeline of this location load. */
  list(): readonly CorridorTraceEntry[] {
    return this.entries;
  }

  private write(flag: string, event: string, detail: Record<string, unknown>, trigger?: string): void {
    const s = (performance.now() - this.t0) / 1000;
    const from = trigger || this.stack.join(' -> ') || `caller ${callers()}`;
    const text = formatDetail(detail);
    if (this.entries.length >= MAX_ENTRIES) this.entries.shift();
    this.entries.push({ s: round2(s), event: flag + event, detail: text, trigger: from });
    console.log(`[CorridorTrace] ${flag}${s.toFixed(2)}s ${event}${text ? ` ${text}` : ''} | ${from}`);
  }
}

/**
 * The two frames above the traced method, for a line without a trigger
 * chain: who called the code that logged it. Function names only; in a
 * production build they are minified.
 */
function callers(): string {
  const frames = (new Error().stack ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('at ') && !line.includes('CorridorTrace.') && !line.includes('callers'))
    .map((line) => line.replace(/^at /, '').replace(/ \(.*\)$/, '').replace(/https?:\/\/[^/]+\//, ''));
  // frames[0] is the traced method itself, which the event names.
  return frames.slice(1, 3).join(' <- ') || 'unknown';
}

export const corridorTrace = new CorridorTrace(isDevMode() && !underVitest());
