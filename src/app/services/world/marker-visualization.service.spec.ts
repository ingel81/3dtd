import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Injector, runInInjectionContext, signal, type WritableSignal } from '@angular/core';
import { BufferGeometry, Group, Mesh, MeshBasicMaterial, OctahedronGeometry, PerspectiveCamera, Vector3 } from 'three';
import { MarkerVisualizationService, type SpawnPoint } from './marker-visualization.service';
import { HQDamageService } from '../combat/hq-damage.service';
import { UIStore } from '../../store/ui.store';
import type { ThreeTilesEngine } from '../../three-engine';
import { MARKER_FLOAT_HEIGHT } from '../../configs/marker-geometry.config';

// MarkerLabelManager renders text into a 2D canvas, which jsdom does not have.
// The fake keeps what the service tells it so the tests can read the labels.
const labelFake = vi.hoisted(() => {
  interface Label {
    text: string;
    color: string;
    phase: number;
    position: { x: number; y: number; z: number };
  }
  const instances: FakeLabelManager[] = [];
  class FakeLabelManager {
    readonly labels = new Map<string, Label>();
    frames = 0;
    disposed = false;
    constructor(readonly overlay: unknown) {
      instances.push(this);
    }
    addLabel(id: string, text: string, p: { x: number; y: number; z: number }, color: string, phase: number): void {
      this.labels.set(id, { text, color, phase, position: { x: p.x, y: p.y, z: p.z } });
    }
    removeLabel(id: string): void {
      this.labels.delete(id);
    }
    updatePosition(id: string, p: { x: number; y: number; z: number }): void {
      const label = this.labels.get(id);
      if (label) label.position = { x: p.x, y: p.y, z: p.z };
    }
    update(): void {
      this.frames++;
    }
    clear(): void {
      this.labels.clear();
    }
    dispose(): void {
      this.clear();
      this.disposed = true;
    }
  }
  return { instances, FakeLabelManager };
});

vi.mock('../../three-engine/renderers/marker/marker-label.manager', () => ({
  MarkerLabelManager: labelFake.FakeLabelManager,
}));

const BASE = { lat: 48.9, lon: 9.2 };

/** 0.001 degree = 100 m, +X west, +Z north. */
function geoToLocal(lat: number, lon: number, height: number) {
  return { x: (BASE.lon - lon) * 1e5, y: height, z: (lat - BASE.lat) * 1e5 };
}

function fakeEngine() {
  const overlay = new Group();
  /** Terrain height per "lat,lon"; `fallback` for every other column. */
  const terrain = { fallback: 100 as number | null, at: new Map<string, number | null>() };
  const engine = {
    getOverlayGroup: vi.fn(() => overlay),
    getTerrainHeightAtGeo: vi.fn((lat: number, lon: number) => {
      const key = `${lat},${lon}`;
      return terrain.at.has(key) ? terrain.at.get(key)! : terrain.fallback;
    }),
    getCamera: vi.fn(() => new PerspectiveCamera()),
    sync: { geoToLocalSimple: vi.fn(geoToLocal) },
    effects: { setDebugSpheresVisible: vi.fn() },
  };
  return { engine, overlay, terrain, asEngine: engine as unknown as ThreeTilesEngine };
}

function createService() {
  const uiStore = {
    specialPointsDebugVisible: signal(false),
    toggleSpecialPointsDebug(): void {
      this.specialPointsDebugVisible.update((v) => !v);
    },
  };
  const hqDamage = { spawnDebugPoint: vi.fn() };
  const injector = Injector.create({
    providers: [
      { provide: UIStore, useValue: uiStore },
      { provide: HQDamageService, useValue: hqDamage },
    ],
  });
  const service = runInInjectionContext(injector, () => new MarkerVisualizationService());
  return { service, uiStore, hqDamage };
}

function labels() {
  return labelFake.instances[labelFake.instances.length - 1].labels;
}

