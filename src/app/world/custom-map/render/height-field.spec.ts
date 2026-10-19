import { MeshBasicMaterial, Ray, Triangle, Vector3, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { cellHeight, cellSplit, HeightField } from './height-field';
import { heightAt } from '../../../map-ops/grid';
import { createMapDocument } from '../map-create';
import { mapToScene, sceneToMap } from './map-coords';
import { HeightTexture } from './terrain/height-texture';
import { TerrainChunks } from './terrain/terrain-chunks';

function field(columns: number, rows: number, cellSize: number, h: (i: number, j: number) => number): HeightField {
  const heights = new Float32Array(columns * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) heights[j * columns + i] = h(i, j);
  return new HeightField({ columns, rows, cellSize, heights }, (columns - 1) * cellSize, (rows - 1) * cellSize);
}

/**
 * The surface the chunks draw at map point (x, y), as the GPU builds it: each vertex lifted by its sample's height
 * (the height texture, TERRAIN_HEIGHT_VERTEX, no geomorph at the finest level), the triangles of the chunks' index
 */
function drawnHeight(chunks: TerrainChunks, f: HeightField, x: number, y: number): number | null {
  const tri = new Triangle();
  const p = new Vector3(-x, 0, y);
  const bary = new Vector3();
  const at = (pos: BufferGeometry['attributes'][string], v: number): Vector3 => {
    const vx = pos.getX(v);
    const vz = pos.getZ(v);
    const h = f.sample(Math.round((-vx - f.originX) / f.cellSize), Math.round((vz - f.originY) / f.cellSize));
    return new Vector3(vx, pos.getY(v) + h, vz);
  };
  for (const mesh of chunks.meshes) {
    const g = mesh.geometry as BufferGeometry;
    const pos = g.getAttribute('position');
    const index = g.getIndex()!;
    for (let k = 0; k < index.count; k += 3) {
      const a = at(pos, index.getX(k));
      const b = at(pos, index.getX(k + 1));
      const c = at(pos, index.getX(k + 2));
      // Surface triangles only: a skirt quad stands upright
      if (pos.getY(index.getX(k)) < 0 || pos.getY(index.getX(k + 1)) < 0 || pos.getY(index.getX(k + 2)) < 0) continue;
      tri.set(new Vector3(a.x, 0, a.z), new Vector3(b.x, 0, b.z), new Vector3(c.x, 0, c.z));
      if (tri.getArea() < 1e-9 || !tri.containsPoint(p)) continue;
      tri.getBarycoord(p, bary);
      return a.y * bary.x + b.y * bary.y + c.y * bary.z;
    }
  }
  return null;
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

  it('splits a cell along the diagonal whose ends differ less, the main one on a tie', () => {
    expect(cellSplit(0, 10, 10, 10)).toBe(false); // one low corner: cut off on its own triangle
    expect(cellSplit(0, 0, 0, 10)).toBe(false);
    expect(cellSplit(10, 0, 10, 10)).toBe(true);
    expect(cellSplit(0, 0, 10, 10)).toBe(true); // a plane: both alike
    expect(cellSplit(3, 7, 1, 5)).toBe(true);
    // Corners and edges stay where the samples are, whichever diagonal
    for (const [h00, h10, h01, h11] of [
      [0, 10, 10, 10],
      [5, 0, 0, 0],
    ]) {
      expect(cellHeight(h00, h10, h01, h11, 0, 0)).toBe(h00);
      expect(cellHeight(h00, h10, h01, h11, 1, 0)).toBe(h10);
      expect(cellHeight(h00, h10, h01, h11, 0, 1)).toBe(h01);
      expect(cellHeight(h00, h10, h01, h11, 1, 1)).toBe(h11);
      expect(cellHeight(h00, h10, h01, h11, 0.5, 0)).toBeCloseTo((h00 + h10) / 2);
      expect(cellHeight(h00, h10, h01, h11, 1, 0.5)).toBeCloseTo((h10 + h11) / 2);
    }
    // A low corner 00 among high ones: its triangle ends at the other diagonal, the far half is flat
    expect(cellHeight(0, 10, 10, 10, 0.25, 0.25)).toBeCloseTo(5);
    expect(cellHeight(0, 10, 10, 10, 0.7, 0.6)).toBeCloseTo(10);
  });

  it('runs the top edge of a sheer pit wall without saw teeth', () => {
    // A round pit 24 cells across, 18 m deep, the wall within one cell
    const N = 81;
    const pit = field(N, N, 1, (i, j) => (Math.hypot(i - 40, j - 40) < 12 ? 0 : 18));
    const fixed = (x: number, y: number): number => {
      // The former split: always (i, j) to (i + 1, j + 1)
      const h = pit.grid.heights;
      const gx = x + 40;
      const gy = y + 40;
      const i = Math.floor(gx);
      const j = Math.floor(gy);
      const u = gx - i;
      const v = gy - j;
      const k = j * N + i;
      return u >= v ? h[k] + u * (h[k + 1] - h[k]) + v * (h[k + N + 1] - h[k + 1]) : h[k] + v * (h[k + N] - h[k]) + u * (h[k + N + 1] - h[k + N]);
    };
    // Where a level leaves the pit along each of 1440 rays, and how far that strays from its own mean over
    // one cell of arc: the teeth within a cell, not the steps the samples themselves make
    const radii = (height: (x: number, y: number) => number, level: number): number[] => {
      const out: number[] = [];
      for (let a = 0; a < 1440; a++) {
        const dx = Math.cos((a / 1440) * Math.PI * 2);
        const dy = Math.sin((a / 1440) * Math.PI * 2);
        let r = 0;
        while (r < 30 && height(dx * r, dy * r) < level) r += 0.005;
        out.push(r);
      }
      return out;
    };
    const roughness = (r: number[]): number => {
      let sum = 0;
      for (let k = 0; k < r.length; k++) {
        let mean = 0;
        for (let d = -19; d <= 19; d++) mean += r[(k + d + r.length) % r.length];
        sum += Math.abs(r[k] - mean / 39);
      }
      return sum / r.length;
    };
    for (const level of [16, 2]) {
      const before = roughness(radii(fixed, level));
      const after = roughness(radii((x, y) => pit.heightAt(x, y), level));
      expect(after).toBeLessThan(before * 0.6);
    }
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

describe('one height model', () => {
  it('gives the editor, the check and the map operations the surface the game draws and walks', () => {
    const doc = createMapDocument({ id: 'twist', name: 'Twist', width: 16, depth: 16, cellSize: 2 });
    const t = doc.terrain;
    // A cell whose diagonals rise unlike: bilinear would read 1 in its middle, the drawn triangles 0 or 2
    t.grid.heights.forEach((_, k) => (t.grid.heights[k] = ((k * 7919) % 13) * 0.37));
    const c = t.grid.columns;
    t.grid.heights.set([0, 4], 0);
    t.grid.heights.set([0, 0], c);
    const field = new HeightField(t.grid, t.width, t.depth);
    for (let y = -9; y <= 9; y += 0.37) {
      for (let x = -9; x <= 9; x += 0.41) expect(heightAt(t, x, y)).toBe(field.heightAt(x, y));
    }
    expect(heightAt(t, -7, -7)).toBe(cellHeight(0, 4, 0, 0, 0.5, 0.5));
    expect(heightAt(t, -7, -7)).not.toBe(1);
  });
});

/** A camera low over the middle: every chunk at the finest level, updated until all are built */
function finest(chunks: TerrainChunks): TerrainChunks {
  const eye = new Vector3(0, 5, 0);
  for (let k = 0; k < 100 && !(k > 0 && chunks.settled); k++) chunks.update(eye, eye);
  return chunks;
}

describe('TerrainChunks', () => {
  it('draws the surface heightAt reports, at the finest level', () => {
    const f = field(33, 33, 4, (i, j) => Math.sin(i * 0.7) * 6 + Math.cos(j * 0.4) * 4);
    const chunks = finest(new TerrainChunks(f, new HeightTexture(f), new MeshBasicMaterial(), { chunkCells: 16 }));
    expect(chunks.meshes.length).toBe(4);
    for (const [mx, my] of [
      [3.3, -7.9],
      [-21.2, 14.6],
      [40.5, 33.1],
    ]) {
      expect(drawnHeight(chunks, f, mx, my)).toBeCloseTo(f.heightAt(mx, my), 4);
    }
    chunks.dispose();
  });

  it('draws the surface heightAt reports on sheer walls, also after an edit turns diagonals', () => {
    const wall = (cx: number, raised: boolean) => (i: number, j: number) =>
      (Math.hypot(i - cx, j - 16) < 9) === raised ? 20 : 0;
    const f = field(33, 33, 2, wall(14, true));
    const chunks = finest(new TerrainChunks(f, new HeightTexture(f), new MeshBasicMaterial(), { chunkCells: 16 }));
    const check = (): void => {
      let n = 0;
      for (let y = -30; y <= 30; y += 0.73) {
        for (let x = -30; x <= 30; x += 0.61) {
          expect(drawnHeight(chunks, f, x, y)).toBeCloseTo(f.heightAt(x, y), 4);
          n++;
        }
      }
      expect(n).toBeGreaterThan(5000);
    };
    check();
    // A pit beside where the plateau was: the shown level's cells pick their diagonal anew
    const next = wall(18, false);
    for (let j = 0; j < 33; j++) for (let i = 0; i < 33; i++) f.grid.heights[j * 33 + i] = next(i, j);
    chunks.rebuild({ i0: 0, j0: 0, i1: 32, j1: 32 });
    check();
    chunks.dispose();
  });

  it('switches far chunks to coarser levels and keeps fine ones near', () => {
    const f = field(257, 257, 2, () => 0);
    const chunks = new TerrainChunks(f, new HeightTexture(f), new MeshBasicMaterial(), { chunkCells: 32 });
    const fine = finest(new TerrainChunks(f, new HeightTexture(f), new MeshBasicMaterial(), { chunkCells: 32 })).meshes[0].geometry.index!.count;
    const corner = new Vector3(250, 10, -250); // above map corner (-250, -250)
    for (let k = 0; k < 100 && !(k > 0 && chunks.settled); k++) chunks.update(corner);
    // Metres between a piece's first two vertices: 2 for the finest, more for a coarser piece over a larger area
    const spacing = chunks.meshes.map((m) => Math.abs(m.geometry.getAttribute('position').getX(1) - m.geometry.getAttribute('position').getX(0)));
    expect(spacing).toContain(2);
    expect(Math.max(...spacing)).toBeGreaterThan(2);
    expect(chunks.meshes.every((m) => m.geometry.index!.count <= fine)).toBe(true);
    chunks.dispose();
  });
});
