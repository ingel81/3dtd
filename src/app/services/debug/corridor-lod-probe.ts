import type { GameStateManager } from '../../managers/game-state.manager';
import type { EngineInitializationService } from '../infrastructure/engine-initialization.service';
import type { IntroCameraFlightService } from '../world/intro-camera-flight.service';
import type { PathAndRouteService } from '../world/path-route.service';
import type { TilesLodDebug, TilesLodSnapshot } from '../../three-engine/tiles-lod-debug';
import type { StationProbe } from '../../utils/route-corridor';
import { raycastStats } from '../../utils/raycast-stats';
import { type CorridorFingerprint, corridorFingerprint } from './corridor-fingerprint';

/** Region error targets a probe loads in turn, metres; 0 is the finest LOD there is. */
export const DEFAULT_PROBE_TARGETS: readonly number[] = [5, 2.5, 0];

/** How long a probe waits for the tiles of one target, seconds. */
export const DEFAULT_PROBE_TIMEOUT_S = 60;

/**
 * Camera error target while the probe runs, px. The region's error is
 * `geometricError - regionTarget + errorTarget` (RouteCorridorRegion), so it
 * still refines to its target; the camera's own error in px stays far below
 * this and refines nothing. The tiles in the corridor then depend on the
 * routes alone (docs/ROUTE_CORRIDOR.md, Phase 0).
 */
export const MUTED_CAMERA_ERROR_TARGET = 1e6;

/**
 * The tiles count as loaded once nothing loaded for this long, ms: the
 * debounce the game waits after tiles-load-end as well (TileLoadingTracker).
 */
export const QUIET_MS = 500;

/** Caller the probe's rays are booked on in `__raycastStats()`. */
export const PROBE_CALLER = 'corridorLodProbe';

/** Where the probe waits for the next frame: rAF stops in a hidden tab, the timeout keeps counting. */
const FRAME_FALLBACK_MS = 250;

/** One row of `__corridor.probeLod()`, one per region target. */
export interface LodProbeRow {
  /** Region error target, metres (0: finest). */
  target: number;
  /** Seconds from setting the target until the tiles stopped loading; the whole wait when they did not. */
  loadS: number;
  timedOut: boolean;
  /** Tiles in the traversal and their MB, then the LRU cache: tiles, MB, at its cap. */
  active: number;
  activeMB: number;
  cachedTiles: number;
  cachedMB: number;
  cacheFull: boolean;
  /** Stations measured, and how fine the tile under each is, by geometric error in metres. */
  stations: number;
  upTo2: number;
  upTo2_5: number;
  upTo5: number;
  over5: number;
  /** No tile under the station, or no probe (DevWorld). */
  none: number;
  /** One pass over all stations: main-thread ms, per station. */
  measureMs: number;
  msPerStation: number;
  /** Rays of that pass (columns and side rays), their ms, intersections per ray. */
  rays: number;
  rayMs: number;
  hitsPerRay: number;
}

/** What `__corridor.probeLod()` resolves with after a run. */
export interface LodProbeResult {
  rows: LodProbeRow[];
  /** Region (m) and camera (px) error target before the run, set back after it. */
  restored: { regionErrorTarget: number; cameraErrorTarget: number };
  /** Why the run stopped before the last target, null when it did not. */
  stoppedEarly: string | null;
  /** The tiles still loaded when the timeout ran out after the restore; the game got its tile loads back anyway. */
  restoreTimedOut: boolean;
  /** The corridor's fingerprint is the same after the run as before it. */
  corridorUnchanged: boolean;
}

/** What CorridorLodProbe needs; VisualizationFacadeService passes its services. */
export interface CorridorLodProbeDeps {
  /** The game state, set by the facade's initialize(); read on each call. */
  gameState: () => Pick<GameStateManager, 'towerCount' | 'enemyManager' | 'waveManager' | 'getGlobalRouteGrid'>;
  engineInit: Pick<EngineInitializationService, 'getEngine'>;
  introFlight: Pick<IntroCameraFlightService, 'isRunning'>;
  pathRoute: Pick<PathAndRouteService, 'measureAllStations' | 'clearanceProgress' | 'corridorState'>;
  /** Resolves on the next frame; the default waits for rAF, at most FRAME_FALLBACK_MS. */
  nextFrame?: () => Promise<void>;
  /** Monotonic clock, ms; the default is performance.now(). */
  now?: () => number;
}

/** The engine as the probe reads it. */
type ProbeEngine = NonNullable<ReturnType<EngineInitializationService['getEngine']>>;

