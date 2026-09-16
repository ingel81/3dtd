import type { GameStateManager } from '../../managers/game-state.manager';
import type { EngineInitializationService } from '../infrastructure/engine-initialization.service';
import type { PathAndRouteService } from '../world/path-route.service';
import type { TowerDefenseStore } from '../../store/tower-defense.store';
import type { GlobalRouteGrid } from '../../utils/global-route-grid';
import { CorridorBuild } from '../world/corridor-build';
import { nextFrameOrTimeout } from '../../three-engine/tiles-lod-debug';
import { cameraTimeline } from '../../utils/camera-timeline';
import { corridorTrace } from '../../utils/corridor-trace';
import { WHOLE_GRID } from '../../utils/route-grid-diagnostics';
import { canvasPngDataUrl } from '../../utils/screenshot';
import { describeColumn } from './corridor-console';
import { tilesStats } from './tiles-console';
import type { CorridorSnapshotSource } from './corridor-snapshot.service';
import type { CorridorSnapshotData, SnapshotCellProbe, SnapshotPoint } from './corridor-snapshot';

/** The engine as the snapshot reads it. */
type SnapshotEngine = NonNullable<ReturnType<EngineInitializationService['getEngine']>>;

/** Widest screenshot a snapshot keeps, px: a 4K canvas scales down to it, a quarter of its pixels. */
export const SNAPSHOT_SCREENSHOT_WIDTH = 1920;

/** What CorridorSnapshotReader needs; VisualizationFacadeService passes its services. */
export interface CorridorSnapshotReaderDeps {
  /** The game state, set by the facade's initialize(); read on each call. */
  gameState: () => Pick<GameStateManager, 'getGlobalRouteGrid'>;
  engineInit: Pick<EngineInitializationService, 'getEngine' | 'loading'>;
  pathRoute: Pick<PathAndRouteService, 'corridorState'>;
  store: Pick<TowerDefenseStore, 'baseCoords' | 'spawnPoints'>;
  /** The corridor is being built (CorridorBuild.pending): its cells and stations are not what it ends with. */
  corridorBuilding: () => boolean;
  /** `__corridor.probeLod()` runs (CorridorLodProbe.running): it holds the tiles at another LOD. */
  lodProbeRunning: () => boolean;
  /** Resolves on the next frame; the default waits for rAF, at most FRAME_FALLBACK_MS. */
  nextFrame?: () => Promise<void>;
  /** Monotonic clock, ms; the default is performance.now(). */
  now?: () => number;
  /** The canvas as a PNG data URL; the default copies the next drawn frame (captureScreenshot). */
  screenshot?: (engine: SnapshotEngine) => Promise<string | null>;
}

/**
 * The next drawn frame as a PNG data URL, at most SNAPSHOT_SCREENSHOT_WIDTH
 * wide. The canvas is copied inside the frame (ThreeTilesEngine.captureFrame):
 * without preserveDrawingBuffer a read in a later task finds it cleared.
 */
async function captureScreenshot(engine: SnapshotEngine): Promise<string | null> {
  const frame = await engine.captureFrame();
  if (!frame) return null;
  if (frame.width <= SNAPSHOT_SCREENSHOT_WIDTH) return canvasPngDataUrl(frame);
  const scaled = document.createElement('canvas');
  scaled.width = SNAPSHOT_SCREENSHOT_WIDTH;
  scaled.height = Math.round((frame.height * SNAPSHOT_SCREENSHOT_WIDTH) / frame.width);
  scaled.getContext('2d')?.drawImage(frame, 0, 0, scaled.width, scaled.height);
  return canvasPngDataUrl(scaled);
}

/** To 2 decimals; `+ 0` turns -0 into 0. */
const round2 = (v: number) => Math.round(v * 100) / 100 + 0;

/**
 * What the corridor snapshot reads off the game (CorridorSnapshotService):
 * first the screenshot, what the player sees at the click; then the stored
 * corridor (corridorState, the grid's cells), the corridor trace of this
 * location load and the tiles of the region; then every cell the way
 * `__corridor.pick()` reads it, with the column at its centre
 * (TerrainQueries.inspectColumn, one ray each). The cells are read in slices
 * of CorridorBuild.SLICE_MS a frame, and the settled tile loads are held
 * back from the game meanwhile (SettleHold), so the column cache and its
 * lodVersion stay as they were at the start. Nothing is stored or built.
 *
 * Refused without a location, while it loads, while the corridor is built
 * and while `__corridor.probeLod()` runs; stops when one of those comes up
 * between two slices.
 */
