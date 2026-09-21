import { describe, expect, it } from 'vitest';
import type { NearestStreetPoint, Street, StreetNetwork, StreetNode } from '../interfaces/street-network-provider.interface';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT } from './geo-utils';
import { SeededRandom } from './seeded-random';
import { distanceToSegment } from './street-astar';
import { StreetSegmentGrid, nearestStreetSegment } from './street-grid';

/**
 * The flat search `findNearestStreetPoint` ran until the segment grid took
 * over (OsmStreetService, DevStreetProvider). It stays here as the reference
 * the grid is measured against, it is not called by the game any more.
 */
function linearNearest(
  network: StreetNetwork,
  lat: number,
  lon: number,
  accept?: (node: StreetNode) => boolean
): NearestStreetPoint | null {
  let nearest: NearestStreetPoint | null = null;
  for (const street of network.streets) {
    for (let i = 0; i < street.nodes.length - 1; i++) {
      const node1 = street.nodes[i];
      const node2 = street.nodes[i + 1];
      if (accept && !accept(node1)) continue;
      const dist = distanceToSegment(lat, lon, node1.lat, node1.lon, node2.lat, node2.lon);
      if (!nearest || dist < nearest.distance) {
        nearest = { street, nodeIndex: i, distance: dist };
      }
    }
  }
  return nearest;
}

const HQ = { lat: 48.9, lon: 9.2 };
const M_PER_DEG_LON = METERS_PER_DEGREE_LAT * Math.cos(HQ.lat * DEG_TO_RAD);
const geoAt = (x: number, z: number) => ({
  lat: HQ.lat + z / METERS_PER_DEGREE_LAT,
  lon: HQ.lon + x / M_PER_DEG_LON,
});

function network(streets: Street[]): StreetNetwork {
  const nodes = new Map<number, StreetNode>();
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const street of streets) {
    for (const node of street.nodes) {
      nodes.set(node.id, node);
      minLat = Math.min(minLat, node.lat);
      maxLat = Math.max(maxLat, node.lat);
      minLon = Math.min(minLon, node.lon);
      maxLon = Math.max(maxLon, node.lon);
    }
  }
  return { streets, nodes, bounds: { minLat, maxLat, minLon, maxLon } };
}

/**
 * A network the size of a loaded box: a street every 100 m over 1600 m square,
 * a shape node every 20 m, every node nudged by up to 3 m so the segments do
 * not all lie on the same lines, plus a few long ways across the whole box
 * (the motorways whose nodes sit hundreds of metres apart).
 */
function cityGrid(): StreetNetwork {
  const random = new SeededRandom(20260921);
  const HALF_M = 800;
  const BLOCK_M = 100;
  const NODE_M = 20;
  const nodes = new Map<number, StreetNode>();
  const steps = HALF_M / NODE_M;
  const node = (xi: number, zi: number): StreetNode => {
    const id = (xi + steps) * (2 * steps + 1) + (zi + steps) + 1;
    let n = nodes.get(id);
    if (!n) {
      const jitterX = (random.next() - 0.5) * 6;
      const jitterZ = (random.next() - 0.5) * 6;
      n = { id, ...geoAt(xi * NODE_M + jitterX, zi * NODE_M + jitterZ) };
      nodes.set(id, n);
    }
    return n;
  };
  const streets: Street[] = [];
  const perBlock = BLOCK_M / NODE_M;
  for (let line = -HALF_M; line <= HALF_M; line += BLOCK_M) {
    const li = line / NODE_M;
    for (let from = -HALF_M; from < HALF_M; from += BLOCK_M) {
      const fi = from / NODE_M;
      const eastWest: StreetNode[] = [];
      const northSouth: StreetNode[] = [];
      for (let k = 0; k <= perBlock; k++) {
        eastWest.push(node(fi + k, li));
        northSouth.push(node(li, fi + k));
      }
      streets.push({ id: streets.length + 1, name: '', type: 'residential', nodes: eastWest });
      streets.push({ id: streets.length + 1, name: '', type: 'residential', nodes: northSouth });
    }
  }
  // Two ways with 800 m between their nodes: they land in the grid's wide list.
  streets.push({
    id: streets.length + 1,
    name: '',
    type: 'motorway',
    nodes: [
      { id: 900001, ...geoAt(-HALF_M, -30) },
      { id: 900002, ...geoAt(0, -30) },
      { id: 900003, ...geoAt(HALF_M, -30) },
    ],
  });
  streets.push({
    id: streets.length + 1,
    name: '',
    type: 'motorway',
    nodes: [
      { id: 900004, ...geoAt(-40, -HALF_M) },
      { id: 900005, ...geoAt(-40, HALF_M) },
    ],
  });
  for (const street of streets) {
    for (const n of street.nodes) nodes.set(n.id, n);
  }
  return network(streets);
}

