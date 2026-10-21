import type { MapPathEdge, MapPaths } from '../../map-document';
import { buildRoadNetwork, RoadNetworkBuilder, type RoadNetwork, type RoadTile } from './road-network';

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
    // In the junction each triangle blends into one road's frame: weight 1 at that road's end section only
    const weights = net.tiles.flatMap((t) => Array.from({ length: t.arm.length / 4 }, (_, k) => t.arm[k * 4 + 3] % 1));
    expect(Math.max(...weights)).toBeCloseTo(0.99, 3);
    expect(weights.filter((w) => w > 0).length).toBeGreaterThan(3);
    expect(net.styles.find((s) => !s.junction && s.markings === 'centre-edges')).toBeTruthy();
  });

  it('widens a road by its pavements, the kerb at distance 0 and the pavement beyond it negative', () => {
    const net = buildRoadNetwork(
      paths(
        [
          { a: 'w', b: 'c', street: 'residential', width: 6, sidewalk: 2 },
          { a: 'c', b: 'e', street: 'residential', width: 6, sidewalk: 2 },
          { a: 'c', b: 'n', street: 'residential', width: 6 },
        ],
        [['w', -100, 0], ['c', 0, 0], ['e', 100, 0], ['n', 0, 100]],
      ),
    );
    const ys = triangles(net).flat().filter(([x]) => x < -40).map(([, y]) => y);
    // 3 m of carriageway and 2 m of pavement either side
    expect(Math.max(...ys)).toBeCloseTo(5, 3);
    expect(Math.min(...ys)).toBeCloseTo(-5, 3);
    const edges = net.tiles.flatMap((t) => Array.from({ length: t.road.length / 4 }, (_, k) => t.road[k * 4 + 2]));
    expect(Math.min(...edges)).toBeCloseTo(-2, 3);
    expect(Math.max(...edges)).toBeCloseTo(3, 3);
    // The pavements' texture joins the roads', a kerb along the street whatever its class
    expect(net.surfaces[net.sidewalk]).toBe('sidewalk');
    expect(net.styles.every((s) => s.gutter)).toBe(true);
  });

  it('keeps the kerbs where the road runs across a junction a footway joins: no pavement bulging into the carriageway', () => {
    const net = buildRoadNetwork(
      paths(
        [
          { a: 'w', b: 'c', street: 'secondary', width: 6, sidewalk: 1.8 },
          { a: 'c', b: 'e', street: 'secondary', width: 6, sidewalk: 1.8 },
          { a: 'c', b: 'n', kind: 'path', street: 'footway', width: 2.5 },
        ],
        [['w', -100, 0], ['c', 0, 0], ['e', 100, 0], ['n', 0, 60]],
      ),
    );
    // The distance to the edge at a map point, from the triangle it lies in
    const edgeAt = (x: number, y: number): number => {
      for (const t of net.tiles) {
        for (let k = 0; k < t.index.length; k += 3) {
          const [i, j, l] = [t.index[k], t.index[k + 1], t.index[k + 2]];
          const p = (n: number) => [t.position[n * 2], t.position[n * 2 + 1]];
          const [a, b, c] = [p(i), p(j), p(l)];
          const d = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
          const u = ((b[0] - x) * (c[1] - y) - (b[1] - y) * (c[0] - x)) / d;
          const v = ((c[0] - x) * (a[1] - y) - (c[1] - y) * (a[0] - x)) / d;
          if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
          return u * t.road[i * 4 + 2] + v * t.road[j * 4 + 2] + (1 - u - v) * t.road[l * 4 + 2];
        }
      }
      return NaN;
    };
    // Across from the footway, through the junction: carriageway to 3 m, pavement beyond, as along the rest of the road
    for (const x of [-3, -1, 0, 1, 3]) {
      expect(edgeAt(x, -2.7)).toBeGreaterThan(0);
      expect(edgeAt(x, -3.3)).toBeLessThan(0);
    }
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

describe('road network, rebuilt in part', () => {
  it('gives the tiles a moved node reaches as a whole rebuild would, and only those', () => {
    // A street grid over 1.5 km (tiles of 512 m), crossings every 300 m
    const nodes: [string, number, number][] = [];
    const edges: Partial<MapPathEdge>[] = [];
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) nodes.push([`n${i}-${j}`, i * 300 - 750, j * 300 - 750]);
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) {
        if (i < 5) edges.push({ a: `n${i}-${j}`, b: `n${i + 1}-${j}`, street: j % 2 ? 'secondary' : 'residential', width: j % 2 ? 9 : 6 });
        if (j < 5) edges.push({ a: `n${i}-${j}`, b: `n${i}-${j + 1}`, street: 'tertiary', width: 7 });
      }
    }
    const builder = new RoadNetworkBuilder();
    const first = builder.update(paths(edges, nodes));
    const moved = paths(edges, nodes.map(([id, x, y]) => (id === 'n1-1' ? [id, x + 25, y - 10] : [id, x, y])));
    const part = builder.update(moved);
    const whole = buildRoadNetwork(moved);
    expect(part.tiles.length).toBeGreaterThan(0);
    expect(part.tiles.length).toBeLessThan(whole.tiles.length);
    const byKey = (net: RoadNetwork) => new Map(net.tiles.map((t) => [t.key, t]));
    const [p, w, f] = [byKey(part), byKey(whole), byKey(first)];
    // The same pieces, maybe in another order: compare the triangles as sorted lists of their corners
    const tris = (t: RoadTile) => {
      const out: string[] = [];
      for (let k = 0; k < t.index.length; k += 3) {
        out.push([0, 1, 2].map((j) => { const v = t.index[k + j]; return [t.position[v * 2], t.position[v * 2 + 1], ...t.road.slice(v * 4, v * 4 + 4)].map((x) => x.toFixed(3)).join(','); }).join('|'));
      }
      return out.sort();
    };
    for (const [key, tile] of w) {
      const got = p.get(key) ?? f.get(key);
      expect(got, key).toBeTruthy();
      expect(tris(got!), key).toEqual(tris(tile));
    }
    // Nothing changed: nothing laid
    expect(builder.update(moved).tiles).toEqual([]);
  });
});
