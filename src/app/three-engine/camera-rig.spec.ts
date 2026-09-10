import { Group, PerspectiveCamera, Scene, Vector3 } from 'three';
import { EnvironmentControls, GlobeControls, type TilesRenderer } from '3d-tiles-renderer';
import type { Mock } from 'vitest';
import { CameraRig } from './camera-rig';

// Controls brauchen DOM-Pointer-Events und ein echtes Tileset. Die Fakes halten nur
// fest, wie der Rig sie konfiguriert; das Ellipsoid bleibt das echte WGS84.
vi.mock('3d-tiles-renderer', async () => {
  const { EventDispatcher } = await import('three');
  const { WGS84_ELLIPSOID } = await import('3d-tiles-renderer/src/three/renderer/math/GeoConstants.js');

  class FakeControls extends EventDispatcher<{ start: object; end: object }> {
    readonly ctorArgs: unknown[];
    enableDamping = false;
    enableDoubleTapZoom = true;
    minDistance = 0;
    maxDistance = Infinity;
    minAltitude = 0;
    maxAltitude = Math.PI;
    setScene = vi.fn();
    setEllipsoid = vi.fn();
    update = vi.fn();
    dispose = vi.fn();

    constructor(...args: unknown[]) {
      super();
      this.ctorArgs = args;
    }
  }

  return {
    EnvironmentControls: class EnvironmentControls extends FakeControls {},
    GlobeControls: class GlobeControls extends FakeControls {},
    WGS84_ELLIPSOID,
  };
});

/** Was die Fake-Controls oben mitschreiben. */
interface FakeControls {
  ctorArgs: unknown[];
  enableDamping: boolean;
  enableDoubleTapZoom: boolean;
  minDistance: number;
  maxDistance: number;
  minAltitude: number;
  maxAltitude: number;
  setScene: Mock;
  setEllipsoid: Mock;
  update: Mock;
  dispose: Mock;
  dispatchEvent(event: { type: 'start' | 'end' }): void;
}

function setup() {
  const camera = new PerspectiveCamera(60, 16 / 9, 1, 8000);
  const canvas = document.createElement('canvas');
  canvas.setAttribute('tabindex', '0');
  const rig = new CameraRig(camera, canvas);
  const controls = () => rig.getControls() as unknown as FakeControls;
  return { camera, canvas, rig, controls };
}

function fakeTilesRenderer(): TilesRenderer {
  return { ellipsoid: { name: 'ellipsoid' }, group: new Group() } as unknown as TilesRenderer;
}

function expectLookingAlong(camera: PerspectiveCamera, x: number, y: number, z: number): void {
  const dir = camera.getWorldDirection(new Vector3());
  const expected = new Vector3(x, y, z).normalize();
  expect(dir.x).toBeCloseTo(expected.x, 6);
  expect(dir.y).toBeCloseTo(expected.y, 6);
  expect(dir.z).toBeCloseTo(expected.z, 6);
}

