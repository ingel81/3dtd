import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Injector, runInInjectionContext, signal } from '@angular/core';

// The coordinator pulls in the dialog and material modules, which are
// partially compiled and need the JIT compiler; they are not used here.
vi.mock('@angular/material/dialog', () => ({ MatDialog: class MatDialog {} }));
vi.mock('../../components/location-dialog/location-dialog.component', () => ({
  LocationDialogComponent: class LocationDialogComponent {},
}));

import { MapRelocationService, RelocationHost } from './map-relocation.service';
import { OsmStreetService } from '../location/osm-street.service';
import { MarkerVisualizationService, SpawnPoint } from '../world/marker-visualization.service';
import { PathAndRouteService } from '../world/path-route.service';
import { LocationManagementService } from '../location/location-management.service';
import { HeightUpdateService } from '../world/height-update.service';
import { RouteAnimationService } from '../world/route-animation.service';
import { StreetRenderingService } from '../world/street-rendering.service';
import { LocationChangeCoordinatorService } from '../location/location-change-coordinator.service';
import { MapPlacementService } from '../world/map-placement.service';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { SPAWN_COLORS } from '../../configs/map-constants.config';
import type { VizCallbacks } from './location-facade.service';

/**
 * The relocation flows against a fake host. The location facade spec runs
 * the same flows through the facade; these pin the host contract, in
 * particular a component that goes away in the middle of a move.
 */

const HQ = { lat: 48.7758, lon: 9.1829 };
const BOUNDS = { minLat: 48.7, maxLat: 48.9, minLon: 9.1, maxLon: 9.3 };
const INSIDE = { lat: 48.78, lon: 9.19 };
const OUTSIDE = { lat: 49.5, lon: 9.19 };
const OLD_SPAWN: SpawnPoint = { id: 'spawn-1', name: 'Old Spawn', lat: 48.79, lon: 9.2, color: SPAWN_COLORS[0] };

