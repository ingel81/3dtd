import { EventDispatcher, Group, PerspectiveCamera, Raycaster, Scene, Vector3 } from 'three';
import { EnvironmentControls, GlobeControls, type TilesRenderer } from '3d-tiles-renderer';
import type { Mock } from 'vitest';
import { CameraRig } from './camera-rig';
import { GroundPickRoot } from './ground-pick-root';

// Controls brauchen DOM-Pointer-Events und ein echtes Tileset. Die Fakes halten nur
// fest, wie der Rig sie konfiguriert.
vi.mock('3d-tiles-renderer', () => {
  class FakeControls {
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
      this.ctorArgs = args;
    }
  }

  return {
    EnvironmentControls: class EnvironmentControls extends FakeControls {},
    GlobeControls: class GlobeControls extends FakeControls {},
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
}

function setup() {
  const camera = new PerspectiveCamera(60, 16 / 9, 1, 8000);
  const canvas = document.createElement('canvas');
  canvas.setAttribute('tabindex', '0');
  const rig = new CameraRig(camera, canvas);
  const controls = () => rig.getControls() as unknown as FakeControls;
  return { camera, canvas, rig, controls };
}

/** Ellipsoid, Gruppe und die Events, an denen der Raycast-Cache der Boden-Wurzel hängt. */
function fakeTilesRenderer(): TilesRenderer {
  return Object.assign(new EventDispatcher(), {
    ellipsoid: { name: 'ellipsoid' },
    group: new Group(),
  }) as unknown as TilesRenderer;
}

function expectLookingAlong(camera: PerspectiveCamera, x: number, y: number, z: number): void {
  const dir = camera.getWorldDirection(new Vector3());
  const expected = new Vector3(x, y, z).normalize();
  expect(dir.x).toBeCloseTo(expected.x, 6);
  expect(dir.y).toBeCloseTo(expected.y, 6);
  expect(dir.z).toBeCloseTo(expected.z, 6);
}

describe('CameraRig', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Tiles-Pfad (GlobeControls)', () => {
    it('baut GlobeControls auf Boden-Wurzel, Kamera und Canvas und hängt sie ans Ellipsoid der Tiles-Gruppe', () => {
      const { camera, canvas, rig, controls } = setup();
      const scene = new Scene();
      const tiles = fakeTilesRenderer();

      rig.setupGlobeControls(scene, tiles);

      expect(rig.getControls()).toBeInstanceOf(GlobeControls);
      const [ctorScene, ctorCamera, ctorCanvas] = controls().ctorArgs;
      // Raycast-Ziel ist nicht die ganze Szene, sondern die Wurzel darin
      expect(ctorScene).toBeInstanceOf(GroundPickRoot);
      expect((ctorScene as GroundPickRoot).parent).toBe(scene);
      expect(ctorCamera).toBe(camera);
      expect(ctorCanvas).toBe(canvas);
      expect(controls().setScene).not.toHaveBeenCalled();
      expect(controls().setEllipsoid).toHaveBeenCalledWith(tiles.ellipsoid, tiles.group);
    });

    it('die Boden-Wurzel beantwortet Strahlen mit der Tiles-Gruppe', () => {
      const { rig, controls } = setup();
      const scene = new Scene();
      const tiles = fakeTilesRenderer();
      scene.add(tiles.group);
      const tilesRaycast = vi.spyOn(tiles.group, 'raycast');
      rig.setupGlobeControls(scene, tiles);

      const root = controls().ctorArgs[0] as GroundPickRoot;
      new Raycaster(new Vector3(0, 50, 0), new Vector3(0, -1, 0)).intersectObject(root);

      expect(tilesRaycast).toHaveBeenCalledTimes(1);
    });

    it('dämpft, schaltet den Double-Tap-Zoom ab und nimmt dem Canvas den Fokus', () => {
      const { canvas, rig, controls } = setup();
      rig.setupGlobeControls(new Scene(), fakeTilesRenderer());

      expect(controls().enableDamping).toBe(true);
      expect(controls().enableDoubleTapZoom).toBe(false);
      expect(canvas.hasAttribute('tabindex')).toBe(false);
    });

    it('stellt den steilen Startblick nach Norden über den Origin ein', () => {
      const { camera, rig, controls } = setup();
      rig.setupGlobeControls(new Scene(), fakeTilesRenderer());

      expect(camera.position.toArray()).toEqual([0, 400, -145]);
      expectLookingAlong(camera, 0, -400, 145);
      // Der Tiles-Pfad ruft update() erst im Render-Loop.
      expect(controls().update).not.toHaveBeenCalled();
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

  describe('setLocalPosition()', () => {
    it('setzt Position und Blickziel in lokalen Koordinaten', () => {
      const { camera, rig } = setup();
      rig.setLocalPosition(100, 250, -80, 100, 0, 20);

      expect(camera.position.toArray()).toEqual([100, 250, -80]);
      expectLookingAlong(camera, 0, -250, 100);
    });
  });

  describe('dispose()', () => {
    it('gibt die Controls frei und macht update() danach zum No-op', () => {
      const { rig, controls } = setup();
      const scene = new Scene();
      rig.setupGlobeControls(scene, fakeTilesRenderer());
      const disposed = controls();
      const root = disposed.ctorArgs[0] as GroundPickRoot;

      rig.dispose();
      rig.update();
      rig.dispose();

      expect(disposed.dispose).toHaveBeenCalledTimes(1);
      expect(disposed.update).not.toHaveBeenCalled();
      expect(rig.getControls()).toBeNull();
      expect(root.parent).toBeNull();
      expect(scene.children).not.toContain(root);
    });
  });
});