describe('CameraRig', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Tiles-Pfad (GlobeControls)', () => {
    it('baut GlobeControls auf Szene, Kamera und Canvas und hängt sie ans Ellipsoid der Tiles-Gruppe', () => {
      const { camera, canvas, rig, controls } = setup();
      const scene = new Scene();
      const tiles = fakeTilesRenderer();

      rig.setupGlobeControls(scene, tiles);

      expect(rig.getControls()).toBeInstanceOf(GlobeControls);
      const [ctorScene, ctorCamera, ctorCanvas] = controls().ctorArgs;
      expect(ctorScene).toBe(scene);
      expect(ctorCamera).toBe(camera);
      expect(ctorCanvas).toBe(canvas);
      expect(controls().setScene).toHaveBeenCalledWith(scene);
      expect(controls().setEllipsoid).toHaveBeenCalledWith(tiles.ellipsoid, tiles.group);
    });

    it('dämpft, schaltet den Double-Tap-Zoom ab und nimmt dem Canvas den Fokus', () => {
      const { canvas, rig, controls } = setup();
      rig.setupGlobeControls(new Scene(), fakeTilesRenderer());

      expect(controls().enableDamping).toBe(true);
      expect(controls().enableDoubleTapZoom).toBe(false);
      expect(canvas.hasAttribute('tabindex')).toBe(false);
    });

    it('stellt ohne Vorgabe den steilen Standardblick nach Norden über den Origin ein', () => {
      const { camera, rig, controls } = setup();
      rig.setupGlobeControls(new Scene(), fakeTilesRenderer());

      expect(camera.position.toArray()).toEqual([0, 400, -145]);
      expectLookingAlong(camera, 0, -400, 145);
      // Der Tiles-Pfad ruft update() erst im Render-Loop.
      expect(controls().update).not.toHaveBeenCalled();
    });

    it('übernimmt eine vorab gesetzte Startposition samt Blickziel', () => {
      const { camera, rig } = setup();
      rig.setInitialPosition({ x: 10, y: 300, z: -50, lookAtX: 10, lookAtY: 0, lookAtZ: 20 });
      rig.setupGlobeControls(new Scene(), fakeTilesRenderer());

      expect(camera.position.toArray()).toEqual([10, 300, -50]);
      expectLookingAlong(camera, 0, -300, 70);
    });
  });

  describe('DevWorld (EnvironmentControls)', () => {
    it('baut EnvironmentControls mit Zoom- und Höhengrenzen und raycastet gegen die DevWorld-Gruppe', () => {
      const { canvas, rig, controls } = setup();
      const scene = new Scene();
      const devWorldGroup = new Group();

      rig.setupEnvironmentControls(scene, devWorldGroup);

      expect(rig.getControls()).toBeInstanceOf(EnvironmentControls);
      expect(rig.getControls()).not.toBeInstanceOf(GlobeControls);
      expect(controls().ctorArgs[0]).toBe(scene);
      expect(controls().setScene).toHaveBeenCalledWith(devWorldGroup);
      expect(controls().enableDamping).toBe(true);
      expect(controls().enableDoubleTapZoom).toBe(false);
      expect(controls().minDistance).toBe(5);
      expect(controls().maxDistance).toBe(2000);
      expect(controls().minAltitude).toBe(0.1);
      expect(controls().maxAltitude).toBeCloseTo(Math.PI / 2 - 0.1, 10);
      expect(canvas.hasAttribute('tabindex')).toBe(false);
    });

    it('positioniert die Kamera wie im Tiles-Pfad und zieht die Controls einmal nach', () => {
      const { camera, rig, controls } = setup();
      rig.setupEnvironmentControls(new Scene(), new Group());

      expect(camera.position.toArray()).toEqual([0, 400, -145]);
      expectLookingAlong(camera, 0, -400, 145);
      expect(controls().update).toHaveBeenCalledTimes(1);
    });
  });

  describe('Drag-Tracking', () => {
    it('meldet ein Drag-Ende erst ab mehr als 5 m Kamerabewegung', () => {
      const { camera, rig, controls } = setup();
      rig.setupGlobeControls(new Scene(), fakeTilesRenderer());
      const onDragEnd = vi.fn();
      rig.onDragEnd = onDragEnd;

      controls().dispatchEvent({ type: 'start' });
      camera.position.x += 3;
      controls().dispatchEvent({ type: 'end' });
      expect(onDragEnd).not.toHaveBeenCalled();
      expect(rig.getLastMovement()).toBeCloseTo(3, 6);

      controls().dispatchEvent({ type: 'start' });
      camera.position.z += 10;
      controls().dispatchEvent({ type: 'end' });
      expect(onDragEnd).toHaveBeenCalledTimes(1);
      expect(rig.getLastMovement()).toBeCloseTo(10, 6);
    });

    it('hört nach dispose() nicht mehr zu', () => {
      const { camera, rig, controls } = setup();
      rig.setupGlobeControls(new Scene(), fakeTilesRenderer());
      const onDragEnd = vi.fn();
      rig.onDragEnd = onDragEnd;
      const disposed = controls();

      rig.dispose();
      disposed.dispatchEvent({ type: 'start' });
      camera.position.x += 50;
      disposed.dispatchEvent({ type: 'end' });

      expect(onDragEnd).not.toHaveBeenCalled();
      expect(rig.getLastMovement()).toBe(0);
    });
  });

  describe('dispose()', () => {
    it('gibt die Controls frei und macht update() danach zum No-op', () => {
      const { rig, controls } = setup();
      rig.setupGlobeControls(new Scene(), fakeTilesRenderer());
      const disposed = controls();

      rig.dispose();
      rig.update();
      rig.dispose();

      expect(disposed.dispose).toHaveBeenCalledTimes(1);
      expect(disposed.update).not.toHaveBeenCalled();
      expect(rig.getControls()).toBeNull();
    });
  });

  describe('update()', () => {
    it('ist vor dem Setup ein No-op und reicht danach an die Controls weiter', () => {
      const { rig, controls } = setup();
      expect(() => rig.update()).not.toThrow();

      rig.setupGlobeControls(new Scene(), fakeTilesRenderer());
      rig.update();
      rig.update();
      expect(controls().update).toHaveBeenCalledTimes(2);
    });
  });

  describe('Kamera-Setter', () => {
    it('setLocalPosition setzt Position und Blickziel in lokalen Koordinaten', () => {
      const { camera, rig } = setup();
      rig.setLocalPosition(100, 250, -80, 100, 0, 20);

      expect(camera.position.toArray()).toEqual([100, 250, -80]);
      expectLookingAlong(camera, 0, -250, 100);
    });

    it('setGeoPosition rechnet über das WGS84-Ellipsoid im Rahmen der Tiles-Gruppe', () => {
      const { camera, rig } = setup();

      // Äquator/Nullmeridian liegt auf der ECEF-X-Achse.
      rig.setGeoPosition(new Group(), 0, 0, 100, 0, -45, 0);
      expect(camera.position.x).toBeCloseTo(6378137 + 100, 3);
      expect(camera.position.y).toBeCloseTo(0, 3);
      expect(camera.position.z).toBeCloseTo(0, 3);

      // Wie im Engine: Z-up-Tileset um -90° um X in die Y-up-Szene gedreht.
      const tilesGroup = new Group();
      tilesGroup.rotation.x = -Math.PI / 2;
      rig.setGeoPosition(tilesGroup, 90, 0, 100, 0, -45, 0);
      expect(camera.position.x).toBeCloseTo(0, 3);
      expect(camera.position.y).toBeCloseTo(6356752.314245 + 100, 3);
      expect(camera.position.z).toBeCloseTo(0, 3);
    });
  });
});
