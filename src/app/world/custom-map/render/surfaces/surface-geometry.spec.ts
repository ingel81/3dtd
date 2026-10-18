import type { MapPoint, MapSurface } from '../../map-document';
import { HeightField } from '../height-field';
import { fitMarking, surfaceArea } from '../../map-surfaces';
import { EDGE_REACH, EDGE_REF, MAX_SURFACE_RANK, surfaceLook, surfacePieces, surfaceRanks, type SurfaceGround } from './surface-geometry';

const box = (x0: number, y0: number, x1: number, y1: number): MapPoint[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** Area, middle, corners and looks of every triangle of a surface */
function triangles(s: MapSurface, ground: SurfaceGround | null = null) {
  const { pieces, edges } = surfacePieces(s, 2, 0, ground);
  const out: { area: number; ax: number; ay: number; corners: MapPoint[]; refs: number[]; looks: number[] }[] = [];
  for (const p of pieces.values()) {
    for (let t = 0; t < p.index.length; t += 3) {
      const [a, b, c] = [p.index[t], p.index[t + 1], p.index[t + 2]];
      const x = (k: number) => p.position[k * 2];
      const y = (k: number) => p.position[k * 2 + 1];
      const area = ((x(b) - x(a)) * (y(c) - y(a)) - (y(b) - y(a)) * (x(c) - x(a))) / 2;
      out.push({
        area,
        ax: (x(a) + x(b) + x(c)) / 3,
        ay: (y(a) + y(b) + y(c)) / 3,
        corners: [a, b, c].map((k) => ({ x: x(k), y: y(k) })),
        refs: [a, b, c].map((k) => p.look[k * 3 + 1]),
        looks: [a, b, c].map((k) => p.look[k * 3]),
      });
    }
  }
  return { out, edges };
}

/** Ground with bumps a few metres across, on a grid of 2 m */
const bumpy: SurfaceGround = { cell: 2, originX: -100, originY: -100, heightAt: (x, y) => Math.sin(x * 0.3) * Math.cos(y * 0.25) * 1.5 };

describe('surface geometry', () => {
  it('covers the outline less its holes, counter-clockwise', () => {
    const s: MapSurface = { id: 's', material: 'paving', outer: box(-13, -7, 29, 18), holes: [box(0, 0, 6, 5)] };
    for (const ground of [null, bumpy]) {
      const { out } = triangles(s, ground);
      expect(out.reduce((sum, t) => sum + t.area, 0)).toBeCloseTo(surfaceArea(s), 3);
      expect(out.every((t) => t.area > 0)).toBe(true);
      // Nothing in the hole
      expect(out.some((t) => t.ax > 0.5 && t.ax < 5.5 && t.ay > 0.5 && t.ay < 4.5)).toBe(false);
    }
  });

  it('lays flat ground in few big cells and follows uneven ground on its own grid', () => {
    const s: MapSurface = { id: 's', material: 'grass-lush', outer: box(0.3, 0.7, 105.3, 68.7) };
    expect(triangles(s).out.length).toBeLessThan(40);
    const uneven = triangles(s, bumpy).out;
    expect(uneven.length).toBeGreaterThan(400);
    // Between its corners each triangle lies on the ground: the height at its middle is theirs
    for (const t of uneven) {
      const mean = t.corners.reduce((sum, q) => sum + bumpy.heightAt(q.x, q.y), 0) / 3;
      expect(Math.abs(bumpy.heightAt(t.ax, t.ay) - mean)).toBeLessThan(0.35);
    }
  });

  it("lies on the terrain's own triangles between its corners, however rough the ground", () => {
    // A terrain of 2 m samples with random heights (a lumpy ground under a square): the surface's height anywhere is
    // the terrain's, so the ground never shows through
    const n = 101;
    const heights = new Float32Array(n * n);
    for (let k = 0; k < heights.length; k++) heights[k] = Math.sin(k * 12.9898) * 2;
    const field = new HeightField({ columns: n, rows: n, cellSize: 2, heights }, 200, 200);
    const ground: SurfaceGround = { heightAt: (x, y) => field.heightAt(x, y), cell: 2, originX: field.originX, originY: field.originY };
    const s: MapSurface = { id: 's', material: 'paving', outer: [{ x: -31.3, y: -20.7 }, { x: 25.1, y: -28.2 }, { x: 33.9, y: 17.4 }, { x: -12.6, y: 30.8 }] };
    const { out } = triangles(s, ground);
    let worst = 0;
    for (const t of out) {
      const [a, b, c] = t.corners;
      const [ha, hb, hc] = t.corners.map((q) => field.heightAt(q.x, q.y));
      // Points inside the triangle, by their barycentric weights
      for (const [u, v] of [[0.2, 0.3], [0.6, 0.2], [0.1, 0.8], [1 / 3, 1 / 3]]) {
        const w = 1 - u - v;
        const p = { x: a.x * w + b.x * u + c.x * v, y: a.y * w + b.y * u + c.y * v };
        worst = Math.max(worst, Math.abs(field.heightAt(p.x, p.y) - (ha * w + hb * u + hc * v)));
      }
    }
    expect(worst).toBeLessThan(0.001);
  });

  it('lists for each cell the edges near it, so the shader measures the distance to the edge exactly', () => {
    const s: MapSurface = { id: 's', material: 'paving', outer: box(0.5, 0.5, 300.5, 200.5) };
    const { out, edges } = triangles(s);
    expect(edges.length % 4).toBe(0);
    // A cell in the middle lists none, one at a corner two
    const holding = (x: number, y: number) =>
      out.find((t) => {
        const [a, b, c] = t.corners;
        const side = (p: MapPoint, q: MapPoint) => (q.x - p.x) * (y - p.y) - (q.y - p.y) * (x - p.x);
        return side(a, b) >= 0 && side(b, c) >= 0 && side(c, a) >= 0;
      })!;
    expect(holding(150, 100).refs.every((r) => r === 0)).toBe(true);
    expect(holding(2, 2).refs[0] % EDGE_REF).toBe(2);
    // Every listed edge lies within reach of the triangle
    for (const t of out) {
      const ref = t.refs[0];
      const count = ref % EDGE_REF;
      const start = (ref - count) / EDGE_REF;
      for (let k = start; k < start + count; k++) {
        const [x0, y0, x1, y1] = edges.slice(k * 4, k * 4 + 4);
        const reach = EDGE_REACH + 64;
        expect(Math.min(x0, x1) <= t.ax + reach && Math.max(x0, x1) >= t.ax - reach && Math.min(y0, y1) <= t.ay + reach && Math.max(y0, y1) >= t.ay - reach).toBe(true);
      }
    }
  });

  it('carries its layer, marking and rank in the look', () => {
    const outer = box(0, 0, 36, 18);
    const s: MapSurface = { id: 's', material: 'red-earth', outer, marking: fitMarking('tennis', outer)! };
    const { out } = triangles(s);
    expect(out[0].looks[0]).toBe(surfaceLook(2, 'tennis', 0));
  });

  it('ranks the smaller of two overlapping surfaces over the larger, none of a rank over another of it', () => {
    const square: MapSurface = { id: 'square', material: 'paving', outer: box(0, 0, 100, 100) };
    const path: MapSurface = { id: 'path', material: 'gravel-light', outer: box(40, -5, 45, 105) };
    const bed: MapSurface = { id: 'bed', material: 'sand', outer: box(41, 50, 44, 53) };
    const apart: MapSurface = { id: 'apart', material: 'sand', outer: box(300, 300, 310, 310) };
    const ranks = surfaceRanks([bed, path, square, apart]);
    expect([ranks.get('square'), ranks.get('path'), ranks.get('bed'), ranks.get('apart')]).toEqual([0, 1, 2, 0]);
    // A pile deeper than the ranks stops at the top one
    const pile = Array.from({ length: 20 }, (_, k): MapSurface => ({ id: `p${k}`, material: 'sand', outer: box(k, k, 100 - k, 100 - k) }));
    expect(Math.max(...surfaceRanks(pile).values())).toBe(MAX_SURFACE_RANK);
  });
});
