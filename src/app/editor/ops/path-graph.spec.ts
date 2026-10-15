import type { MapPaths } from '../../world/custom-map/map-document';
import {
  addNode,
  components,
  connect,
  deleteEdge,
  deleteNode,
  dissolveNode,
  edgePolyline,
  EdgeIndex,
  mergeNodes,
  moveNode,
  nearestOnEdges,
  routeBetween,
  smoothEdge,
  splitEdge,
} from './path-graph';

function line(): MapPaths {
  const p: MapPaths = { nodes: [], edges: [] };
  const a = addNode(p, { x: 0, y: 0 });
  const b = addNode(p, { x: 100, y: 0 });
  const c = addNode(p, { x: 100, y: 100 });
  connect(p, a.id, b.id);
  connect(p, b.id, c.id);
  return p;
}

describe('path graph', () => {
  it('connects once and never a node to itself', () => {
    const p = line();
    expect(connect(p, 'n1', 'n2')).toBe(p.edges[0]);
    expect(connect(p, 'n1', 'n1')).toBeNull();
    expect(p.edges).toHaveLength(2);
  });

  it('splits an edge into a junction and keeps its curve on both halves', () => {
    const p = line();
    p.edges[0].via = [{ x: 25, y: 5 }, { x: 75, y: 5 }];
    const j = splitEdge(p, 'e1', { x: 50, y: 10 })!;
    expect(j).toBeTruthy();
    expect(p.edges).toHaveLength(3);
    const halves = p.edges.filter((e) => e.a === j.id || e.b === j.id);
    expect(halves).toHaveLength(2);
    expect(halves.flatMap((e) => e.via ?? [])).toHaveLength(2);
    // A branch from the junction
    const d = addNode(p, { x: 50, y: -80 });
    connect(p, j.id, d.id);
    expect(components(p)).toHaveLength(1);
  });

  it('deletes nodes and edges, dropping lonely nodes', () => {
    const p = line();
    deleteEdge(p, 'e2');
    expect(p.nodes.map((n) => n.id)).toEqual(['n1', 'n2']);
    deleteNode(p, 'n1');
    expect(p.edges).toHaveLength(0);
  });

  it('dissolves a node between two edges into a curve point', () => {
    const p = line();
    expect(dissolveNode(p, 'n2')).toBe(true);
    expect(p.edges).toHaveLength(1);
    expect(edgePolyline(p, p.edges[0])).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
  });

  it('merges a node into another (snapping)', () => {
    const p = line();
    const e = addNode(p, { x: 101, y: 1 });
    connect(p, 'n1', e.id);
    mergeNodes(p, e.id, 'n2');
    expect(p.nodes.some((n) => n.id === e.id)).toBe(false);
    // n1-n2 existed already: no double edge
    expect(p.edges).toHaveLength(2);
  });

  it('moves a node and drags curve points along', () => {
    const p = line();
    p.edges[0].via = [{ x: 50, y: 0 }];
    moveNode(p, 'n2', { x: 100, y: 20 });
    expect(p.edges[0].via![0]).toEqual({ x: 50, y: 10 });
  });

  it('smooths an edge through a corner', () => {
    const p = line();
    smoothEdge(p, 'e1', 10);
    const via = p.edges[0].via!;
    expect(via.length).toBeGreaterThan(5);
    // Ends of the line stay put
    expect(edgePolyline(p, p.edges[0])[0]).toEqual({ x: 0, y: 0 });
  });

  it('finds the nearest point on the network', () => {
    const p = line();
    const hit = nearestOnEdges(p, { x: 40, y: 7 })!;
    expect(hit.edge.id).toBe('e1');
    expect(hit.point).toEqual({ x: 40, y: 0 });
    expect(hit.dist).toBeCloseTo(7);
  });

  it('routes the shortest way and reports split networks', () => {
    const p = line();
    // A shortcut from n1 to n3
    connect(p, 'n1', 'n3');
    const r = routeBetween(p, { x: 0, y: -5 }, { x: 100, y: 105 })!;
    expect(r.length).toBeCloseTo(Math.hypot(100, 100), 0);
    expect(r.startGap).toBeCloseTo(5);
    const lonely = addNode(p, { x: 500, y: 500 });
    const lonely2 = addNode(p, { x: 600, y: 500 });
    connect(p, lonely.id, lonely2.id);
    expect(routeBetween(p, { x: 0, y: 0 }, { x: 550, y: 500 })).toBeNull();
    expect(components(p)).toHaveLength(2);
  });

  it('routes along one edge in either direction', () => {
    const p = line();
    const r = routeBetween(p, { x: 80, y: 0 }, { x: 20, y: 0 })!;
    expect(r.length).toBeCloseTo(60);
    expect(r.points[0]).toEqual({ x: 80, y: 0 });
    expect(r.points.at(-1)).toEqual({ x: 20, y: 0 });
  });

  it('routes across edges with the full polyline', () => {
    const p = line();
    const r = routeBetween(p, { x: 10, y: 0 }, { x: 100, y: 90 })!;
    expect(r.length).toBeCloseTo(90 + 90);
    expect(r.points).toContainEqual({ x: 100, y: 0 });
  });

  it('finds through its edge grid the nearest point nearestOnEdges finds, and the same routes', () => {
    // A tangle of roads with curves over 2 km, points inside, beside and far off it
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const p: MapPaths = { nodes: [], edges: [] };
    for (let k = 0; k < 60; k++) addNode(p, { x: rnd() * 2000 - 1000, y: rnd() * 2000 - 1000 });
    for (let k = 0; k < 90; k++) {
      const a = p.nodes[Math.floor(rnd() * 60)];
      const b = p.nodes[Math.floor(rnd() * 60)];
      const e = connect(p, a.id, b.id, 4 + rnd() * 8);
      if (e && rnd() < 0.5) e.via = [{ x: (a.x + b.x) / 2 + rnd() * 80 - 40, y: (a.y + b.y) / 2 + rnd() * 80 - 40 }];
    }
    const index = new EdgeIndex(p);
    for (let k = 0; k < 400; k++) {
      const q = { x: rnd() * 3000 - 1500, y: rnd() * 3000 - 1500 };
      const reach = k % 2 ? Infinity : 30;
      const want = nearestOnEdges(p, q, reach);
      const got = index.nearest(q, reach);
      expect(got?.edge.id).toBe(want?.edge.id);
      if (want) expect(got!.dist).toBeCloseTo(want.dist, 9);
    }
    const from = p.nodes[0];
    const to = p.nodes[1];
    expect(routeBetween(p, from, to, index)?.length).toBeCloseTo(routeBetween(p, from, to)!.length, 9);
  });
});