export class CorridorSnapshotReader implements CorridorSnapshotSource {
  private readonly nextFrame: () => Promise<void>;
  private readonly now: () => number;
  private readonly screenshot: (engine: SnapshotEngine) => Promise<string | null>;

  constructor(private readonly deps: CorridorSnapshotReaderDeps) {
    this.nextFrame = deps.nextFrame ?? nextFrameOrTimeout;
    this.now = deps.now ?? (() => performance.now());
    this.screenshot = deps.screenshot ?? captureScreenshot;
  }

  blocker(): string | null {
    if (!this.deps.engineInit.getEngine()) return 'No location loaded.';
    if (this.deps.engineInit.loading()) return 'The location is loading: take the snapshot once the loading screen is gone.';
    if (this.deps.corridorBuilding()) return 'The corridor is being built: take the snapshot once it stands.';
    if (this.deps.lodProbeRunning()) return '__corridor.probeLod() is running: take the snapshot after it.';
    return null;
  }

  async read(progress: (done: number, total: number) => void): Promise<CorridorSnapshotData | string> {
    const start = this.now();
    const engine = this.deps.engineInit.getEngine();
    if (!engine) return 'No location loaded.';
    const grid = this.deps.gameState().getGlobalRouteGrid().getGrid();

    const camera = cameraTimeline.pose();
    const screenshot = await this.screenshot(engine);
    const screenshotMs = this.now() - start;
    const stopped = this.stopped(engine, grid);
    if (stopped) return stopped;

    const trace = [...corridorTrace.list()];
    const state = this.deps.pathRoute.corridorState();
    const cells = grid.dumpCellsInBox(WHOLE_GRID);
    const tiles = tilesStats(engine);
    const region = engine.routeCorridorLod();
    const tilePaths = engine.routeCorridorTilePaths();
    const size = grid.getCellSize();
    const point = (lat: number, lon: number): SnapshotPoint => {
      const local = engine.sync.geoToLocalSimple(lat, lon, 0);
      return { lat, lon, x: round2(local.x), z: round2(local.z) };
    };
    const base = this.deps.store.baseCoords();

    const probes: SnapshotCellProbe[] = [];
    let cellsMs = 0;
    let columnsMs = 0;
    let slices = 0;
    const hold = engine.tilesLodDebug();
    hold?.holdSettled(true);
    try {
      while (probes.length < cells.length) {
        if (slices > 0) {
          progress(probes.length, cells.length);
          await this.nextFrame();
          const why = this.stopped(engine, grid);
          if (why) return why;
        }
        slices++;
        const sliceStart = this.now();
        do {
          const cell = cells[probes.length];
          const live = grid.getCellAt(cell.x, cell.z);
          const rayStart = this.now();
          const column = engine.terrain.inspectColumn(cell.x, cell.z);
          columnsMs += this.now() - rayStart;
          probes.push({
            // The spot of the cell alone: its centre lies on the lattice
            row: grid.describeCellsAround(cell.x, cell.z, size / 4, null)[0] ?? null,
            passage: live?.tunnelSpan?.passage === true,
            miss: live ? grid.missOf(live) : null,
            column: column ? describeColumn(column) : null,
          });
        } while (probes.length < cells.length && this.now() - sliceStart < CorridorBuild.SLICE_MS);
        cellsMs += this.now() - sliceStart;
      }
    } finally {
      hold?.holdSettled(false);
    }
    progress(cells.length, cells.length);

    return {
      hq: point(base.lat, base.lon),
      spawns: this.deps.store.spawnPoints().map((spawn) => ({ id: spawn.id, ...point(spawn.lat, spawn.lon) })),
      cellSize: size,
      camera,
      state,
      cells,
      probes,
      trace,
      tiles,
      region,
      tilePaths,
      screenshot,
      cost: {
        cells: cells.length,
        cellsMs,
        columnsMs,
        slices,
        screenshotMs,
        wallMs: this.now() - start,
      },
    };
  }

  /** Why the read cannot go on: a blocker came up, or the location or its grid is another one now. */
  private stopped(engine: SnapshotEngine, grid: GlobalRouteGrid): string | null {
    const blocked = this.blocker();
    if (blocked) return blocked;
    if (this.deps.engineInit.getEngine() !== engine || this.deps.gameState().getGlobalRouteGrid().getGrid() !== grid) {
      return 'The location changed during the snapshot: take it again.';
    }
    return null;
  }
}
