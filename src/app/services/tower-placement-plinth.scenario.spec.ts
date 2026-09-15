/**
 * Playtest 314 (night 2026-09-14): the build preview over a spot too close to
 * the route, where the tower would get a plinth. The real
 * TowerPlacementService with its real placement rules, footprint probing and
 * TowerPlinthPreview; DevWorld terrain on a slope gives the footprint its
 * plinth (a roof gives it the same way, the rule is the height difference
 * under the footprint). Engine, grid, asset manager and LOS viz are fakes as
 * in tower-placement.service.spec.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';

const injectionRegistry: Record<string, unknown> = {};
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  return {
    ...actual,
    Injectable: () => (target: unknown) => target,
    effect: () => ({ destroy: () => undefined }),
    inject: (token: { name?: string }) => injectionRegistry[token?.name ?? ''],
  };
});
vi.mock('../utils/tower-los-viz', () => ({
  TowerLosViz: class {
    setFilterMode() { /* fake */ }
    addTo() { /* fake */ }
    updateTowerTip() { /* fake */ }
    tick() { /* fake */ }
    dispose() { /* fake */ }
  },
}));

import { TowerPlacementService } from './tower-placement.service';
import { TOWER_TYPES } from '../configs/tower-types.config';
import { PLACEMENT_CONFIG } from '../configs/placement.config';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT, haversineDistance } from '../utils/geo-utils';
import type { GeoPosition } from '../models/game.types';

describe('Build preview with a plinth on a spot too close to the route (playtest 314)', () => {
  const HQ = { lat: 48.0, lon: 9.0 };
  const M_PER_DEG_LON = METERS_PER_DEGREE_LAT * Math.cos(HQ.lat * DEG_TO_RAD);
  const at = (east: number, north: number) => ({
    lat: HQ.lat + north / METERS_PER_DEGREE_LAT,
    lon: HQ.lon + east / M_PER_DEG_LON,
  });
  const sync = {
    geoToLocalSimple: (lat: number, lon: number, height: number) => ({
      x: (lon - HQ.lon) * M_PER_DEG_LON,
      y: height,
      z: (lat - HQ.lat) * METERS_PER_DEGREE_LAT,
    }),
  };
  /** Ground rising 0.5 m per metre to the east, no buildings */
  const slope = (x: number) => 10 + x * 0.5;
  const bounds = { minLat: 47.99, maxLat: 48.02, minLon: 8.99, maxLon: 9.02 };
  /** Route straight down, 100 m east of the HQ */
  const route: GeoPosition[] = [at(100, 1000), at(100, 0)];
  /** 5 m from the route, closer than PLACEMENT_CONFIG.MIN_DISTANCE_TO_ROUTE */
  const NEAR_ROUTE = at(95, 300);
  /** 100 m from the route */
  const FREE = at(0, 300);

  let service: TowerPlacementService;
  let overlay: Group;
  let emit: ReturnType<typeof vi.fn>;

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const emissive = (mesh: Mesh) => (mesh.material as MeshStandardMaterial).emissive;
  const red = (mesh: Mesh) => emissive(mesh).r > emissive(mesh).g;
  const green = (mesh: Mesh) => emissive(mesh).g > emissive(mesh).r;
  const previewTower = () => (overlay.children[0] as Group).children[0] as Mesh;
  const plinth = () => overlay.children.find((child) => child.name === 'tower-plinth') as Mesh | undefined;

  beforeEach(async () => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    injectionRegistry['UIStore'] = {
      buildMode: signal(false),
      selectedTowerType: signal(null),
      buildValidationReason: signal<string | null>(null),
      perTowerLosFilter: signal('both'),
    };
    injectionRegistry['AssetManagerService'] = {
      loadModel: vi.fn(async () => ({})),
      cloneModel: vi.fn(() => {
        const model = new Group();
        model.add(new Mesh(new BoxGeometry(), new MeshStandardMaterial()));
        return model;
      }),
      releaseModel: vi.fn(),
    };
    injectionRegistry['GlobalRouteGridService'] = {
      isInitialized: vi.fn(() => true),
      getCellsInRange: vi.fn(() => [{}, {}]),
      getCellSize: () => 2,
      registerTower: vi.fn(() => []),
      registerTowerIncremental: vi.fn(() => []),
      unregisterTower: vi.fn(),
      rebuildAirRouteLayer: vi.fn(),
    };
    injectionRegistry['ResearchStore'] = { airTargetingUnlocked: signal(false) };
    injectionRegistry['TowerDefenseStore'] = {
      spawnPoints: signal([{ id: 'sp-1', name: 'Spawn', color: '#f00', ...route[0] }]),
    };
    injectionRegistry['PathAndRouteService'] = { getCachedPaths: () => new Map([['sp-1', route]]) };

    overlay = new Group();
    emit = vi.fn();
    const devTerrain = {
      raycastDown: vi.fn((x: number) => ({ y: slope(x) })),
      getHeightAtLocal: vi.fn((x: number) => slope(x)),
    };
    const engine = {
      sync,
      terrain: { raycastColumnSample: vi.fn(() => null) },
      getOverlayGroup: () => overlay,
      getScene: () => ({}),
      getDevTerrainProvider: () => devTerrain,
      getLosBlockerGroup: () => ({}),
      getTowerShadowMapper: () => ({
        invalidate: vi.fn(), update: vi.fn(), getRenderTarget: () => ({}),
        getReferencePos: () => new Vector3(), getFarDistance: () => 77, readFacesToCpu: vi.fn(() => []),
      }),
      towers: { showPreviewRange: vi.fn(), hidePreviewRange: vi.fn() },
    };
    const towerManager = {
      getAll: () => [], selectTower: vi.fn(), refreshSelectionViz: vi.fn(), onTowerUnregistered: vi.fn(),
    };

    service = new TowerPlacementService();
    service.initialize(
      engine as never,
      { streets: [{}], bounds } as never,
      { haversineDistance } as never,
      HQ,
      { towerManager, getEventBus: () => ({ emit }) } as never,
    );
    service.selectTowerType('cannon');
    await flush();
  });

  afterEach(() => {
    service.dispose();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('314: tints tower and plinth red, and a click places nothing', () => {
    const local = sync.geoToLocalSimple(NEAR_ROUTE.lat, NEAR_ROUTE.lon, 0);
    expect(100 - local.x).toBeLessThan(PLACEMENT_CONFIG.MIN_DISTANCE_TO_ROUTE);
    service.updatePreviewPosition(NEAR_ROUTE.lat, NEAR_ROUTE.lon, 5);

    expect(service.validationReason()).toBe('Too close to route');
    expect(red(previewTower())).toBe(true);
    const r = TOWER_TYPES.cannon.footprintRadius;
    expect(plinth()!.visible).toBe(true);
    expect(plinth()!.position.y).toBeCloseTo(slope(local.x - r));
    expect(red(plinth()!)).toBe(true);

    expect(service.handleBuildClick()).toBe(false);
    expect(emit).not.toHaveBeenCalled();
    expect(service.buildMode()).toBe(true);
  });

  it('314: both turn green on a free spot, where the click places the tower on its plinth', () => {
    service.updatePreviewPosition(NEAR_ROUTE.lat, NEAR_ROUTE.lon, 5);
    service.updatePreviewPosition(FREE.lat, FREE.lon, 5);

    expect(service.validationReason()).toBeNull();
    expect(green(previewTower())).toBe(true);
    expect(green(plinth()!)).toBe(true);

    expect(service.handleBuildClick()).toBe(true);
    expect(emit.mock.calls[0][0].plinthHeight).toBeGreaterThan(0);
  });
});
