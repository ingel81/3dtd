/**
 * Playtest 12 to 17 (2026-09-16, C10): towers at roof edges and walls. The
 * real TowerPlacementService with its real placement rules, footprint
 * probing and TowerPlinthPreview on the 3D tiles (raycastColumnSample): a
 * high roof with its edge east of the cursor, a lower part of the building
 * below it, and a higher building to the west. Engine, grid, asset manager
 * and LOS viz are fakes as in tower-placement.service.spec.ts.
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
import { PLINTH_CONFIG } from '../configs/placement.config';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT, haversineDistance } from '../utils/geo-utils';
import { footprintSampleOffsets } from '../utils/tower-footprint';
import { plinthBraces } from '../three-engine/renderers/tower-plinth/plinth-braces';
import { PLINTH_EMBED_M } from '../three-engine/renderers/tower-plinth/plinth-geometry';

describe('Towers at roof edges and walls (playtest 12 to 17, C10)', () => {
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
  const bounds = { minLat: 47.99, maxLat: 48.02, minLon: 8.99, maxLon: 9.02 };
  const RADIUS = TOWER_TYPES.archer.footprintRadius;

  /** Roof at 120 m from x = 0 to its edge at x = 100, the street at 5 m */
  const ROOF = 120;
  const EDGE_X = 100;
  /** East of the edge a lower part of the building, 12 m down (playtest 12), up to x = 110 */
  const LOWER = 108;
  /** West of x = -100 a higher building, 30 m above the roof (playtest 13) */
  const WALL_X = -100;
  const surface = (x: number) => (x < WALL_X ? ROOF + 30 : x < EDGE_X ? ROOF : x < EDGE_X + 10 ? LOWER : 5);

  /** Cursor spots on the roof, north of the HQ, clear of every distance rule */
  const NORTH = 300;
  /** Only the outer ring past the edge (the inner ring reaches 1.56 m east) */
  const OUTER_PAST_EDGE = at(EDGE_X - 2.5, NORTH);
  /** The inner ring past the edge, the axis still on the roof (playtest 14) */
  const INNER_PAST_EDGE = at(EDGE_X - 1, NORTH);
  /** The inner ring in the wall of the higher building (playtest 13) */
  const INNER_IN_WALL = at(WALL_X + 1, NORTH);

  let service: TowerPlacementService;
  let overlay: Group;
  let emit: ReturnType<typeof vi.fn>;
  let columnSample: ReturnType<typeof vi.fn>;

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  const emissive = (mesh: Mesh) => (mesh.material as MeshStandardMaterial).emissive;
  const red = (mesh: Mesh) => emissive(mesh).r > emissive(mesh).g;
  const green = (mesh: Mesh) => emissive(mesh).g > emissive(mesh).r;
  const previewTower = () => (overlay.children[0] as Group).children[0] as Mesh;
  const plinth = () => overlay.children.find((child) => child.name === 'tower-plinth') as Mesh | undefined;
  const hover = (p: { lat: number; lon: number }) => service.updatePreviewPosition(p.lat, p.lon, ROOF);
  /** Footprint probes east of the edge for a tower at `p` */
  const pastEdge = (p: { lat: number; lon: number }) => {
    const x = sync.geoToLocalSimple(p.lat, p.lon, 0).x;
    return footprintSampleOffsets(RADIUS).flatMap(([dx], index) => (x + dx >= EDGE_X ? [index] : []));
  };

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
    injectionRegistry['TowerDefenseStore'] = { spawnPoints: signal([]) };
    injectionRegistry['PathAndRouteService'] = { getCachedPaths: () => new Map() };

    overlay = new Group();
    emit = vi.fn();
    columnSample = vi.fn((x: number) => ({ groundY: 5, topY: surface(x) }));
    const engine = {
      sync,
      terrain: { raycastColumnSample: columnSample },
      getOverlayGroup: () => overlay,
      getScene: () => ({}),
      getDevTerrainProvider: () => null,
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
    service.selectTowerType('archer');
    await flush();
  });

  afterEach(() => {
    service.dispose();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('14, 17: the axis next to the edge, the inner ring past it: red with the reason, a click places nothing', () => {
    hover(INNER_PAST_EDGE);

    expect(service.validationReason()).toBe('Too far over the edge');
    expect(red(previewTower())).toBe(true);
    expect(plinth()!.visible).toBe(true);
    expect(red(plinth()!)).toBe(true);

    expect(service.handleBuildClick()).toBe(false);
    expect(emit).not.toHaveBeenCalled();
    expect(service.buildMode()).toBe(true);
  });

  it('12, 16: only the outer ring past the edge: green, and once the cursor rests a slab braced over the lower part', () => {
    hover(OUTER_PAST_EDGE);
    // The inner ring lies level: the outer ring waits, the spot is valid already
    expect(service.validationReason()).toBeNull();
    expect(green(previewTower())).toBe(true);
    expect(plinth()?.visible ?? false).toBe(false);

    service.tickBuildPreviewViz(0);
    service.tickBuildPreviewViz(1);

    // Not 12 m down the facade to the lower part: a slab with braces under it
    expect(service.validationReason()).toBeNull();
    expect(green(previewTower())).toBe(true);
    const mesh = plinth()!;
    expect(mesh.visible).toBe(true);
    expect(green(mesh)).toBe(true);
    expect(mesh.position.y).toBeCloseTo(ROOF - PLINTH_CONFIG.MIN_BRACED_HEIGHT);
    mesh.geometry.computeBoundingBox();
    expect(mesh.geometry.boundingBox!.min.y).toBeLessThan(-PLINTH_EMBED_M - 0.9);

    expect(service.handleBuildClick()).toBe(true);
    const command = emit.mock.calls[0][0];
    expect(command).toMatchObject({
      position: { height: ROOF },
      plinthHeight: PLINTH_CONFIG.MIN_BRACED_HEIGHT,
      plinthOverhang: pastEdge(OUTER_PAST_EDGE),
    });
    expect(plinthBraces(RADIUS, command.plinthHeight, command.plinthOverhang).length).toBeGreaterThan(0);
  });

  it('a click before the cursor rested probes the outer ring and places the same slab', () => {
    hover(OUTER_PAST_EDGE);
    expect(service.handleBuildClick()).toBe(true);

    expect(emit.mock.calls[0][0]).toMatchObject({
      position: { height: ROOF },
      plinthHeight: PLINTH_CONFIG.MIN_BRACED_HEIGHT,
      plinthOverhang: pastEdge(OUTER_PAST_EDGE),
    });
  });

  it('13: the inner ring in the wall of a higher building: red with the reason, a click places nothing', () => {
    hover(INNER_IN_WALL);

    expect(service.validationReason()).toBe('Not enough room');
    expect(red(previewTower())).toBe(true);
    expect(service.handleBuildClick()).toBe(false);
    expect(emit).not.toHaveBeenCalled();
  });

  it('the bot gets the answers the preview gives: resolveFootprint, then the rules with it', async () => {
    const botSays = (p: { lat: number; lon: number }) => {
      const footprint = service.resolveFootprint(p.lat, p.lon, 'archer', ROOF);
      return { footprint, result: service.validateTowerPosition(p.lat, p.lon, footprint) };
    };

    const reasons: (string | null)[] = [];
    for (const spot of [INNER_PAST_EDGE, INNER_IN_WALL, OUTER_PAST_EDGE]) {
      service.selectTowerType('archer');
      await flush();
      hover(spot);
      service.tickBuildPreviewViz(0);
      service.tickBuildPreviewViz(1);
      const preview = service.validationReason();

      reasons.push(preview);
      expect(botSays(spot).result.reason ?? null).toBe(preview);
    }
    expect(reasons).toEqual(['Too far over the edge', 'Not enough room', null]);
    const braced = botSays(OUTER_PAST_EDGE).footprint;
    expect(braced).toMatchObject({ plinthHeight: PLINTH_CONFIG.MIN_BRACED_HEIGHT, overhang: pastEdge(OUTER_PAST_EDGE) });
  });
});
