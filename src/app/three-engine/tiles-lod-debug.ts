import type { TilesRenderer } from '3d-tiles-renderer';

/**
 * Debug handle on the LOD the 3D tiles load at, for `__tiles.stats()` and
 * `__corridor.probeLod()` (docs/ROUTE_CORRIDOR.md, Phase 0). Nothing here
 * runs unless one of them is called.
 */

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
