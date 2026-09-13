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
import { EnvironmentControls, TilesRenderer } from '3d-tiles-renderer';
import { instrumentRaycasts, raycastStats } from '../utils/raycast-stats';
import { GroundPickRoot, TileSetVersion } from './ground-pick-root';

/**
 * Szene wie im Spiel an der Route: Boden in einer eigenen Gruppe (die Tiles),
 * darüber eine versteckte Reichweiten-Scheibe 8 m hoch. Mit `tileSet` hat die
 * Wurzel ihren Raycast-Cache; die Specs zählen die Version von Hand hoch.
 */
function routeScene(tileSet: { value: number } | null = null) {
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

  const root = new GroundPickRoot(ground, tileSet);
  scene.add(root);
  scene.updateMatrixWorld(true);
  return { scene, ground, groundMesh, root };
}

function downRay(x: number, y: number, z: number): Raycaster {
  return new Raycaster(new Vector3(x, y, z), new Vector3(0, -1, 0));
}

/** Wie die Controls ihren Raycaster einstellen: nur der nächste Treffer zählt. */
function firstHitRay(origin: Vector3, direction: Vector3): Raycaster {
  const raycaster = new Raycaster(origin, direction.clone().normalize());
  (raycaster as Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;
  return raycaster;
}

/** Ein frisch geladenes Tile: ein Dach in 12 m über (0, 0). */
function roofTile(): Mesh {
  const roof = new Mesh(new PlaneGeometry(20, 20), new MeshBasicMaterial());
  roof.rotation.x = -Math.PI / 2;
  roof.position.y = 12;
  return roof;
}

function emit(tiles: TilesRenderer, type: string): void {
  tiles.dispatchEvent({ type } as never);
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

    it('in Ruhe erreichen nur die Strahlen des ersten Updates den Boden, bis sich die Tiles ändern', () => {
      const tileSet = { value: 0 };
      const { root, groundMesh } = routeScene(tileSet);
      const meshRaycast = vi.spyOn(groundMesh, 'raycast');
      const camera = cameraAbove(50);
      const controls = new EnvironmentControls(root, camera);

      controls.update(1 / 60);
      const firstFrame = meshRaycast.mock.calls.length;
      expect(firstFrame).toBeGreaterThan(0);
      for (let i = 0; i < 5; i++) controls.update(1 / 60);
      expect(meshRaycast).toHaveBeenCalledTimes(firstFrame);
      expect(camera.position.y).toBeCloseTo(50, 6);

      tileSet.value++;
      controls.update(1 / 60);
      expect(meshRaycast).toHaveBeenCalledTimes(2 * firstFrame);
    });
  });

  describe('Cache', () => {
    function cachedScene() {
      const tileSet = { value: 0 };
      const s = routeScene(tileSet);
      const meshRaycast = vi.spyOn(s.groundMesh, 'raycast');
      return { ...s, tileSet, meshRaycast };
    }

    it('beantwortet einen wiederholten Strahl aus dem Speicher, mit demselben Treffer', () => {
      const { root, meshRaycast } = cachedScene();
      const first = downRay(5, 50, 5).intersectObject(root);
      const second = downRay(5, 50, 5).intersectObject(root);

      expect(meshRaycast).toHaveBeenCalledTimes(1);
      expect(second).toHaveLength(first.length);
      expect(second[0].point.toArray()).toEqual(first[0].point.toArray());
      expect(second[0].distance).toBe(first[0].distance);
      expect(second[0].object).toBe(first[0].object);
    });

    it('merkt sich auch einen Strahl ohne Treffer', () => {
      const { root, meshRaycast } = cachedScene();
      const up = () => new Raycaster(new Vector3(0, 50, 0), new Vector3(0, 1, 0));
      expect(up().intersectObject(root)).toHaveLength(0);
      expect(up().intersectObject(root)).toHaveLength(0);
      expect(meshRaycast).toHaveBeenCalledTimes(1);
    });

    it('ein nachgeladenes Tile zählt erst mit der neuen Version, dann aber sofort', () => {
      const { root, ground, tileSet } = cachedScene();
      expect(downRay(0, 50, 0).intersectObject(root)[0].point.y).toBeCloseTo(0, 6);

      const roof = roofTile();
      ground.add(roof);
      ground.updateMatrixWorld(true);
      // Ohne Meldung der Tiles bliebe der alte Treffer stehen, deshalb die Version
      expect(downRay(0, 50, 0).intersectObject(root)[0].point.y).toBeCloseTo(0, 6);

      tileSet.value++;
      expect(downRay(0, 50, 0).intersectObject(root)[0].point.y).toBeCloseTo(12, 6);
    });

    it('ein entladenes Tile verschwindet mit der neuen Version aus den Treffern', () => {
      const { root, ground, tileSet } = cachedScene();
      const roof = roofTile();
      ground.add(roof);
      ground.updateMatrixWorld(true);
      expect(downRay(0, 50, 0).intersectObject(root)[0].object).toBe(roof);

      ground.remove(roof);
      tileSet.value++;
      const hits = downRay(0, 50, 0).intersectObject(root);
      expect(hits.some((hit) => hit.object === roof)).toBe(false);
      expect(hits[0].point.y).toBeCloseTo(0, 6);
    });

    it('rechnet neu, wenn die Tiles-Gruppe sich bewegt (neuer Origin), auch ohne neue Version', () => {
      const { root, ground } = cachedScene();
      expect(downRay(0, 50, 0).intersectObject(root)[0].point.y).toBeCloseTo(0, 6);
      ground.position.y = -2;
      ground.updateMatrixWorld(true);
      expect(downRay(0, 50, 0).intersectObject(root)[0].point.y).toBeCloseTo(-2, 6);
    });

    it('Ursprung: bis 1 mm daneben aus dem Speicher, weiter weg neu gerechnet', () => {
      const { root, meshRaycast } = cachedScene();
      downRay(0, 50, 0).intersectObject(root);
      downRay(0.0005, 50, 0).intersectObject(root);
      expect(meshRaycast).toHaveBeenCalledTimes(1);

      const moved = downRay(0.002, 50, 0).intersectObject(root);
      expect(meshRaycast).toHaveBeenCalledTimes(2);
      expect(moved[0].point.x).toBeCloseTo(0.002, 9);
    });

    it('Richtung: mit firstHitOnly zählt der Weg bis zum Treffer, 1 mm Versatz dort', () => {
      const { root, meshRaycast } = cachedScene();
      const origin = new Vector3(0, 50, 0);
      firstHitRay(origin, new Vector3(0, -1, 0)).intersectObject(root);
      // 1e-5 rad auf 50 m sind 0,5 mm am Treffer
      firstHitRay(origin, new Vector3(1e-5, -1, 0)).intersectObject(root);
      expect(meshRaycast).toHaveBeenCalledTimes(1);
      // 1e-4 rad sind 5 mm
      firstHitRay(origin, new Vector3(1e-4, -1, 0)).intersectObject(root);
      expect(meshRaycast).toHaveBeenCalledTimes(2);
    });

    it('Richtung ohne firstHitOnly: jede sichtbare Drehung rechnet neu', () => {
      const { root, meshRaycast } = cachedScene();
      downRay(0, 50, 0).intersectObject(root);
      new Raycaster(new Vector3(0, 50, 0), new Vector3(1e-5, -1, 0).normalize()).intersectObject(root);
      expect(meshRaycast).toHaveBeenCalledTimes(2);
    });

    it('rechnet neu, wenn near, far oder firstHitOnly sich ändern', () => {
      const { root, meshRaycast } = cachedScene();
      downRay(0, 50, 0).intersectObject(root);

      const short = downRay(0, 50, 0);
      short.far = 40;
      expect(short.intersectObject(root)).toHaveLength(0);
      const late = downRay(0, 50, 0);
      late.near = 60;
      expect(late.intersectObject(root)).toHaveLength(0);
      firstHitRay(new Vector3(0, 50, 0), new Vector3(0, -1, 0)).intersectObject(root);

      expect(meshRaycast).toHaveBeenCalledTimes(4);
    });

    it('gibt Kopien heraus: was die Controls am Treffer ändern, bleibt nicht im Speicher', () => {
      const { root } = cachedScene();
      for (let i = 0; i < 3; i++) {
        const hit = downRay(0, 50, 0).intersectObject(root)[0];
        expect(hit.distance).toBeCloseTo(50, 6);
        expect(hit.point.y).toBeCloseTo(0, 6);
        // wie _getPointBelowCamera(): distance -= 1e5
        hit.distance -= 1e5;
        hit.point.y = 99;
      }
    });

    it('hält die zwei abwechselnden Strahlen der Controls in Ruhe', () => {
      const { root, meshRaycast } = cachedScene();
      for (let frame = 0; frame < 3; frame++) {
        downRay(0, 1e5, 0).intersectObject(root);
        firstHitRay(new Vector3(0, 1e5, 0), new Vector3(0, -1, 0)).intersectObject(root);
      }
      expect(meshRaycast).toHaveBeenCalledTimes(2);
    });

    it('der Boden außerhalb der Szene trifft auch mit gefülltem Cache nichts', () => {
      const { scene, ground, root } = cachedScene();
      const hits = downRay(0, 50, 0).intersectObject(root).length;
      expect(hits).toBeGreaterThan(0);
      scene.remove(ground);
      expect(downRay(0, 50, 0).intersectObject(root)).toHaveLength(0);
      scene.add(ground);
      expect(downRay(0, 50, 0).intersectObject(root)).toHaveLength(hits);
    });

    it('ohne Version rechnet jeder Strahl neu', () => {
      const { root, groundMesh } = routeScene();
      const meshRaycast = vi.spyOn(groundMesh, 'raycast');
      downRay(0, 50, 0).intersectObject(root);
      downRay(0, 50, 0).intersectObject(root);
      expect(meshRaycast).toHaveBeenCalledTimes(2);
    });

    it('bucht nur die gerechneten Strahlen in den Raycast-Stats', () => {
      const { ground, root } = cachedScene();
      instrumentRaycasts(ground);
      raycastStats.reset();

      for (let i = 0; i < 5; i++) downRay(0, 50, 0).intersectObject(root);

      expect(raycastStats.rows().find((r) => r.caller === 'cameraControls')?.calls).toBe(1);
      raycastStats.reset();
    });
  });
});

