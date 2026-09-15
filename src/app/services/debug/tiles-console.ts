import type { EngineInitializationService } from '../infrastructure/engine-initialization.service';
import type { TilesLodSnapshot } from '../../three-engine/tiles-lod-debug';

/** What TilesConsole needs; VisualizationFacadeService passes its services. */
export interface TilesConsoleDeps {
  engineInit: Pick<EngineInitializationService, 'getEngine'>;
}

/**
 * `__tiles.stats()` in DevTools: the tiles loaded and cached, the downloads
 * pending, and the error targets of the route corridor region and of the
 * camera (ThreeTilesEngine.tilesLodDebug), with the column cache's
 * `lodVersion`. The info overlay shows part of it without the targets.
 */
export class TilesConsole {
  /** The `__tiles` this instance registered, see uninstall(). */
  private api: object | null = null;

  constructor(private readonly deps: TilesConsoleDeps) {}

  /** Register `__tiles` on globalThis, replacing the one of a previous location. */
  install(): void {
    this.api = { stats: () => this.stats() };
    (globalThis as Record<string, unknown>)['__tiles'] = this.api;
  }

  /** Remove `__tiles` from globalThis, unless another instance has registered its own since. */
  uninstall(): void {
    const global = globalThis as Record<string, unknown>;
    if (this.api && global['__tiles'] === this.api) delete global['__tiles'];
    this.api = null;
  }

  private stats(): (TilesLodSnapshot & { lodVersion: number }) | string {
    const engine = this.deps.engineInit.getEngine();
    const tiles = engine?.tilesLodDebug() ?? null;
    if (!engine || !tiles) return 'No 3D tiles: no location loaded, or DevWorld.';
    const row = { ...tiles.snapshot(), lodVersion: engine.terrain.lodVersion };
    console.table(row);
    return row;
  }
}
