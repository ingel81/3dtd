import { BufferGeometry, Mesh, MeshBasicMaterial, MeshDepthMaterial, Raycaster, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { HeightField } from '../height-field';
import { mapToScene } from '../map-coords';
import { HeightTexture } from './height-texture';
import { TerrainChunks } from './terrain-chunks';

/** Updates until every chunk shows the level it wants (a few chunks are built each update) */
function settle(chunks: TerrainChunks, eye: Vector3, focus?: Vector3): void {
  for (let k = 0; k < 100 && !(k > 0 && chunks.settled); k++) chunks.update(eye, focus);
}

describe('TerrainChunks', () => {
  /** A view's first frame built the finest level of every chunk of the map (45 ms on 2048 m in a dev build) */
  it('starts at the coarsest level and refines the nearest chunks first, a few each update', () => {
    const n = 513;
    const field = new HeightField({ columns: n, rows: n, cellSize: 2, heights: new Float32Array(n * n) }, 1024, 1024);
    const chunks = new TerrainChunks(field, new HeightTexture(field), new MeshBasicMaterial(), { buildCells: 2 * 64 * 64 });
    chunks.group.updateMatrixWorld();
    const cells = () => chunks.meshes.map((m) => (m as Mesh<BufferGeometry>).geometry.getIndex()!.count / 6);
    // Every chunk at step 8: 8 x 8 cells and its skirts
    expect(new Set(cells())).toEqual(new Set([cells()[0]]));
    expect(cells()[0]).toBeLessThan(200);
    expect(chunks.settled).toBe(false);
    // Low over the map's corner (-512, -512): the chunk there first
    const eye = mapToScene(-500, -500, 20, new Vector3());
    chunks.update(eye, eye);
    const first = cells();
    expect(first[0]).toBeGreaterThan(64 * 64);
    expect(first.filter((c) => c > 64 * 64).length).toBeLessThanOrEqual(2);
    settle(chunks, eye, eye);
    const ref = new TerrainChunks(field, new HeightTexture(field), new MeshBasicMaterial(), { buildCells: Infinity });
    ref.group.updateMatrixWorld();
    ref.update(eye, eye);
    expect(cells()).toEqual(ref.meshes.map((m) => (m as Mesh<BufferGeometry>).geometry.getIndex()!.count / 6));
  });

  it('keeps the finest, unmorphed level under a game camera, where units stand on heightAt', () => {
    // 1 km at 2 m cells, a game camera 200 m above the map's centre
    const n = 513;
    const field = new HeightField({ columns: n, rows: n, cellSize: 2, heights: new Float32Array(n * n) }, 1024, 1024);
    const chunks = new TerrainChunks(field, new HeightTexture(field), new MeshBasicMaterial());
    chunks.group.updateMatrixWorld();
    const eye = mapToScene(0, -120, 200, new Vector3());
    const ground = mapToScene(0, 0, 0, new Vector3());
    settle(chunks, eye, ground);
    expect(chunks.morphEye.value.distanceTo(eye)).toBeCloseTo(0);
    expect(chunks.morphFocus.value.distanceTo(ground)).toBeCloseTo(0);
    for (const mesh of chunks.meshes as Mesh<BufferGeometry>[]) {
      mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox!;
      // Chunks the game camera's ground reaches (250 m around its focus)
      if (box.distanceToPoint(ground) > 250) continue;
      const morph = mesh.geometry.getAttribute('aMorph');
      // Full detail (2 m between neighbours), and no vertex there is pulled towards the coarser level:
      // the morph band starts beyond 250 m of detail distance (the nearer of camera and focus)
      expect(Math.abs(mesh.geometry.getAttribute('position').getX(1) - mesh.geometry.getAttribute('position').getX(0))).toBeCloseTo(2);
      expect(morph.getY(0)).toBeGreaterThan(250);
      expect(mesh.customDepthMaterial).toBeInstanceOf(MeshDepthMaterial);
    }
  });
});

describe('TerrainChunks brush update', () => {
  for (const height of [10, 900]) it(`picks the diagonals of the shown level, and of the others when shown, as a full rebuild does (camera ${height} m up)`, () => {
    const n = 129;
    const heights = new Float32Array(n * n).map((_, k) => Math.sin(k * 0.37) * 3);
    const field = new HeightField({ columns: n, rows: n, cellSize: 2, heights }, 256, 256);
    const a = new TerrainChunks(field, new HeightTexture(field), new MeshBasicMaterial());
    const far = mapToScene(0, 0, height, new Vector3());
    const other = mapToScene(0, 0, 1000 - height, new Vector3());
    a.group.updateMatrixWorld();
    // Both levels built before the brush: the one shown after it was built on the heights before
    a.update(other, other);
    a.update(far, far);
    // A brush in the middle
    for (let j = 60; j <= 70; j++) for (let i = 55; i <= 66; i++) heights[j * n + i] += 2.5;
    const rect = { i0: 55, j0: 60, i1: 66, j1: 70 };
    a.rebuild(rect);
    const b = new TerrainChunks(field, new HeightTexture(field), new MeshBasicMaterial());
    b.group.updateMatrixWorld();
    for (const eye of [far, other]) {
      a.update(eye, eye);
      b.update(eye, eye);
      const ga = a.meshes.map((m) => (m as Mesh<BufferGeometry>).geometry);
      const gb = b.meshes.map((m) => (m as Mesh<BufferGeometry>).geometry);
      for (let k = 0; k < ga.length; k++) {
        expect(Array.from(ga[k].getIndex()!.array)).toEqual(Array.from(gb[k].getIndex()!.array));
        for (const name of ['position', 'aMorph']) {
          expect(Array.from(ga[k].getAttribute(name).array)).toEqual(Array.from(gb[k].getAttribute(name).array));
        }
        // Culled by the heights now: the box follows the brush
        expect(ga[k].boundingBox!.max.y).toBeCloseTo(gb[k].boundingBox!.max.y, 5);
      }
    }
  });
});

describe('TerrainChunks skirts', () => {
  it('tells the shadow pass how far each skirt vertex hangs, so lifted it lies on its edge', () => {
    const n = 65;
    const heights = new Float32Array(n * n).map((_, k) => Math.cos(k * 0.21) * 4);
    const field = new HeightField({ columns: n, rows: n, cellSize: 2, heights }, 128, 128);
    const chunks = new TerrainChunks(field, new HeightTexture(field), new MeshBasicMaterial());
    chunks.group.updateMatrixWorld();
    settle(chunks, mapToScene(0, 0, 5, new Vector3()));
    const g = (chunks.meshes[0] as Mesh<BufferGeometry>).geometry;
    const pos = g.getAttribute('position');
    const lift = g.getAttribute('aSkirt');
    const top = 65 * 65;
    // The surface does not move; the ring of skirt vertices below the border, each its full drop (4 m at the finest level)
    expect(Array.from(lift.array.slice(0, top)).every((v) => v === 0)).toBe(true);
    expect(lift.getX(top)).toBe(4);
    // The vertices hold no heights (the texture does): a skirt vertex hangs its drop below, lifted it meets its
    // border vertex, the grid's first
    expect(pos.getY(0)).toBeCloseTo(0, 9);
    expect(pos.getY(top)).toBe(-4);
    expect(pos.getY(top) + lift.getX(top)).toBeCloseTo(pos.getY(0), 9);
    expect([pos.getX(top), pos.getZ(top)]).toEqual([pos.getX(0), pos.getZ(0)]);
    expect(lift.count).toBe(pos.count);
  });
});

describe('TerrainChunks rays and line of sight', () => {
  it('meet the surface heightAt reports on the chunk it lies in; the meshes alone answer nothing', () => {
    const n = 65;
    const heights = new Float32Array(n * n).map((_, k) => Math.sin(k * 0.11) * 5);
    const field = new HeightField({ columns: n, rows: n, cellSize: 2, heights }, 128, 128);
    const chunks = new TerrainChunks(field, new HeightTexture(field), new MeshBasicMaterial(), { chunkCells: 32 });
    chunks.group.position.set(10, 0, -4);
    chunks.group.updateMatrixWorld(true);
    const raycaster = new Raycaster(new Vector3(10 - 40, 300, -4 + 20), new Vector3(0, -1, 0));
    const hits = raycaster.intersectObject(chunks.group, true);
    expect(hits).toHaveLength(1);
    expect(hits[0].point.y).toBeCloseTo(field.heightAt(40, 20), 3);
    expect(hits[0].distance).toBeCloseTo(300 - field.heightAt(40, 20), 3);
    // Map (40, 20) lies in the chunk of samples 32.. along x and y (scene x = -map x)
    expect(hits[0].object.name).toBe('terrain-chunk-32-32');
    expect(raycaster.intersectObjects(chunks.meshes as Mesh[], false)).toHaveLength(0);
    raycaster.far = 100;
    expect(raycaster.intersectObject(chunks.group, true)).toHaveLength(0);
    // The cube draws each chunk with its height (tower-shadow-mapper.ts)
    for (const m of chunks.meshes) expect(m.userData['losVertex']).toMatchObject({ key: 'custom-map-terrain' });
  });
});
