import type { MapPoint, MapSurface } from '../../map-document';
import { fitMarking, surfaceArea } from '../../map-surfaces';
import { EDGE_REACH, SURFACE_CELL, surfaceLook, surfacePieces, surfaceRank } from './surface-geometry';

const box = (x0: number, y0: number, x1: number, y1: number): MapPoint[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

/** Area, cell and winding of every triangle of a surface */
function triangles(s: MapSurface) {
  const { pieces, edges } = surfacePieces(s, 2);
  const out: { area: number; ax: number; ay: number; refs: number[]; looks: number[] }[] = [];
  for (const p of pieces.values()) {
    for (let t = 0; t < p.index.length; t += 3) {
      const [a, b, c] = [p.index[t], p.index[t + 1], p.index[t + 2]];
      const x = (k: number) => p.position[k * 2];
      const y = (k: number) => p.position[k * 2 + 1];
      const area = ((x(b) - x(a)) * (y(c) - y(a)) - (y(b) - y(a)) * (x(c) - x(a))) / 2;
      out.push({ area, ax: (x(a) + x(b) + x(c)) / 3, ay: (y(a) + y(b) + y(c)) / 3, refs: [a, b, c].map((k) => p.look[k * 3 + 1]), looks: [a, b, c].map((k) => p.look[k * 3]) });
    }
  }
  return { out, edges };
}

describe('surface geometry', () => {
  it('covers the outline less its holes, counter-clockwise, cut into grid cells', () => {
    const s: MapSurface = { id: 's', material: 'paving', outer: box(-13, -7, 29, 18), holes: [box(0, 0, 6, 5)] };
    const { out } = triangles(s);
    const total = out.reduce((sum, t) => sum + t.area, 0);
    expect(total).toBeCloseTo(surfaceArea(s), 3);
    expect(out.every((t) => t.area > 0)).toBe(true);
    // No triangle crosses a cell line: its centre and corners share one cell
    for (const t of out) {
      expect(Math.abs(t.ax - (Math.floor(t.ax / SURFACE_CELL) + 0.5) * SURFACE_CELL)).toBeLessThanOrEqual(SURFACE_CELL / 2);
    }
    // Nothing in the hole
    expect(out.some((t) => t.ax > 0.5 && t.ax < 5.5 && t.ay > 0.5 && t.ay < 4.5)).toBe(false);
  });

  it('stays within the budget for a pitch: about two triangles a cell', () => {
    const s: MapSurface = { id: 's', material: 'grass-lush', outer: box(0.3, 0.7, 105.3, 68.7) };
    const { out } = triangles(s);
    const cells = (105 / SURFACE_CELL + 1) * (68 / SURFACE_CELL + 1);
    expect(out.length).toBeLessThan(cells * 3);
  });

  it('lists for each cell the edges near it, so the shader measures the distance to the edge exactly', () => {
    const s: MapSurface = { id: 's', material: 'paving', outer: box(0.5, 0.5, 30.5, 20.5) };
    const { out, edges } = triangles(s);
    expect(edges.length % 4).toBe(0);
    // A cell in the middle lists none, one at a corner two
    const middle = out.find((t) => Math.abs(t.ax - 14) < 2 && Math.abs(t.ay - 10) < 2)!;
    expect(middle.refs.every((r) => r === 0)).toBe(true);
    const corner = out.find((t) => t.ax < 2.5 && t.ay < 2.5)!;
    expect(corner.refs[0] % 8).toBe(2);
    // Every listed edge lies within reach of its cell
    for (const t of out) {
      const ref = t.refs[0];
      const count = ref % 8;
      const start = (ref - count) / 8;
      const cx = (Math.floor(t.ax / SURFACE_CELL) + 0.5) * SURFACE_CELL;
      const cy = (Math.floor(t.ay / SURFACE_CELL) + 0.5) * SURFACE_CELL;
      for (let k = start; k < start + count; k++) {
        const [x0, y0, x1, y1] = edges.slice(k * 4, k * 4 + 4);
        const near = Math.min(x0, x1) <= cx + SURFACE_CELL / 2 + EDGE_REACH && Math.max(x0, x1) >= cx - SURFACE_CELL / 2 - EDGE_REACH;
        expect(near && Math.min(y0, y1) <= cy + SURFACE_CELL / 2 + EDGE_REACH && Math.max(y0, y1) >= cy - SURFACE_CELL / 2 - EDGE_REACH).toBe(true);
      }
    }
  });

  it('carries its layer, marking and rank in the look', () => {
    const outer = box(0, 0, 36, 18);
    const s: MapSurface = { id: 's', material: 'red-earth', outer, marking: fitMarking('tennis', outer)! };
    const { out } = triangles(s);
    expect(out[0].looks[0]).toBe(surfaceLook(2, 'tennis', surfaceRank(36 * 18)));
    expect(surfaceRank(20000)).toBe(0);
    expect(surfaceRank(30)).toBe(6);
    expect(surfaceRank(600)).toBeGreaterThan(surfaceRank(6000));
  });
});
