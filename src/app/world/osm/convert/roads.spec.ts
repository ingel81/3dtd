import { createMapDocument } from '../../custom-map/map-create';
import { components, routeBetween } from '../../../editor/ops/path-graph';
import { OsmFrame, parseOsm } from '../osm-parse';
import type { OverpassElement } from '../overpass-client';
import { buildRoads, clipPieces, levelRoads, paintRoads } from './roads';

const frame = new OsmFrame(48, 9);
const g = (x: number, y: number) => frame.geo({ x, y });

/** A road way through map points, each with its own node id */
function way(id: number, tags: Record<string, string>, points: [number, number, number][]): OverpassElement {
  return { type: 'way', id, tags, nodes: points.map((p) => p[2]), geometry: points.map(([x, y]) => g(x, y)) };
}

describe('OSM roads', () => {
  it('joins ways where they share an inner node, as the real places do', () => {
    // A runs west to east through node 5; B runs south to north through it
    const f = parseOsm({
      elements: [
        way(1, { highway: 'residential' }, [[-100, 0, 1], [0, 0, 5], [100, 0, 2]]),
        way(2, { highway: 'footway' }, [[0, -100, 3], [0, 0, 5], [0, 100, 4]]),
      ],
    }, frame, 1200);
    const { paths, stats } = buildRoads(f);
    expect(stats.edges).toBe(4);
    expect(paths.nodes.map((n) => n.id).sort()).toEqual(['n1', 'n2', 'n3', 'n4', 'n5']);
    expect(components(paths)).toHaveLength(1);
    const route = routeBetween(paths, { x: -100, y: 0 }, { x: 0, y: 100 })!;
    expect(route.length).toBeCloseTo(200, 0);
    const road = paths.edges.find((e) => e.street === 'residential')!;
    expect(road).toMatchObject({ kind: 'road', width: 6, surface: 'asphalt' });
    expect(paths.edges.find((e) => e.street === 'footway')).toMatchObject({ kind: 'path', width: 2.5, surface: 'sidewalk' });
  });

  it('reads width, lanes and surface, makes bridges and keeps tunnels as tunnel edges', () => {
    const f = parseOsm({
      elements: [
        way(1, { highway: 'primary', lanes: '4' }, [[-50, 0, 1], [0, 0, 2]]),
        way(2, { highway: 'primary', bridge: 'yes', width: '9.5' }, [[0, 0, 2], [40, 0, 3]]),
        way(3, { highway: 'primary', tunnel: 'yes' }, [[40, 0, 3], [300, 0, 4]]),
        way(4, { highway: 'service', tunnel: 'building_passage', surface: 'sett' }, [[40, 0, 3], [40, 30, 5]]),
        way(5, { highway: 'construction' }, [[0, 0, 2], [0, 50, 6]]),
      ],
    }, frame, 1200);
    const { paths, stats, mouths } = buildRoads(f);
    expect(stats.tunnels).toBe(1);
    expect(stats.tunnelM).toBe(260);
    expect(paths.edges.map((e) => [e.street, e.kind, e.width, e.surface ?? e.style ?? (e.tunnel && 'tunnel')])).toEqual([
      ['primary', 'road', 12, 'asphalt'],
      ['primary', 'bridge', 9.5, 'stone'],
      ['primary', 'road', 10, 'tunnel'],
      ['service', 'road', 4, 'cobblestone'],
    ]);
    // Routes run through it: the graph stays one piece from the bridge to the far mouth
    expect(routeBetween(paths, { x: -50, y: 0 }, { x: 300, y: 0 })!.length).toBeCloseTo(350, 0);
    expect(mouths.map((m) => [m.p.x, m.inward.x, m.width])).toEqual([[40, 1, 10], [300, -1, 10]]);
  });

  it('joins tunnel ways end to end, puts mouths only at its open ends inside the map, and keeps short ones and footways open', () => {
    const f = parseOsm({
      elements: [
        way(1, { highway: 'primary', tunnel: 'yes' }, [[0, 0, 1], [100, 0, 2]]),
        way(2, { highway: 'primary', tunnel: 'yes' }, [[100, 0, 2], [100, 100, 3], [1300, 100, 4]]),
        way(3, { highway: 'footway', tunnel: 'yes' }, [[0, 50, 5], [0, 150, 6]]),
        way(4, { highway: 'service', tunnel: 'yes' }, [[300, 0, 7], [330, 0, 8]]),
      ],
    }, frame, 1200);
    const { paths, stats, tunnels, mouths } = buildRoads(f);
    expect(stats).toMatchObject({ tunnels: 1, openTunnels: 2 });
    expect(tunnels[0].lines).toHaveLength(2);
    // Node 2 joins the two ways, node 4 lies off the map: one mouth, at node 1, facing east
    expect(mouths.map((m) => [m.p.x, m.p.y, m.inward.x])).toEqual([[0, 0, 1]]);
    expect(paths.edges.find((e) => e.street === 'footway')).toMatchObject({ kind: 'path', surface: 'sidewalk' });
    expect(paths.edges.find((e) => e.street === 'footway')!.tunnel).toBeUndefined();
    expect(paths.edges.find((e) => e.street === 'service')).toMatchObject({ kind: 'road', surface: 'asphalt' });
  });

  it('neither levels nor paints a tunnel', () => {
    const doc = createMapDocument({ id: 't', name: 't', width: 200, depth: 200, cellSize: 2, splatResolution: 256, starter: false });
    const t = doc.terrain;
    for (let j = 0; j < t.grid.rows; j++) for (let i = 0; i < t.grid.columns; i++) t.grid.heights[j * t.grid.columns + i] = j * t.grid.cellSize * 0.2;
    const before = Float32Array.from(t.grid.heights);
    const f = parseOsm({ elements: [way(1, { highway: 'residential', tunnel: 'yes' }, [[-80, 0, 1], [80, 0, 2]])] }, frame, 100);
    doc.paths = buildRoads(f).paths;
    levelRoads(t, doc.paths);
    expect(t.grid.heights).toEqual(before);
    expect(paintRoads(t, doc.paths)).toEqual([]);
  });

  it('cuts a way at the map edge with a node there, and where the answer cut its nodes off', () => {
    const f = parseOsm({ elements: [way(1, { highway: 'track' }, [[-1100, 0, 1], [-1300, 0, 2]])] }, frame, 1200);
    const { paths, stats } = buildRoads(f);
    expect(stats.cutAtEdge).toBe(1);
    expect(paths.nodes.map((n) => [n.id, n.x])).toEqual([['n1', -1100], ['b2', -1199]]);
    const v = (x: number, id: number) => ({ id, p: { x, y: 0 } });
    expect(clipPieces([v(0, 1), v(10, 2), null, v(30, 4), v(40, 5)], 100).map((p) => p.vertices.map((q) => q.id))).toEqual([[1, 2], [4, 5]]);
  });

  it('splits a closed way at its middle so no edge starts and ends at one node', () => {
    const f = parseOsm({ elements: [way(1, { highway: 'service' }, [[0, 0, 1], [20, 0, 2], [20, 20, 3], [0, 20, 4], [0, 0, 1]])] }, frame, 1200);
    const { paths } = buildRoads(f);
    expect(paths.edges.length).toBe(2);
    for (const e of paths.edges) expect(e.a).not.toBe(e.b);
  });

  it('levels the ground across a road and paints its surface, the road mask left to the painted ones', () => {
    const doc = createMapDocument({ id: 't', name: 't', width: 200, depth: 200, cellSize: 2, splatResolution: 256, starter: false });
    const t = doc.terrain;
    // A slope across the road: 0.2 m per metre north
    for (let j = 0; j < t.grid.rows; j++) for (let i = 0; i < t.grid.columns; i++) t.grid.heights[j * t.grid.columns + i] = j * t.grid.cellSize * 0.2;
    const f = parseOsm({ elements: [way(1, { highway: 'residential' }, [[-80, 0, 1], [80, 0, 2]])] }, frame, 100);
    doc.paths = buildRoads(f).paths;
    levelRoads(t, doc.paths);
    const h = (x: number, y: number) => t.grid.heights[Math.round((y + 100) / 2) * t.grid.columns + Math.round((x + 100) / 2)];
    expect(Math.abs(h(0, 2) - h(0, -2))).toBeLessThan(0.05);
    expect(paintRoads(t, doc.paths)).toEqual(['asphalt']);
    const texel = (x: number, y: number) => Math.floor(((y + 100) / 200) * 256) * 256 + Math.floor(((x + 100) / 200) * 256);
    expect(t.splat.maps[0][texel(0, 0) * 4 + 1]).toBe(255);
    expect(t.splat.maps[0][texel(0, 20) * 4]).toBe(255);
  });
});