/** Every cell of the grid, for dumpCellsInBox. */
const WHOLE_GRID = { xMin: -Infinity, xMax: Infinity, zMin: -Infinity, zMax: Infinity };

function nextFrameOrTimeout(): Promise<void> {
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

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

/**
 * `__corridor.probeLod()` and `__corridor.fingerprint()`, the measuring
 * tools of Phase 0 (docs/ROUTE_CORRIDOR.md): what a corridor measured on a
 * fixed LOD would cost, and whether two loads gave the same corridor.
 *
 * A probe loads the route corridor region at each error target in turn with
 * the camera's own refinement muted (MUTED_CAMERA_ERROR_TARGET), waits for the
 * tiles, and measures every station once into a scratch list, against a
 * column cache of its own (PathAndRouteService.measureAllStations,
 * TerrainQueries.withScratchColumnCache). Nothing of that reaches the
 * corridor: nothing is stored or rebuilt, and the settled tile loads are held
 * back from the game while it runs (SettleHold), so the cells and the
 * re-measurement keep what they saw before. At the end, also on a timeout or
 * an error, both error targets go back to what they were.
 *
 * Refused while towers stand, a wave runs, enemies walk, the intro flight
 * runs or a corridor measurement is under way; stops early when one of
 * those comes up between two targets.
 */
export class CorridorLodProbe {
  private busy = false;
  private readonly nextFrame: () => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly deps: CorridorLodProbeDeps) {
    this.nextFrame = deps.nextFrame ?? nextFrameOrTimeout;
    this.now = deps.now ?? (() => performance.now());
  }

  /** A probe runs: `__corridor.set()` and `reset()` wait for it. */
  get running(): boolean {
    return this.busy;
  }

  /**
   * Load each region target in turn and measure every station on it, see
   * the class comment. Resolves with a row per target (also printed as a
   * table), or with why it did not start.
   *
   * @param targets Region error targets, metres, 0 for the finest LOD
   * @param timeoutS How long to wait for the tiles of one target
   */
  async run(targets: readonly number[] = DEFAULT_PROBE_TARGETS, timeoutS = DEFAULT_PROBE_TIMEOUT_S): Promise<LodProbeResult | string> {
    if (this.busy) return 'Not started: a probe is running.';
    if (!Array.isArray(targets) || targets.length === 0 || !targets.every((t) => typeof t === 'number' && Number.isFinite(t) && t >= 0)) {
      return 'Not started: targets are metres of geometric error, 0 or more, e.g. [5, 2.5, 0].';
    }
    if (!(timeoutS > 0)) return 'Not started: the timeout is seconds, more than 0.';
    const blocker = this.blocker();
    if (blocker) return `Not started: ${blocker}.`;
    const engine = this.deps.engineInit.getEngine();
    const tiles = engine?.tilesLodDebug() ?? null;
    if (!engine || !tiles) return 'Not started: no 3D tiles (no location loaded, or DevWorld).';
    const before = tiles.snapshot();
    if (before.regionErrorTarget === null) return 'Not started: the route corridor region is not set yet (no routes).';
    const restored = { regionErrorTarget: before.regionErrorTarget, cameraErrorTarget: before.cameraErrorTarget };

    this.busy = true;
    const timeoutMs = timeoutS * 1000;
    const hashBefore = this.compute().hash;
    const rows: LodProbeRow[] = [];
    let stoppedEarly: string | null = null;
    let restoreTimedOut: boolean;
    let corridorUnchanged: boolean;
    tiles.holdSettled(true);
    try {
      try {
        tiles.setCameraErrorTarget(MUTED_CAMERA_ERROR_TARGET);
        for (const target of targets) {
          stoppedEarly = this.blocker();
          if (stoppedEarly) break;
          tiles.setRegionErrorTarget(target);
          console.log(`[Corridor] probeLod: region ${target} m, waiting for the tiles (at most ${timeoutS} s)`);
          const load = await this.settle(tiles, timeoutMs);
          rows.push(this.measure(engine, target, load, tiles.snapshot()));
        }
      } catch (error) {
        stoppedEarly = error instanceof Error ? error.message : String(error);
      } finally {
        tiles.setRegionErrorTarget(restored.regionErrorTarget);
        tiles.setCameraErrorTarget(restored.cameraErrorTarget);
      }
      restoreTimedOut = (await this.settle(tiles, timeoutMs)).timedOut;
      // Before the game gets its tile loads back: the sweep they start may move cells.
      corridorUnchanged = this.compute().hash === hashBefore;
    } finally {
      tiles.holdSettled(false);
      this.busy = false;
    }

    console.log(
      `[Corridor] probeLod: region ${restored.regionErrorTarget} m and camera ${restored.cameraErrorTarget} px restored` +
      (restoreTimedOut ? ` (tiles still loading after ${timeoutS} s)` : '') +
      (stoppedEarly ? `; stopped early: ${stoppedEarly}` : '') +
      (corridorUnchanged ? '; corridor unchanged' : '; the corridor CHANGED while the probe ran, reload before comparing fingerprints'),
    );
    console.table(rows);
    return { rows, restored, stoppedEarly, restoreTimedOut, corridorUnchanged };
  }

  /** `__corridor.fingerprint()`: prints and returns the fingerprint of the corridor in use (corridor-fingerprint.ts). */
  fingerprint(): CorridorFingerprint | string {
    if (!this.deps.engineInit.getEngine()) return 'No location loaded.';
    const print = this.compute();
    console.log(`[Corridor] fingerprint ${print.hash}`);
    console.table(print.parts);
    return print;
  }

  private compute(): CorridorFingerprint {
    const grid = this.deps.gameState().getGlobalRouteGrid().getGrid();
    return corridorFingerprint(this.deps.pathRoute.corridorState(), grid.dumpCellsInBox(WHOLE_GRID));
  }

  /** Why the probe must not start or go on, null if it may. */
  private blocker(): string | null {
    const gameState = this.deps.gameState();
    if (gameState.towerCount() > 0) return 'towers stand on the map, sell them first';
    if (gameState.waveManager.phase() === 'wave') return 'a wave is running';
    if (gameState.enemyManager.getAliveCount() > 0) return 'enemies are on the map';
    if (this.deps.introFlight.isRunning()) return 'the intro flight is running';
    if (this.deps.pathRoute.clearanceProgress() !== null) {
      return 'a corridor measurement is under way, wait for its [Corridor] clearance line';
    }
    return null;
  }

  /**
   * Wait until the tiles have not loaded for QUIET_MS, at most `timeoutMs`.
   * `ms` is the time until they stopped, or the whole wait on a timeout.
   */
  private async settle(tiles: TilesLodDebug, timeoutMs: number): Promise<{ ms: number; timedOut: boolean }> {
    const start = this.now();
    let quietSince: number | null = null;
    for (;;) {
      await this.nextFrame();
      const now = this.now();
      if (tiles.busy()) quietSince = null;
      else quietSince ??= now;
      if (quietSince !== null && now - quietSince >= QUIET_MS) return { ms: quietSince - start, timedOut: false };
      if (now - start >= timeoutMs) return { ms: now - start, timedOut: true };
    }
  }

  /** Measure every station once on the tiles loaded now, into a scratch list, and put it in a row. */
  private measure(
    engine: ProbeEngine, target: number, load: { ms: number; timedOut: boolean }, snapshot: TilesLodSnapshot,
  ): LodProbeRow {
    const raysBefore = raycastStats.totals(PROBE_CALLER);
    const scope = raycastStats.enter(PROBE_CALLER);
    const start = this.now();
    let probes: (StationProbe | null)[];
    try {
      probes = engine.terrain.withScratchColumnCache(() => this.deps.pathRoute.measureAllStations()) ?? [];
    } finally {
      raycastStats.exit(scope);
    }
    const measureMs = this.now() - start;
    const raysAfter = raycastStats.totals(PROBE_CALLER);
    const rays = raysAfter.calls - raysBefore.calls;

    const histogram = { upTo2: 0, upTo2_5: 0, upTo5: 0, over5: 0, none: 0 };
    for (const probe of probes) {
      const error = probe?.tileError ?? Infinity;
      if (!Number.isFinite(error)) histogram.none++;
      else if (error <= 2) histogram.upTo2++;
      else if (error <= 2.5) histogram.upTo2_5++;
      else if (error <= 5) histogram.upTo5++;
      else histogram.over5++;
    }
    return {
      target,
      loadS: round(load.ms / 1000, 1),
      timedOut: load.timedOut,
      active: snapshot.active,
      activeMB: snapshot.activeMB,
      cachedTiles: snapshot.cachedTiles,
      cachedMB: snapshot.cachedMB,
      cacheFull: snapshot.cacheFull,
      stations: probes.length,
      ...histogram,
      measureMs: round(measureMs, 1),
      msPerStation: probes.length > 0 ? round(measureMs / probes.length, 2) : 0,
      rays,
      rayMs: round(raysAfter.totalMs - raysBefore.totalMs, 1),
      hitsPerRay: rays > 0 ? round((raysAfter.hits - raysBefore.hits) / rays, 1) : 0,
    };
  }
}