/** `street` by identity, the index and the distance to the last bit. */
function expectSame(got: NearestStreetPoint | null, want: NearestStreetPoint | null, where: string): void {
  if (want === null) {
    expect(got, where).toBeNull();
    return;
  }
  expect(got, where).not.toBeNull();
  expect(got!.street.id, `${where}: street`).toBe(want.street.id);
  expect(got!.street, `${where}: street object`).toBe(want.street);
  expect(got!.nodeIndex, `${where}: nodeIndex`).toBe(want.nodeIndex);
  expect(got!.distance, `${where}: distance`).toBe(want.distance);
}

describe('StreetSegmentGrid', () => {
  it('answers exactly as the flat search over a box the size of a city load', () => {
    const net = cityGrid();
    let segments = 0;
    for (const street of net.streets) segments += street.nodes.length - 1;
    expect(segments).toBeGreaterThan(2500);

    const grid = new StreetSegmentGrid(net);
    const random = new SeededRandom(7);
    for (let i = 0; i < 400; i++) {
      const x = (random.next() - 0.5) * 1700;
      const z = (random.next() - 0.5) * 1700;
      const p = geoAt(x, z);
      expectSame(grid.nearest(p.lat, p.lon), linearNearest(net, p.lat, p.lon), `inside at ${x},${z}`);
    }
  });

  it('answers the same for a point far outside the streets, in every direction', () => {
    const net = cityGrid();
    const grid = new StreetSegmentGrid(net);
    const outside: [number, number][] = [
      [0, 5000], [0, -5000], [5000, 0], [-5000, 0],
      [4000, 4000], [-4000, 4000], [4000, -4000], [-4000, -4000],
      [0, 900], [900, 0], [850, 850], [-60000, 120000],
    ];
    for (const [x, z] of outside) {
      const p = geoAt(x, z);
      expectSame(grid.nearest(p.lat, p.lon), linearNearest(net, p.lat, p.lon), `outside at ${x},${z}`);
    }
  });

  it('answers the same on a node and on the foot of a segment', () => {
    const net = cityGrid();
    const grid = new StreetSegmentGrid(net);
    for (const street of net.streets.slice(0, 40)) {
      for (const node of street.nodes) {
        expectSame(grid.nearest(node.lat, node.lon), linearNearest(net, node.lat, node.lon), `on node ${node.id}`);
      }
      const a = street.nodes[0];
      const b = street.nodes[1];
      const mid = { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
      expectSame(grid.nearest(mid.lat, mid.lon), linearNearest(net, mid.lat, mid.lon), `on segment of ${street.id}`);
    }
  });

  it('keeps the flat search tie-break when two segments are equally far', () => {
    // Four segments around the origin at the same distance, in two streets.
    const at = (id: number, x: number, z: number): StreetNode => ({ id, ...geoAt(x, z) });
    const west: Street = { id: 1, name: '', type: 'residential', nodes: [at(1, -50, -100), at(2, -50, 100)] };
    const east: Street = { id: 2, name: '', type: 'residential', nodes: [at(3, 50, -100), at(4, 50, 100)] };
    const eastTwin: Street = { id: 3, name: '', type: 'residential', nodes: [at(5, 50, -100), at(6, 50, 100)] };
    const westTwin: Street = { id: 4, name: '', type: 'residential', nodes: [at(7, -50, -100), at(8, -50, 100)] };
    const net = network([west, east, eastTwin, westTwin]);
    const grid = new StreetSegmentGrid(net);
    const here = geoAt(0, 0);

    const want = linearNearest(net, here.lat, here.lon)!;
    const got = grid.nearest(here.lat, here.lon)!;
    // The two sides are the same distance apart to the bit, so the first street wins.
    expect(linearNearest(net, here.lat, here.lon)!.distance).toBe(
      distanceToSegment(here.lat, here.lon, east.nodes[0].lat, east.nodes[0].lon, east.nodes[1].lat, east.nodes[1].lon)
    );
    expect(want.street).toBe(west);
    expectSame(got, want, 'tie');

    // A street with several equally far segments: the lower index wins.
    const crossing: Street = {
      id: 5,
      name: '',
      type: 'residential',
      nodes: [at(9, -20, 200), at(10, 0, 200), at(11, 20, 200)],
    };
    const above = network([crossing]);
    const onNode = geoAt(0, 200);
    const gridAbove = new StreetSegmentGrid(above);
    expectSame(gridAbove.nearest(onNode.lat, onNode.lon), linearNearest(above, onNode.lat, onNode.lon), 'tie inside a street');
    expect(gridAbove.nearest(onNode.lat, onNode.lon)!.nodeIndex).toBe(0);
  });

  it('answers null without segments, and skips streets of one node', () => {
    const empty = network([]);
    expect(new StreetSegmentGrid(empty).nearest(HQ.lat, HQ.lon)).toBeNull();
    expect(linearNearest(empty, HQ.lat, HQ.lon)).toBeNull();

    const lone: Street = { id: 1, name: '', type: 'residential', nodes: [{ id: 1, ...geoAt(0, 0) }] };
    const onlyNodes = network([lone]);
    expect(new StreetSegmentGrid(onlyNodes).nearest(HQ.lat, HQ.lon)).toBeNull();
    expect(linearNearest(onlyNodes, HQ.lat, HQ.lon)).toBeNull();

    // A street of one node beside one with a segment: the segment answers.
    const pair = network([lone, { id: 2, name: '', type: 'residential', nodes: [{ id: 2, ...geoAt(100, 0) }, { id: 3, ...geoAt(200, 0) }] }]);
    const p = geoAt(0, 0);
    expectSame(new StreetSegmentGrid(pair).nearest(p.lat, p.lon), linearNearest(pair, p.lat, p.lon), 'lone node beside a segment');
  });

  it('filters by the segment start node exactly as the flat search did', () => {
    const net = cityGrid();
    const grid = new StreetSegmentGrid(net);
    // Half the nodes by id, as segmentRoutes filters by connected piece.
    const accept = (node: StreetNode) => node.id % 2 === 0;
    const random = new SeededRandom(11);
    for (let i = 0; i < 120; i++) {
      const x = (random.next() - 0.5) * 1700;
      const z = (random.next() - 0.5) * 1700;
      const p = geoAt(x, z);
      expectSame(grid.nearest(p.lat, p.lon, accept), linearNearest(net, p.lat, p.lon, accept), `accept at ${x},${z}`);
    }
    // A filter nothing passes answers null, like the flat search.
    const here = geoAt(0, 0);
    expect(grid.nearest(here.lat, here.lon, () => false)).toBeNull();
    expect(linearNearest(net, here.lat, here.lon, () => false)).toBeNull();
  });

  it('builds a grid per network, so new streets are never answered from the old ones', () => {
    const first = network([
      { id: 1, name: '', type: 'residential', nodes: [{ id: 1, ...geoAt(0, 0) }, { id: 2, ...geoAt(100, 0) }] },
    ]);
    const p = geoAt(10, 5);
    expect(nearestStreetSegment(first, p.lat, p.lon)!.street.id).toBe(1);

    // A load of another box: a new network object, which brings its own grid.
    const second = network([
      { id: 7, name: '', type: 'residential', nodes: [{ id: 3, ...geoAt(0, 400) }, { id: 4, ...geoAt(100, 400) }] },
    ]);
    const answer = nearestStreetSegment(second, p.lat, p.lon)!;
    expect(answer.street.id).toBe(7);
    expectSame(answer, linearNearest(second, p.lat, p.lon), 'after a new load');

    // The old network still answers from its own grid.
    expect(nearestStreetSegment(first, p.lat, p.lon)!.street.id).toBe(1);
  });
});
