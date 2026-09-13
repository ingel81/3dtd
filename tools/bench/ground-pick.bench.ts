// @vitest-environment node
/**
 * Ground pick cache (GroundPickRoot): what a repeated camera ray costs when
 * the cache answers it, next to the same ray cast.
 *
 * The cast here goes into a single plane and is far cheaper than a ray into
 * the tiles (0.27 ms per ray in playtest 254). The cached row is the cache's
 * own cost per ray; the saving in the game is the tile ray it replaces.
 *
 *   npm run bench -- ground-pick
 *
 * Conditions: Node, no DOM; the ray is the one the controls cast below the
 * camera every frame (firstHitOnly, from 1e5 m above, near 0, far Infinity).
 */
import { describe, test } from 'vitest';
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry, Raycaster, Scene, Vector3 } from 'three';
import { GroundPickRoot } from '../../src/app/three-engine/ground-pick-root';

function root(tileSet: { value: number } | null): GroundPickRoot {
  const scene = new Scene();
  const ground = new Group();
  const plane = new Mesh(new PlaneGeometry(400, 400), new MeshBasicMaterial());
  plane.rotation.x = -Math.PI / 2;
  ground.add(plane);
  scene.add(ground);
  const pick = new GroundPickRoot(ground, tileSet);
  scene.add(pick);
  scene.updateMatrixWorld(true);
  return pick;
}

const ray = new Raycaster(new Vector3(3, 1e5 + 50, 7), new Vector3(0, -1, 0), 0, Infinity);
(ray as Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;

describe('camera ray below the camera', () => {
  test('one ray', async ({ bench }) => {
    const cached = root({ value: 0 });
    const cast = root(null);
    await bench.compare(
      bench('repeated ray, answered from the cache', () => {
        ray.intersectObject(cached);
      }),
      bench('same ray cast into one plane, no cache', () => {
        ray.intersectObject(cast);
      }),
    );
  });
});
