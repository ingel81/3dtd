import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { BUILDING_RELOAD_DELAY_MS, BuildingOverlay, type BuildingOverlayDeps } from './building-overlay';
import { BUILDING_CORRIDOR_RADIUS } from '../../configs/map-constants.config';

/**
 * Building footprints are loaded from OSM for the route corridor on the
 * first toggle-on, drawn again after tile loads and forgotten on dispose.
 */
describe('BuildingOverlay', () => {
  const HQ = { lat: 48.7758, lon: 9.1829 };
  const ROUTE = [{ ...HQ, height: 1 }, { lat: 48.78, lon: 9.19, height: 2 }];
  const engine = { engine: true };

  let cachedPaths: Map<string, typeof ROUTE>;
  let currentEngine: object | null;
  let deps: ReturnType<typeof fakeDeps>;
  let overlay: BuildingOverlay;

  function fakeDeps() {
    return {
      osm: {
        loadBuildingsNearRoutes: vi.fn(async (_routes: unknown, _radius: number) => ({ buildings: ['near'] as unknown[] })),
      },
      pathRoute: { getCachedPaths: vi.fn(() => cachedPaths) },
      buildingRendering: { renderBuildings: vi.fn(), toggleVisibility: vi.fn(), reset: vi.fn(), clear: vi.fn() },
      uiStore: { buildingsVisible: signal(false) },
      store: { baseCoords: signal({ ...HQ }) },
      engine: vi.fn(() => currentEngine),
    };
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  async function show(): Promise<void> {
    deps.uiStore.buildingsVisible.set(true);
    overlay.toggled();
    await settle();
  }

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    cachedPaths = new Map([['spawn-1', ROUTE]]);
    currentEngine = engine;
    deps = fakeDeps();
    overlay = new BuildingOverlay(deps as unknown as BuildingOverlayDeps);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads the buildings near the routes on the first toggle-on, then only toggles', async () => {
    await show();

    expect(deps.osm.loadBuildingsNearRoutes).toHaveBeenCalledWith(
      [ROUTE.map(({ lat, lon }) => ({ lat, lon }))], BUILDING_CORRIDOR_RADIUS,
    );
    expect(deps.buildingRendering.renderBuildings).toHaveBeenCalledWith(engine, ['near'], HQ, true);
    expect(deps.buildingRendering.toggleVisibility).not.toHaveBeenCalled();

    overlay.toggled();
    expect(deps.osm.loadBuildingsNearRoutes).toHaveBeenCalledTimes(1);
    expect(deps.buildingRendering.toggleVisibility).toHaveBeenCalledTimes(1);
  });

  it('loads nothing without routes and asks again on the next toggle-on', async () => {
    cachedPaths = new Map();
    await show();
    expect(deps.osm.loadBuildingsNearRoutes).not.toHaveBeenCalled();
    expect(deps.buildingRendering.renderBuildings).not.toHaveBeenCalled();

    cachedPaths = new Map([['spawn-1', ROUTE]]);
    overlay.toggled();
    await settle();
    expect(deps.osm.loadBuildingsNearRoutes).toHaveBeenCalledTimes(1);
  });

  it('only toggles while hidden and not loaded', () => {
    overlay.toggled();
    expect(deps.osm.loadBuildingsNearRoutes).not.toHaveBeenCalled();
    expect(deps.buildingRendering.toggleVisibility).toHaveBeenCalledTimes(1);
  });

  it('loads nothing without an engine', async () => {
    currentEngine = null;
    await show();
    expect(deps.osm.loadBuildingsNearRoutes).not.toHaveBeenCalled();
    expect(deps.buildingRendering.renderBuildings).not.toHaveBeenCalled();
  });

  it('logs a failed load and tries again on the next toggle', async () => {
    deps.osm.loadBuildingsNearRoutes.mockRejectedValueOnce(new Error('Overpass down'));
    await show();
    expect(console.error).toHaveBeenCalledWith('[Buildings] Failed to load:', expect.any(Error));

    overlay.toggled();
    await settle();
    expect(deps.osm.loadBuildingsNearRoutes).toHaveBeenCalledTimes(2);
  });

  it('draws the loaded buildings again after a tile load while they are shown', async () => {
    overlay.rerender(engine as never);
    expect(deps.buildingRendering.renderBuildings).not.toHaveBeenCalled();

    await show();
    overlay.rerender(engine as never);
    expect(deps.buildingRendering.renderBuildings).toHaveBeenCalledTimes(2);
    expect(deps.buildingRendering.renderBuildings).toHaveBeenLastCalledWith(engine, ['near'], HQ, true);

    deps.uiStore.buildingsVisible.set(false);
    overlay.rerender(engine as never);
    expect(deps.buildingRendering.renderBuildings).toHaveBeenCalledTimes(2);
  });

  it('forgets the buildings on reset and loads them again on the next toggle-on', async () => {
    await show();

    overlay.reset();
    expect(deps.buildingRendering.reset).toHaveBeenCalledTimes(1);
    overlay.rerender(engine as never);
    expect(deps.buildingRendering.renderBuildings).toHaveBeenCalledTimes(1);

    overlay.toggled();
    await settle();
    expect(deps.osm.loadBuildingsNearRoutes).toHaveBeenCalledTimes(2);
  });

  describe('when the routes or the place change', () => {
    const OTHER = [{ lat: 48.77, lon: 9.17, height: 1 }, { ...HQ, height: 1 }];

    it('takes the old buildings off and loads those of the new routes by itself while shown', async () => {
      await show();
      vi.useFakeTimers();
      try {
        cachedPaths = new Map([['spawn-1', ROUTE], ['spawn-2', OTHER]]);
        overlay.routesChanged();
        expect(deps.buildingRendering.clear).toHaveBeenCalledWith(engine);
        // Not at once: a place builds its routes one by one
        expect(deps.osm.loadBuildingsNearRoutes).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(BUILDING_RELOAD_DELAY_MS);
        expect(deps.osm.loadBuildingsNearRoutes).toHaveBeenCalledTimes(2);
        expect(deps.osm.loadBuildingsNearRoutes).toHaveBeenLastCalledWith(
          [ROUTE, OTHER].map((r) => r.map(({ lat, lon }) => ({ lat, lon }))), BUILDING_CORRIDOR_RADIUS,
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it('drops the buildings of another place while hidden and loads anew on the next toggle-on', async () => {
      await show();
      deps.uiStore.buildingsVisible.set(false);
      overlay.toggled();
      deps.store.baseCoords.set({ lat: 40.64, lon: 22.93 });
      cachedPaths = new Map([['spawn-1', OTHER]]);
      overlay.routesChanged();
      expect(deps.buildingRendering.clear).toHaveBeenCalledTimes(1);
      overlay.rerender(engine as never);
      expect(deps.buildingRendering.renderBuildings).toHaveBeenCalledTimes(1);

      await show();
      expect(deps.osm.loadBuildingsNearRoutes).toHaveBeenCalledTimes(2);
    });

    it('never draws the old cache on the new place after a tile load', async () => {
      await show();
      deps.store.baseCoords.set({ lat: 40.64, lon: 22.93 });
      overlay.rerender(engine as never);
      expect(deps.buildingRendering.renderBuildings).toHaveBeenCalledTimes(1);
    });

    it('throws away an answer for routes that changed while it was on its way', async () => {
      let answer!: (value: { buildings: unknown[] }) => void;
      deps.osm.loadBuildingsNearRoutes.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
      deps.uiStore.buildingsVisible.set(true);
      overlay.toggled();
      cachedPaths = new Map([['spawn-1', OTHER]]);
      answer({ buildings: ['old'] });
      await settle();
      expect(deps.buildingRendering.renderBuildings).not.toHaveBeenCalled();
    });

    it('stays as it is when nothing changed for the buildings', async () => {
      await show();
      overlay.routesChanged();
      expect(deps.buildingRendering.clear).not.toHaveBeenCalled();
      overlay.toggled();
      expect(deps.osm.loadBuildingsNearRoutes).toHaveBeenCalledTimes(1);
    });
  });
});
