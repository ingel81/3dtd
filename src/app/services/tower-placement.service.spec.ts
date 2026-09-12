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
    isFbxModel: ReturnType<typeof vi.fn>;
    applyFbxMaterials: ReturnType<typeof vi.fn>;
    releaseModel: ReturnType<typeof vi.fn>;
  };
  let grid: {
    cellsChanged: ((changed: RouteCell[]) => void) | null;
    off: ReturnType<typeof vi.fn>;
    addCellsChangedListener: ReturnType<typeof vi.fn>;
    isInitialized: ReturnType<typeof vi.fn>;
    promoteUnsampledCellsInRadius: ReturnType<typeof vi.fn>;
    refineCellsInRadius: ReturnType<typeof vi.fn>;
    getCellsInRange: ReturnType<typeof vi.fn>;
    getCellSize: () => number;
    registerTower: ReturnType<typeof vi.fn>;
    registerTowerIncremental: ReturnType<typeof vi.fn>;
    unregisterTower: ReturnType<typeof vi.fn>;
    rebuildAirRouteLayer: ReturnType<typeof vi.fn>;
    isTerrainRefreshActive: () => boolean;
  };
  let airTargetingUnlocked: ReturnType<typeof signal<boolean>>;
  let overlay: Group;
  let scene: object;
  let blockerGroup: object | null;
  let devTerrain: { raycastDown: ReturnType<typeof vi.fn> } | null;
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
  const runFrames = () => {
    const due = [...frames.values()];
    frames.clear();
    for (const callback of due) callback(0);
  };

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
  const hover = (p: { lat: number; lon: number }, height = 0) =>
    service.updatePreviewPosition(p.lat, p.lon, height);

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
      isFbxModel: vi.fn(() => false),
      applyFbxMaterials: vi.fn(),
      releaseModel: vi.fn(),
    };
    injectionRegistry['AssetManagerService'] = assets;
    grid = {
      cellsChanged: null,
      off: vi.fn(),
      addCellsChangedListener: vi.fn((listener: (changed: RouteCell[]) => void) => {
        grid.cellsChanged = listener;
        return grid.off;
      }),
      isInitialized: vi.fn(() => true),
      promoteUnsampledCellsInRadius: vi.fn(),
      refineCellsInRadius: vi.fn(),
      getCellsInRange: vi.fn(() => [{} as RouteCell, {} as RouteCell]),
      getCellSize: () => 2,
      registerTower: vi.fn(() => [{ x: 1, z: 1 } as RouteCell]),
      registerTowerIncremental: vi.fn(() => []),
      unregisterTower: vi.fn(),
      rebuildAirRouteLayer: vi.fn(),
      isTerrainRefreshActive: () => false,
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
      getOverlayGroup: () => overlay,
      getScene: () => scene,
      getDevTerrainProvider: () => devTerrain,
      getLosBlockerGroup: () => blockerGroup,
      getTowerShadowMapper: () => mapper,
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

    it('applies the FBX materials only to FBX models', async () => {
      init();
      await enterBuild('archer');
      expect(assets.applyFbxMaterials).not.toHaveBeenCalled();

      assets.isFbxModel.mockReturnValue(true);
      await enterBuild('cannon');
      expect(assets.applyFbxMaterials).toHaveBeenCalledWith(preview());
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

    it('keeps a model that finishes loading after a cancel hidden until the next choice', async () => {
      init();
      service.selectTowerType('archer');
      hover(FREE);
      service.exitBuildMode();
      await flush();

      // Current behaviour: the late model lands in the overlay, hidden and
      // not positioned; the next selectTowerType or dispose removes it.
      expect(overlay.children).toHaveLength(1);
      expect(preview()!.visible).toBe(false);
      await enterBuild('cannon');
      expect(overlay.children).toHaveLength(1);
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
      devTerrain = { raycastDown: vi.fn(() => ({ y: 42 })) };
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
  });

  describe('surface height', () => {
    it('returns the fallback without an engine or DevWorld terrain', () => {
      expect(service.getSurfaceHeightAt(FREE.lat, FREE.lon, 7)).toBe(7);
      init();
      expect(service.getSurfaceHeightAt(FREE.lat, FREE.lon, 7)).toBe(7);
    });

    it('returns the DevWorld hit, or the fallback where the ray hits nothing', () => {
      devTerrain = { raycastDown: vi.fn(() => ({ y: 42 })) };
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
      expect(grid.promoteUnsampledCellsInRadius).toHaveBeenCalledWith(local.x, local.z, config.range);
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

      expect(grid.promoteUnsampledCellsInRadius).not.toHaveBeenCalled();
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
      devTerrain = { raycastDown: vi.fn(() => ({ y: 42 })) };
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

      expect(grid.refineCellsInRadius).toHaveBeenCalledWith(local.x, local.z, config.range);
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

  describe('cells changed by tile loads', () => {
    const cellAt = (east: number, north: number) => {
      const p = at(east, north);
      const local = sync.geoToLocalSimple(p.lat, p.lon, 0);
      return { x: local.x, z: local.z, towerVisibility: new Map(), airVisibility: new Map() } as unknown as RouteCell;
    };

    it('rebuilds the air-route tube once per frame, however many changes arrive', () => {
      init();
      grid.cellsChanged!([cellAt(0, 0)]);
      grid.cellsChanged!([cellAt(0, 2)]);
      expect(grid.rebuildAirRouteLayer).not.toHaveBeenCalled();

      runFrames();
      expect(grid.rebuildAirRouteLayer).toHaveBeenCalledTimes(1);
    });

    it('ignores an empty change list', () => {
      init();
      grid.cellsChanged!([]);
      expect(frames.size).toBe(0);
    });

    it('queues only registered towers whose range covers a changed cell', () => {
      init();
      const covering = new Tower({ ...at(0, 300), height: 0 }, 'archer');
      covering.losReady = true;
      const farAway = new Tower({ ...at(0, 600), height: 0 }, 'archer');
      farAway.losReady = true;
      const unregistered = new Tower({ ...at(0, 305), height: 0 }, 'archer');
      towers.push(covering, farAway, unregistered);
      const recompute = vi.spyOn(service, 'recomputeTowerLOS');

      grid.cellsChanged!([cellAt(0, 310)]);
      runFrames();
      runFrames();

      expect(recompute.mock.calls.map(([t]) => t)).toEqual([covering]);
    });

    it('drops the subscription of the previous location on initialize', () => {
      init();
      const first = grid.cellsChanged;
      init();

      expect(grid.off).toHaveBeenCalledTimes(1);
      expect(grid.addCellsChangedListener).toHaveBeenCalledTimes(2);
      expect(grid.cellsChanged).not.toBe(first);
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
      expect(grid.off).toHaveBeenCalledTimes(1);
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
