import {
  CircleGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  Vector3,
} from 'three';
import { EnvironmentControls } from '3d-tiles-renderer';
import { instrumentRaycasts, raycastStats } from '../utils/raycast-stats';
import { GroundPickRoot } from './ground-pick-root';

/**
 * Szene wie im Spiel an der Route: Boden in einer eigenen Gruppe (die Tiles),
 * darüber eine versteckte Reichweiten-Scheibe 8 m hoch.
 */
function routeScene() {
  const scene = new Scene();
  const ground = new Group();
  const groundMesh = new Mesh(new PlaneGeometry(400, 400), new MeshBasicMaterial());
  groundMesh.rotation.x = -Math.PI / 2;
  ground.add(groundMesh);
  scene.add(ground);

  const hiddenDisc = new Mesh(new CircleGeometry(60, 48), new MeshBasicMaterial({ side: DoubleSide }));
  hiddenDisc.rotation.x = -Math.PI / 2;
  hiddenDisc.position.y = 8;
  hiddenDisc.visible = false;
  scene.add(hiddenDisc);

  const root = new GroundPickRoot(ground);
  scene.add(root);
  scene.updateMatrixWorld(true);
  return { scene, ground, groundMesh, root };
}

function downRay(x: number, y: number, z: number): Raycaster {
  return new Raycaster(new Vector3(x, y, z), new Vector3(0, -1, 0));
}

/** Kamera senkrecht über (0, y, 0), Blick nach unten. */
function cameraAbove(y: number): PerspectiveCamera {
  const camera = new PerspectiveCamera(60, 1, 1, 8000);
  camera.position.set(0, y, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  return camera;
}

describe('GroundPickRoot', () => {
  it('three trifft über die ganze Szene auch versteckte Overlays, deshalb die Wurzel', () => {
    const { scene } = routeScene();
    expect(downRay(0, 50, 0).intersectObject(scene)[0].point.y).toBeCloseTo(8, 6);
  });

  it('beantwortet Strahlen nur mit dem Boden', () => {
    const { root, groundMesh } = routeScene();
    const hits = downRay(0, 50, 0).intersectObject(root);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => hit.object === groundMesh)).toBe(true);
    expect(hits[0].point.y).toBeCloseTo(0, 6);
  });

  it('bucht die Strahlen in den Raycast-Stats als cameraControls', () => {
    const { ground, root } = routeScene();
    instrumentRaycasts(ground);
    raycastStats.reset();

    downRay(0, 50, 0).intersectObject(root);
    downRay(10, 50, 10).intersectObject(root);

    const row = raycastStats.rows().find((r) => r.caller === 'cameraControls');
    expect(row?.calls).toBe(2);
    raycastStats.reset();
  });

  it('trifft nichts, solange der Boden nicht in der Szene hängt', () => {
    const { scene, ground, root } = routeScene();
    scene.remove(ground);
    expect(downRay(0, 50, 0).intersectObject(root)).toHaveLength(0);
  });

  it('zeichnet eingehängte Kinder an ihrer Weltposition und raycastet sie nicht', () => {
    const { root } = routeScene();
    const pivot = new Mesh(new PlaneGeometry(10, 10), new MeshBasicMaterial({ side: DoubleSide }));
    pivot.rotation.x = -Math.PI / 2;
    pivot.position.set(3, 20, -4);
    root.add(pivot);
    root.updateMatrixWorld(true);

    expect(pivot.getWorldPosition(new Vector3()).toArray()).toEqual([3, 20, -4]);
    const hits = downRay(3, 50, -4).intersectObject(root);
    expect(hits[0].point.y).toBeCloseTo(0, 6);
  });

  describe('mit den echten EnvironmentControls', () => {
    it('Mindestabstand: die versteckte Scheibe hebt die Kamera nicht mehr an', () => {
      const sceneCamera = cameraAbove(6);
      new EnvironmentControls(routeScene().scene, sceneCamera).adjustCamera(sceneCamera);
      // 5 m cameraRadius über der Scheibe in 8 m
      expect(sceneCamera.position.y).toBeCloseTo(13, 6);

      const camera = cameraAbove(6);
      new EnvironmentControls(routeScene().root, camera).adjustCamera(camera);
      expect(camera.position.y).toBeCloseTo(6, 6);
    });

    it('Pivot für Zoom, Ziehen und Drehen liegt auf dem Boden, nicht auf der Scheibe', () => {
      const scenePivot = new Vector3();
      new EnvironmentControls(routeScene().scene, cameraAbove(50)).getPivotPoint(scenePivot);
      expect(scenePivot.y).toBeCloseTo(8, 6);

      const pivot = new Vector3();
      new EnvironmentControls(routeScene().root, cameraAbove(50)).getPivotPoint(pivot);
      expect(pivot.y).toBeCloseTo(0, 6);
    });
  });
});
