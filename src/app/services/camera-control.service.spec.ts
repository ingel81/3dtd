import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  Box3,
  BufferGeometry,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
} from 'three';
import { CameraControlService, type CameraView } from './camera-control.service';
import type { CameraFrame } from './camera-framing.service';
import type { ThreeTilesEngine } from '../three-engine';

/** Local origin of the fake engine. */
const ORIGIN = { lat: 48.9, lon: 9.2 };
/** A frame around the origin, for the debug drawing */
const FRAME_AT_ORIGIN: CameraFrame = {
  camX: 0, camY: 300, camZ: -300, lookAtX: 0, lookAtY: 0, lookAtZ: 0,
  boundingBox: { minX: -30, maxX: 30, minZ: -30, maxZ: 30, centerX: 0, centerZ: 0, spanX: 60, spanZ: 60 },
  cameraDistance: 420, cameraAngle: 45,
};

/**
 * Engine convention (see camera-framing.service.spec.ts): +Z north, +X west.
 * 0.001 degree = 100 m here, which keeps the expected numbers readable.
 */
function geoToLocal(lat: number, lon: number, height: number) {
  return { x: (ORIGIN.lon - lon) * 1e5, y: height, z: (lat - ORIGIN.lat) * 1e5 };
}

function fakeEngine(camera: PerspectiveCamera | OrthographicCamera = new PerspectiveCamera(60, 1.5, 0.1, 1e6)) {
  const scene = new Scene();
  const engine = {
    getCamera: vi.fn(() => camera),
    getScene: vi.fn(() => scene),
    getTerrainHeightAtGeo: vi.fn((): number | null => 20),
    setLocalCameraPosition: vi.fn(),
    sync: {
      getOrigin: vi.fn(() => ({ ...ORIGIN, height: 0 })),
      geoToLocalSimple: vi.fn(geoToLocal),
    },
  };
  return { engine, scene, camera, asEngine: engine as unknown as ThreeTilesEngine };
}

const VIEW: CameraView = {
  position: { x: 10, y: 200, z: -300 },
  target: { x: 1, y: 2, z: 3 },
};

/** Smallest angle between two headings in degrees. */
function headingDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

function bounds(obj: Object3D): Box3 {
  const geometry = (obj as LineSegments).geometry as BufferGeometry;
  geometry.computeBoundingBox();
  return geometry.boundingBox!;
}

function colorOf(obj: Object3D): number {
  return ((obj as Mesh).material as MeshBasicMaterial | LineBasicMaterial).color.getHex();
}