describe('TileSetVersion', () => {
  it('zählt bei Laden, Entladen, Sichtbarkeit, neuem Tileset und needs-update hoch', () => {
    const tiles = new TilesRenderer();
    const version = new TileSetVersion(tiles);
    for (const type of ['load-tileset', 'load-model', 'dispose-model', 'tile-visibility-change', 'needs-update']) {
      const before = version.value;
      emit(tiles, type);
      expect(version.value, type).toBe(before + 1);
    }
  });

  it('zählt nach einem Update nur, wenn die Traversierung lief (frameCount)', () => {
    const tiles = new TilesRenderer();
    const version = new TileSetVersion(tiles);

    // UpdateOnChangePlugin hat die Traversierung übersprungen
    emit(tiles, 'update-after');
    expect(version.value).toBe(0);

    (tiles as unknown as { frameCount: number }).frameCount++;
    emit(tiles, 'update-after');
    expect(version.value).toBe(1);
    emit(tiles, 'update-after');
    expect(version.value).toBe(1);
  });

  it('meldet sich mit dispose() ab', () => {
    const tiles = new TilesRenderer();
    const version = new TileSetVersion(tiles);
    version.dispose();
    emit(tiles, 'needs-update');
    (tiles as unknown as { frameCount: number }).frameCount++;
    emit(tiles, 'update-after');
    expect(version.value).toBe(0);
  });
});
