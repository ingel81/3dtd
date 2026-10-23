import type { MapPathEdge, MapPaths } from '../../map-document';
import { gridHeightAt } from '../height-field';
import { REFINE_TOLERANCE, type DrapeGround } from '../drape/draped-refine';
import { ARM_WEIGHT_BASE, ARM_WEIGHT_SPAN, buildRoadNetwork, RoadNetworkBuilder, type RoadNetwork, type RoadTile } from './road-network';

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
    // In the junction each triangle blends into one road's frame: weight 1 at that road's end section only, the weight
    // in the wear's fraction clear of the whole numbers (interpolated, a weight 0 on one read as nearly 1 at some pixels)
    const arms = net.tiles.flatMap((t) => Array.from({ length: t.arm.length / 4 }, (_, k) => t.arm[k * 4 + 3])).filter((w) => w > 0);
    const weights = arms.map((w) => ((w % 1) - ARM_WEIGHT_BASE) / ARM_WEIGHT_SPAN);
    expect(Math.min(...arms.map((w) => w % 1))).toBeGreaterThanOrEqual(ARM_WEIGHT_BASE - 1e-6);
    expect(Math.max(...weights)).toBeCloseTo(1, 5);
    expect(Math.min(...weights)).toBeCloseTo(0, 5);
    expect(weights.filter((w) => w > 0.5).length).toBeGreaterThan(3);
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
    // The footway meets the carriageway without kerbs of its own: none along its sides into the junction and back
    // (a notch in the pavement), its mouth past the kerb and its gutter
    for (const y of [5.2, 5.6, 6]) {
      for (const x of [-0.6, 0, 0.6]) expect(edgeAt(x, y)).toBeGreaterThan(0.55);
    }
  });

  it('tapers a road that goes on at another width: its kerb runs across, no tooth at the node', () => {
    const net = buildRoadNetwork(
      paths(
        [
          { a: 'w', b: 'c', street: 'residential', width: 9, sidewalk: 1.8 },
          { a: 'c', b: 'e', street: 'residential', width: 6, sidewalk: 1.8 },
        ],
        [['w', -100, 0], ['c', 0, 0], ['e', 100, 0]],
      ),
    );
    // The outline's northern edge, sampled along: it falls from 6.3 m (4.5 + 1.8) to 4.8 m (3 + 1.8) once, never back
    const tris = triangles(net);
    const inside = (x: number, y: number) =>
      tris.some(([a, b, c]) => {
        const d = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        if (Math.abs(d) < 1e-9) return false;
        const u = ((b[0] - x) * (c[1] - y) - (b[1] - y) * (c[0] - x)) / d;
        const v = ((c[0] - x) * (a[1] - y) - (c[1] - y) * (a[0] - x)) / d;
        return u >= -1e-6 && v >= -1e-6 && u + v <= 1 + 1e-6;
      });
    const top = (x: number) => {
      let y = 8;
      while (y > 0 && !inside(x, y)) y -= 0.05;
      return y;
    };
    const tops = [-8, -6, -4, -2, 0, 2, 4, 6, 8].map(top);
    for (let k = 1; k < tops.length; k++) expect(tops[k]).toBeLessThanOrEqual(tops[k - 1] + 1e-3);
    expect(tops[0]).toBeCloseTo(6.3, 1);
    expect(tops.at(-1)).toBeCloseTo(4.8, 1);
    // Tapered over metres, not stepped at the node
    expect(tops.filter((t) => t > 4.85 && t < 6.25).length).toBeGreaterThan(1);
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

describe('road network on the ground', () => {
  /** Rolling ground with a crest across x = 0, 2 m cells over 512 m */
  function hills(): DrapeGround {
    const columns = 257;
    const heights = new Float32Array(columns * columns);
    for (let j = 0; j < columns; j++) {
      for (let i = 0; i < columns; i++) heights[j * columns + i] = 4 - Math.abs(i * 2 - 256) / 8 + Math.sin(j * 0.35) * 2 + Math.cos(i * 0.29) * 1.5;
    }
    const grid = { columns, rows: columns, cellSize: 2, heights };
    return { grid, originX: -256, originY: -256, heightAt: (x, y) => gridHeightAt(grid, -256, -256, x, y) };
  }
  const tJunction = () =>
    paths(
      [
        { a: 'c', b: 'e', street: 'secondary', width: 9 },
        { a: 'w', b: 'c', street: 'secondary', width: 9 },
        { a: 'c', b: 'n', street: 'residential', width: 6, sidewalk: 2 },
      ],
      [['c', 0, 0], ['e', 100, 0], ['w', -100, 0], ['n', 0, 100]],
    );

  it('lays ribbons and junctions onto the ground: none of it stands off by more than twice the tolerance', () => {
    const ground = hills();
    const flat = buildRoadNetwork(tJunction());
    const laid = new RoadNetworkBuilder(ground).update(tJunction());
    let before = 0;
    let after = 0;
    for (const [net, add] of [[flat, (d: number) => (before = Math.max(before, d))], [laid, (d: number) => (after = Math.max(after, d))]] as const) {
      for (const t of triangles(net)) {
        const h = t.map(([x, y]) => ground.heightAt(x, y));
        for (const [u, v] of [[0.25, 0.25], [0.5, 0.25], [0.25, 0.5], [0.33, 0.33], [0.5, 0], [0, 0.5], [0.5, 0.5]]) {
          const w = 1 - u - v;
          const x = t[0][0] * w + t[1][0] * u + t[2][0] * v;
          const y = t[0][1] * w + t[1][1] * u + t[2][1] * v;
          add(Math.abs(ground.heightAt(x, y) - (h[0] * w + h[1] * u + h[2] * v)));
        }
      }
    }
    expect(before).toBeGreaterThan(0.1);
    expect(after).toBeLessThanOrEqual(2 * REFINE_TOLERANCE + 1e-4);
    // Still faces up, the same paved area
    const area0 = triangles(flat).reduce((s, t) => s + area(t), 0);
    const area1 = triangles(laid).reduce((s, t) => s + area(t), 0);
    expect(area1).toBeCloseTo(area0, 0);
    for (const t of triangles(laid)) expect(area(t)).toBeGreaterThan(-1e-6);
  });

  it('leaves no crack: no corner of a triangle lies inside a side of another (a ribbon, its junction, its pieces)', () => {
    const tris = triangles(new RoadNetworkBuilder(hills()).update(tJunction()));
    const corners = new Map<string, [number, number]>();
    for (const t of tris) for (const p of t) corners.set(p.join(','), p);
    let inside = 0;
    for (const t of tris) {
      for (let e = 0; e < 3; e++) {
        const [px, py] = t[e];
        const [qx, qy] = t[(e + 1) % 3];
        const len = Math.hypot(qx - px, qy - py);
        for (const [x, y] of corners.values()) {
          if (Math.abs((x - px) * (qy - py) - (y - py) * (qx - px)) > 1e-4 * len) continue;
          const u = ((x - px) * (qx - px) + (y - py) * (qy - py)) / (len * len);
          if (u * len > 1e-3 && (1 - u) * len > 1e-3) { inside++; console.log("TJ", x, y, "on", px, py, qx, qy); }
        }
      }
    }
    expect(tris.length).toBeGreaterThan(300);
    expect(inside).toBe(0);
  });

  it('lays again what the ground changed under, and only that', () => {
    const ground = hills();
    const builder = new RoadNetworkBuilder(ground);
    const count = (net: RoadNetwork) => net.tiles.reduce((s, t) => s + t.index.length, 0);
    const hilly = count(builder.update(tJunction()));
    expect(builder.reground({ minX: 300, minY: 300, maxX: 310, maxY: 310 }).tiles).toEqual([]);
    expect(builder.reground({ minX: 40, minY: -10, maxX: 60, maxY: 10 }).tiles.length).toBeGreaterThan(0);
    // The ground levelled and laid again: nothing left to cut but the shared end sections' points
    ground.grid.heights.fill(1);
    const again = builder.reground();
    expect(count(again)).toBeLessThan(hilly / 2);
    expect(count(again)).toBeGreaterThanOrEqual(count(buildRoadNetwork(tJunction())));
  });

  it('lays a whole map flat at once and onto the ground a few at a time, as laid at once', () => {
    const now = new RoadNetworkBuilder(hills()).update(tJunction());
    const builder = new RoadNetworkBuilder(hills());
    const flat = builder.update(tJunction(), true);
    expect(flat.tiles.reduce((s, t) => s + t.index.length, 0)).toBe(buildRoadNetwork(tJunction()).tiles.reduce((s, t) => s + t.index.length, 0));
    let net = builder.layOnGround(0);
    let calls = 0;
    for (; !net; calls++) net = builder.layOnGround(0);
    // One item a call at a budget of nothing: the three ribbons and the junction
    expect(calls).toBe(3);
    const sorted = (n: RoadNetwork) => triangles(n).map((t) => t.flat().map((v) => v.toFixed(4)).join(',')).sort();
    expect(sorted(net)).toEqual(sorted(now));
    expect(builder.layOnGround(0)!.tiles).toEqual([]);
  });
});

describe('road network, junctions close together', () => {
  it('lays two side roads a few metres apart as one junction: no sliver of ribbon between, no fold', () => {
    // A main road with a side road to the north at x = 0 and one to the south at x = 5
    const net = buildRoadNetwork(
      paths(
        [
          { a: 'w', b: 'p', street: 'secondary', width: 9 },
          { a: 'p', b: 'q', street: 'secondary', width: 9 },
          { a: 'q', b: 'e', street: 'secondary', width: 9 },
          { a: 'p', b: 'n', street: 'residential', width: 6 },
          { a: 'q', b: 's', street: 'residential', width: 6 },
        ],
        [['w', -100, 0], ['p', 0, 0], ['q', 5, 0], ['e', 100, 0], ['n', 0, 100], ['s', 5, -100]],
      ),
    );
    const tris = triangles(net);
    for (const t of tris) expect(area(t)).toBeGreaterThan(-1e-6);
    // Between the two nodes only the junction's surface (bit 11 of the look), no ribbon of the main road
    let between = 0;
    for (const t of net.tiles) {
      for (let k = 0; k < t.index.length; k += 3) {
        const [a, b, c] = [t.index[k], t.index[k + 1], t.index[k + 2]];
        const x = (t.position[a * 2] + t.position[b * 2] + t.position[c * 2]) / 3;
        const y = (t.position[a * 2 + 1] + t.position[b * 2 + 1] + t.position[c * 2 + 1]) / 3;
        if (Math.abs(x - 2.5) > 2 || Math.abs(y) > 4) continue;
        between++;
        expect(Math.floor(t.road[a * 4 + 3] / 2048) % 2).toBe(1);
      }
    }
    expect(between).toBeGreaterThan(0);
    // The paved area stays whole: the four roads and the junction, give or take the kerbs
    const total = tris.reduce((s, t) => s + area(t), 0);
    expect(total).toBeGreaterThan(200 * 9 + 2 * 95 * 6 - 20);
    expect(total).toBeLessThan(200 * 9 + 2 * 100 * 6 + 60);
  });

  it('gives roads of one rank that overlap without meeting an order, so they never lie at one depth', () => {
    const net = buildRoadNetwork(
      paths(
        [
          { a: 'a', b: 'b', kind: 'path', width: 2, surface: 'sidewalk' },
          { a: 'c', b: 'd', kind: 'path', width: 2, surface: 'sidewalk' },
        ],
        [['a', -20, 0], ['b', 20, 0], ['c', 0, -20], ['d', 0, 20]],
      ),
    );
    const orders = new Set<number>();
    for (const t of net.tiles) for (let k = 3; k < t.road.length; k += 4) orders.add(Math.floor(t.road[k] / 1048576));
    expect(orders.size).toBe(2);
  });
});

describe('road network, kerbs through a junction', () => {
  it('follows a road bending through a junction on the inside of the bend, round as the road', () => {
    // A ring road of radius 20 round (0, 0) through node c at the top, a side road leaving it outwards there
    const arc = (from: number, to: number) => Array.from({ length: 9 }, (_, k) => {
      const a = from + ((to - from) * (k + 1)) / 10;
      return { x: Math.cos(a) * 20, y: Math.sin(a) * 20 };
    });
    const net = buildRoadNetwork({
      nodes: [
        { id: 'w', x: Math.cos(Math.PI * 0.9) * 20, y: Math.sin(Math.PI * 0.9) * 20 },
        { id: 'c', x: 0, y: 20 },
        { id: 'e', x: Math.cos(Math.PI * 0.1) * 20, y: Math.sin(Math.PI * 0.1) * 20 },
        { id: 'n', x: 0, y: 60 },
      ],
      edges: [
        { id: 'e1', a: 'w', b: 'c', width: 6, kind: 'road', surface: 'asphalt', via: arc(Math.PI * 0.9, Math.PI * 0.5) },
        { id: 'e2', a: 'c', b: 'e', width: 6, kind: 'road', surface: 'asphalt', via: arc(Math.PI * 0.5, Math.PI * 0.1) },
        { id: 'e3', a: 'c', b: 'n', width: 6, kind: 'road', surface: 'asphalt' },
      ],
    });
    // Every point of the surface lies outside the circle of the inner edge (17 m), none cut across into it
    let inner = Infinity;
    for (const t of net.tiles) for (let k = 0; k < t.position.length; k += 2) inner = Math.min(inner, Math.hypot(t.position[k], t.position[k + 1]));
    expect(inner).toBeGreaterThan(16.9);
    expect(inner).toBeLessThan(17.1);
  });

  it('keeps pavement and kerb parallel to the outline round the corners of a junction: the distance to the edge is the true one', () => {
    const net = buildRoadNetwork(
      paths(
        [
          { a: 'w', b: 'c', street: 'secondary', width: 9, sidewalk: 1.8 },
          { a: 'c', b: 'e', street: 'secondary', width: 9, sidewalk: 1.8 },
          { a: 'c', b: 'n', street: 'residential', width: 6, sidewalk: 1.5 },
          { a: 's', b: 'c', street: 'residential', width: 6, sidewalk: 1.5 },
        ],
        [['w', -100, 0], ['c', 0, 0], ['e', 100, 0], ['n', 20, 100], ['s', 0, -100]],
      ),
    );
    // A distance to the edge rises a metre a metre: so on every triangle along the outline (two corners on the
    // pavement's outer edge), in the ribbons and round the junction's corners alike. Fanned from the node it rose by
    // the node's distance to the edge over the way there, slower the further out the corner
    let worst = 0;
    let seen = 0;
    for (const t of net.tiles) {
      for (let k = 0; k < t.index.length; k += 3) {
        const v = [0, 1, 2].map((j) => t.index[k + j]);
        const [a, b, c] = v.map((n) => [t.position[n * 2], t.position[n * 2 + 1], t.road[n * 4 + 2]]);
        if (v.filter((n) => t.road[n * 4 + 2] < -1.4).length < 2) continue;
        const d = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        if (d < 0.02) continue;
        const gx = ((b[2] - a[2]) * (c[1] - a[1]) - (c[2] - a[2]) * (b[1] - a[1])) / d;
        const gy = ((c[2] - a[2]) * (b[0] - a[0]) - (b[2] - a[2]) * (c[0] - a[0])) / d;
        seen++;
        worst = Math.max(worst, Math.abs(Math.hypot(gx, gy) - 1));
      }
    }
    expect(seen).toBeGreaterThan(20);
    expect(worst).toBeLessThan(0.1);
  });
});