describe('CameraControlService', () => {
  let service: CameraControlService;

  beforeEach(() => {
    // cameraTimeline logs every recorded event
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    service = new CameraControlService();
  });

  afterEach(() => vi.restoreAllMocks());

  describe('before initialize', () => {
    it('ignores saves, resets and debug calls and reports neutral values', () => {
      service.saveInitialPosition(VIEW);
      expect(service.getInitialView()).toBeNull();
      expect(() => service.resetCamera()).not.toThrow();
      expect(service.getCameraHeading()).toBe(0);
      expect(service.getCameraDebugInfo()).toBeNull();
      expect(() => service.clearDebugVisualization()).not.toThrow();
    });

    it('does not draw the framing debug even when enabled', () => {
      service.toggleDebugFraming(true);
      expect(() => service.showDebugVisualization(ORIGIN, [], FRAME_AT_ORIGIN, 0.2)).not.toThrow();
    });
  });

  describe('initial view (overview)', () => {
    it('stores a copy of the saved view and hands out copies', () => {
      const { asEngine } = fakeEngine();
      service.initialize(asEngine, { ...ORIGIN });
      const view: CameraView = { position: { ...VIEW.position }, target: { ...VIEW.target } };

      service.saveInitialPosition(view);
      view.position.x = 999;

      const stored = service.getInitialView()!;
      expect(stored).toEqual(VIEW);
      stored.target.y = -1;
      expect(service.getInitialView()).toEqual(VIEW);
    });

    it('returns null from getOverview while there is neither a provider result nor a stored view', () => {
      const { asEngine } = fakeEngine();
      service.initialize(asEngine, { ...ORIGIN });
      expect(service.getOverview()).toBeNull();

      service.setOverviewProvider(() => null);
      expect(service.getOverview()).toBeNull();
    });

    it('prefers a fresh provider view and stores it as the new initial view', () => {
      const { asEngine } = fakeEngine();
      service.initialize(asEngine, { ...ORIGIN });
      service.saveInitialPosition(VIEW);
      const fresh: CameraView = { position: { x: 0, y: 50, z: 0 }, target: { x: 5, y: 0, z: 5 } };
      service.setOverviewProvider(() => fresh);

      expect(service.getOverview()).toEqual(fresh);
      expect(service.getInitialView()).toEqual(fresh);
    });

    it('falls back to the stored view when the provider has none', () => {
      const { asEngine } = fakeEngine();
      service.initialize(asEngine, { ...ORIGIN });
      service.saveInitialPosition(VIEW);
      service.setOverviewProvider(() => null);

      expect(service.getOverview()).toEqual(VIEW);
    });

    it('stops using a provider that was unset', () => {
      const { asEngine } = fakeEngine();
      service.initialize(asEngine, { ...ORIGIN });
      const provider = vi.fn(() => VIEW);
      service.setOverviewProvider(provider);
      service.setOverviewProvider(null);

      expect(service.getOverview()).toBeNull();
      expect(provider).not.toHaveBeenCalled();
    });
  });

  describe('resetCamera', () => {
    it('moves the camera to the overview position and target', () => {
      const { engine, asEngine } = fakeEngine();
      service.initialize(asEngine, { ...ORIGIN });
      service.saveInitialPosition(VIEW);

      service.resetCamera();

      expect(engine.setLocalCameraPosition).toHaveBeenCalledWith(10, 200, -300, 1, 2, 3);
    });

    it('computes the overview fresh on every reset', () => {
      const { engine, asEngine } = fakeEngine();
      service.initialize(asEngine, { ...ORIGIN });
      service.saveInitialPosition(VIEW);
      let height = 100;
      service.setOverviewProvider(() => ({ position: { x: 0, y: height, z: 0 }, target: { x: 0, y: 0, z: 0 } }));

      service.resetCamera();
      height = 150;
      service.resetCamera();

      expect(engine.setLocalCameraPosition.mock.calls.map((c) => c[1])).toEqual([100, 150]);
    });

    it('leaves the camera alone when there is no overview yet', () => {
      const { engine, asEngine } = fakeEngine();
      service.initialize(asEngine, { ...ORIGIN });

      service.resetCamera();

      expect(engine.setLocalCameraPosition).not.toHaveBeenCalled();
    });
  });

  describe('getCameraHeading', () => {
    it.each([
      ['north (+Z)', { x: 0, z: 100 }, 0],
      ['east (-X)', { x: -100, z: 0 }, 90],
      ['south (-Z)', { x: 0, z: -100 }, 180],
      ['west (+X)', { x: 100, z: 0 }, 270],
    ])('reads %s relative to geographic north', (_name, target, expected) => {
      const { camera, asEngine } = fakeEngine();
      service.initialize(asEngine, { ...ORIGIN });
      camera.position.set(0, 50, 0);
      camera.lookAt(target.x, 0, target.z);

      const heading = service.getCameraHeading();

      expect(heading).toBeGreaterThanOrEqual(0);
      expect(heading).toBeLessThan(360);
      expect(headingDiff(heading, expected)).toBeLessThan(1e-6);
    });

    it('follows the local direction of north from the engine sync, not the +Z axis', () => {
      const { engine, camera, asEngine } = fakeEngine();
      // A rotated local frame: north lies along +X.
      engine.sync.geoToLocalSimple.mockImplementation((lat: number, lon: number, h: number) => ({
        x: (lat - ORIGIN.lat) * 1e5,
        y: h,
        z: (lon - ORIGIN.lon) * 1e5,
      }));
      service.initialize(asEngine, { ...ORIGIN });
      camera.position.set(0, 50, 0);
      camera.lookAt(100, 0, 0);

      expect(headingDiff(service.getCameraHeading(), 0)).toBeLessThan(1e-6);
    });

    it('is 0 when the camera looks straight down', () => {
      const { camera, asEngine } = fakeEngine();
      service.initialize(asEngine, { ...ORIGIN });
      camera.position.set(0, 100, 0);
      camera.lookAt(0, 0, 0);

      expect(service.getCameraHeading()).toBe(0);
    });
  });

  describe('getCameraDebugInfo', () => {
    it('reports pose, altitude over the HQ terrain and the distance along the view ray', () => {
      const { engine, camera, asEngine } = fakeEngine();
      const base = { lat: 48.91, lon: 9.21 };
      service.initialize(asEngine, base);
      camera.position.set(0, 100, 0);
      camera.lookAt(0, 0, -100);

      const info = service.getCameraDebugInfo()!;

      expect(engine.getTerrainHeightAtGeo).toHaveBeenCalledWith(base.lat, base.lon);
      expect(info.posY).toBe(100);
      expect(info.terrainHeight).toBe(20);
      expect(info.altitude).toBe(80);
      expect(info.pitch).toBeCloseTo(-45, 6);
      expect(info.rotX).toBeCloseTo(-45, 6);
      expect(info.distanceToCenter).toBeCloseTo(80 / Math.sin(Math.PI / 4), 6);
      expect(headingDiff(info.heading, 180)).toBeLessThan(1e-6);
      expect(info.fov).toBe(60);
    });

    it('treats a missing terrain sample as height 0', () => {
      const { engine, camera, asEngine } = fakeEngine();
      engine.getTerrainHeightAtGeo.mockReturnValue(null);
      service.initialize(asEngine, { ...ORIGIN });
      camera.position.set(0, 100, 0);

      const info = service.getCameraDebugInfo()!;

      expect(info.terrainHeight).toBe(0);
      expect(info.altitude).toBe(100);
    });

    it('uses the altitude as distance for a level camera', () => {
      const { camera, asEngine } = fakeEngine();
      service.initialize(asEngine, { ...ORIGIN });
      camera.position.set(0, 100, 0);
      camera.rotation.set(0, 0, 0);

      expect(service.getCameraDebugInfo()!.distanceToCenter).toBe(80);
    });

    it('reports fov 60 for a camera without a field of view', () => {
      const { asEngine } = fakeEngine(new OrthographicCamera());
      service.initialize(asEngine, { ...ORIGIN });

      expect(service.getCameraDebugInfo()!.fov).toBe(60);
    });
  });

  describe('framing debug visualization', () => {
    const HQ = { ...ORIGIN };
    // 100 m west, 200 m north of the HQ
    const SPAWN = { lat: ORIGIN.lat + 0.002, lon: ORIGIN.lon - 0.001 };
    // The frame CameraFramingService fitted to them: box 0..100 x 0..200, padded by 0.2, ground at 20
    const FRAME: CameraFrame = {
      camX: 50, camY: 320, camZ: -300,
      lookAtX: 50, lookAtY: 20, lookAtZ: 90,
      boundingBox: { minX: -10, maxX: 110, minZ: -20, maxZ: 220, centerX: 50, centerZ: 100, spanX: 120, spanZ: 240 },
      cameraDistance: 500,
      cameraAngle: 45,
    };

    function setup() {
      const fake = fakeEngine();
      service.initialize(fake.asEngine, { ...ORIGIN });
      fake.camera.position.set(0, 300, -400);
      return fake;
    }

    it('toggles, reports the state and accepts an explicit value', () => {
      expect(service.isDebugFramingEnabled()).toBe(false);
      expect(service.toggleDebugFraming()).toBe(true);
      expect(service.isDebugFramingEnabled()).toBe(true);
      expect(service.toggleDebugFraming(true)).toBe(true);
      expect(service.toggleDebugFraming()).toBe(false);
      expect(service.isDebugFramingEnabled()).toBe(false);
    });

    it('draws nothing while disabled', () => {
      const { scene } = setup();
      service.showDebugVisualization(HQ, [SPAWN], FRAME, 0.2);
      expect(scene.children).toHaveLength(0);
    });

    it('draws the fitted and the padded box of the frame above its ground', () => {
      const { scene } = setup();
      service.toggleDebugFraming(true);

      service.showDebugVisualization(HQ, [SPAWN], FRAME, 0.2);

      const boxes = scene.children.filter((o) => o instanceof LineSegments);
      const inner = bounds(boxes.find((o) => colorOf(o) === 0x00ffff)!);
      const outer = bounds(boxes.find((o) => colorOf(o) === 0xffff00)!);
      expect(inner.min.x).toBeCloseTo(0, 6);
      expect(inner.max.x).toBeCloseTo(100, 6);
      expect(inner.min.z).toBeCloseTo(0, 6);
      expect(inner.max.z).toBeCloseTo(200, 6);
      expect(outer.min.x).toBeCloseTo(-10, 6);
      expect(outer.max.x).toBeCloseTo(110, 6);
      expect(outer.min.z).toBeCloseTo(-20, 6);
      expect(outer.max.z).toBeCloseTo(220, 6);
      // the frame's ground 20 + 5
      expect(inner.min.y).toBe(25);
      expect(outer.max.y).toBe(25);
    });

    it('marks HQ, spawns, the centre, the camera and the HQ-to-spawn axis', () => {
      const { scene } = setup();
      service.toggleDebugFraming(true);

      service.showDebugVisualization(HQ, [SPAWN], FRAME, 0.2);

      const spheres = scene.children.filter((o) => o instanceof Mesh);
      const byColor = (hex: number) => spheres.filter((o) => colorOf(o) === hex);
      expect(byColor(0x00ff00).map((o) => o.position.toArray())).toEqual([[0, 35, 0]]);
      expect(byColor(0xff0000)).toHaveLength(1);
      expect(byColor(0xffffff)[0].position.x).toBeCloseTo(50, 6);
      expect(byColor(0xffffff)[0].position.z).toBeCloseTo(100, 6);
      const centroid = byColor(0xff8800)[0];
      expect(centroid.position.x).toBeCloseTo(100, 6);
      expect(centroid.position.y).toBe(40);
      const camMarker = byColor(0xff00ff)[0];
      expect(camMarker.position.toArray()).toEqual([0, 300, -400]);

      const lines = scene.children.filter((o) => o instanceof Line && !(o instanceof LineSegments));
      expect(lines.map(colorOf).sort()).toEqual([0xff00ff, 0xff8800].sort());
      // The look-at line ends where the frame looks
      const lookAt = (lines.find((o) => colorOf(o) === 0xff00ff) as Line).geometry.getAttribute('position');
      expect([lookAt.getX(1), lookAt.getY(1), lookAt.getZ(1)]).toEqual([50, 20, 90]);
    });

    it('leaves out the axis and centroid without spawns', () => {
      const { scene } = setup();
      service.toggleDebugFraming(true);

      service.showDebugVisualization(HQ, [], FRAME, 0.2);

      expect(scene.children.some((o) => colorOf(o) === 0xff8800)).toBe(false);
      // two boxes, HQ, centre, camera marker, look-at line
      expect(scene.children).toHaveLength(6);
    });

    it('replaces the previous drawing instead of adding to it', () => {
      const { scene } = setup();
      service.toggleDebugFraming(true);

      service.showDebugVisualization(HQ, [SPAWN], FRAME, 0.2);
      const first = [...scene.children];
      service.showDebugVisualization(HQ, [SPAWN], FRAME, 0.2);

      expect(scene.children).toHaveLength(first.length);
      expect(scene.children.some((o) => first.includes(o))).toBe(false);
    });

    it('removes and disposes the drawing when framing debug is switched off', () => {
      const { scene } = setup();
      service.toggleDebugFraming(true);
      service.showDebugVisualization(HQ, [SPAWN], FRAME, 0.2);
      const geometries = new Set(scene.children.map((o) => (o as Mesh).geometry));
      const disposed = new Set<unknown>();
      geometries.forEach((g) => g.addEventListener('dispose', () => disposed.add(g)));

      service.toggleDebugFraming(false);

      expect(scene.children).toHaveLength(0);
      expect(disposed.size).toBe(geometries.size);
    });
  });

  describe('dispose', () => {
    it('clears the drawing and forgets engine, overview, provider and debug state', () => {
      const { engine, scene, asEngine } = fakeEngine();
      service.initialize(asEngine, { ...ORIGIN });
      service.saveInitialPosition(VIEW);
      const provider = vi.fn(() => VIEW);
      service.setOverviewProvider(provider);
      service.toggleDebugFraming(true);
      service.showDebugVisualization(ORIGIN, [], FRAME_AT_ORIGIN, 0.2);

      service.dispose();

      expect(scene.children).toHaveLength(0);
      expect(service.isDebugFramingEnabled()).toBe(false);
      expect(service.getInitialView()).toBeNull();
      expect(service.getCameraDebugInfo()).toBeNull();
      service.resetCamera();
      expect(engine.setLocalCameraPosition).not.toHaveBeenCalled();
      expect(service.getOverview()).toBeNull();
      expect(provider).not.toHaveBeenCalled();
    });

    it('can be initialized again afterwards', () => {
      const first = fakeEngine();
      service.initialize(first.asEngine, { ...ORIGIN });
      service.dispose();

      const second = fakeEngine();
      service.initialize(second.asEngine, { ...ORIGIN });
      service.saveInitialPosition(VIEW);
      service.resetCamera();

      expect(first.engine.setLocalCameraPosition).not.toHaveBeenCalled();
      expect(second.engine.setLocalCameraPosition).toHaveBeenCalledTimes(1);
    });
  });
});

