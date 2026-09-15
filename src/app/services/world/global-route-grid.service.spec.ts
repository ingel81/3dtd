import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Scene } from 'three';

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

// Stand-in for the cubemap: a wall at 10 m, so a cell's visibility follows
// its height (same fake as in global-route-grid.spec.ts).
vi.mock('../../utils/gpu-cube-resolve', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isCubeVisible: (...args: number[]) => args[4] < 10,
}));

// The tube builder walks the route polylines into shader meshes; the service
// only owns its lifecycle. The dispose fake detaches like the real one.
const tubes = vi.hoisted(() => ({ build: vi.fn(), dispose: vi.fn() }));
vi.mock('../../utils/route-altitude-tubes', () => ({
  buildRouteAltitudeTubes: tubes.build,
  disposeRouteAltitudeTubes: tubes.dispose,
}));

import { GlobalRouteGridService } from './global-route-grid.service';
import { UIStore } from '../../store/ui.store';
import type { ColumnSample } from '../../three-engine/column-sample';
import type { Enemy } from '../../entities/enemy.entity';
import type { GeoPosition } from '../../models/game.types';

/**
 * The service wraps GlobalRouteGrid (covered in utils/global-route-grid.spec.ts)
 * and owns the debug overlays, the air-route tube and the defense-reach
 * marker. The grid underneath is real; the cubemap and the tube geometry are
 * fakes.
 */
