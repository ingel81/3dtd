import type { PerspectiveCamera, WebGLRenderer } from 'three';
import type { TilesRenderer } from '3d-tiles-renderer';

/** Tile-Zähler für Loading-Screen, Info-Overlay und die First-Load-Prüfung. */
export interface TileStats {
  parsing: number;
  downloading: number;
  total: number;
  visible: number;
  cacheMB: number;
}

/** Was der Tracker vom Engine braucht. */
export interface TileLoadingHooks {
  /**
   * Bodenhöhe unter dem Origin, null solange dort kein Tile getroffen wird.
   * Läuft bei jedem beruhigten tiles-load-end und bei jedem Retry.
   */
  probeOriginGround(): number | null;
  /**
   * Nach jedem beruhigten tiles-load-end, nach der First-Load-Prüfung. Hier
   * invalidiert der Engine seine LOD-abhängigen Caches.
   */
  onTileSetSettled(): void;
}

const TILES_LOAD_DEBOUNCE_MS = 500; // Wait 500ms after last tile load
const FIRST_TILES_RETRY_MS = 200; // Retry interval when meshes not ready
const FIRST_TILES_MAX_RETRIES = 50; // Max 10 seconds of retries
const MAX_CAMERA_NUDGES = 3;
/** Fallback, wenn der Origin-Raycast nichts trifft (Wasser, Mesh-Lücke). */
const MIN_VISIBLE_TILES = 50;
/** So lange liefert getTileStats() den letzten Stand. */
const TILE_STATS_CACHE_MS = 500;

/**
 * TileLoadingTracker: wann gelten die ersten Tiles als geladen, und wann hat sich
 * der geladene Tile-Satz beruhigt.
 *
 * Vorher inline in `three-tiles-engine.ts` (`onTilesLoadEnd`, `scheduleFirstTilesRetry`,
 * `getTileStats`, die Auth-Fehler-Erkennung und ihre Felder). Warum es Retry und
 * Nudge gibt: docs/TILES_LOADING_BUG.md.
 *
 * Ablauf:
 * 1. `tiles-load-end` startet einen Debounce von 500 ms, jeder weitere setzt ihn neu.
 * 2. Nach der Ruhe gelten die ersten Tiles als geladen, wenn der Origin-Raycast trifft
 *    oder mindestens 50 Tiles sichtbar sind. Sonst alle 200 ms erneut, höchstens 50 Mal.
 * 3. Sind danach null Tiles sichtbar, wird ein TilesRenderer-Update erzwungen und die
 *    Retry-Runde beginnt neu (höchstens 3 Mal). Danach gilt der Stand als geladen.
 * 4. Jeder beruhigte load-end meldet `onTileSetSettled`, auch nach dem ersten Laden.
 *
 * Vom Engine besessen: `attach()` in initialize(), `reset()` in setOrigin(), `dispose()`
 * aus dem Engine-dispose().
 */
export class TileLoadingTracker {
  private tilesRenderer: TilesRenderer | null = null;

  // Callback when first tiles are loaded (for loading indicator)
  private onFirstTilesLoadedCallback: (() => void) | null = null;
  private firstTilesLoaded = false;

  // Callback when the tile server rejects our credentials (bad/expired token).
  // The rejection lands during initEngine(), before the caller gets the engine
  // back to register anything, so a missed error is remembered and replayed.
  private onAuthErrorCallback: (() => void) | null = null;
  private authErrorSeen = false;

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryCount = 0;
  private tilesetLoadCount = 0; // Track how many tilesets have been loaded (for debugging)
  private cameraNudgeCount = 0; // Track camera nudges to prevent infinite loop

  // Cached tile stats (updated every 500ms to avoid performance overhead)
  private cachedTileStats: TileStats = { parsing: 0, downloading: 0, total: 0, visible: 0, cacheMB: 0 };
  private lastTileStatsUpdate = 0;

