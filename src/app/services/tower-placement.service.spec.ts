import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';

// Angular DI replaced by a registry: inject() hands out what the test put there.
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

// The GPU viz needs a renderer; the fake records what the service asks of it.
const losViz = vi.hoisted(() => ({
  instances: [] as {
    opts: Record<string, unknown>;
    filterMode: string | null;
    parent: unknown;
    tips: { x: number; y: number; z: number }[];
    ticks: number[];
    disposed: boolean;
  }[],
}));
vi.mock('../utils/tower-los-viz', () => ({
  TowerLosViz: class {
    filterMode: string | null = null;
    parent: unknown = null;
    tips: { x: number; y: number; z: number }[] = [];
    ticks: number[] = [];
    disposed = false;
    constructor(public opts: Record<string, unknown>) {
      losViz.instances.push(this);
    }
    setFilterMode(mode: string) { this.filterMode = mode; }
    addTo(scene: unknown) { this.parent = scene; }
    updateTowerTip(tip: { x: number; y: number; z: number }) { this.tips.push({ x: tip.x, y: tip.y, z: tip.z }); }
    tick(time: number) { this.ticks.push(time); }
    dispose() { this.disposed = true; }
  },
}));

import { TowerPlacementService } from './tower-placement.service';
import { Tower } from '../entities/tower.entity';
import { TOWER_TYPES, TowerTypeId } from '../configs/tower-types.config';
import { LOS_VIZ_CONFIG } from '../configs/los-viz.config';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT, haversineDistance } from '../utils/geo-utils';
import type { GeoPosition } from '../models/game.types';
import type { RouteCell } from '../utils/route-cell';
import { PLINTH_EMBED_M } from '../three-engine/renderers/tower-plinth/plinth-geometry';
import { footprintSampleOffsets } from '../utils/tower-footprint';
import { PLINTH_CONFIG } from '../configs/placement.config';

/**
 * Build mode, preview, click and grid registration of TowerPlacementService.
 * The placement rules are the real ones (tower-placement-rules.spec.ts and
 * tower-placement-checker.spec.ts cover them), the LOS refresh queue is
 * covered in tower-placement-los.spec.ts. Here the engine, the grid, the
 * asset manager and the LOS viz are fakes.
 */
