import type { MapPathEdge, MapPaths } from '../../map-document';
import { buildRoadNetwork, type RoadNetwork } from './road-network';

function paths(edges: Partial<MapPathEdge>[], nodes: [string, number, number][]): MapPaths {
  return {
    nodes: nodes.map(([id, x, y]) => ({ id, x, y })),
    edges: edges.map((e, k) => ({ id: `e${k}`, a: '', b: '', width: 6, kind: 'road', surface: 'asphalt', ...e })),
  };
}

/** Every triangle of every tile, as map points */
function triangles(net: RoadNetwork): [number, number][][] {
  const out: [number, number][][] = [];
  for (const t of net.tiles) {
    for (let k = 0; k < t.index.length; k += 3) {
      out.push([0, 1, 2].map((j) => [t.position[t.index[k + j] * 2], t.position[t.index[k + j] * 2 + 1]] as [number, number]));
    }
  }
  return out;
}

const area = (t: [number, number][]): number => ((t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[1][1] - t[0][1]) * (t[2][0] - t[0][0])) / 2;

describe('road network', () => {
  it('lays a T junction: three ribbons trimmed back past the kerbs, a junction between them, all faces up', () => {
    const net = buildRoadNetwork(
      paths(
        [
          { a: 'c', b: 'e', street: 'secondary', width: 9 },
          { a: 'w', b: 'c', street: 'secondary', width: 9 },
          { a: 'c', b: 'n', street: 'residential', width: 6 },
        ],
        [['c', 0, 0], ['e', 100, 0], ['w', -100, 0], ['n', 0, 100]],
      ),
    );
    const tris = triangles(net);
    expect(tris.length).toBeGreaterThan(100);
    // Counter-clockwise from above (front faces up in the scene), no NaN
    for (const t of tris) {
      expect(t.flat().every(Number.isFinite)).toBe(true);
      expect(area(t)).toBeGreaterThan(-1e-6);
    }
    // The paved area is the roads' plus the junction's: 200 m x 9 m and 100 m x 6 m less the overlap, give or take the kerbs
    const total = tris.reduce((s, t) => s + area(t), 0);
    expect(total).toBeGreaterThan(200 * 9 + 95.5 * 6 - 5);
    expect(total).toBeLessThan(200 * 9 + 95.5 * 6 + 40);
    // Markings stop at the junction: its own look
    expect(net.styles.filter((s) => s.junction).length).toBe(1);
    expect(net.styles.find((s) => !s.junction && s.markings === 'centre-edges')).toBeTruthy();
  });

  it('runs edges of one look on as one ribbon, its distance along going on', () => {
    const net = buildRoadNetwork(paths([{ a: 'a', b: 'b' }, { a: 'c', b: 'b' }], [['a', 0, 0], ['b', 50, 0], ['c', 100, 0]]));
    const along = net.tiles.flatMap((t) => Array.from({ length: t.road.length / 4 }, (_, k) => t.road[k * 4 + 1]));
    expect(Math.max(...along) - Math.min(...along)).toBeCloseTo(100, 3);
    // One look, no junction
    expect(net.styles.length).toBe(1);
  });

  it('rounds the end of a path that stops with nothing there, and leaves gravel and bridges out', () => {
    const net = buildRoadNetwork(
      paths(
        [
          { a: 'a', b: 'b', kind: 'path', width: 2, surface: 'sidewalk' },
          { a: 'b', b: 'c', kind: 'path', width: 2, surface: 'gravel' },
          { a: 'c', b: 'd', kind: 'bridge', width: 6 },
        ],
        [['a', 0, 0], ['b', 20, 0], ['c', 40, 0], ['d', 60, 0]],
      ),
    );
    const xs = net.tiles.flatMap((t) => Array.from({ length: t.position.length / 2 }, (_, k) => t.position[k * 2]));
    // The round end reaches a half width before node a; at b the gravel track meets it: square
    expect(Math.min(...xs)).toBeCloseTo(-1, 3);
    expect(Math.max(...xs)).toBeCloseTo(20, 3);
  });
});
