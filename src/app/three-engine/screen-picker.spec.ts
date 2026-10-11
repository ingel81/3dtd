import {
  BoxGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Vector3,
  type Object3D,
  type WebGLRenderer,
} from 'three';
import type { TilesRenderer } from '3d-tiles-renderer';
import { instrumentRaycasts, raycastStats } from '../utils/raycast-stats';
import type { WorldSurface } from '../world/world-provider';
import type { EllipsoidSync } from './ellipsoid-sync';
import { ScreenPicker } from './screen-picker';
import { TerrainQueries } from './terrain-queries';

const material = new MeshBasicMaterial({ side: DoubleSide });

/** Canvas bei (10, 20) mit 800 x 600 px; seine Mitte liegt bei (410, 320). */
const RECT = { left: 10, top: 20, width: 800, height: 600 };
const CENTER = { x: 410, y: 320 };
const TOP_LEFT = { x: 10, y: 20 };

/** Boden: Quadrat mit 40 m Kante in y=0 um den Origin. */
function floor(): Mesh {
  const mesh = new Mesh(new PlaneGeometry(40, 40), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.updateMatrixWorld();
  return mesh;
}

/** Tower-Ersatz: 4-m-Würfel bei (x, y, z), ohne y auf dem Boden. */
function towerMesh(x: number, z: number, y = 2): Mesh {
  const mesh = new Mesh(new BoxGeometry(4, 4, 4), material);
  mesh.position.set(x, y, z);
  mesh.updateMatrixWorld();
  return mesh;
}

function setup() {
  // Blick schräg von oben auf den Origin: die Canvas-Mitte trifft (0, 0, 0).
  const camera = new PerspectiveCamera(60, RECT.width / RECT.height, 1, 1000);
  camera.position.set(0, 100, 50);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const renderer = { domElement: { getBoundingClientRect: () => RECT } } as unknown as WebGLRenderer;

  const group = new Group();
  group.add(floor());
  group.updateMatrixWorld(true);
  let tiles: TilesRenderer | null = { group } as unknown as TilesRenderer;
  let towerMeshes: { id: string; mesh: Object3D }[] = [];
  // The tiles world's surface; another world brings its own (useOtherWorld)
  let ground: Pick<WorldSurface, 'pickRay'> = new TerrainQueries({} as EllipsoidSync, { tiles: () => tiles });

  const picker = new ScreenPicker(camera, renderer, { getAllMeshes: () => towerMeshes }, {
    pickRay: (raycaster) => ground.pickRay(raycaster),
  });

  return {
    picker, camera, renderer, group,
    setTowers: (meshes: { id: string; mesh: Object3D }[]) => { towerMeshes = meshes; },
    dropTiles: () => { tiles = null; },
    useOtherWorld: () => {
      const surface = { pickRay: vi.fn((_ray: Raycaster) => new Vector3(1, 2, 3)) };
      ground = surface;
      return surface;
    },
  };
}

describe('ScreenPicker', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('raycastTerrain()', () => {
    it('liefert den Boden unter dem Canvas-Punkt, relativ zum Canvas-Rechteck', () => {
      const { picker } = setup();
      const hit = picker.raycastTerrain(CENTER.x, CENTER.y);

      expect(hit).toBeInstanceOf(Vector3);
      expect(hit!.x).toBeCloseTo(0, 6);
      expect(hit!.y).toBeCloseTo(0, 6);
      expect(hit!.z).toBeCloseTo(0, 6);
    });

    it('liefert null, wenn unter dem Punkt kein Tile liegt oder es keine Tiles gibt', () => {
      const world = setup();
      expect(world.picker.raycastTerrain(TOP_LEFT.x, TOP_LEFT.y)).toBeNull();

      world.dropTiles();
      expect(world.picker.raycastTerrain(CENTER.x, CENTER.y)).toBeNull();
    });

    it('bucht seinen Strahl auf screenPick', () => {
      const { picker, group } = setup();
      instrumentRaycasts(group);
      raycastStats.reset();

      picker.raycastTerrain(CENTER.x, CENTER.y);
      expect(raycastStats.rows().map(({ caller, calls }) => ({ caller, calls }))).toEqual([
        { caller: 'screenPick', calls: 1 },
      ]);
    });

    it('gibt einer anderen Welt (DevWorld) einen frischen Strahl durch den Punkt', () => {
      const { picker, camera, useOtherWorld } = setup();
      const surface = useOtherWorld();

      expect(picker.raycastTerrain(CENTER.x, CENTER.y)?.toArray()).toEqual([1, 2, 3]);
      const ray = surface.pickRay.mock.calls[0][0];
      expect(ray.ray.origin.toArray()).toEqual(camera.position.toArray());
      expect(ray.far).toBe(Infinity);
    });
  });

  describe('raycastTowers()', () => {
    it('liefert die ID des Towers unter dem Punkt und null daneben', () => {
      const { picker, setTowers } = setup();
      setTowers([
        { id: 'far', mesh: towerMesh(200, 0) },
        { id: 'center', mesh: towerMesh(0, 0) },
      ]);

      expect(picker.raycastTowers(CENTER.x, CENTER.y)).toBe('center');
      expect(picker.raycastTowers(TOP_LEFT.x, TOP_LEFT.y)).toBeNull();
    });

    it('nimmt bei mehreren Treffern den vordersten Tower, egal wo er in der Liste steht', () => {
      const { picker, setTowers } = setup();
      // (0, 10, 5) liegt auf dem Strahl durch die Canvas-Mitte, zwischen Kamera und Origin
      const back = towerMesh(0, 0);
      const front = towerMesh(0, 5, 10);

      setTowers([{ id: 'back', mesh: back }, { id: 'front', mesh: front }]);
      expect(picker.raycastTowers(CENTER.x, CENTER.y)).toBe('front');

      setTowers([{ id: 'front', mesh: front }, { id: 'back', mesh: back }]);
      expect(picker.raycastTowers(CENTER.x, CENTER.y)).toBe('front');
    });

    it('nimmt bei gleich weiten Treffern den ersten Tower der Liste', () => {
      const { picker, setTowers } = setup();
      setTowers([
        { id: 'first', mesh: towerMesh(0, 0) },
        { id: 'second', mesh: towerMesh(0, 0) },
      ]);
      expect(picker.raycastTowers(CENTER.x, CENTER.y)).toBe('first');
    });

    it('liefert ohne Tower null', () => {
      const { picker } = setup();
      expect(picker.raycastTowers(CENTER.x, CENTER.y)).toBeNull();
    });
  });
});