describe('TowerPlacementService', () => {
  const HQ = { lat: 48.0, lon: 9.0 };
  const M_PER_DEG_LON = METERS_PER_DEGREE_LAT * Math.cos(HQ.lat * DEG_TO_RAD);
  /** Geo point `east` and `north` meters from the HQ. */
  const at = (east: number, north: number) => ({
    lat: HQ.lat + north / METERS_PER_DEGREE_LAT,
    lon: HQ.lon + east / M_PER_DEG_LON,
  });
  /** Local frame in meters around the HQ: x east, z north, y the given height. */
  const sync = {
    geoToLocalSimple: (lat: number, lon: number, height: number) => ({
      x: (lon - HQ.lon) * M_PER_DEG_LON,
      y: height,
      z: (lat - HQ.lat) * METERS_PER_DEGREE_LAT,
    }),
  };
  /** DevWorld terrain whose surface and ground both follow `height`: no buildings. */
  const devWorld = (height: (x: number) => number) => ({
    raycastDown: vi.fn((x: number): { y: number } | null => ({ y: height(x) })),
    getHeightAtLocal: vi.fn((x: number) => height(x)),
  });
  /** A tile column with nothing over its ground. */
  const column = (y: number) => ({ groundY: y, topY: y });

  const bounds = { minLat: 47.99, maxLat: 48.02, minLon: 8.99, maxLon: 9.02 };
  /** Spawn 1 km north, route straight down 100 m east of the HQ. */
  const spawn = at(100, 1000);
  const route: GeoPosition[] = [at(100, 1000), at(100, 0)];
  /** Clear of HQ, spawn and route. */
  const FREE = at(0, 300);
  /** 10 m from the HQ. */
  const NEAR_HQ = at(0, 10);

  let service: TowerPlacementService;
  let uiStore: {
    buildMode: ReturnType<typeof signal<boolean>>;
    selectedTowerType: ReturnType<typeof signal<TowerTypeId | null>>;
    buildValidationReason: ReturnType<typeof signal<string | null>>;
    perTowerLosFilter: ReturnType<typeof signal<'both' | 'ground' | 'air'>>;
  };
  let assets: {
    loadModel: ReturnType<typeof vi.fn>;
    cloneModel: ReturnType<typeof vi.fn>;
    releaseModel: ReturnType<typeof vi.fn>;
  };
  let grid: {
    isInitialized: ReturnType<typeof vi.fn>;
    getCellsInRange: ReturnType<typeof vi.fn>;
    getCellSize: () => number;
    registerTower: ReturnType<typeof vi.fn>;
    registerTowerIncremental: ReturnType<typeof vi.fn>;
    unregisterTower: ReturnType<typeof vi.fn>;
    rebuildAirRouteLayer: ReturnType<typeof vi.fn>;
  };
  let airTargetingUnlocked: ReturnType<typeof signal<boolean>>;
  let overlay: Group;
  let scene: object;
  let blockerGroup: object | null;
  let devTerrain: ReturnType<typeof devWorld> | null;
  let terrain: { raycastColumnSample: ReturnType<typeof vi.fn> };
  let mapper: {
    invalidate: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    getRenderTarget: () => object;
    getReferencePos: () => Vector3;
    getFarDistance: () => number;
    readFacesToCpu: ReturnType<typeof vi.fn>;
  };
  let engine: Record<string, unknown>;
  let towers: Tower[];
  let towerManager: {
    getAll: () => Tower[];
    selectTower: ReturnType<typeof vi.fn>;
    refreshSelectionViz: ReturnType<typeof vi.fn>;
    onTowerUnregistered: ReturnType<typeof vi.fn>;
  };
  let emit: ReturnType<typeof vi.fn>;
  let frames: Map<number, FrameRequestCallback>;
  let nextFrameId: number;
  let cancelFrame: ReturnType<typeof vi.fn>;

  /** Let the async preview-model load settle. */
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  /** Model the asset manager hands out: one mesh with a standard material. */
  const makeModel = () => {
    const model = new Group();
    model.add(new Mesh(new BoxGeometry(), new MeshStandardMaterial()));
    return model;
  };
  const materialOf = (model: Group) => (model.children[0] as Mesh).material as MeshStandardMaterial;
  /** The preview is the only thing the service puts into the overlay group. */
  const preview = () => overlay.children[0] as Group | undefined;

  const init = (streets: unknown[] = [{}]) =>
    service.initialize(
      engine as never,
      { streets, bounds } as never,
      { haversineDistance } as never,
      HQ,
      { towerManager, getEventBus: () => ({ emit }) } as never,
    );

  /** Enter build mode for `typeId` and wait for its preview model. */
  const enterBuild = async (typeId: TowerTypeId = 'archer') => {
    service.selectTowerType(typeId);
    await flush();
  };
  /** Height of the last hovered cursor surface, where the tiles show flat ground by default */
  let cursorY = 0;
  const hover = (p: { lat: number; lon: number }, height = 0) => {
    cursorY = height;
    service.updatePreviewPosition(p.lat, p.lon, height);
  };
  /** The footprint lines `__footprintDebug.watch()` logged, from a console.log spy. */
  const watchLines = (log: { mock: { calls: unknown[][] } }) =>
    log.mock.calls.map(([line]) => String(line)).filter((line) => line.includes(' rule='));

  beforeEach(() => {
    losViz.instances.length = 0;
    frames = new Map();
    nextFrameId = 1;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      frames.set(id, callback);
      return id;
    });
    cancelFrame = vi.fn((id: number) => frames.delete(id));
    vi.stubGlobal('cancelAnimationFrame', cancelFrame);

    uiStore = {
      buildMode: signal(false),
      selectedTowerType: signal<TowerTypeId | null>(null),
      buildValidationReason: signal<string | null>(null),
      perTowerLosFilter: signal<'both' | 'ground' | 'air'>('both'),
    };
    injectionRegistry['UIStore'] = uiStore;
    assets = {
      loadModel: vi.fn(async () => ({})),
      cloneModel: vi.fn(() => makeModel()),
      releaseModel: vi.fn(),
    };
    injectionRegistry['AssetManagerService'] = assets;
    grid = {
      isInitialized: vi.fn(() => true),
      getCellsInRange: vi.fn(() => [{} as RouteCell, {} as RouteCell]),
      getCellSize: () => 2,
      registerTower: vi.fn(() => [{ x: 1, z: 1 } as RouteCell]),
      registerTowerIncremental: vi.fn(() => []),
      unregisterTower: vi.fn(),
      rebuildAirRouteLayer: vi.fn(),
    };
    injectionRegistry['GlobalRouteGridService'] = grid;
    airTargetingUnlocked = signal(false);
    injectionRegistry['ResearchStore'] = { airTargetingUnlocked };
    injectionRegistry['TowerDefenseStore'] = {
      spawnPoints: signal([{ id: 'sp-1', name: 'Spawn', color: '#f00', ...spawn }]),
    };
    injectionRegistry['PathAndRouteService'] = { getCachedPaths: () => new Map([['sp-1', route]]) };

    overlay = new Group();
    scene = {};
    blockerGroup = {};
    devTerrain = null;
    // The tiles show flat ground at the cursor unless a test gives them something else.
    cursorY = 0;
    terrain = { raycastColumnSample: vi.fn(() => column(cursorY)) };
    const referencePos = new Vector3(1, 2, 3);
    mapper = {
      invalidate: vi.fn(),
      update: vi.fn(),
      getRenderTarget: () => ({}),
      getReferencePos: () => referencePos,
      getFarDistance: () => 77,
      readFacesToCpu: vi.fn(() => []),
    };
    engine = {
      sync,
      terrain,
      getOverlayGroup: () => overlay,
      getScene: () => scene,
      getDevTerrainProvider: () => devTerrain,
      getLosBlockerGroup: () => blockerGroup,
      getTowerShadowMapper: () => mapper,
      towers: { showPreviewRange: vi.fn(), hidePreviewRange: vi.fn() },
    };
    towers = [];
    towerManager = {
      getAll: () => [...towers],
      selectTower: vi.fn(),
      refreshSelectionViz: vi.fn(),
      onTowerUnregistered: vi.fn(),
    };
    emit = vi.fn();

    service = new TowerPlacementService();
  });

  afterEach(() => {
    service.dispose();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('build mode', () => {
    it('enters build mode for the chosen type and deselects the selected tower', () => {
      init();
      service.selectTowerType('cannon');

      expect(service.buildMode()).toBe(true);
      expect(service.selectedTowerType()).toBe('cannon');
      expect(towerManager.selectTower).toHaveBeenCalledWith(null);
    });

    it('puts a hidden, see-through preview of the model into the overlay', async () => {
      init();
      await enterBuild('archer');

      expect(assets.loadModel).toHaveBeenCalledWith(TOWER_TYPES.archer.modelUrl);
      expect(overlay.children).toHaveLength(1);
      const model = preview()!;
      expect(model.visible).toBe(false);
      expect(model.scale.x).toBeCloseTo(TOWER_TYPES.archer.scale);
      const material = materialOf(model);
      expect(material.transparent).toBe(true);
      expect(material.opacity).toBeCloseTo(0.7);
      expect(material.depthWrite).toBe(false);
    });

    it('swaps the preview when another type is chosen', async () => {
      init();
      await enterBuild('archer');
      const first = preview();
      await enterBuild('cannon');

      expect(overlay.children).toHaveLength(1);
      expect(preview()).not.toBe(first);
      expect(service.selectedTowerType()).toBe('cannon');
    });

    it('leaves build mode and takes everything down on exit', async () => {
      init();
      await enterBuild();
      hover(NEAR_HQ);
      service.startRotating();
      service.updateRotation(0.5);

      service.exitBuildMode();

      expect(service.buildMode()).toBe(false);
      expect(service.getRotation()).toBe(0);
      expect(service.validationReason()).toBeNull();
      expect(overlay.children).toHaveLength(0);
    });

    it('only ever leaves build mode through toggleBuildMode', async () => {
      init();
      service.toggleBuildMode();
      expect(service.buildMode()).toBe(false);

      await enterBuild();
      service.toggleBuildMode();
      expect(service.buildMode()).toBe(false);
      expect(overlay.children).toHaveLength(0);
    });

    it('stays in build mode without a preview when the model fails to load', async () => {
      init();
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      assets.loadModel.mockRejectedValueOnce(new Error('404'));

      await enterBuild();

      expect(error).toHaveBeenCalledWith(expect.stringContaining('Failed to load preview model'), expect.any(Error));
      expect(service.buildMode()).toBe(true);
      expect(overlay.children).toHaveLength(0);
    });

    it('stays in build mode without a preview when the model cannot be cloned', async () => {
      init();
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      assets.cloneModel.mockReturnValueOnce(null);

      await enterBuild();

      expect(error).toHaveBeenCalledWith(expect.stringContaining('Failed to clone model'));
      expect(overlay.children).toHaveLength(0);
      // Without a preview a click has no position to place at.
      hover(FREE);
      expect(service.handleBuildClick()).toBe(false);
    });

    it('does not load a preview before initialize', async () => {
      service.selectTowerType('archer');
      await flush();

      expect(service.buildMode()).toBe(true);
      expect(assets.loadModel).not.toHaveBeenCalled();
    });

    it('drops a model that finishes loading after a cancel', async () => {
      init();
      service.selectTowerType('archer');
      hover(FREE);
      service.exitBuildMode();
      await flush();

      expect(overlay.children).toHaveLength(0);
      await enterBuild('cannon');
      expect(overlay.children).toHaveLength(1);
    });

    it('does not carry the cursor of a cancelled build into the next one', async () => {
      init();
      service.selectTowerType('archer');
      hover(FREE);
      service.exitBuildMode();
      await enterBuild('cannon');

      expect(preview()!.visible).toBe(false);
      expect(service.handleBuildClick()).toBe(false);
    });

    it('keeps only the preview of the last choice when loads finish out of order', async () => {
      init();
      const pending: (() => void)[] = [];
      assets.loadModel.mockImplementation(() => new Promise<void>((resolve) => pending.push(resolve)));
      service.selectTowerType('archer');
      service.selectTowerType('cannon');
      hover(FREE);

      pending[1]();
      await flush();
      pending[0]();
      await flush();

      expect(overlay.children).toHaveLength(1);
      expect(assets.cloneModel).toHaveBeenCalledTimes(1);
      expect(assets.cloneModel).toHaveBeenCalledWith(TOWER_TYPES.cannon.modelUrl);
      expect(preview()!.visible).toBe(true);
    });
  });

  describe('preview position', () => {
    it('ignores the cursor before initialize', () => {
      expect(() => hover(FREE)).not.toThrow();
      expect(service.validationReason()).toBeNull();
    });

    it('applies a cursor position that arrived while the model was loading', async () => {
      init();
      service.selectTowerType('archer');
      hover(FREE, 12);
      expect(overlay.children).toHaveLength(0);

      await flush();

      const local = sync.geoToLocalSimple(FREE.lat, FREE.lon, 0);
      const model = preview()!;
      expect(model.visible).toBe(true);
      expect(model.position.x).toBeCloseTo(local.x);
      expect(model.position.y).toBeCloseTo(12 + TOWER_TYPES.archer.heightOffset);
      expect(model.position.z).toBeCloseTo(local.z);
    });

    it('tints a valid spot green and clears the reason', async () => {
      init();
      await enterBuild();
      hover(FREE);

      expect(service.validationReason()).toBeNull();
      const emissive = materialOf(preview()!).emissive;
      expect(emissive.g).toBeGreaterThan(emissive.r);
      expect(materialOf(preview()!).emissiveIntensity).toBeCloseTo(0.5);
    });

    it('tints an invalid spot red and reports the rule that failed', async () => {
      init();
      await enterBuild();
      hover(NEAR_HQ);

      expect(service.validationReason()).toBe('Too close to HQ');
      const emissive = materialOf(preview()!).emissive;
      expect(emissive.r).toBeGreaterThan(emissive.g);
      // Shown anyway, so the player sees where the red tower would go.
      expect(preview()!.visible).toBe(true);
    });

    it('reports why every spot is invalid when there are no streets', async () => {
      init([]);
      await enterBuild();
      hover(FREE);

      expect(service.validationReason()).toBe('No streets loaded');
    });

    it('follows a new street network from updateStreetNetwork', async () => {
      init();
      service.updateStreetNetwork({ streets: [], bounds } as never);

      expect(service.validateTowerPosition(FREE.lat, FREE.lon)).toEqual({
        valid: false, reason: 'No streets loaded',
      });
    });

    it('re-validates only after the cursor moved a meter', async () => {
      init();
      await enterBuild();
      const validate = vi.spyOn(service, 'validateTowerPosition');

      hover(FREE);
      hover(at(0, 300.4));
      expect(validate).toHaveBeenCalledTimes(1);

      hover(at(0, 10));
      expect(validate).toHaveBeenCalledTimes(2);
      expect(service.validationReason()).toBe('Too close to HQ');
    });

    it('turns the preview by the type base rotation plus the player rotation', async () => {
      init();
      await enterBuild('cannon');
      service.startRotating();
      service.updateRotation(0.25);
      hover(FREE);

      expect(preview()!.rotation.y).toBeCloseTo(TOWER_TYPES.cannon.rotationY! + Math.PI * 0.25);
    });

    it('stands the preview on the DevWorld surface below the cursor', async () => {
      devTerrain = devWorld(() => 42);
      init();
      await enterBuild();
      hover(FREE, 5);

      expect(preview()!.position.y).toBeCloseTo(42 + TOWER_TYPES.archer.heightOffset);
      const local = sync.geoToLocalSimple(FREE.lat, FREE.lon, 0);
      expect(devTerrain.raycastDown).toHaveBeenCalledWith(local.x, local.z, 10000);
    });

    it('hides the preview on request', async () => {
      init();
      await enterBuild();
      hover(FREE);
      service.hidePreview();

      expect(preview()!.visible).toBe(false);
    });

    it('shows the range ring of the tower to be built at its foot and hides it with the preview', async () => {
      devTerrain = devWorld(() => 42);
      init();
      await enterBuild('cannon');
      hover(FREE, 5);

      const local = sync.geoToLocalSimple(FREE.lat, FREE.lon, 0);
      const { showPreviewRange, hidePreviewRange } = engine['towers'] as Record<string, ReturnType<typeof vi.fn>>;
      expect(showPreviewRange).toHaveBeenLastCalledWith(local.x, 42, local.z, TOWER_TYPES.cannon.range);

      // Also where the tower may not stand
      hover(at(0, 10));
      expect(service.validationReason()).toBe('Too close to HQ');
      expect(showPreviewRange).toHaveBeenCalledTimes(2);

      hidePreviewRange.mockClear();
      service.hidePreview();
      expect(hidePreviewRange).toHaveBeenCalledTimes(1);
      service.exitBuildMode();
      expect(hidePreviewRange).toHaveBeenCalledTimes(2);
    });
  });

  describe('footprint on uneven ground', () => {
    /** Ground rising 0.5 m per metre to the east, 10 m high at the tower. */
    const slope = (x: number) => 10 + x * 0.5;

    it('stands the preview on the highest point of the footprint in DevWorld', async () => {
      devTerrain = devWorld(slope);
      init();
      await enterBuild('archer');
      hover(FREE, 5);

      const { footprintRadius, heightOffset, shootHeight } = TOWER_TYPES.archer;
      const foot = slope(footprintRadius);
      expect(preview()!.position.y).toBeCloseTo(foot + heightOffset);
      // The LOS preview starts at the raised foot as well.
      const tip = losViz.instances[0].opts['towerTip'] as Vector3;
      expect(tip.y).toBeCloseTo(foot + heightOffset + shootHeight);
      expect(terrain.raycastColumnSample).not.toHaveBeenCalled();
    });

    it('reads the tile column under each probe on the 3D tiles', async () => {
      terrain.raycastColumnSample.mockImplementation((x: number) => column(3 + x * 0.25));
      init();
      await enterBuild('cannon');
      hover(FREE, 3);

      const { footprintRadius, heightOffset } = TOWER_TYPES.cannon;
      expect(terrain.raycastColumnSample).toHaveBeenCalledTimes(19);
      expect(terrain.raycastColumnSample).toHaveBeenCalledWith(expect.any(Number), expect.any(Number), 'towerFootprint');
      expect(preview()!.position.y).toBeCloseTo(3 + footprintRadius * 0.25 + heightOffset);
    });

    it('places the tower at the raised foot with the plinth down to the lowest point', async () => {
      devTerrain = devWorld(slope);
      init();
      await enterBuild('archer');
      hover(FREE, 5);

      expect(service.handleBuildClick()).toBe(true);

      const r = TOWER_TYPES.archer.footprintRadius;
      const command = emit.mock.calls[0][0];
      expect(command.position.height).toBeCloseTo(slope(r));
      expect(command.plinthHeight).toBeCloseTo(slope(r) - slope(-r));
      // On the ground: nothing to brace
      expect(command.plinthOverhang).toEqual([]);
    });

    it('registers the LOS of such a tower from the top of its plinth', async () => {
      devTerrain = devWorld(slope);
      init();
      await enterBuild('archer');
      hover(FREE, 5);
      service.handleBuildClick();
      const { position, plinthHeight } = emit.mock.calls[0][0];
      const tower = new Tower(position, 'archer', 0, plinthHeight);

      service.registerTowerOnGrid(tower, position, 'archer');

      const { footprintRadius, heightOffset, shootHeight } = TOWER_TYPES.archer;
      const [tip] = mapper.update.mock.calls[0];
      expect(tip.y).toBeCloseTo(slope(footprintRadius) + heightOffset + shootHeight);
    });

    it('re-probes only after the cursor moved a meter', async () => {
      terrain.raycastColumnSample.mockImplementation((x: number) => column(3 + x * 0.25));
      init();
      await enterBuild('archer');
      hover(FREE, 3);
      hover(at(0, 300.4), 3);
      expect(terrain.raycastColumnSample).toHaveBeenCalledTimes(19);

      hover(at(0, 310), 3);
      expect(terrain.raycastColumnSample).toHaveBeenCalledTimes(38);
    });

    it('shows the plinth under the preview, down to the lowest point', async () => {
      devTerrain = devWorld(slope);
      init();
      await enterBuild('archer');
      hover(FREE, 5);

      const r = TOWER_TYPES.archer.footprintRadius;
      const plinth = overlay.children.find((child) => child.name === 'tower-plinth') as Mesh;
      const local = sync.geoToLocalSimple(FREE.lat, FREE.lon, 0);
      expect(plinth.visible).toBe(true);
      expect(plinth.position.x).toBeCloseTo(local.x);
      expect(plinth.position.y).toBeCloseTo(slope(-r));
      expect(plinth.position.z).toBeCloseTo(local.z);
      expect((plinth.material as MeshStandardMaterial).transparent).toBe(true);

      service.hidePreview();
      expect(plinth.visible).toBe(false);

      service.exitBuildMode();
      expect(overlay.children).toHaveLength(0);
    });

    it('keeps the cursor surface on even ground', async () => {
      terrain.raycastColumnSample.mockImplementation(() => column(3.05));
      init();
      await enterBuild('archer');
      hover(FREE, 3);
      service.handleBuildClick();

      expect(emit.mock.calls[0][0]).toMatchObject({ position: { height: 3 }, plinthHeight: 0 });
      expect(overlay.children.some((child) => child.name === 'tower-plinth')).toBe(false);
    });

    it('does not lift the tower onto a car parked beside it', async () => {
      const local = sync.geoToLocalSimple(FREE.lat, FREE.lon, 0);
      // 1.5 m high, 2.2 to 4.4 m east of the tower
      const onCar = (x: number, z: number) => x - local.x >= 2.2 && x - local.x <= 4.4 && Math.abs(z - local.z) <= 2.3;
      terrain.raycastColumnSample.mockImplementation((x: number, z: number) => column(onCar(x, z) ? 4.5 : 3));
      init();
      await enterBuild('archer');
      hover(FREE, 3);
      service.handleBuildClick();

      expect(emit.mock.calls[0][0]).toMatchObject({ position: { height: 3 }, plinthHeight: 0 });
    });

    it('on a roof, stands on its higher part with the plinth down to the lower', async () => {
      const local = sync.geoToLocalSimple(FREE.lat, FREE.lon, 0);
      // Flat roof at 20 m over a street at 5 m, 1.5 m higher from 1 m east of the tower on
      terrain.raycastColumnSample.mockImplementation((x: number) => ({ groundY: 5, topY: x - local.x > 1 ? 21.5 : 20 }));
      init();
      await enterBuild('archer');
      hover(FREE, 20);
      service.handleBuildClick();

      expect(emit.mock.calls[0][0]).toMatchObject({ position: { height: 21.5 }, plinthHeight: 1.5 });
      // Away from the roof's edge: nothing to brace
      expect(emit.mock.calls[0][0].plinthOverhang).toEqual([]);
    });

    it('at a roof edge above a deep street, braces the plinth over it, in the preview and in the command (E18)', async () => {
      const local = sync.geoToLocalSimple(FREE.lat, FREE.lon, 0);
      // Roof at 50 m, 1 m higher from 1 m west of the tower, its edge 2 m east of it; the street at 10 m
      terrain.raycastColumnSample.mockImplementation((x: number) => {
        const dx = x - local.x;
        return { groundY: 10, topY: dx > 2 ? 10 : dx < -1 ? 51 : 50 };
      });
      init();
      await enterBuild('archer');
      hover(FREE, 50);

      const plinth = overlay.children.find((child) => child.name === 'tower-plinth') as Mesh;
      plinth.geometry.computeBoundingBox();
      expect(plinth.geometry.boundingBox!.min.y).toBeLessThan(-PLINTH_EMBED_M - 0.9);

      service.handleBuildClick();
      const pastEdge = footprintSampleOffsets(TOWER_TYPES.archer.footprintRadius)
        .flatMap(([dx], index) => (dx > 2 ? [index] : []));
      expect(pastEdge.length).toBeGreaterThan(0);
      expect(emit.mock.calls[0][0]).toMatchObject({ position: { height: 51 }, plinthHeight: 1, plinthOverhang: pastEdge });
    });

    it('on a roof without ground under it, finds the roof by the street on both sides', async () => {
      const local = sync.geoToLocalSimple(FREE.lat, FREE.lon, 0);
      // Roof at 10 m, 2 m higher from 1 m east of the tower on; the building 16 m across, the street at 0 m
      terrain.raycastColumnSample.mockImplementation((x: number, z: number) => {
        const inside = Math.abs(x - local.x) < 8 && Math.abs(z - local.z) < 8;
        return column(inside ? (x - local.x > 1 ? 12 : 10) : 0);
      });
      init();
      await enterBuild('archer');
      hover(FREE, 10);
      service.handleBuildClick();

      expect(emit.mock.calls[0][0]).toMatchObject({ position: { height: 12 }, plinthHeight: 2 });
      // The footprint, and as roof and ground rule disagree, the eight probes around it
      expect(terrain.raycastColumnSample).toHaveBeenCalledTimes(19 + 8);
    });

    it('tells in the console how the last footprint was decided', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
      vi.spyOn(console, 'table').mockImplementation(() => undefined);
      const local = sync.geoToLocalSimple(FREE.lat, FREE.lon, 0);
      terrain.raycastColumnSample.mockImplementation((x: number) => ({ groundY: 5, topY: x - local.x > 1 ? 21.5 : 20 }));
      init();
      await enterBuild('archer');
      hover(FREE, 20);

      expect(window.__footprintDebug!()).toMatchObject({
        tower: 'archer',
        surfaceY: 20,
        centreGroundY: 5,
        centreTopY: 20,
        rule: 'roof-column',
        footY: 21.5,
        plinthHeight: 1.5,
        surroundingsGroundY: 'not probed',
      });
      service.dispose();
      expect(window.__footprintDebug).toBeUndefined();
    });

    describe('footprint watch', () => {
      /** Flat roof at 20 m over a street at 5 m, 1.5 m higher from 1 m east of the tower on */
      const steppedRoof = () => {
        const local = sync.geoToLocalSimple(FREE.lat, FREE.lon, 0);
        terrain.raycastColumnSample.mockImplementation((x: number) => ({ groundY: 5, topY: x - local.x > 1 ? 21.5 : 20 }));
      };

      it('logs one line once the cursor rests on a spot, and the next on the next spot', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        steppedRoof();
        init();
        await enterBuild('archer');
        window.__footprintDebug!.watch();
        hover(FREE, 20);
        service.tickBuildPreviewViz(10);
        service.tickBuildPreviewViz(10.2);
        expect(watchLines(log)).toEqual([]);

        service.tickBuildPreviewViz(10.4);
        service.tickBuildPreviewViz(11);
        expect(watchLines(log)).toEqual([
          '[Footprint] rest archer rule=roof-column centreGroundY=5 centreTopY=20 plinthHeight=1.5 overhang=0 '
            + `refusal=- footY=21.5 surfaceY=20 at ${FREE.lat.toFixed(6)},${FREE.lon.toFixed(6)}`,
        ]);

        const next = at(0, 310);
        hover(next, 20);
        service.tickBuildPreviewViz(11.1);
        service.tickBuildPreviewViz(11.5);
        expect(watchLines(log)).toHaveLength(2);
        expect(watchLines(log)[1]).toContain(`at ${next.lat.toFixed(6)},${next.lon.toFixed(6)}`);
      });

      it('stays quiet while the cursor sweeps on, and while off', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        terrain.raycastColumnSample.mockImplementation(() => column(3));
        init();
        await enterBuild('archer');
        for (let i = 0; i < 10; i++) {
          hover(at(0, 300 + 1.5 * i), 3);
          service.tickBuildPreviewViz(i);
        }
        service.tickBuildPreviewViz(10);
        service.handleBuildClick();
        expect(watchLines(log)).toEqual([]);

        window.__footprintDebug!.watch();
        await enterBuild('archer');
        for (let i = 0; i < 10; i++) {
          hover(at(0, 300 + 1.5 * i), 3);
          service.tickBuildPreviewViz(20 + i);
        }
        expect(watchLines(log)).toEqual([]);
      });

      it('logs each placement, and watch(false) stops it', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        steppedRoof();
        init();
        await enterBuild('archer');
        window.__footprintDebug!.watch();
        hover(FREE, 20);
        service.handleBuildClick();
        expect(emit).toHaveBeenCalledTimes(1);
        expect(watchLines(log)).toEqual([
          expect.stringMatching(/^\[Footprint\] placed archer rule=roof-column .*plinthHeight=1\.5 overhang=0 refusal=- footY=21\.5 /),
        ]);

        window.__footprintDebug!.watch(false);
        await enterBuild('archer');
        hover(at(0, 320), 20);
        service.tickBuildPreviewViz(0);
        service.tickBuildPreviewViz(1);
        service.handleBuildClick();
        expect(emit).toHaveBeenCalledTimes(2);
        expect(watchLines(log)).toHaveLength(1);
      });
    });

    describe('outer ring on level ground', () => {
      /** Archer: the centre and 6 inner probes, 12 on the outer ring */
      const INNER = 1 + 6;
      const OUTER = 12;
      const plinth = () => overlay.children.find((child) => child.name === 'tower-plinth');
      /** Flat roof at 20 m over a street at 5 m, its edge 3 m east of the tower: only the outer ring overhangs */
      const roofEdge = () => {
        const local = sync.geoToLocalSimple(FREE.lat, FREE.lon, 0);
        terrain.raycastColumnSample.mockImplementation((x: number) =>
          x - local.x > 3 ? column(5) : { groundY: 5, topY: 20 },
        );
      };

      it('probes only the centre and the inner ring while the cursor sweeps on', async () => {
        terrain.raycastColumnSample.mockImplementation(() => column(3));
        init();
        await enterBuild('archer');
        for (let i = 0; i < 10; i++) {
          hover(at(0, 300 + 1.5 * i), 3);
          service.tickBuildPreviewViz(i);
        }
        expect(terrain.raycastColumnSample).toHaveBeenCalledTimes(10 * INNER);

        // The cursor rests a frame: the outer ring of the last spot, once
        service.tickBuildPreviewViz(10);
        service.tickBuildPreviewViz(11);
        expect(terrain.raycastColumnSample).toHaveBeenCalledTimes(10 * INNER + OUTER);
      });

      it('shows the plinth once the cursor rests when only the outer ring hangs over the edge', async () => {
        roofEdge();
        init();
        await enterBuild('archer');
        hover(FREE, 20);
        service.tickBuildPreviewViz(0);
        expect(plinth()?.visible ?? false).toBe(false);

        service.tickBuildPreviewViz(1);
        expect(plinth()!.visible).toBe(true);
        // A slab on the roof, braced over the street 15 m below (C10)
        expect(plinth()!.position.y).toBeCloseTo(20 - PLINTH_CONFIG.MIN_BRACED_HEIGHT);
        expect(preview()!.position.y).toBeCloseTo(20 + TOWER_TYPES.archer.heightOffset);
      });

      it('places with the whole footprint when clicked before the cursor rested', async () => {
        roofEdge();
        init();
        await enterBuild('archer');
        hover(FREE, 20);
        service.handleBuildClick();

        const pastEdge = footprintSampleOffsets(TOWER_TYPES.archer.footprintRadius)
          .flatMap(([dx], index) => (dx > 3 ? [index] : []));
        expect(emit.mock.calls[0][0]).toMatchObject({
          position: { height: 20 },
          plinthHeight: PLINTH_CONFIG.MIN_BRACED_HEIGHT,
          plinthOverhang: pastEdge,
        });
      });

      it('lets the watch log the settled footprint, not the provisional one', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        roofEdge();
        init();
        await enterBuild('archer');
        window.__footprintDebug!.watch();
        hover(FREE, 20);
        service.tickBuildPreviewViz(0);
        // Settles the outer ring: a new note, the wait starts again
        service.tickBuildPreviewViz(0.1);
        service.tickBuildPreviewViz(0.35);
        expect(watchLines(log)).toEqual([]);

        service.tickBuildPreviewViz(0.5);
        expect(watchLines(log)).toHaveLength(1);
        expect(watchLines(log)[0]).toContain(`plinthHeight=${PLINTH_CONFIG.MIN_BRACED_HEIGHT} `);
        expect(watchLines(log)[0]).not.toContain('level-inner-ring');
      });
    });
  });

  describe('surface height', () => {
    it('returns the fallback without an engine or DevWorld terrain', () => {
      expect(service.getSurfaceHeightAt(FREE.lat, FREE.lon, 7)).toBe(7);
      init();
      expect(service.getSurfaceHeightAt(FREE.lat, FREE.lon, 7)).toBe(7);
    });

    it('returns the DevWorld hit, or the fallback where the ray hits nothing', () => {
      devTerrain = devWorld(() => 42);
      init();
      expect(service.getSurfaceHeightAt(FREE.lat, FREE.lon, 7)).toBe(42);

      devTerrain.raycastDown.mockReturnValue(null);
      expect(service.getSurfaceHeightAt(FREE.lat, FREE.lon, 7)).toBe(7);
    });
  });

  describe('LOS preview', () => {
    it('builds the viz for a valid spot from the cells in range at the tower tip', async () => {
      uiStore.perTowerLosFilter.set('ground');
      init();
      await enterBuild('archer');
      hover(FREE, 10);

      const local = sync.geoToLocalSimple(FREE.lat, FREE.lon, 0);
      const config = TOWER_TYPES.archer;
      expect(grid.getCellsInRange).toHaveBeenCalledWith(local.x, local.z, config.range);
      expect(losViz.instances).toHaveLength(1);
      const [viz] = losViz.instances;
      expect(viz.opts).toMatchObject({
        groundRange: config.range,
        airRange: config.range,
        canTargetGround: true,
        canTargetAir: true,
        gridCellSize: 2,
        shadowMapper: mapper,
        blockerGroup,
      });
      expect(viz.opts['cells']).toHaveLength(2);
      const tip = viz.opts['towerTip'] as Vector3;
      expect(tip.x).toBeCloseTo(local.x);
      expect(tip.y).toBeCloseTo(10 + config.heightOffset + config.shootHeight);
      expect(tip.z).toBeCloseTo(local.z);
      expect(viz.filterMode).toBe('ground');
      expect(viz.parent).toBe(scene);
    });

    it('asks for air only when the type can hit air', async () => {
      init();
      await enterBuild('cannon');
      hover(FREE);
      expect(losViz.instances[0].opts).toMatchObject({ canTargetGround: true, canTargetAir: false });

      await enterBuild('rocket');
      hover(FREE);
      expect(losViz.instances[1].opts).toMatchObject({ canTargetGround: false, canTargetAir: true });
    });

    it('moves only the tip for a small move and rebuilds after a larger one', async () => {
      init();
      await enterBuild();
      hover(FREE);
      hover(at(0.5, 300));
      expect(losViz.instances).toHaveLength(1);
      expect(losViz.instances[0].tips).toHaveLength(1);

      hover(at(0, 310));
      expect(losViz.instances).toHaveLength(2);
      expect(losViz.instances[0].disposed).toBe(true);
      expect(losViz.instances[1].disposed).toBe(false);
    });

    it('drops the viz when the cursor moves onto an invalid spot', async () => {
      init();
      await enterBuild();
      hover(FREE);
      hover(NEAR_HQ);

      expect(losViz.instances).toHaveLength(1);
      expect(losViz.instances[0].disposed).toBe(true);
    });

    it('builds nothing while the grid is not initialized', async () => {
      grid.isInitialized.mockReturnValue(false);
      init();
      await enterBuild();
      hover(FREE);

      expect(grid.getCellsInRange).not.toHaveBeenCalled();
      expect(losViz.instances).toHaveLength(0);
    });

    it('builds nothing without a blocker group or without cells in range', async () => {
      init();
      await enterBuild();
      blockerGroup = null;
      hover(FREE);
      expect(losViz.instances).toHaveLength(0);

      blockerGroup = {};
      grid.getCellsInRange.mockReturnValue([]);
      hover(at(0, 320));
      expect(losViz.instances).toHaveLength(0);
    });

    it('forwards the frame time to the viz', async () => {
      init();
      await enterBuild();
      service.tickBuildPreviewViz(1.5);
      hover(FREE);
      service.tickBuildPreviewViz(2.5);

      expect(losViz.instances[0].ticks).toEqual([2.5]);
    });

    it('disposes the viz on exit', async () => {
      init();
      await enterBuild();
      hover(FREE);
      service.exitBuildMode();

      expect(losViz.instances[0].disposed).toBe(true);
    });
  });

  describe('rotation', () => {
    it('turns at half a turn per second while R is held', async () => {
      init();
      await enterBuild('archer');
      service.startRotating();
      service.updateRotation(0.5);

      expect(service.getRotation()).toBeCloseTo(Math.PI / 2);
      expect(service.currentRotation()).toBeCloseTo(Math.PI / 2);
      expect(preview()!.rotation.y).toBeCloseTo(Math.PI / 2);

      service.stopRotating();
      service.updateRotation(0.5);
      expect(service.getRotation()).toBeCloseTo(Math.PI / 2);
    });

    it('does not turn outside build mode or without a preview', async () => {
      init();
      service.startRotating();
      service.updateRotation(1);
      expect(service.getRotation()).toBe(0);

      assets.cloneModel.mockReturnValueOnce(null);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await enterBuild();
      service.startRotating();
      service.updateRotation(1);
      expect(service.getRotation()).toBe(0);
    });

    it('forgets the held R on exit', async () => {
      init();
      await enterBuild();
      service.startRotating();
      service.exitBuildMode();
      await enterBuild();
      service.updateRotation(1);

      expect(service.getRotation()).toBe(0);
    });
  });

  describe('click', () => {
    it('asks the game state to place the tower and leaves build mode', async () => {
      devTerrain = devWorld(() => 42);
      init();
      await enterBuild('cannon');
      service.startRotating();
      service.updateRotation(0.25);
      hover(FREE, 5);

      expect(service.handleBuildClick()).toBe(true);

      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith({
        type: 'command:place-tower',
        position: { lat: FREE.lat, lon: FREE.lon, height: 42 },
        typeId: 'cannon',
        rotation: Math.PI * 0.25,
        plinthHeight: 0,
        plinthOverhang: [],
      });
      expect(service.buildMode()).toBe(false);
      expect(overlay.children).toHaveLength(0);
    });

    it('refuses an invalid spot and stays in build mode', async () => {
      init();
      await enterBuild();
      hover(NEAR_HQ);

      expect(service.handleBuildClick()).toBe(false);
      expect(emit).not.toHaveBeenCalled();
      expect(service.buildMode()).toBe(true);
    });

    it('checks the rules again on click, not the hover result', async () => {
      init();
      await enterBuild();
      hover(FREE);
      expect(service.validationReason()).toBeNull();

      // Another tower went up next to the spot between hover and click.
      towers.push(new Tower({ ...at(0, 303), height: 0 }, 'archer'));

      expect(service.handleBuildClick()).toBe(false);
      expect(emit).not.toHaveBeenCalled();
    });

    it('refuses a click before the cursor was over the map', async () => {
      init();
      await enterBuild();

      expect(service.handleBuildClick()).toBe(false);
      expect(emit).not.toHaveBeenCalled();
    });
  });

  describe('grid registration', () => {
    const placed = (typeId: TowerTypeId, p = FREE) => {
      const position = { ...p, height: 8 };
      return { position, tower: new Tower(position, typeId) };
    };

    it('renders the cubemap from the tip and registers the tower with its targeting', () => {
      init();
      const { tower, position } = placed('archer');
      const local = sync.geoToLocalSimple(position.lat, position.lon, position.height);
      const config = TOWER_TYPES.archer;

      service.registerTowerOnGrid(tower, position, 'archer');

      expect(mapper.invalidate).toHaveBeenCalled();
      expect(mapper.invalidate.mock.invocationCallOrder[0])
        .toBeLessThan(mapper.update.mock.invocationCallOrder[0]);
      const [tip, far, blockers] = mapper.update.mock.calls[0];
      expect(tip.x).toBeCloseTo(local.x);
      expect(tip.y).toBeCloseTo(8 + config.heightOffset + config.shootHeight);
      expect(tip.z).toBeCloseTo(local.z);
      expect(far).toBe(config.range);
      expect(blockers).toBe(blockerGroup);

      const [id, x, z, range, ctx, ground, air] = grid.registerTower.mock.calls[0];
      expect([id, range, ground, air]).toEqual([tower.id, config.range, true, true]);
      expect(x).toBeCloseTo(local.x);
      expect(z).toBeCloseTo(local.z);
      expect(ctx).toMatchObject({
        referencePos: mapper.getReferencePos(),
        farDistance: 77,
        visibilityBias: LOS_VIZ_CONFIG.visibilityBiasMeters,
        emptyDepthEpsilon: LOS_VIZ_CONFIG.emptyDepthEpsilon,
      });

      expect(tower.visibleCells).toEqual([{ x: 1, z: 1 }]);
      expect(tower.losReady).toBe(true);
    });

    it('reads the cube faces back only when the resolve asks for them', () => {
      init();
      const { tower, position } = placed('archer');
      service.registerTowerOnGrid(tower, position, 'archer');

      expect(mapper.readFacesToCpu).not.toHaveBeenCalled();
      const ctx = grid.registerTower.mock.calls[0][4] as { faces: unknown };
      void ctx.faces;
      expect(mapper.readFacesToCpu).toHaveBeenCalledTimes(1);
    });

    it('passes the targeting of ground-only, air-only and retrofitted types', () => {
      init();
      const flags = (typeId: TowerTypeId) => {
        grid.registerTower.mockClear();
        const { tower, position } = placed(typeId);
        service.registerTowerOnGrid(tower, position, typeId);
        return grid.registerTower.mock.calls[0].slice(5);
      };

      expect(flags('fire')).toEqual([true, false]);
      expect(flags('rocket')).toEqual([false, true]);
      expect(flags('dual-gatling')).toEqual([true, false]);
      airTargetingUnlocked.set(true);
      expect(flags('dual-gatling')).toEqual([true, true]);
    });

    it('refreshes the selection viz of a tower that is already selected', () => {
      init();
      const plain = placed('archer');
      service.registerTowerOnGrid(plain.tower, plain.position, 'archer');
      expect(towerManager.refreshSelectionViz).not.toHaveBeenCalled();

      const selected = placed('archer', at(0, 400));
      selected.tower.selected = true;
      service.registerTowerOnGrid(selected.tower, selected.position, 'archer');
      expect(towerManager.refreshSelectionViz).toHaveBeenCalledWith(selected.tower);
    });

    it('leaves the tower without LOS while the grid is not initialized', () => {
      init();
      grid.isInitialized.mockReturnValue(false);
      const { tower, position } = placed('archer');
      service.registerTowerOnGrid(tower, position, 'archer');

      expect(grid.registerTower).not.toHaveBeenCalled();
      expect(tower.losReady).toBe(false);
    });

    it('leaves the tower without LOS when there is no blocker group', () => {
      init();
      blockerGroup = null;
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { tower, position } = placed('archer');
      service.registerTowerOnGrid(tower, position, 'archer');

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('no LOS blocker group'));
      expect(grid.registerTower).not.toHaveBeenCalled();
      expect(tower.losReady).toBe(false);
    });

    it('unregisters a tower from the grid and the selection owner', () => {
      init();
      const { tower, position } = placed('archer');
      service.registerTowerOnGrid(tower, position, 'archer');

      service.unregisterTowerFromGrid(tower);

      expect(towerManager.onTowerUnregistered).toHaveBeenCalledWith(tower);
      expect(grid.unregisterTower).toHaveBeenCalledWith(tower.id);
      expect(tower.visibleCells).toEqual([]);
    });

    it('clears every tower handed to clearAllTowerOverlays', () => {
      init();
      const a = placed('archer').tower;
      const b = placed('cannon', at(0, 400)).tower;

      service.clearAllTowerOverlays([a, b]);

      expect(grid.unregisterTower.mock.calls.map(([id]) => id)).toEqual([a.id, b.id]);
    });
  });

  describe('dispose', () => {
    it('leaves build mode, unsubscribes and cancels a pending LOS refresh', async () => {
      init();
      await enterBuild();
      hover(FREE);
      service.scheduleLosRecompute(new Tower({ ...FREE, height: 0 }, 'archer'));
      const [pending] = [...frames.keys()];

      service.dispose();

      expect(service.buildMode()).toBe(false);
      expect(overlay.children).toHaveLength(0);
      expect(losViz.instances[0].disposed).toBe(true);
      expect(cancelFrame).toHaveBeenCalledWith(pending);
    });

    it('releases each loaded preview model once', async () => {
      init();
      await enterBuild('archer');
      await enterBuild('archer');
      await enterBuild('cannon');

      service.dispose();

      expect(assets.releaseModel.mock.calls.map(([url]) => url).sort()).toEqual(
        [TOWER_TYPES.archer.modelUrl, TOWER_TYPES.cannon.modelUrl].sort(),
      );
      service.dispose();
      expect(assets.releaseModel).toHaveBeenCalledTimes(2);
    });

    it('behaves as uninitialized afterwards', async () => {
      init();
      service.dispose();

      expect(service.validateTowerPosition(FREE.lat, FREE.lon)).toEqual({
        valid: false, reason: 'Service not initialized',
      });
      const { tower, position } = { position: { ...FREE, height: 0 }, tower: new Tower({ ...FREE, height: 0 }, 'archer') };
      service.registerTowerOnGrid(tower, position, 'archer');
      expect(grid.registerTower).not.toHaveBeenCalled();
      await enterBuild();
      hover(FREE);
      expect(service.handleBuildClick()).toBe(false);
    });
  });
});
