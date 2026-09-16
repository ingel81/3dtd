import type { TilesRenderer } from '3d-tiles-renderer';

/**
 * Handle on the LOD the 3D tiles load at: the corridor build sets the region
 * and mutes the camera while it measures (CorridorBuild), `__tiles.stats()`
 * and `__corridor.probeLod()` read and set the same (docs/ROUTE_CORRIDOR.md).
 */

/**
 * Camera error target while the corridor is measured, px. The region's error
 * is `geometricError - regionTarget + errorTarget` (RouteCorridorRegion), so
 * it still refines to its target; the camera's own error in px stays far
 * below this and refines nothing. The tiles in the corridor then depend on
 * the routes alone, not on where the camera looks.
 */
export const MUTED_CAMERA_ERROR_TARGET = 1e6;

/**
 * The tiles count as loaded once nothing loaded for this long, ms: the
 * debounce the game waits after tiles-load-end as well (TileLoadingTracker).
 */
export const QUIET_MS = 500;

/** Where a wait for the next frame gives up on rAF: it stops in a hidden tab, the timeouts keep counting. */
const FRAME_FALLBACK_MS = 250;

/** Resolves on the next animation frame, at the latest after FRAME_FALLBACK_MS. */
export function nextFrameOrTimeout(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cancelAnimationFrame(frame);
      resolve();
    }, FRAME_FALLBACK_MS);
    const frame = requestAnimationFrame(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** How a wait for the tiles ended, see waitForQuietTiles. */
export interface TilesWait {
  /** Until the tiles stopped loading, ms; the whole wait on a timeout or a stop. */
  ms: number;
  timedOut: boolean;
  /** `stop` said so before the tiles were quiet. */
  stopped: boolean;
}

/** How long a wait sits still before it asks the renderer to traverse again, ms. */
const NUDGE_MS = 1000;

/** What a wait for the tiles may do besides watching `busy()`, see waitForQuietTiles. */
export interface QuietTilesOptions {
  /** End the wait early; the result then says `stopped`. */
  stop?: () => boolean;
  /**
   * The tiles the caller needs are there. Without it quiet counts on its
   * own; with it, a quiet spell in which `ready()` is false does not count.
   * Nothing loading is not the same as everything loaded: before the
   * renderer has traversed once, nothing is queued either.
   */
  ready?: () => boolean;
  /**
   * Called while nothing loads and `ready()` is false, at most every
   * NUDGE_MS: ask the renderer to traverse again. It traverses on camera
   * moves and tile loads only (UpdateOnChangePlugin), and in a background
   * tab rAF does not run, so without this a wait can sit out its whole
   * timeout without one request going out.
   */
  nudge?: () => void;
}

/**
 * Wait until the tiles have not loaded for QUIET_MS and `ready()` holds, at
 * most `timeoutMs`, checking once a frame.
 */
export async function waitForQuietTiles(
  tiles: Pick<TilesLodDebug, 'busy'>,
  timeoutMs: number,
  nextFrame: () => Promise<void>,
  now: () => number,
  { stop = () => false, ready = () => true, nudge }: QuietTilesOptions = {},
): Promise<TilesWait> {
  const start = now();
  let quietSince: number | null = null;
  let nudgedAt = start;
  for (;;) {
    await nextFrame();
    const time = now();
    if (stop()) return { ms: time - start, timedOut: false, stopped: true };
    const busy = tiles.busy();
    if (busy || !ready()) {
      quietSince = null;
      if (!busy && nudge && time - nudgedAt >= NUDGE_MS) {
        nudgedAt = time;
        nudge();
      }
    } else quietSince ??= time;
    if (quietSince !== null && time - quietSince >= QUIET_MS) return { ms: quietSince - start, timedOut: false, stopped: false };
    if (time - start >= timeoutMs) return { ms: time - start, timedOut: true, stopped: false };
  }
}

/** What `__tiles.stats()` prints and `__corridor.probeLod()` records per target. */
export interface TilesLodSnapshot {
  /** Error target of the route corridor region, metres; null before the routes are built. */
  regionErrorTarget: number | null;
  /** Error target of the camera, px (TilesRenderer.errorTarget). */
  cameraErrorTarget: number;
  /** Tiles in the current traversal: the ones rays hit. */
  active: number;
  visible: number;
  /** MB of the active tiles, as the LRU cache books them. */
  activeMB: number;
  /** Tiles the LRU cache holds (active or not) and their MB. */
  cachedTiles: number;
  cachedMB: number;
  /** The cache is at its byte or item cap: no new downloads start until it unloads. */
  cacheFull: boolean;
  /** Tiles waiting for a download slot, downloading, parsing. */
  queued: number;
  downloading: number;
  parsing: number;
}

/** See ThreeTilesEngine.tilesLodDebug(). */
export interface TilesLodDebug {
  snapshot(): TilesLodSnapshot;
  /** Tiles are loading: the renderer has not reported tiles-load-end since its last start, or a job is queued or runs. */
  busy(): boolean;
  /** Refine the route corridor region to `metres` of geometric error (0: the finest there is). False without a region. */
  setRegionErrorTarget(metres: number): boolean;
  /** The camera's screen-space error target, px. */
  setCameraErrorTarget(px: number): void;
  /** Ask the renderer to traverse again: it does so on camera moves and tile loads only. */
  requestUpdate(): void;
  /** Hold the settled tile loads back from the game, see SettleHold. */
  holdSettled(hold: boolean): void;
}

/** The renderer's fields this handle reads that its typings omit. */
interface TilesInternals {
  isLoading: boolean;
  stats: { queued: number; downloading: number; parsing: number };
  lruCache: { cachedBytes: number; itemSet: Map<unknown, unknown>; isFull(): boolean; getMemoryUsage(item: unknown): number };
}

const MB = 2 ** 20;
const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * The handle over one TilesRenderer. `region` is read on every call: the
 * corridor region is replaced whenever the routes are built again.
 */
export function createTilesLodDebug(
  tiles: TilesRenderer,
  host: { region(): { errorTarget: number } | null; holdSettled(hold: boolean): void },
): TilesLodDebug {
  const internals = tiles as unknown as TilesInternals;
  // UpdateOnChangePlugin updates on camera moves and tile loads only.
  const update = () => tiles.dispatchEvent({ type: 'needs-update' });
  return {
    snapshot: () => {
      const cache = internals.lruCache;
      let activeBytes = 0;
      for (const tile of tiles.activeTiles) activeBytes += cache.getMemoryUsage(tile);
      const { queued, downloading, parsing } = internals.stats;
      return {
        regionErrorTarget: host.region()?.errorTarget ?? null,
        cameraErrorTarget: tiles.errorTarget,
        active: tiles.activeTiles.size,
        visible: tiles.visibleTiles.size,
        activeMB: round1(activeBytes / MB),
        cachedTiles: cache.itemSet.size,
        cachedMB: round1(cache.cachedBytes / MB),
        cacheFull: cache.isFull(),
        queued,
        downloading,
        parsing,
      };
    },
    busy: () => {
      const { queued, downloading, parsing } = internals.stats;
      return internals.isLoading || queued + downloading + parsing > 0;
    },
    setRegionErrorTarget: (metres) => {
      const region = host.region();
      if (!region) return false;
      region.errorTarget = metres;
      update();
      return true;
    },
    setCameraErrorTarget: (px) => {
      tiles.errorTarget = px;
      update();
    },
    requestUpdate: () => update(),
    holdSettled: (hold) => host.holdSettled(hold),
  };
}

/**
 * Holds the settled tile loads back from the game while `__corridor.probeLod()`
 * changes the LOD: the column cache, the cell sweep and the corridor
 * re-measurement then keep what they saw before the probe instead of taking
 * the probe's tiles. Released, it hands on one settle if any came in between,
 * so the game still learns that the tile set changed.
 */
export class SettleHold {
  private state: 'off' | 'held' | 'missed' = 'off';

  /** @param settle What a settle runs; called again on release after a miss. */
  constructor(private readonly settle: () => void) {}

  get held(): boolean {
    return this.state !== 'off';
  }

  hold(on: boolean): void {
    if (on) {
      if (this.state === 'off') this.state = 'held';
      return;
    }
    const missed = this.state === 'missed';
    this.state = 'off';
    if (missed) this.settle();
  }

  /** At the start of a settle: true, and remembered, while held; the caller then skips it. */
  intercept(): boolean {
    if (this.state === 'off') return false;
    this.state = 'missed';
    return true;
  }
}
