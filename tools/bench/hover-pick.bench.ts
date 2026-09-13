// @vitest-environment node
/**
 * Hover pick of the towers: what one ScreenPicker.raycastTowers() costs.
 *
 * InputHandlerService picks at most every 100 ms while the pointer moves
 * outside build mode, and not while a button is held. The pick tests the
 * tower meshes only, one after the other, until one is hit; enemies are not
 * part of it, so their number does not enter the pick.
 *
 * Real tower models (GLBs from public/, loaded in Node without their images
 * like the model-budget tools do), cloned, scaled and rotated like
 * ThreeTowerRenderer.create() does it, on a grid around the HQ.
 *
 *   npm run bench -- hover
 *
 * Conditions: Node, no DOM, no rendering; the bounding spheres are computed
 * once before the runs, as after the first pick in the game.
 */
import { describe, test } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PerspectiveCamera, Vector3, type Object3D, type WebGLRenderer } from 'three';
import { TOWER_TYPES, type TowerTypeId } from '../../src/app/configs/tower-types.config';
import { ScreenPicker, type PickableTowers } from '../../src/app/three-engine/screen-picker';
import type { TerrainSources } from '../../src/app/three-engine/terrain-queries';
import { loadGlb } from '../model-budget/glb-node.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WIDTH = 1920;
const HEIGHT = 1080;

/** The tower types that stand on the map, research building left out. */
const TYPES = (Object.keys(TOWER_TYPES) as TowerTypeId[]).filter((id) =>
  TOWER_TYPES[id].modelUrl.includes('/towers/'),
);

const templates = new Map<string, Object3D>();
for (const id of TYPES) {
  const url = TOWER_TYPES[id].modelUrl;
  if (!templates.has(url)) templates.set(url, (await loadGlb(resolve(ROOT, 'public', url))).root);
}

const camera = new PerspectiveCamera(60, WIDTH / HEIGHT, 1, 8000);
camera.position.set(0, 400, -145);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld(true);

const renderer = {
  domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: WIDTH, height: HEIGHT }) },
} as unknown as WebGLRenderer;
const noTerrain = {} as TerrainSources;

/** `count` towers on a 20 m grid around the HQ, the types in turn, like create() builds them. */
function towers(count: number): { id: string; mesh: Object3D }[] {
  const side = Math.ceil(Math.sqrt(count));
  const list: { id: string; mesh: Object3D }[] = [];
  for (let i = 0; i < count; i++) {
    const config = TOWER_TYPES[TYPES[i % TYPES.length]];
    const mesh = templates.get(config.modelUrl)!.clone();
    mesh.scale.setScalar(config.scale);
    mesh.rotation.y = (config.rotationY ?? 0) + i;
    mesh.position.set(((i % side) - side / 2) * 20, config.heightOffset, (Math.floor(i / side) - side / 2) * 20);
    mesh.updateMatrixWorld(true);
    list.push({ id: `tower-${i}`, mesh });
  }
  return list;
}

/** Screen position of a world point, px. */
function screenOf(point: Vector3): { x: number; y: number } {
  const ndc = point.clone().project(camera);
  return { x: ((ndc.x + 1) / 2) * WIDTH, y: ((1 - ndc.y) / 2) * HEIGHT };
}

for (const count of [20, 80]) {
  const list = towers(count);
  const pickable: PickableTowers = { getAllMeshes: () => list.map(({ id, mesh }) => ({ id, mesh })) };
  const picker = new ScreenPicker(camera, renderer, pickable, noTerrain);

  // Over the sky above the towers: every tower is tested and missed
  const empty = { x: WIDTH / 2, y: 20 };
  // Onto the middle of the last tower, found after all the others
  const last = list[list.length - 1].mesh;
  const onLast = screenOf(new Vector3(0, 4, 0).add(last.position));
  // Onto the ground halfway to the next tower: the ray passes close to towers
  const between = screenOf(new Vector3(10, 0, 0).add(last.position).setY(0));
  const hitLast = picker.raycastTowers(onLast.x, onLast.y);
  const missEmpty = picker.raycastTowers(empty.x, empty.y);
  const betweenResult = picker.raycastTowers(between.x, between.y);
  console.log(
    `[hover bench] ${count} towers: sky -> ${missEmpty}, ground between towers -> ${betweenResult}, last tower -> ${hitLast}`,
  );

  describe(`${count} towers`, () => {
    test('one pick', async ({ bench }) => {
      await bench.compare(
        bench('pointer over the sky, no tower', () => {
          picker.raycastTowers(empty.x, empty.y);
        }),
        bench('pointer on the ground between towers', () => {
          picker.raycastTowers(between.x, between.y);
        }),
        bench('pointer over the last placed tower', () => {
          picker.raycastTowers(onLast.x, onLast.y);
        }),
      );
    });
  });
}