describe('GlobalRouteGridService', () => {
  /** Fake space as in global-route-grid.spec.ts: lon is x, lat is z, height is y. */
  const sync = {
    geoToLocalSimple: (lat: number, lon: number, height: number) => ({ x: lon, y: height, z: lat }),
    geoToLocalSimpleInto: (lat: number, lon: number, height: number, out: { x: number; y: number; z: number }) => {
      out.x = lon;
      out.y = height;
      out.z = lat;
      return out;
    },
  };
  /** Straight route along +x, 40 m long, a waypoint every 20 m. */
  const route: GeoPosition[] = [
    { lat: 0, lon: 0, height: 0 },
    { lat: 0, lon: 20, height: 0 },
    { lat: 0, lon: 40, height: 0 },
  ];

  let service: GlobalRouteGridService;
  let uiStore: UIStore;
  let column: ColumnSample;
  let scene: Scene;

  /** Ground below the 10 m wall: tower answers come back visible. */
  const openGround = () => { column = { groundY: 3, topY: 40, tileDepth: 21, tileGeometricError: 2 }; };
  /** Ground above the wall: tower answers come back blocked. */
  const walledGround = () => { column = { groundY: 50, topY: 60, tileDepth: 21, tileGeometricError: 2 }; };

  const init = () => {
    service.initialize((() => column) as never, sync as never);
    service.generateFromRoutes([route]);
  };
  /** Register a tower at (x, 0) that sees the cells within `range`. */
  const tower = (id: string, x: number, range: number) =>
    service.registerTower(id, x, 0, range, { referencePos: { x, y: 20, z: 0 } } as never);
  const enemy = (id: string, x: number, z: number, alive = true) =>
    ({ id, alive, position: { lat: z, lon: x } }) as unknown as Enemy;

  beforeEach(() => {
    localStorage.clear();
    tubes.build.mockReset().mockImplementation(() => new Group());
    tubes.dispose.mockReset().mockImplementation((group: Group) => group.removeFromParent());
    uiStore = new UIStore();
    injectionRegistry['UIStore'] = uiStore;
    openGround();
    scene = new Scene();
    service = new GlobalRouteGridService();
  });

  afterEach(() => {
    service.dispose();
    delete (globalThis as Record<string, unknown>)['__rg'];
    vi.restoreAllMocks();
  });

  describe('lifecycle', () => {
    it('is initialized from initialize until clear or dispose', () => {
      expect(service.isInitialized()).toBe(false);
      init();
      expect(service.isInitialized()).toBe(true);
      service.clear();
      expect(service.isInitialized()).toBe(false);

      init();
      service.dispose();
      expect(service.isInitialized()).toBe(false);
    });

    it('publishes the __rg diagnostics for the grid it wraps', () => {
      init();
      const rg = (globalThis as Record<string, unknown>)['__rg'] as Record<string, unknown>;

      expect(rg['grid']).toBe(service.getGrid());
      expect(rg['dumpStats']).toBeTypeOf('function');
      expect(rg['dumpCellsInBox']).toBeTypeOf('function');
      expect(rg['resetHeightsAndRetry']).toBeTypeOf('function');
    });

    it('empties the grid on clear but keeps the coordinate sync; dispose drops it', () => {
      init();
      service.updateEnemyPosition(enemy('e1', 5, 0), 5, 0);
      expect(service.getStats().totalCells).toBeGreaterThan(0);

      service.clear();
      expect(service.getStats()).toEqual({ totalCells: 0, trackedEnemies: 0, occupiedCells: 0 });
      expect(service.getCoordinateSync()).toBe(sync);

      service.dispose();
      expect(service.getCoordinateSync()).toBeNull();
    });
  });

  describe('enemies and towers', () => {
    it('tracks an enemy and finds it by local and geo radius until removed', () => {
      init();
      const e1 = enemy('e1', 5, 0);
      const e2 = enemy('e2', 7, 0);
      service.updateEnemyPosition(e1, 5, 0);
      service.updateEnemyPosition(e2, 7, 0);

      expect(service.getStats()).toMatchObject({ trackedEnemies: 2 });
      expect(service.getEnemiesInRadius(5, 0, 1)).toEqual([e1]);
      expect(service.getEnemiesInRadiusGeo({ lat: 0, lon: 6 }, 3).sort((a, b) => a.id.localeCompare(b.id)))
        .toEqual([e1, e2]);
      expect(service.getEnemiesInRadiusGeo({ lat: 0, lon: 6 }, 3, 'e1')).toEqual([e2]);

      service.removeEnemy(e1);
      expect(service.getEnemiesInRadius(5, 0, 1)).toEqual([]);
      expect(service.getStats()).toMatchObject({ trackedEnemies: 1 });
    });

    it('hands a tower the alive enemies in the cells it sees', () => {
      init();
      const visible = tower('t1', 5, 3);
      const alive = enemy('e1', 5, 0);
      const dead = enemy('e2', 5, 0, false);
      service.updateEnemyPosition(alive, 5, 0);
      service.updateEnemyPosition(dead, 5, 0);

      expect(service.getEnemiesForTower(visible)).toEqual([alive]);
    });

    it('answers LOS inside the grid and nothing outside it until the tower is gone', () => {
      init();
      tower('t1', 5, 3);

      expect(service.isPositionVisibleFromTower('t1', 5, 0)).toBe(true);
      expect(service.isPositionVisibleFromTower('t1', 5, 100)).toBeUndefined();

      service.unregisterTower('t1');
      expect(service.isPositionVisibleFromTower('t1', 5, 0)).toBeUndefined();
    });
  });

  describe('defense reach', () => {
    it('is 0 before initialize', () => {
      expect(service.getDefenseReachPercent([route])).toBe(0);
    });

    it('is 0 without a usable route', () => {
      init();
      tower('t1', 20, 3);
      expect(service.getDefenseReachPercent([])).toBe(0);
      expect(service.getDefenseReachPercent([[route[0]]])).toBe(0);
      expect(service.getDefenseReachPercent([[route[1], route[1]]])).toBe(0);
    });

    it('is the share of the path up to the last waypoint a tower sees', () => {
      init();
      tower('t1', 20, 3);
      expect(service.getDefenseReachPercent([route])).toBeCloseTo(0.5);

      tower('t2', 40, 3);
      expect(service.getDefenseReachPercent([route])).toBeCloseTo(1);
    });

    it('does not count a tower whose view is blocked', () => {
      walledGround();
      init();
      tower('t1', 20, 3);

      expect(service.getDefenseReachPercent([route])).toBe(0);
    });

    it('marks the reach 3 m above that waypoint and hides the marker when it is gone', () => {
      init();
      service.initDebugViz(scene);
      tower('t1', 20, 3);
      service.getDefenseReachPercent([route]);

      const markers = scene.children.filter((c) => c instanceof Mesh);
      expect(markers).toHaveLength(1);
      const [marker] = markers;
      expect(marker.visible).toBe(true);
      expect(marker.position.toArray()).toEqual([20, 3, 0]);

      service.unregisterTower('t1');
      expect(service.getDefenseReachPercent([route])).toBe(0);
      expect(marker.visible).toBe(false);
      expect(scene.children).toContain(marker);
    });

    it('still reports the reach without a debug scene', () => {
      init();
      tower('t1', 20, 3);

      expect(service.getDefenseReachPercent([route])).toBeCloseTo(0.5);
      expect(scene.children).toHaveLength(0);
    });
  });

  describe('spatial grid debug', () => {
    it('adds the cell mesh on first show, then only toggles its visibility', () => {
      init();
      service.initDebugViz(scene);

      service.toggleSpatialGridDebug();
      expect(uiStore.spatialGridDebugVisible()).toBe(true);
      expect(scene.children).toHaveLength(1);
      const mesh = scene.children[0];
      expect(mesh.visible).toBe(true);
      expect(service.isSpatialGridVizVisible()).toBe(true);

      service.toggleSpatialGridDebug();
      expect(mesh.visible).toBe(false);
      expect(scene.children).toEqual([mesh]);
      expect(service.isSpatialGridVizVisible()).toBe(false);

      service.toggleSpatialGridDebug();
      expect(scene.children).toEqual([mesh]);
      expect(mesh.visible).toBe(true);
    });

    it('only flips the store without a scene or before initialize', () => {
      init();
      service.toggleSpatialGridDebug();
      expect(uiStore.spatialGridDebugVisible()).toBe(true);
      expect(service.isSpatialGridVizVisible()).toBe(false);

      service.clear();
      service.initDebugViz(scene);
      service.updateSpatialGridVisualization();
      expect(scene.children).toHaveLength(0);
    });

    it('restores a persisted overlay, and nothing when it was off', () => {
      init();
      service.initDebugViz(scene);
      service.initSpatialGridVisualizationIfEnabled();
      expect(scene.children).toHaveLength(0);

      uiStore.spatialGridDebugVisible.set(true);
      service.initSpatialGridVisualizationIfEnabled();
      expect(scene.children).toHaveLength(1);
      expect(scene.children[0].visible).toBe(true);
    });

    it('builds a fresh mesh after cleanup', () => {
      init();
      service.initDebugViz(scene);
      service.toggleSpatialGridDebug();
      const first = scene.children[0];

      service.cleanupSpatialGridVisualization();
      expect(scene.children).toHaveLength(0);
      expect(service.isSpatialGridVizVisible()).toBe(false);

      service.updateSpatialGridVisualization();
      expect(scene.children).toHaveLength(1);
      expect(scene.children[0]).not.toBe(first);
    });
  });

  describe('air cell debug', () => {
    it('keeps its own mesh with the same show, hide and cleanup lifecycle', () => {
      init();
      service.initDebugViz(scene);
      service.toggleSpatialGridDebug();
      const ground = scene.children[0];

      service.toggleAirSpatialGridDebug();
      expect(uiStore.airSpatialGridDebugVisible()).toBe(true);
      expect(scene.children).toHaveLength(2);
      const air = scene.children.find((c) => c !== ground)!;
      expect(air.visible).toBe(true);
      expect(service.isAirSpatialGridVizVisible()).toBe(true);

      service.toggleAirSpatialGridDebug();
      expect(air.visible).toBe(false);
      expect(ground.visible).toBe(true);
      expect(service.isAirSpatialGridVizVisible()).toBe(false);

      service.cleanupAirSpatialGridVisualization();
      expect(scene.children).toEqual([ground]);
    });

    it('restores a persisted air overlay', () => {
      init();
      service.initDebugViz(scene);
      uiStore.airSpatialGridDebugVisible.set(true);
      service.initAirSpatialGridVisualizationIfEnabled();

      expect(scene.children).toHaveLength(1);
      expect(service.isAirSpatialGridVizVisible()).toBe(true);
    });
  });

  describe('air-route tube', () => {
    const tubeInScene = () => scene.children.filter((c) => c instanceof Group);

    it('builds the tube once and toggles its visibility', () => {
      init();
      service.initDebugViz(scene);

      service.toggleAirRouteLayer();
      expect(uiStore.airRouteVisible()).toBe(true);
      expect(tubes.build).toHaveBeenCalledWith(service.getGrid());
      const [tube] = tubeInScene();
      expect(tube.visible).toBe(true);

      service.toggleAirRouteLayer();
      expect(tube.visible).toBe(false);
      expect(tubes.dispose).not.toHaveBeenCalled();

      service.toggleAirRouteLayer();
      expect(tube.visible).toBe(true);
      expect(tubes.build).toHaveBeenCalledTimes(1);
    });

    it('only flips the store without a scene', () => {
      init();
      service.toggleAirRouteLayer();

      expect(uiStore.airRouteVisible()).toBe(true);
      expect(tubes.build).not.toHaveBeenCalled();
    });

    it('rebuilds a shown tube when the routes change', () => {
      init();
      service.initDebugViz(scene);
      service.toggleAirRouteLayer();
      const [old] = tubeInScene();

      service.generateFromRoutes([route]);

      expect(tubes.dispose).toHaveBeenCalledWith(old);
      expect(tubes.build).toHaveBeenCalledTimes(2);
      const [fresh] = tubeInScene();
      expect(fresh).not.toBe(old);
      expect(fresh.visible).toBe(true);
      expect(tubeInScene()).toHaveLength(1);
    });

    it('drops a hidden tube on rebuild and builds it again on the next show', () => {
      init();
      service.initDebugViz(scene);
      service.toggleAirRouteLayer();
      service.toggleAirRouteLayer();

      service.rebuildAirRouteLayer();
      expect(tubes.dispose).toHaveBeenCalledTimes(1);
      expect(tubes.build).toHaveBeenCalledTimes(1);
      expect(tubeInScene()).toHaveLength(0);

      service.toggleAirRouteLayer();
      expect(tubes.build).toHaveBeenCalledTimes(2);
      expect(tubeInScene()).toHaveLength(1);
    });

    it('does nothing on route changes or rebuilds while no tube exists', () => {
      init();
      service.initDebugViz(scene);
      service.generateFromRoutes([route]);
      service.rebuildAirRouteLayer();

      expect(tubes.build).not.toHaveBeenCalled();
      expect(tubes.dispose).not.toHaveBeenCalled();
    });

    it('restores a persisted tube', () => {
      init();
      service.initDebugViz(scene);
      service.initAirRouteLayerIfEnabled();
      expect(tubes.build).not.toHaveBeenCalled();

      uiStore.airRouteVisible.set(true);
      service.initAirRouteLayerIfEnabled();
      expect(tubeInScene()).toHaveLength(1);
    });
  });

  describe('cell report selection', () => {
    const frames = () => scene.children.find((c) => c.name === 'cell-report-selection');
    const framesAt = () => {
      const mesh = frames()!.children[0] as InstancedMesh;
      const m = new Matrix4();
      return Array.from({ length: mesh.count }, (_, i) => {
        mesh.getMatrixAt(i, m);
        // To the millimetre: the instance matrices are float32
        return [m.elements[12], m.elements[13], m.elements[14]].map((v) => Math.round(v * 1000) / 1000);
      });
    };

    it('frames a cell on its ground and a spot without a cell at its own height', () => {
      init();
      service.initDebugViz(scene);

      service.showCellSelection([{ x: 5, y: 99, z: 1 }, { x: 101, y: 7, z: 101 }]);

      // Ground at 3 m, the frames 5 cm above like the overlay plates
      expect(framesAt()).toEqual([[5, 3.05, 1], [101, 7.05, 101]]);
      expect(service.isSpatialGridVizVisible()).toBe(false);
    });

    it('takes the frames down for an empty selection, on clear and without a scene', () => {
      init();
      service.showCellSelection([{ x: 5, y: 0, z: 1 }]);
      expect(scene.children).toHaveLength(0);

      service.initDebugViz(scene);
      service.showCellSelection([{ x: 5, y: 0, z: 1 }]);
      service.showCellSelection([]);
      expect(frames()).toBeUndefined();

      service.showCellSelection([{ x: 5, y: 0, z: 1 }]);
      service.clear();
      expect(frames()).toBeUndefined();
    });
  });

  describe('clear and dispose', () => {
    /** Every overlay up: ground cells, air cells, tube and the reach marker. */
    const showEverything = () => {
      init();
      service.initDebugViz(scene);
      service.toggleSpatialGridDebug();
      service.toggleAirSpatialGridDebug();
      service.toggleAirRouteLayer();
      tower('t1', 20, 3);
      service.getDefenseReachPercent([route]);
      expect(scene.children).toHaveLength(4);
      return scene.children.find((c) => c instanceof Mesh && !('isInstancedMesh' in c))! as Mesh;
    };

    it('takes the overlays down on clear and keeps the marker hidden in the scene', () => {
      const marker = showEverything();

      service.clear();

      expect(scene.children).toEqual([marker]);
      expect(marker.visible).toBe(false);
      expect(tubes.dispose).toHaveBeenCalledTimes(1);
      expect(service.isSpatialGridVizVisible()).toBe(false);
      expect(service.isAirSpatialGridVizVisible()).toBe(false);
    });

    it('shows the overlays again after the next initialize', () => {
      showEverything();
      service.clear();

      init();
      service.updateSpatialGridVisualization();
      expect(service.isSpatialGridVizVisible()).toBe(true);
    });

    it('removes and frees the marker on dispose and lets go of the scene', () => {
      const marker = showEverything();
      const geometry = vi.spyOn(marker.geometry, 'dispose');
      const material = vi.spyOn(marker.material as MeshBasicMaterial, 'dispose');

      service.dispose();

      expect(scene.children).toHaveLength(0);
      expect(geometry).toHaveBeenCalled();
      expect(material).toHaveBeenCalled();

      init();
      service.updateSpatialGridVisualization();
      service.updateAirRouteLayer();
      expect(scene.children).toHaveLength(0);
    });
  });
});
