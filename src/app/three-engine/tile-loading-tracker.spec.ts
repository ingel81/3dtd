import { EventDispatcher, PerspectiveCamera, type WebGLRenderer } from 'three';
import type { TilesRenderer } from '3d-tiles-renderer';
import { TileLoadingTracker } from './tile-loading-tracker';

/** Genug TilesRenderer für den Tracker: Events, Zähler, Tile-Sets, erzwungenes Update. */
class FakeTilesRenderer extends EventDispatcher<{
  'tiles-load-end': object;
  'load-tileset': object;
  'load-error': { tile: unknown };
}> {
  stats = { queued: 0, downloading: 0, parsing: 0 };
  activeTiles = new Set<number>();
  visibleTiles = new Set<number>();
  lruCache = { cachedBytes: 0 };
  setResolutionFromRenderer = vi.fn();
  setCamera = vi.fn();
  update = vi.fn();

  setVisible(count: number): void {
    this.visibleTiles = new Set(Array.from({ length: count }, (_, i) => i));
  }

  loadEnd(): void {
    this.dispatchEvent({ type: 'tiles-load-end' });
  }
}

function setup(options: { ground?: number | null; visible?: number; attach?: boolean } = {}) {
  const tiles = new FakeTilesRenderer();
  tiles.setVisible(options.visible ?? 0);
  const camera = new PerspectiveCamera();
  const renderer = { name: 'renderer' } as unknown as WebGLRenderer;

  let ground = options.ground ?? null;
  const hooks = {
    probeOriginGround: vi.fn(() => ground),
    onTileSetSettled: vi.fn(),
  };
  const tracker = new TileLoadingTracker(camera, renderer, hooks);
  if (options.attach ?? true) {
    tracker.attach(tiles as unknown as TilesRenderer);
  }
  const onFirstLoaded = vi.fn();
  tracker.setOnFirstTilesLoaded(onFirstLoaded);

  return {
    tiles, camera, renderer, tracker, hooks, onFirstLoaded,
    setGround: (y: number | null) => { ground = y; },
  };
}