  // Event handler (stored for cleanup in dispose)
  private readonly tilesLoadEndHandler = () => this.onTilesLoadEnd();

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly renderer: WebGLRenderer,
    private readonly hooks: TileLoadingHooks,
  ) {}

  /** Registriert die Lade-Events am TilesRenderer. */
  attach(tilesRenderer: TilesRenderer): void {
    this.tilesRenderer = tilesRenderer;

    // Listen for tile loading events to refresh terrain heights
    // 'tiles-load-end' fires when ALL currently visible tiles have finished loading
    tilesRenderer.addEventListener('tiles-load-end', this.tilesLoadEndHandler);

    // Track tileset loading count (for debugging)
    tilesRenderer.addEventListener('load-tileset', () => {
      this.tilesetLoadCount++;
    });

    // A failed credential handshake and a failed single tile arrive on the same
    // event. The auth plugins dispatch theirs with `tile: null` (see
    // CesiumIonAuthPlugin.loadRootTileset), which is what separates "your token
    // is wrong" from "one tile did not come back".
    tilesRenderer.addEventListener('load-error', (event: unknown) => {
      console.error('[TilesEngine] load-error event:', event);

      const tile = (event as { tile?: unknown } | null)?.tile;
      if (tile === null) {
        this.authErrorSeen = true;
        this.onAuthErrorCallback?.();
      }
    });
  }

  /**
   * Register a callback to be called when first tiles are loaded
   * Used by component to hide "loading tiles" indicator
   */
  setOnFirstTilesLoaded(callback: () => void): void {
    this.onFirstTilesLoadedCallback = callback;
    // If tiles already loaded, call immediately
    if (this.firstTilesLoaded) {
      callback();
    }
  }

  /**
   * Register a callback for a rejected tile-server credential.
   * Used to send the player back to the token screen instead of leaving them
   * on a loading indicator that never finishes.
   */
  setOnAuthError(callback: () => void): void {
    this.onAuthErrorCallback = callback;

    // Registration usually happens after the tileset request already failed.
    if (this.authErrorSeen) callback();
  }

  /**
   * Erste Tiles gelten als geladen, der Callback feuert. Direkt aufgerufen von
   * DevWorld, das kein Tile-Streaming hat.
   */
  markFirstTilesLoaded(): void {
    this.firstTilesLoaded = true;
    if (this.onFirstTilesLoadedCallback) {
      this.onFirstTilesLoadedCallback();
    }
  }

  /**
   * Standortwechsel: Timer abbrechen und alle Zustände zurücksetzen, damit der
   * First-Load-Callback für den neuen Ort wieder feuert.
   */
  reset(): void {
    // Cancel any pending debounce timer from previous location
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // Reset ALL tiles-related flags so everything recalculates for new location
    this.firstTilesLoaded = false;
    this.retryCount = 0;
    this.tilesetLoadCount = 0;
    this.authErrorSeen = false;
    this.cameraNudgeCount = 0;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  /**
   * Called when all visible tiles finish loading
   * Uses debounce to avoid multiple rapid refreshes during camera movement
   */
  private onTilesLoadEnd(): void {
    // Clear existing debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // Start new debounce timer - wait for camera to settle
    this.debounceTimer = setTimeout(() => {
      // Probe und Stats laufen bei jedem beruhigten load-end, nicht nur vor dem ersten Laden
      const originGround = this.hooks.probeOriginGround();
      const stats = this.getTileStats();

      // FIRST TILES LOADED - primarily wait for raycast success
      // Raycast hitting terrain means tiles are loaded AND stable (not mid-LOD-transition)
      // Fallback: 50+ visible tiles without raycast (e.g., origin over water/gap)
      if (!this.firstTilesLoaded) {
        if (originGround !== null || stats.visible >= MIN_VISIBLE_TILES) {
          this.markFirstTilesLoaded();
        } else {
          // Not ready yet - schedule retry
          this.scheduleFirstTilesRetry();
        }
      }

      this.hooks.onTileSetSettled();
    }, TILES_LOAD_DEBOUNCE_MS);
  }

  /**
   * Retry checking for first tiles when tiles-load-end fired but the origin
   * column still has no ground: water or a mesh gap at (0,0), or tiles still
   * refining in after the debounce.
   */
  private scheduleFirstTilesRetry(): void {
    // Clear any existing retry timer
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }

    // Don't retry forever - but try camera nudge first
    if (this.retryCount >= FIRST_TILES_MAX_RETRIES) {
      const stats = this.getTileStats();
      if (stats.visible === 0 && this.cameraNudgeCount < MAX_CAMERA_NUDGES) {
        // No tiles after max retries - try forcing tile update
        this.cameraNudgeCount++;
        console.warn(`[TilesEngine] Max retries reached with 0 tiles - forcing update #${this.cameraNudgeCount}`);

        // Force camera matrix update and tile refresh
        this.camera.updateMatrixWorld(true);
        if (this.tilesRenderer) {
          this.tilesRenderer.setResolutionFromRenderer(this.camera, this.renderer);
          this.tilesRenderer.setCamera(this.camera);
          this.tilesRenderer.update();
        }

        // Reset retry counter and try again
        this.retryCount = 0;
        this.scheduleFirstTilesRetry();
        return;
      }
      // Either some tiles loaded, or we've exhausted nudges - accept current state
      console.warn(`[TilesEngine] Max retries reached (visible=${stats.visible}, nudges=${this.cameraNudgeCount}), marking as loaded`);
      this.markFirstTilesLoaded();
      return;
    }

    this.retryCount++;

    this.retryTimer = setTimeout(() => {
      if (this.firstTilesLoaded) return; // Already loaded via another path

      const originGround = this.hooks.probeOriginGround();
      const stats = this.getTileStats();

      // Primarily wait for raycast success - means tiles are stable
      // Fallback: 50+ visible tiles (e.g., origin over water/gap)
      if (originGround !== null || stats.visible >= MIN_VISIBLE_TILES) {
        this.markFirstTilesLoaded();
      } else {
        // Not ready yet - continue retrying
        this.scheduleFirstTilesRetry();
      }
    }, FIRST_TILES_RETRY_MS);
  }

  /**
   * Tile loading statistics from the renderer's counters and tile sets.
   * Cached and updated every 500ms for performance.
   */
  getTileStats(): TileStats {
    const now = performance.now();
    if (now - this.lastTileStatsUpdate < TILE_STATS_CACHE_MS) {
      return this.cachedTileStats;
    }

    if (!this.tilesRenderer) {
      return this.cachedTileStats;
    }

    // The renderer keeps these counters per frame, but its typings omit them.
    const { queued, downloading, parsing } = (this.tilesRenderer as unknown as {
      stats: { queued: number; downloading: number; parsing: number };
    }).stats;

    this.cachedTileStats = {
      parsing,
      // Queued tiles are still waiting on a download slot, so they count as pending.
      downloading: queued + downloading,
      total: this.tilesRenderer.activeTiles.size,
      visible: this.tilesRenderer.visibleTiles.size,
      cacheMB: Math.round(
        (this.tilesRenderer.lruCache as unknown as { cachedBytes: number }).cachedBytes / 2 ** 20,
      ),
    };
    this.lastTileStatsUpdate = now;

    return this.cachedTileStats;
  }

  /**
   * Entfernt den tiles-load-end-Listener und lässt den TilesRenderer los.
   * Laufende Debounce- und Retry-Timer bricht das nicht ab; so war es schon im
   * Engine, ein Abbruch hier wäre ein eigener Fix.
   */
  dispose(): void {
    if (this.tilesRenderer) {
      this.tilesRenderer.removeEventListener('tiles-load-end', this.tilesLoadEndHandler);
      this.tilesRenderer = null;
    }
  }
}