describe('CameraControlService.focusGeo', () => {
  let service: CameraControlService;

  /** Camera 200 m up at the origin, looking 45° down to the north (-Z). */
  function jumpEngine(groundY: number | null) {
    const camera = {
      position: { x: 0, y: 200, z: 0 },
      getWorldDirection(target: { x: number; y: number; z: number }) {
        target.x = 0;
        target.y = -Math.SQRT1_2;
        target.z = -Math.SQRT1_2;
        return target;
      },
    };
    const engine = {
      getCamera: () => camera,
      getTerrainHeightAtGeo: () => groundY,
      sync: { geoToLocalSimple: () => ({ x: 500, y: 0, z: 300 }) },
      setLocalCameraPosition: vi.fn(),
    };
    return { engine, camera };
  }

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    service = new CameraControlService();
  });

  afterEach(() => vi.restoreAllMocks());

  it('glides to the target over the jump and keeps the view offset', () => {
    const { engine, camera } = jumpEngine(0);
    service.initialize(engine as unknown as ThreeTilesEngine, { lat: 0, lon: 0, height: 0 });

    expect(service.focusGeo(48.7, 9.1)).toBe(true);
    service.update(300);
    // Half way in time, half way in space (eased, symmetric)
    expect(camera.position.x).toBeCloseTo(250);

    service.update(300);
    expect(camera.position.x).toBeCloseTo(500);
    expect(camera.position.y).toBeCloseTo(200);
    expect(camera.position.z).toBeCloseTo(500);

    // Done: further frames leave the camera alone
    service.update(100);
    expect(camera.position.x).toBeCloseTo(500);
  });

  it('adds to other camera moves in the same frames instead of overriding them', () => {
    const { engine, camera } = jumpEngine(0);
    service.initialize(engine as unknown as ThreeTilesEngine, { lat: 0, lon: 0, height: 0 });
    service.focusGeo(48.7, 9.1);

    service.update(300);
    camera.position.x += 40; // keyboard pan during the jump
    service.update(300);

    expect(camera.position.x).toBeCloseTo(540);
  });

  it('cuts to a 45° view when the camera looks at the horizon', () => {
    const { engine, camera } = jumpEngine(10);
    camera.getWorldDirection = (target) => {
      target.x = 0;
      target.y = 0;
      target.z = -1;
      return target;
    };
    service.initialize(engine as unknown as ThreeTilesEngine, { lat: 0, lon: 0, height: 0 });

    service.focusGeo(48.7, 9.1);
    const [x, y, z, tx, ty, tz] = engine.setLocalCameraPosition.mock.calls[0];
    expect([tx, ty, tz]).toEqual([500, 10, 300]);
    expect(x).toBeCloseTo(500);
    expect(y - ty).toBeCloseTo(z - tz); // 45°
  });

  it('does nothing without an engine', () => {
    expect(service.focusGeo(48.7, 9.1)).toBe(false);
    expect(() => service.update(16)).not.toThrow();
  });
});