describe('TileLoadingTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('erster Tile-Load', () => {
    it('meldet die ersten Tiles 500 ms nach dem letzten tiles-load-end, wenn der Origin-Raycast trifft', () => {
      const { tiles, hooks, onFirstLoaded } = setup({ ground: 12 });

      tiles.loadEnd();
      vi.advanceTimersByTime(499);
      expect(onFirstLoaded).not.toHaveBeenCalled();
      expect(hooks.onTileSetSettled).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(onFirstLoaded).toHaveBeenCalledTimes(1);
      expect(hooks.onTileSetSettled).toHaveBeenCalledTimes(1);
    });

    it('setzt den Debounce bei jedem weiteren tiles-load-end neu', () => {
      const { tiles, hooks, onFirstLoaded } = setup({ ground: 12 });

      tiles.loadEnd();
      vi.advanceTimersByTime(300);
      tiles.loadEnd();
      vi.advanceTimersByTime(300);
      tiles.loadEnd();
      vi.advanceTimersByTime(499);
      expect(hooks.onTileSetSettled).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(hooks.onTileSetSettled).toHaveBeenCalledTimes(1);
      expect(onFirstLoaded).toHaveBeenCalledTimes(1);
    });

    it('akzeptiert ohne Raycast-Treffer ab 50 sichtbaren Tiles', () => {
      const few = setup({ visible: 49 });
      few.tiles.loadEnd();
      vi.advanceTimersByTime(500);
      expect(few.onFirstLoaded).not.toHaveBeenCalled();

      const enough = setup({ visible: 50 });
      enough.tiles.loadEnd();
      vi.advanceTimersByTime(500);
      expect(enough.onFirstLoaded).toHaveBeenCalledTimes(1);
    });

    it('ruft einen erst danach registrierten Callback sofort auf', () => {
      const { tiles, tracker } = setup({ ground: 12 });
      tiles.loadEnd();
      vi.advanceTimersByTime(500);

      const late = vi.fn();
      tracker.setOnFirstTilesLoaded(late);
      expect(late).toHaveBeenCalledTimes(1);
    });

    it('meldet jeden beruhigten load-end weiter, den ersten Load aber nur einmal', () => {
      const { tiles, hooks, onFirstLoaded } = setup({ ground: 12 });

      tiles.loadEnd();
      vi.advanceTimersByTime(500);
      tiles.loadEnd();
      vi.advanceTimersByTime(500);

      expect(onFirstLoaded).toHaveBeenCalledTimes(1);
      expect(hooks.onTileSetSettled).toHaveBeenCalledTimes(2);
      // Der Engine verlässt sich darauf, dass die Origin-Probe jedes Mal läuft.
      expect(hooks.probeOriginGround).toHaveBeenCalledTimes(2);
    });

    it('markFirstTilesLoaded() meldet sofort, ohne auf Tiles zu warten (DevWorld)', () => {
      const { tracker, onFirstLoaded } = setup({ attach: false });
      tracker.markFirstTilesLoaded();
      expect(onFirstLoaded).toHaveBeenCalledTimes(1);
    });
  });

  describe('Retry', () => {
    it('prüft alle 200 ms nach, bis der Origin-Raycast trifft', () => {
      const { tiles, hooks, onFirstLoaded, setGround } = setup();

      tiles.loadEnd();
      vi.advanceTimersByTime(500);
      expect(onFirstLoaded).not.toHaveBeenCalled();
      expect(hooks.probeOriginGround).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(200);
      expect(hooks.probeOriginGround).toHaveBeenCalledTimes(2);
      expect(onFirstLoaded).not.toHaveBeenCalled();

      setGround(5);
      vi.advanceTimersByTime(199);
      expect(onFirstLoaded).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(onFirstLoaded).toHaveBeenCalledTimes(1);
      // Retries sind keine beruhigten load-ends.
      expect(hooks.onTileSetSettled).toHaveBeenCalledTimes(1);
    });

    it('akzeptiert nach 50 Retries den Stand, wenn wenigstens ein Tile sichtbar ist', () => {
      const { tiles, onFirstLoaded } = setup({ visible: 10 });

      tiles.loadEnd();
      vi.advanceTimersByTime(500 + 50 * 200 - 1);
      expect(onFirstLoaded).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(onFirstLoaded).toHaveBeenCalledTimes(1);
      expect(tiles.update).not.toHaveBeenCalled();
    });

    it('erzwingt bei null sichtbaren Tiles bis zu 3 Tiles-Updates, dann gilt der Stand als geladen', () => {
      const { tiles, camera, renderer, onFirstLoaded } = setup();
      const updateMatrixWorld = vi.spyOn(camera, 'updateMatrixWorld');

      tiles.loadEnd();
      vi.advanceTimersByTime(500 + 50 * 200);
      expect(tiles.update).toHaveBeenCalledTimes(1);
      expect(updateMatrixWorld).toHaveBeenCalledWith(true);
      expect(tiles.setResolutionFromRenderer).toHaveBeenCalledWith(camera, renderer);
      expect(tiles.setCamera).toHaveBeenCalledWith(camera);

      // Jeder Nudge startet eine neue Runde von 50 Retries.
      vi.advanceTimersByTime(50 * 200);
      expect(tiles.update).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(50 * 200);
      expect(tiles.update).toHaveBeenCalledTimes(3);

      vi.advanceTimersByTime(50 * 200 - 1);
      expect(onFirstLoaded).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(onFirstLoaded).toHaveBeenCalledTimes(1);
      expect(tiles.update).toHaveBeenCalledTimes(3);
    });

    it('hört auf nachzuprüfen, sobald die ersten Tiles anders geladen gelten', () => {
      const { tiles, tracker, hooks, onFirstLoaded } = setup();

      tiles.loadEnd();
      vi.advanceTimersByTime(500);
      tracker.markFirstTilesLoaded();
      vi.advanceTimersByTime(60_000);

      expect(hooks.probeOriginGround).toHaveBeenCalledTimes(1);
      expect(onFirstLoaded).toHaveBeenCalledTimes(1);
    });
  });

  describe('reset() beim Standortwechsel', () => {
    it('verwirft einen laufenden Debounce und meldet den ersten Load für den neuen Ort erneut', () => {
      const { tiles, tracker, hooks, onFirstLoaded } = setup({ ground: 12 });
      tiles.loadEnd();
      vi.advanceTimersByTime(500);
      expect(onFirstLoaded).toHaveBeenCalledTimes(1);

      tiles.loadEnd();
      vi.advanceTimersByTime(200);
      tracker.reset();
      vi.advanceTimersByTime(1000);
      expect(hooks.onTileSetSettled).toHaveBeenCalledTimes(1);

      tiles.loadEnd();
      vi.advanceTimersByTime(500);
      expect(onFirstLoaded).toHaveBeenCalledTimes(2);
      expect(hooks.onTileSetSettled).toHaveBeenCalledTimes(2);
    });

    it('bricht laufende Retries ab und gibt die drei Nudges für den neuen Ort wieder frei', () => {
      const { tiles, tracker, hooks, onFirstLoaded } = setup();

      tiles.loadEnd();
      vi.advanceTimersByTime(500 + 3 * 50 * 200);
      expect(tiles.update).toHaveBeenCalledTimes(3);

      tracker.reset();
      const probesAtReset = hooks.probeOriginGround.mock.calls.length;
      vi.advanceTimersByTime(60_000);
      expect(hooks.probeOriginGround).toHaveBeenCalledTimes(probesAtReset);
      expect(onFirstLoaded).not.toHaveBeenCalled();

      // Ohne Reset von Retry- und Nudge-Zähler käme hier kein vierter Nudge.
      tiles.loadEnd();
      vi.advanceTimersByTime(500 + 50 * 200);
      expect(tiles.update).toHaveBeenCalledTimes(4);
    });
  });

  describe('Auth-Fehler', () => {
    it('meldet einen load-error ohne Tile als Auth-Fehler, auch einem später registrierten Callback', () => {
      const { tiles, tracker } = setup();
      tiles.dispatchEvent({ type: 'load-error', tile: null });

      const onAuthError = vi.fn();
      tracker.setOnAuthError(onAuthError);
      expect(onAuthError).toHaveBeenCalledTimes(1);

      tiles.dispatchEvent({ type: 'load-error', tile: null });
      expect(onAuthError).toHaveBeenCalledTimes(2);
    });

    it('ignoriert Ladefehler einzelner Tiles', () => {
      const { tiles, tracker } = setup();
      const onAuthError = vi.fn();
      tracker.setOnAuthError(onAuthError);

      tiles.dispatchEvent({ type: 'load-error', tile: { url: 'tile.glb' } });
      expect(onAuthError).not.toHaveBeenCalled();
    });

    it('vergisst einen gemerkten Auth-Fehler beim Standortwechsel', () => {
      const { tiles, tracker } = setup();
      tiles.dispatchEvent({ type: 'load-error', tile: null });
      tracker.reset();

      const onAuthError = vi.fn();
      tracker.setOnAuthError(onAuthError);
      expect(onAuthError).not.toHaveBeenCalled();
    });
  });

  describe('getTileStats()', () => {
    it('liest Zähler, Tile-Sets und Cache-Größe des Renderers und hält den Stand 500 ms', () => {
      const { tiles, tracker } = setup({ attach: true });
      vi.advanceTimersByTime(1000);
      tiles.stats = { queued: 2, downloading: 3, parsing: 1 };
      tiles.activeTiles = new Set([1, 2, 3, 4]);
      tiles.setVisible(7);
      tiles.lruCache.cachedBytes = 3 * 2 ** 20;

      expect(tracker.getTileStats()).toEqual({ parsing: 1, downloading: 5, total: 4, visible: 7, cacheMB: 3 });

      tiles.setVisible(9);
      vi.advanceTimersByTime(499);
      expect(tracker.getTileStats().visible).toBe(7);
      vi.advanceTimersByTime(1);
      expect(tracker.getTileStats().visible).toBe(9);
    });

    it('liefert ohne TilesRenderer den leeren Stand', () => {
      const { tracker } = setup({ attach: false, visible: 80 });
      vi.advanceTimersByTime(1000);
      expect(tracker.getTileStats()).toEqual({ parsing: 0, downloading: 0, total: 0, visible: 0, cacheMB: 0 });
    });
  });

  describe('dispose()', () => {
    it('löst den tiles-load-end-Listener und lässt den Renderer los', () => {
      const { tiles, tracker, hooks } = setup({ ground: 12, visible: 80 });
      tracker.dispose();

      tiles.loadEnd();
      vi.advanceTimersByTime(1000);
      expect(hooks.onTileSetSettled).not.toHaveBeenCalled();
      expect(tracker.getTileStats().visible).toBe(0);
    });

    it('bricht einen laufenden Debounce ab, der Engine bekommt keinen Settled-Hook mehr', () => {
      const { tiles, tracker, hooks, onFirstLoaded } = setup({ ground: 12 });

      tiles.loadEnd();
      vi.advanceTimersByTime(200);
      tracker.dispose();
      vi.advanceTimersByTime(60_000);

      expect(hooks.probeOriginGround).not.toHaveBeenCalled();
      expect(hooks.onTileSetSettled).not.toHaveBeenCalled();
      expect(onFirstLoaded).not.toHaveBeenCalled();
    });

    it('bricht laufende Retries samt Nudges ab', () => {
      const { tiles, tracker, hooks, onFirstLoaded } = setup();

      tiles.loadEnd();
      vi.advanceTimersByTime(500);
      expect(hooks.probeOriginGround).toHaveBeenCalledTimes(1);

      tracker.dispose();
      vi.advanceTimersByTime(4 * 50 * 200);

      expect(hooks.probeOriginGround).toHaveBeenCalledTimes(1);
      expect(tiles.update).not.toHaveBeenCalled();
      expect(onFirstLoaded).not.toHaveBeenCalled();
    });
  });
});
