import { MeshBasicMaterial, Ray, Raycaster, Vector3, type Mesh } from 'three';
import { describe, expect, it } from 'vitest';
import { HeightField } from './height-field';
import { mapToScene, sceneToMap } from './map-coords';
import { TerrainChunks } from './terrain/terrain-chunks';

function field(columns: number, rows: number, cellSize: number, h: (i: number, j: number) => number): HeightField {
  const heights = new Float32Array(columns * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) heights[j * columns + i] = h(i, j);
  return new HeightField({ columns, rows, cellSize, heights }, (columns - 1) * cellSize, (rows - 1) * cellSize);
}

describe('map coordinates', () => {
  it('puts map east on scene -x and map north on scene +z', () => {
    const v = mapToScene(10, 20, 5, new Vector3());
    expect([v.x, v.y, v.z]).toEqual([-10, 5, 20]);
    expect(sceneToMap(v, { x: 0, y: 0 })).toEqual({ x: 10, y: 20 });
  });
});

describe('HeightField', () => {
  const f = field(3, 3, 10, (i, j) => i * 2 + j * 10);

  it('returns the samples at grid points, x and y measured from the middle', () => {
    expect(f.heightAt(-10, -10)).toBe(0);
    expect(f.heightAt(10, -10)).toBe(4);
    expect(f.heightAt(-10, 10)).toBe(20);
    expect(f.heightAt(0, 0)).toBe(12);
  });

  it('interpolates on the two triangles of the cell', () => {
    const tri = field(2, 2, 10, (i, j) => (i === 1 && j === 0 ? 10 : 0));
    // Lower-right triangle (u >= v) carries the raised corner, the other one is flat
    expect(tri.heightAt(2.5, -2.5)).toBeCloseTo(5);
    expect(tri.heightAt(-2.5, 2.5)).toBeCloseTo(0);
  });

  it('clamps outside the grid', () => {
    expect(f.heightAt(-100, -100)).toBe(0);
    expect(f.heightAt(100, 100)).toBe(24);
  });

  it('gives slope and normal of a plane', () => {
    const plane = field(5, 5, 1, (i) => i);
    expect(plane.slopeAt(0, 0)).toBeCloseTo(45);
    const n = plane.normalAt(0, 0, { x: 0, y: 0, z: 0 });
    expect(n.x).toBeCloseTo(-Math.SQRT1_2);
    expect(n.z).toBeCloseTo(Math.SQRT1_2);
  });

  it('raycasts down onto the surface', () => {
    const hit = new Vector3();
    // Map point (5, 0) is scene (-5, ?, 0)
    const d = f.raycast(new Ray(new Vector3(-5, 100, 0), new Vector3(0, -1, 0)), hit);
    expect(d).not.toBeNull();
    expect(hit.y).toBeCloseTo(f.heightAt(5, 0), 3);
    expect(f.raycast(new Ray(new Vector3(-500, 100, 0), new Vector3(0, -1, 0)), hit)).toBeNull();
  });
});

describe('TerrainChunks', () => {
  it('draws the surface heightAt reports, at the finest level', () => {
    const f = field(33, 33, 4, (i, j) => Math.sin(i * 0.7) * 6 + Math.cos(j * 0.4) * 4);
    const chunks = new TerrainChunks(f, new MeshBasicMaterial(), { chunkCells: 16 });
    expect(chunks.meshes.length).toBe(4);
    const raycaster = new Raycaster();
    for (const m of chunks.meshes) m.updateMatrixWorld();
    for (const [mx, my] of [
      [3.3, -7.9],
      [-21.2, 14.6],
      [40.5, 33.1],
    ]) {
      raycaster.set(new Vector3(-mx, 500, my), new Vector3(0, -1, 0));
      const hits = raycaster.intersectObjects(chunks.meshes as Mesh[], false);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].point.y).toBeCloseTo(f.heightAt(mx, my), 3);
    }
    chunks.dispose();
  });

  it('switches far chunks to coarser levels and keeps fine ones near', () => {
    const f = field(129, 129, 2, () => 0);
    const chunks = new TerrainChunks(f, new MeshBasicMaterial(), { chunkCells: 32 });
    const fine = chunks.meshes[0].geometry.index!.count;
    chunks.update(new Vector3(120, 10, -120)); // above map corner (-120, -120)
    const counts = chunks.meshes.map((m) => m.geometry.index!.count);
    expect(counts[0]).toBe(fine);
    expect(Math.min(...counts)).toBeLessThan(fine);
    chunks.dispose();
  });
});