describe('MapRelocationService', () => {
  let relocation: MapRelocationService;
  let placementClick: { mode: 'hq' | 'spawn'; lat: number; lon: number } | null;
  let cachedPaths: Map<string, unknown[]>;
  let store: {
    baseCoords: ReturnType<typeof signal<{ lat: number; lon: number }>>;
    centerCoords: ReturnType<typeof signal<{ lat: number; lon: number; height: number }>>;
    spawnPoints: ReturnType<typeof signal<SpawnPoint[]>>;
  };
  let host: RelocationHost & Record<keyof RelocationHost, ReturnType<typeof vi.fn>>;
  let viz: Record<keyof VizCallbacks, ReturnType<typeof vi.fn>>;

  const engine = { getOverlayGroup: () => ({}), setOrigin: vi.fn() };
  const bridge = {
    getEngine: () => engine,
    getStreetNetwork: () => ({ streets: [{}], bounds: BOUNDS }),
    setStreetNetwork: vi.fn(),
    setStreetNetworkLocation: vi.fn(),
    setFilteredStreetNetwork: vi.fn(),
  };
  const gameState = { reset: vi.fn(), initialize: vi.fn(), initializeGlobalRouteGrid: vi.fn() };
  const osm = { loadStreets: vi.fn(), findRandomStreetPoint: vi.fn(), findPath: vi.fn(), haversineDistance: vi.fn() };
  const coordinator = { applyNewLocation: vi.fn(async () => undefined) };
  const mapPlacement = { handlePlacementClick: vi.fn(() => placementClick), updateDependencies: vi.fn() };
  const noop = () => ({ clearAllMarkers: vi.fn(), clearSpawnMarkers: vi.fn(), addBaseMarker: vi.fn() });

  const click = async (mode: 'hq' | 'spawn', at: { lat: number; lon: number }) => {
    placementClick = { mode, ...at };
    await relocation.applyPlacementClick(host);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    placementClick = null;
    cachedPaths = new Map([['spawn-1', [HQ, OLD_SPAWN]]]);
    osm.findPath.mockReturnValue([OLD_SPAWN, HQ]);
    osm.findRandomStreetPoint.mockReturnValue(null);
    osm.haversineDistance.mockReturnValue(5000);
    store = {
      baseCoords: signal({ ...HQ }),
      centerCoords: signal({ ...HQ, height: 400 }),
      spawnPoints: signal<SpawnPoint[]>([OLD_SPAWN]),
    };
    viz = {
      initializeTowerPlacement: vi.fn(),
      filterStreetNetworkToRoutes: vi.fn(),
      scheduleOverlayHeightUpdate: vi.fn(),
      initializeVisualizationServices: vi.fn(),
      reframeCameraWithRoutes: vi.fn(),
      renderStreets: vi.fn(),
      saveInitialCameraPosition: vi.fn(),
      fitCorridorToTiles: vi.fn(),
    };
    host = {
      context: vi.fn(() => ({ bridge, gameState })),
      vizCallbacks: vi.fn(() => viz),
      addSpawnPoint: vi.fn((id: string, name: string, lat: number, lon: number, color: number) =>
        store.spawnPoints.update((p) => [...p, { id, name, lat, lon, color }])),
      syncUrlWithLocation: vi.fn(),
    } as unknown as typeof host;

    const injector = Injector.create({
      providers: [
        { provide: OsmStreetService, useValue: osm },
        { provide: MarkerVisualizationService, useValue: noop() },
        { provide: PathAndRouteService, useValue: { clearAllRoutes: vi.fn(), clearCachedPaths: vi.fn(), getCachedPaths: () => cachedPaths } },
        { provide: LocationManagementService, useValue: { setLocation: vi.fn() } },
        { provide: HeightUpdateService, useValue: { stopHeightUpdates: vi.fn() } },
        { provide: RouteAnimationService, useValue: { stopAnimation: vi.fn(), startAnimation: vi.fn() } },
        { provide: StreetRenderingService, useValue: { dispose: vi.fn() } },
        { provide: LocationChangeCoordinatorService, useValue: coordinator },
        { provide: MapPlacementService, useValue: mapPlacement },
        { provide: TowerDefenseStore, useValue: store },
      ],
    });
    relocation = runInInjectionContext(injector, () => new MapRelocationService());
  });

  afterEach(() => vi.restoreAllMocks());

  it('does nothing when the placement service rejects the click', async () => {
    await relocation.applyPlacementClick(host);
    expect(host.context).not.toHaveBeenCalled();
    expect(gameState.reset).not.toHaveBeenCalled();
  });

  it('moves the HQ in place through the host, keeping a spawn that still has a route', async () => {
    await click('hq', INSIDE);

    expect(engine.setOrigin).toHaveBeenCalledWith(INSIDE.lat, INSIDE.lon);
    expect(host.addSpawnPoint).toHaveBeenCalledWith(OLD_SPAWN.id, OLD_SPAWN.name, OLD_SPAWN.lat, OLD_SPAWN.lon, OLD_SPAWN.color);
    expect(viz.initializeVisualizationServices).toHaveBeenCalled();
    expect(viz.initializeTowerPlacement).toHaveBeenCalled();
    expect(host.syncUrlWithLocation).toHaveBeenCalled();
    expect(gameState.initialize).toHaveBeenCalledWith(
      engine, INSIDE, [{ id: OLD_SPAWN.id, name: OLD_SPAWN.name, lat: OLD_SPAWN.lat, lon: OLD_SPAWN.lon }], cachedPaths,
    );
    expect(mapPlacement.updateDependencies).toHaveBeenCalled();
    expect(viz.fitCorridorToTiles).toHaveBeenCalledTimes(1);
    expect(coordinator.applyNewLocation).not.toHaveBeenCalled();
  });

  it('turns an HQ outside the streets into a full change, with a spawn from the new streets', async () => {
    const loaded = { streets: [{}], bounds: BOUNDS };
    osm.loadStreets.mockResolvedValue(loaded);
    osm.findRandomStreetPoint.mockReturnValue({ lat: 49.505, lon: 9.2, streetName: 'Hauptstraße' });

    await click('hq', OUTSIDE);

    expect(bridge.setStreetNetwork).toHaveBeenCalledWith(loaded);
    expect(bridge.setStreetNetworkLocation).toHaveBeenCalledWith(OUTSIDE);
    expect(coordinator.applyNewLocation).toHaveBeenCalledWith({
      hq: { ...OUTSIDE, name: 'Loading...' },
      spawn: { lat: 49.505, lon: 9.2, name: 'Hauptstraße' },
    });
    expect(gameState.reset).not.toHaveBeenCalled();
  });

  it('does not hand the new streets to a component that went away during the load', async () => {
    let finish!: (network: unknown) => void;
    osm.loadStreets.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));

    const moving = click('hq', OUTSIDE);
    host.context.mockReturnValue(null);
    finish({ streets: [], bounds: BOUNDS });
    await moving;

    expect(bridge.setStreetNetwork).not.toHaveBeenCalled();
    // The coordinator has no engine by then and refuses on its own.
    expect(coordinator.applyNewLocation).toHaveBeenCalled();
  });

  it('replaces the spawn in place when it has a route to the HQ, and refuses one without', async () => {
    await click('spawn', INSIDE);
    expect(host.addSpawnPoint).toHaveBeenCalledWith('spawn-1', 'Spawn', INSIDE.lat, INSIDE.lon, SPAWN_COLORS[0]);
    expect(gameState.reset).toHaveBeenCalledTimes(1);
    expect(viz.fitCorridorToTiles).toHaveBeenCalledTimes(1);

    osm.findPath.mockReturnValue(null);
    await click('spawn', INSIDE);
    expect(gameState.reset).toHaveBeenCalledTimes(1);
  });

  it('moves nothing without a component, and nothing in place without the viz callbacks', async () => {
    host.context.mockReturnValue(null);
    await click('hq', INSIDE);
    await click('spawn', INSIDE);

    host.context.mockReturnValue({ bridge, gameState });
    host.vizCallbacks.mockReturnValue(null);
    await click('hq', INSIDE);

    expect(gameState.reset).not.toHaveBeenCalled();
    expect(engine.setOrigin).not.toHaveBeenCalled();
    expect(coordinator.applyNewLocation).not.toHaveBeenCalled();
  });
});
