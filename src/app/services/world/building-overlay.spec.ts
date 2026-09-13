import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { BuildingOverlay, type BuildingOverlayDeps } from './building-overlay';
import { STREET_FILTER_RADIUS } from '../../configs/map-constants.config';

/**
 * Building footprints are loaded from OSM on the first toggle-on, kept to
 * the ones near the routes, drawn again after tile loads and forgotten on
 * dispose.
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
        loadBuildings: vi.fn(async (_lat: number, _lon: number) => ({ buildings: ['near', 'far'] as unknown[] })),
        filterBuildingsNearRoutes: vi.fn((_buildings: unknown, _routes: unknown, _radius: number) => ['near']),
      },
      pathRoute: { getCachedPaths: vi.fn(() => cachedPaths) },
      buildingRendering: { renderBuildings: vi.fn(), toggleVisibility: vi.fn(), reset: vi.fn() },
      uiStore: { buildingsVisible: signal(false) },
      store: { baseCoords: signal({ ...HQ }), centerCoords: signal({ lat: 48.777, lon: 9.185, height: 400 }) },
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

    expect(deps.osm.loadBuildings).toHaveBeenCalledWith(48.777, 9.185);
    expect(deps.osm.filterBuildingsNearRoutes).toHaveBeenCalledWith(
      ['near', 'far'], [ROUTE.map(({ lat, lon }) => ({ lat, lon }))], STREET_FILTER_RADIUS,
    );
    expect(deps.buildingRendering.renderBuildings).toHaveBeenCalledWith(engine, ['near'], HQ, true);
    expect(deps.buildingRendering.toggleVisibility).not.toHaveBeenCalled();

    overlay.toggled();
    expect(deps.osm.loadBuildings).toHaveBeenCalledTimes(1);
    expect(deps.buildingRendering.toggleVisibility).toHaveBeenCalledTimes(1);
  });

  it('keeps every building without routes', async () => {
    cachedPaths = new Map();
    await show();
    expect(deps.osm.filterBuildingsNearRoutes).not.toHaveBeenCalled();
    expect(deps.buildingRendering.renderBuildings).toHaveBeenCalledWith(engine, ['near', 'far'], HQ, true);
  });

  it('only toggles while hidden and not loaded', () => {
    overlay.toggled();
    expect(deps.osm.loadBuildings).not.toHaveBeenCalled();
    expect(deps.buildingRendering.toggleVisibility).toHaveBeenCalledTimes(1);
  });

  it('loads nothing without an engine', async () => {
    currentEngine = null;
    await show();
    expect(deps.osm.loadBuildings).not.toHaveBeenCalled();
    expect(deps.buildingRendering.renderBuildings).not.toHaveBeenCalled();
  });

  it('logs a failed load and tries again on the next toggle', async () => {
    deps.osm.loadBuildings.mockRejectedValueOnce(new Error('Overpass down'));
    await show();
    expect(console.error).toHaveBeenCalledWith('[Buildings] Failed to load:', expect.any(Error));

    overlay.toggled();
    await settle();
    expect(deps.osm.loadBuildings).toHaveBeenCalledTimes(2);
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
    expect(deps.osm.loadBuildings).toHaveBeenCalledTimes(2);
  });
});
