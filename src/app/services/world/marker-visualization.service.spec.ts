import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Injector, runInInjectionContext, signal, type WritableSignal } from '@angular/core';
import {
  BufferGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  OctahedronGeometry,
  PerspectiveCamera,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import { MarkerVisualizationService } from './marker-visualization.service';
import { HQDamageService } from '../combat/hq-damage.service';
import { UIStore } from '../../store/ui.store';
import { GameEventBus } from '../../game-engine/game-event-bus';
import { SPAWN_PORTAL_LOOK } from '../../configs/visual-effects.config';
import type { ThreeTilesEngine } from '../../three-engine';
import {
  MARKER_FLOAT_HEIGHT,
  MARKER_LABEL_OFFSET,
  PORTAL_OPENING_HEIGHT,
  PORTAL_OPENING_WIDTH,
  PORTAL_SETBACK,
  portalLabelHeight,
} from '../../configs/marker-geometry.config';

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

/** Inverse of geoToLocal. */
function localToGeo(v: { x: number; y: number; z: number }) {
  return { lat: BASE.lat + v.z / 1e5, lon: BASE.lon - v.x / 1e5, height: v.y };
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
    sync: {
      geoToLocalSimple: vi.fn(geoToLocal),
      geoToLocalSimpleInto: vi.fn((lat: number, lon: number, height: number, out: Vector3) => {
        const p = geoToLocal(lat, lon, height);
        return out.set(p.x, p.y, p.z);
      }),
      localToGeo: vi.fn(localToGeo),
    },
    effects: { setDebugSpheresVisible: vi.fn(), impactEffectsEnabled: true, spawnPortalSparks: vi.fn() },
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

/** Centre of the HQ label for a diamond over terrain at `ground`. */
const hqLabelY = (ground: number) => ground + MARKER_FLOAT_HEIGHT + MARKER_LABEL_OFFSET;

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

  const instanced = () =>
    fake.overlay.children.filter((o): o is InstancedMesh => (o as InstancedMesh).isInstancedMesh === true);
  const portalFrames = () => instanced().find((m) => m.name === 'spawnPortalFrames')!;
  /** Instances the HQ diamond draws: body, two rings and the ground glow per HQ. */
  const hqInstances = () =>
    instanced().filter((m) => !m.name.startsWith('spawnPortal')).reduce((n, m) => n + m.count, 0);

  /** Position, facing (the portal's +z) and scale of portal instance `index`. */
  function portal(index = 0) {
    const matrix = new Matrix4();
    portalFrames().getMatrixAt(index, matrix);
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3();
    matrix.decompose(position, rotation, scale);
    return { position, forward: new Vector3(0, 0, 1).applyQuaternion(rotation), scale: scale.x };
  }

  describe('before initialize', () => {
    it('has no markers and ignores every marker call', () => {
      expect(() => {
        service.addBaseMarker();
        service.addSpawnMarker('s1', 'S1', BASE.lat, BASE.lon, 0xff0000);
        service.placeSpawnPortal('s1', [{ ...BASE }, { lat: BASE.lat + 0.001, lon: BASE.lon }], 0);
        service.removeBaseMarker();
        service.removeSpawnMarker('s1');
        service.clearSpawnMarkers();
        service.updateMarkerHeights();
        service.animateMarkers(16);
        service.addHeightDebugMarker(new Vector3(), 1, true);
        service.clearHeightDebugMarkers();
        service.toggleHeightDebug(true);
        service.clearAllMarkers();
        service.updateDebugSpheresVisibility();
        service.dispose();
      }).not.toThrow();
      expect(labelFake.instances).toHaveLength(0);
      expect(fake.engine.effects.setDebugSpheresVisible).not.toHaveBeenCalled();
    });
  });

  it('attaches its marker meshes to the engine overlay group', () => {
    init();
    expect(fake.engine.getOverlayGroup).toHaveBeenCalled();
    expect(fake.overlay.children.length).toBeGreaterThan(0);
    expect(labelFake.instances[0].overlay).toBe(fake.overlay);
  });

  it('drops the previous meshes when initialized again', () => {
    init();
    const meshes = fake.overlay.children.length;

    init();

    expect(fake.overlay.children).toHaveLength(meshes);
    expect(labelFake.instances[0].disposed).toBe(true);
  });

  describe('HQ marker', () => {
    it('floats above the terrain under the HQ, labelled "HQ" in green', () => {
      init();
      service.addBaseMarker();

      expect(hqInstances()).toBe(4);
      expect(labels().get('hq')).toMatchObject({ text: 'HQ', color: '#22c55e', position: { y: hqLabelY(100) } });
      expect(portalFrames().count).toBe(0);
    });

    it('replaces the previous HQ marker when added again', () => {
      init();
      service.addBaseMarker();
      fake.terrain.fallback = 50;

      service.addBaseMarker();

      expect(hqInstances()).toBe(4);
      expect(labels().get('hq')!.position.y).toBe(hqLabelY(50));
      expect(labels().size).toBe(1);
    });

    it('sits at the bare float height when added without a terrain sample', () => {
      init();
      service.addBaseMarker();
      fake.terrain.fallback = null;

      // addBaseMarker removes the old marker first, so there is no current
      // height to keep: the marker drops to MARKER_FLOAT_HEIGHT (absolute).
      service.addBaseMarker();

      expect(labels().get('hq')!.position.y).toBe(MARKER_FLOAT_HEIGHT + MARKER_LABEL_OFFSET);
    });

    it('removes marker and label', () => {
      init();
      service.addBaseMarker();

      service.removeBaseMarker();

      expect(hqInstances()).toBe(0);
      expect(labels().has('hq')).toBe(false);
    });
  });

  describe('spawn portals', () => {
    it('stands a portal on its own terrain column, facing the HQ, with its name and colour', () => {
      init();
      const lat = BASE.lat + 0.002;
      const lon = BASE.lon - 0.001;
      fake.terrain.at.set(`${lat},${lon}`, 40);

      service.addSpawnMarker('s1', 'North Gate', lat, lon, 0x3366ff);

      const { position, forward, scale } = portal();
      expect(position.x).toBeCloseTo(100, 3);
      expect(position.y).toBe(40);
      expect(position.z).toBeCloseTo(200, 3);
      // Until its route is built it faces the HQ at the origin
      expect(forward.x).toBeCloseTo(-100 / Math.hypot(100, 200), 4);
      expect(forward.z).toBeCloseTo(-200 / Math.hypot(100, 200), 4);
      expect(scale).toBeCloseTo(1, 4);
      expect(labels().get('s1')).toMatchObject({ text: 'North Gate', color: '#3366ff' });
      expect(labels().get('s1')!.position.y).toBeCloseTo(40 + portalLabelHeight(1), 6);
    });

    it('does not depend on the HQ column resolving', () => {
      init();
      fake.terrain.at.set(`${BASE.lat},${BASE.lon}`, null);

      service.addSpawnMarker('s1', 'S1', BASE.lat + 0.001, BASE.lon, 0xff0000);

      expect(portal().position.y).toBe(100);
    });

    it('stands at 0 when its own column has no sample', () => {
      init();
      fake.terrain.fallback = null;

      service.addSpawnMarker('s1', 'S1', BASE.lat + 0.001, BASE.lon, 0xff0000);

      expect(portal().position.y).toBe(0);
    });

    it('replaces a spawn added again under the same id', () => {
      init();
      service.addSpawnMarker('s1', 'Old', BASE.lat + 0.001, BASE.lon, 0xff0000);

      service.addSpawnMarker('s1', 'New', BASE.lat + 0.002, BASE.lon, 0xff0000);

      expect(portalFrames().count).toBe(1);
      expect(portal().position.z).toBeCloseTo(200, 3);
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
      service.addSpawnMarker('s2', 'S2', BASE.lat + 0.001, BASE.lon, 0xff0000);

      service.removeSpawnMarker('s1');
      service.removeSpawnMarker('nope');

      // s1's instance is moved out of sight, s2 stays
      expect(portal(0).position.y).toBe(-99999);
      expect(portal(1).position.z).toBeCloseTo(100, 3);
      expect([...labels().keys()]).toEqual(['s2']);
    });

    it('clears all spawns but keeps the HQ', () => {
      init();
      service.addBaseMarker();
      service.addSpawnMarker('s1', 'S1', BASE.lat, BASE.lon, 0xff0000);
      service.addSpawnMarker('s2', 'S2', BASE.lat + 0.001, BASE.lon, 0xff0000);

      service.clearSpawnMarkers();

      expect(portalFrames().count).toBe(0);
      expect(hqInstances()).toBe(4);
      expect([...labels().keys()]).toEqual(['hq']);
    });
  });

  describe('placeSpawnPortal', () => {
    const lat = BASE.lat + 0.002;
    // Route south toward the HQ, (0, 200) to (0, 100) in local metres
    const route = [
      { lat, lon: BASE.lon, corridorLeft: 6, corridorRight: 3 },
      { lat: BASE.lat + 0.001, lon: BASE.lon },
    ];

    it('stands on the cell at the route start, ahead of it along the route, as wide as the corridor', () => {
      init();
      service.addSpawnMarker('s1', 'S1', lat + 0.0003, BASE.lon + 0.0002, 0xff0000);

      service.placeSpawnPortal('s1', route, 12);

      const { position, forward, scale } = portal();
      expect(position.x).toBeCloseTo(0, 3);
      expect(position.y).toBe(12);
      expect(position.z).toBeCloseTo(200 - PORTAL_SETBACK, 3);
      expect(forward.z).toBeCloseTo(-1, 4);
      // The wider side sets the opening: 2 x 6 m
      expect(scale).toBeCloseTo(12 / PORTAL_OPENING_WIDTH, 4);
      expect(labels().get('s1')!.position.y).toBeCloseTo(12 + portalLabelHeight(12 / PORTAL_OPENING_WIDTH), 3);
    });

    it('takes the terrain at the route start while the cells are not built', () => {
      init();
      service.addSpawnMarker('s1', 'S1', lat, BASE.lon, 0xff0000);
      fake.terrain.at.set(`${lat},${BASE.lon}`, 55);

      service.placeSpawnPortal('s1', route, null);

      expect(portal().position.y).toBe(55);
    });

    it('ignores unknown spawns and routes without a direction', () => {
      init();
      service.addSpawnMarker('s1', 'S1', lat, BASE.lon, 0xff0000);
      const before = portal();

      service.placeSpawnPortal('ghost', route, 12);
      service.placeSpawnPortal('s1', [route[0]], 12);
      service.placeSpawnPortal('s1', [route[0], route[0]], 12);

      expect(portal().position).toEqual(before.position);
      expect(labels().has('ghost')).toBe(false);
    });
  });

  describe('updateMarkerHeights', () => {
    it('moves the HQ and the portals off the cells to the current terrain, labels follow', () => {
      init();
      service.addBaseMarker();
      service.addSpawnMarker('s1', 'S1', BASE.lat + 0.001, BASE.lon, 0xff0000);
      fake.terrain.fallback = 250;

      service.updateMarkerHeights();

      expect(labels().get('hq')!.position.y).toBe(hqLabelY(250));
      expect(portal().position.y).toBe(250);
      expect(labels().get('s1')!.position.y).toBeCloseTo(250 + portalLabelHeight(1), 6);
    });

    it('keeps markers whose column has no sample where they are', () => {
      init();
      service.addBaseMarker();
      service.addSpawnMarker('s1', 'S1', BASE.lat + 0.001, BASE.lon, 0xff0000);
      fake.terrain.fallback = null;

      service.updateMarkerHeights();

      expect(labels().get('hq')!.position.y).toBe(hqLabelY(100));
      expect(portal().position.y).toBe(100);
    });

    it('leaves a portal standing on a route cell to its route', () => {
      init();
      service.addSpawnMarker('s1', 'S1', BASE.lat + 0.002, BASE.lon, 0xff0000);
      service.placeSpawnPortal('s1', [{ lat: BASE.lat + 0.002, lon: BASE.lon }, { lat: BASE.lat + 0.001, lon: BASE.lon }], 12);
      fake.terrain.fallback = 250;

      service.updateMarkerHeights();

      expect(portal().position.y).toBe(12);
    });
  });

  describe('animateMarkers', () => {
    it('ticks the labels once per frame', () => {
      init();
      service.addSpawnMarker('s1', 'S1', BASE.lat, BASE.lon, 0xff0000);

      service.animateMarkers(16);
      service.animateMarkers(16);

      expect(labelFake.instances[0].frames).toBe(2);
    });
  });

  describe('wave events', () => {
    it('surges the portals at wave start and calms them after the wave', () => {
      const L = SPAWN_PORTAL_LOOK;
      const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
      init();
      service.addSpawnMarker('s1', 'S1', BASE.lat + 0.001, BASE.lon, 0xff0000);
      const bus = new GameEventBus();
      service.subscribeToEventBus(bus);
      const energy = () => (portalFrames().material as ShaderMaterial).uniforms['uEnergy'].value as number;

      service.animateMarkers(16);
      expect(energy()).toBeCloseTo(L.idleEnergy);

      bus.emit({ type: 'wave:started', wave: 1, enemyCount: 10 });
      service.animateMarkers(16);
      expect(energy()).toBeGreaterThan(L.idleEnergy + 0.9 * L.surge);

      bus.emit({ type: 'wave:completed', wave: 1, credits: 0, perfect: true, closeCall: false, hpLost: 0 });
      for (let t = 1000; t <= 20_000; t += 16) {
        now.mockReturnValue(t);
        service.animateMarkers(16);
      }
      expect(energy()).toBeCloseTo(L.idleEnergy, 2);
    });
  });

  describe('spawn burst', () => {
    const lat = BASE.lat + 0.002;
    // Route south toward the HQ, (0, 200) to (0, 100) in local metres
    const route = [{ lat, lon: BASE.lon }, { lat: BASE.lat + 0.001, lon: BASE.lon }];

    /** A portal on the route start, listening to a fresh event bus; returns an enemy spawner. */
    function portalOnRoute() {
      init();
      service.addSpawnMarker('s1', 'S1', lat, BASE.lon, 0xff0000);
      service.placeSpawnPortal('s1', route, 12);
      const bus = new GameEventBus();
      service.subscribeToEventBus(bus);
      return (at: { lat: number; lon: number }) =>
        bus.emit({ type: 'enemy:spawned', enemy: { position: at } } as never);
    }

    it('throws sparks out of the portal along the route, at most once per interval', () => {
      const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
      const enemyAt = portalOnRoute();
      const sparks = fake.engine.effects.spawnPortalSparks;

      // A thousand enemies at the same moment
      for (let i = 0; i < 1000; i++) enemyAt(route[0]);
      expect(sparks).toHaveBeenCalledTimes(1);

      // Portal plane 2 m ahead of the route start, on the cell, facing south
      const [x, y, z, forwardX, forwardZ] = sparks.mock.calls[0] as number[];
      expect(x).toBeCloseTo(0);
      expect(y).toBe(12);
      expect(z).toBeCloseTo(200 - PORTAL_SETBACK);
      expect(forwardX).toBeCloseTo(0);
      expect(forwardZ).toBeCloseTo(-1);

      now.mockReturnValue(1000 + SPAWN_PORTAL_LOOK.burstIntervalMs);
      enemyAt(route[0]);
      expect(sparks).toHaveBeenCalledTimes(2);
    });

    it('stays off with the impact effects off, and for enemies that start at no portal', () => {
      vi.spyOn(performance, 'now').mockReturnValue(1000);
      const enemyAt = portalOnRoute();
      const sparks = fake.engine.effects.spawnPortalSparks;

      fake.engine.effects.impactEffectsEnabled = false;
      enemyAt(route[0]);
      expect(sparks).not.toHaveBeenCalled();

      fake.engine.effects.impactEffectsEnabled = true;
      enemyAt({ lat: BASE.lat + 0.0015, lon: BASE.lon + 0.001 }); // a debug spawn elsewhere
      expect(sparks).not.toHaveBeenCalled();

      // The switched-off enemy did not use up the portal's burst
      enemyAt(route[0]);
      expect(sparks).toHaveBeenCalledTimes(1);
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

  it('clearAllMarkers removes HQ, portals, labels and height debug markers', () => {
    init();
    service.addBaseMarker();
    service.addSpawnMarker('s1', 'S1', BASE.lat, BASE.lon, 0xff0000);
    service.addHeightDebugMarker(new Vector3(), 0, true);

    service.clearAllMarkers();

    expect(hqInstances()).toBe(0);
    expect(portalFrames().count).toBe(0);
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

  describe('placement previews', () => {
    it('builds the HQ diamond from core, wireframe, glow and two rings', () => {
      const marker = service.createDiamondMarker({ color: 0xff0000 });
      expect(marker.children).toHaveLength(5);
      expect(marker.children.every((c) => c instanceof Mesh)).toBe(true);
    });

    it('scales the diamond with size', () => {
      const small = service.createDiamondMarker({ color: 0xff0000 });
      const big = service.createDiamondMarker({ color: 0xff0000, size: 2 });

      const coreRadius = (g: Group) => ((g.children[0] as Mesh).geometry as OctahedronGeometry).parameters.radius;
      expect(coreRadius(big)).toBe(2 * coreRadius(small));
    });

    it('builds the spawn preview as a portal standing on its origin, in tintable materials', () => {
      const preview = service.createPortalPreview(0xef4444);

      expect(preview.children).toHaveLength(2);
      const [frame, surface] = preview.children as Mesh[];
      expect(frame.material).toBeInstanceOf(MeshPhongMaterial);
      expect(surface.material).toBeInstanceOf(MeshBasicMaterial);
      surface.geometry.computeBoundingBox();
      const box = surface.geometry.boundingBox!;
      expect(box.min.y).toBeCloseTo(0);
      expect(box.max.y).toBeCloseTo(PORTAL_OPENING_HEIGHT);
      expect(box.max.x).toBeCloseTo(PORTAL_OPENING_WIDTH / 2);
    });

    it('works without initialize and disposes every geometry and material', () => {
      const disposed = vi.fn();
      for (const preview of [service.createDiamondMarker({ color: 0x00ff00 }), service.createPortalPreview(0x00ff00)]) {
        for (const child of preview.children as Mesh[]) {
          child.geometry.addEventListener('dispose', disposed);
          (child.material as MeshBasicMaterial).addEventListener('dispose', disposed);
        }
        service.disposePreviewMarker(preview);
      }

      // Diamond 5 meshes, portal 2, a geometry and a material each
      expect(disposed).toHaveBeenCalledTimes(14);
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
      expect(labelFake.instances[0].labels.size).toBe(0);

      service.addSpawnMarker('s2', 'S2', BASE.lat, BASE.lon, 0xff0000);
      expect(fake.overlay.children).toHaveLength(0);
      expect(labelFake.instances[0].labels.size).toBe(0);
    });

    it('can be initialized again with a new engine', () => {
      init();
      service.dispose();

      const second = fakeEngine();
      service.initialize(second.asEngine, { ...BASE }, heightDebugVisible);
      service.addBaseMarker();

      expect(labels().has('hq')).toBe(true);
      expect(second.overlay.children.length).toBeGreaterThan(0);
    });
  });
});