function spawn(id: string, lat: number, lon: number): SpawnPoint {
  return { id, name: id, lat, lon, color: 0xff0000 };
}

describe('MarkerVisualizationService', () => {
  let service: MarkerVisualizationService;
  let uiStore: ReturnType<typeof createService>['uiStore'];
  let hqDamage: ReturnType<typeof createService>['hqDamage'];
  let fake: ReturnType<typeof fakeEngine>;
  let heightDebugVisible: WritableSignal<boolean>;

  beforeEach(() => {
    labelFake.instances.length = 0;
    ({ service, uiStore, hqDamage } = createService());
    fake = fakeEngine();
    heightDebugVisible = signal(false);
  });

  afterEach(() => vi.restoreAllMocks());

  const init = () => service.initialize(fake.asEngine, { ...BASE }, heightDebugVisible);

  describe('before initialize', () => {
    it('has no markers and ignores every marker call', () => {
      service.addBaseMarker();
      expect(service.addSpawnMarker('s1', 'S1', BASE.lat, BASE.lon, 0xff0000)).toBeNull();
      expect(service.getSpawnMarkers()).toEqual([]);
      expect(service.getBaseMarker()).toBeNull();
      expect(() => {
        service.removeBaseMarker();
        service.removeSpawnMarker('s1');
        service.clearSpawnMarkers();
        service.updateMarkerHeights([spawn('s1', BASE.lat, BASE.lon)]);
        service.animateMarkers(16);
        service.addHeightDebugMarker(new Vector3(), 1, true);
        service.clearHeightDebugMarkers();
        service.toggleHeightDebug(true);
        service.clearAllMarkers();
        service.updateDebugSpheresVisibility();
        service.dispose();
      }).not.toThrow();
      expect(fake.engine.effects.setDebugSpheresVisible).not.toHaveBeenCalled();
    });
  });

  it('attaches its marker meshes to the engine overlay group', () => {
    init();
    expect(fake.engine.getOverlayGroup).toHaveBeenCalled();
    expect(fake.overlay.children.length).toBeGreaterThan(0);
    expect(labelFake.instances[0].overlay).toBe(fake.overlay);
  });

  describe('HQ marker', () => {
    it('floats above the terrain under the HQ, labelled "HQ" in green', () => {
      init();
      service.addBaseMarker();

      const hq = service.getBaseMarker()!;
      expect(hq.position.toArray()).toEqual([0, 100 + MARKER_FLOAT_HEIGHT, 0]);
      expect(labels().get('hq')).toMatchObject({ text: 'HQ', color: '#22c55e', position: { y: 130 } });
      expect(service.getSpawnMarkers()).toEqual([]);
    });

    it('replaces the previous HQ marker when added again', () => {
      init();
      service.addBaseMarker();
      const first = service.getBaseMarker();
      fake.terrain.fallback = 50;

      service.addBaseMarker();

      expect(service.getBaseMarker()).not.toBe(first);
      expect(service.getBaseMarker()!.position.y).toBe(80);
      expect(labels().size).toBe(1);
    });

    it('sits at the bare float height when added without a terrain sample', () => {
      init();
      service.addBaseMarker();
      fake.terrain.fallback = null;

      // addBaseMarker removes the old marker first, so there is no current
      // height to keep: the marker drops to MARKER_FLOAT_HEIGHT (absolute).
      service.addBaseMarker();

      expect(service.getBaseMarker()!.position.y).toBe(MARKER_FLOAT_HEIGHT);
    });

    it('removes marker and label', () => {
      init();
      service.addBaseMarker();

      service.removeBaseMarker();

      expect(service.getBaseMarker()).toBeNull();
      expect(labels().has('hq')).toBe(false);
    });
  });

  describe('spawn markers', () => {
    it('adds a spawn at its own terrain column with its name and colour', () => {
      init();
      const lat = BASE.lat + 0.002;
      const lon = BASE.lon - 0.001;
      fake.terrain.at.set(`${lat},${lon}`, 40);

      const proxy = service.addSpawnMarker('s1', 'North Gate', lat, lon, 0x3366ff)!;

      expect(proxy.name).toBe('spawnMarker_s1');
      expect(proxy.position.x).toBeCloseTo(100, 6);
      expect(proxy.position.y).toBe(40 + MARKER_FLOAT_HEIGHT);
      expect(proxy.position.z).toBeCloseTo(200, 6);
      expect(service.getSpawnMarkers()).toEqual([proxy]);
      expect(labels().get('s1')).toMatchObject({ text: 'North Gate', color: '#3366ff' });
    });

    it('does not depend on the HQ column resolving', () => {
      init();
      fake.terrain.at.set(`${BASE.lat},${BASE.lon}`, null);

      const proxy = service.addSpawnMarker('s1', 'S1', BASE.lat + 0.001, BASE.lon, 0xff0000)!;

      expect(proxy.position.y).toBe(100 + MARKER_FLOAT_HEIGHT);
    });

    it('uses the bare float height when its own column has no sample', () => {
      init();
      fake.terrain.fallback = null;

      const proxy = service.addSpawnMarker('s1', 'S1', BASE.lat + 0.001, BASE.lon, 0xff0000)!;

      expect(proxy.position.y).toBe(MARKER_FLOAT_HEIGHT);
    });

    it('replaces a spawn added again under the same id', () => {
      init();
      service.addSpawnMarker('s1', 'Old', BASE.lat + 0.001, BASE.lon, 0xff0000);

      const proxy = service.addSpawnMarker('s1', 'New', BASE.lat + 0.002, BASE.lon, 0xff0000)!;

      expect(service.getSpawnMarkers()).toEqual([proxy]);
      expect(labels().get('s1')!.text).toBe('New');
    });

    it('gives a marker the same animation phase every time it is added', () => {
      init();
      service.addSpawnMarker('s1', 'S1', BASE.lat, BASE.lon, 0xff0000);
      const phase = labels().get('s1')!.phase;
      service.removeSpawnMarker('s1');
      service.addSpawnMarker('s1', 'S1', BASE.lat, BASE.lon, 0xff0000);

      expect(labels().get('s1')!.phase).toBe(phase);
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(Math.PI * 2);
    });

    it('removes one spawn by id and ignores unknown ids', () => {
      init();
      service.addSpawnMarker('s1', 'S1', BASE.lat, BASE.lon, 0xff0000);
      const s2 = service.addSpawnMarker('s2', 'S2', BASE.lat + 0.001, BASE.lon, 0xff0000);

      service.removeSpawnMarker('s1');
      service.removeSpawnMarker('nope');

      expect(service.getSpawnMarkers()).toEqual([s2]);
      expect([...labels().keys()]).toEqual(['s2']);
    });

    it('clears all spawns but keeps the HQ', () => {
      init();
      service.addBaseMarker();
      service.addSpawnMarker('s1', 'S1', BASE.lat, BASE.lon, 0xff0000);
      service.addSpawnMarker('s2', 'S2', BASE.lat + 0.001, BASE.lon, 0xff0000);

      service.clearSpawnMarkers();

      expect(service.getSpawnMarkers()).toEqual([]);
      expect(service.getBaseMarker()).not.toBeNull();
      expect([...labels().keys()]).toEqual(['hq']);
    });
  });

  describe('updateMarkerHeights', () => {
    it('moves HQ and spawns to their current terrain, labels follow', () => {
      init();
      const s1 = spawn('s1', BASE.lat + 0.001, BASE.lon);
      service.addBaseMarker();
      service.addSpawnMarker(s1.id, s1.name, s1.lat, s1.lon, s1.color);
      fake.terrain.fallback = 250;

      service.updateMarkerHeights([s1]);

      expect(service.getBaseMarker()!.position.y).toBe(280);
      expect(service.getSpawnMarkers()[0].position.y).toBe(280);
      expect(labels().get('hq')!.position.y).toBe(280);
      expect(labels().get('s1')!.position.y).toBe(280);
    });

    it('keeps markers whose column has no sample where they are', () => {
      init();
      const s1 = spawn('s1', BASE.lat + 0.001, BASE.lon);
      service.addBaseMarker();
      service.addSpawnMarker(s1.id, s1.name, s1.lat, s1.lon, s1.color);
      fake.terrain.fallback = null;

      service.updateMarkerHeights([s1]);

      expect(service.getBaseMarker()!.position.y).toBe(130);
      expect(service.getSpawnMarkers()[0].position.y).toBe(130);
    });

    it('ignores spawn points without a marker', () => {
      init();
      service.addBaseMarker();

      expect(() => service.updateMarkerHeights([spawn('ghost', BASE.lat, BASE.lon)])).not.toThrow();
      expect(service.getSpawnMarkers()).toEqual([]);
      expect(labels().has('ghost')).toBe(false);
    });
  });

  describe('animateMarkers', () => {
    it('moves the label along when a marker proxy was moved from outside', () => {
      init();
      const proxy = service.addSpawnMarker('s1', 'S1', BASE.lat, BASE.lon, 0xff0000)!;
      service.animateMarkers(16);

      proxy.position.set(7, 140, -3); // snap-to-path in PathRouteService
      service.animateMarkers(16);

      expect(labels().get('s1')!.position).toEqual({ x: 7, y: 140, z: -3 });
      expect(labelFake.instances[0].frames).toBe(2);
    });
  });

  describe('height debug markers', () => {
    const debugGroup = () => fake.overlay.children.find((o) => o.name === 'heightDebugGroup') as Group | undefined;

    it('collects spheres in one overlay group, green for hits and red for misses, 2 m above the sample', () => {
      init();
      service.addHeightDebugMarker(new Vector3(1, 10, 2), 10, true);
      service.addHeightDebugMarker(new Vector3(3, 20, 4), null, false);

      const group = debugGroup()!;
      expect(group.children).toHaveLength(2);
      const [hit, miss] = group.children as Mesh[];
      expect(hit.position.toArray()).toEqual([1, 12, 2]);
      expect((hit.material as MeshBasicMaterial).color.getHex()).toBe(0x00ff00);
      expect((miss.material as MeshBasicMaterial).color.getHex()).toBe(0xff0000);
    });

    it('takes the initial visibility from the signal and toggles it afterwards', () => {
      heightDebugVisible.set(true);
      init();
      service.addHeightDebugMarker(new Vector3(), 0, true);
      expect(debugGroup()!.visible).toBe(true);

      service.toggleHeightDebug(false);
      expect(debugGroup()!.visible).toBe(false);
    });

    it('removes and disposes them on clear, and starts a new group afterwards', () => {
      init();
      service.addHeightDebugMarker(new Vector3(), 0, true);
      const group = debugGroup()!;
      const geometry = (group.children[0] as Mesh).geometry as BufferGeometry;
      const onDispose = vi.fn();
      geometry.addEventListener('dispose', onDispose);

      service.clearHeightDebugMarkers();

      expect(debugGroup()).toBeUndefined();
      expect(onDispose).toHaveBeenCalled();

      service.addHeightDebugMarker(new Vector3(), 0, true);
      expect(debugGroup()).not.toBe(group);
      expect(debugGroup()!.children).toHaveLength(1);
    });
  });

  it('clearAllMarkers removes HQ, spawns, labels and height debug markers', () => {
    init();
    service.addBaseMarker();
    service.addSpawnMarker('s1', 'S1', BASE.lat, BASE.lon, 0xff0000);
    service.addHeightDebugMarker(new Vector3(), 0, true);

    service.clearAllMarkers();

    expect(service.getBaseMarker()).toBeNull();
    expect(service.getSpawnMarkers()).toEqual([]);
    expect(labels().size).toBe(0);
    expect(fake.overlay.children.some((o) => o.name === 'heightDebugGroup')).toBe(false);
  });

  describe('special points debug', () => {
    it('flips the UI flag, shows the debug spheres and spawns the HQ point when switched on', () => {
      init();

      service.toggleSpecialPointsDebug();

      expect(uiStore.specialPointsDebugVisible()).toBe(true);
      expect(fake.engine.effects.setDebugSpheresVisible).toHaveBeenLastCalledWith(true);
      expect(hqDamage.spawnDebugPoint).toHaveBeenCalledTimes(1);
    });

    it('hides the spheres without a new HQ point when switched off', () => {
      init();
      service.toggleSpecialPointsDebug();

      service.toggleSpecialPointsDebug();

      expect(uiStore.specialPointsDebugVisible()).toBe(false);
      expect(fake.engine.effects.setDebugSpheresVisible).toHaveBeenLastCalledWith(false);
      expect(hqDamage.spawnDebugPoint).toHaveBeenCalledTimes(1);
    });

    it('still flips the UI flag before initialize', () => {
      service.toggleSpecialPointsDebug();

      expect(uiStore.specialPointsDebugVisible()).toBe(true);
      expect(hqDamage.spawnDebugPoint).not.toHaveBeenCalled();
    });

    it('updateDebugSpheresVisibility applies the UI flag to the engine', () => {
      init();
      uiStore.specialPointsDebugVisible.set(true);

      service.updateDebugSpheresVisibility();

      expect(fake.engine.effects.setDebugSpheresVisible).toHaveBeenCalledWith(true);
    });
  });

  describe('placement preview diamond', () => {
    it('builds core, wireframe and glow plus two rings by default', () => {
      const marker = service.createDiamondMarker({ color: 0xff0000 });
      expect(marker.children).toHaveLength(5);
      expect(marker.children.every((c) => c instanceof Mesh)).toBe(true);
    });

    it('leaves out the rings on request and scales with size', () => {
      const small = service.createDiamondMarker({ color: 0xff0000, showRings: false });
      const big = service.createDiamondMarker({ color: 0xff0000, size: 2, showRings: false });

      expect(small.children).toHaveLength(3);
      const coreRadius = (g: Group) => ((g.children[0] as Mesh).geometry as OctahedronGeometry).parameters.radius;
      expect(coreRadius(big)).toBe(2 * coreRadius(small));
    });

    it('works without initialize and disposes every geometry and material', () => {
      const marker = service.createDiamondMarker({ color: 0x00ff00 });
      const disposed = vi.fn();
      for (const child of marker.children as Mesh[]) {
        child.geometry.addEventListener('dispose', disposed);
        (child.material as MeshBasicMaterial).addEventListener('dispose', disposed);
      }

      service.disposeDiamondMarker(marker);

      expect(disposed).toHaveBeenCalledTimes(10);
    });
  });

  describe('dispose', () => {
    it('removes the meshes from the overlay, drops all markers and ignores later adds', () => {
      init();
      service.addBaseMarker();
      service.addSpawnMarker('s1', 'S1', BASE.lat, BASE.lon, 0xff0000);
      service.addHeightDebugMarker(new Vector3(), 0, true);

      service.dispose();

      expect(fake.overlay.children).toHaveLength(0);
      expect(labelFake.instances[0].disposed).toBe(true);
      expect(service.getBaseMarker()).toBeNull();
      expect(service.getSpawnMarkers()).toEqual([]);
      expect(service.addSpawnMarker('s2', 'S2', BASE.lat, BASE.lon, 0xff0000)).toBeNull();
    });

    it('can be initialized again with a new engine', () => {
      init();
      service.dispose();

      const second = fakeEngine();
      service.initialize(second.asEngine, { ...BASE }, heightDebugVisible);
      service.addBaseMarker();

      expect(service.getBaseMarker()).not.toBeNull();
      expect(second.overlay.children.length).toBeGreaterThan(0);
    });
  });
});
