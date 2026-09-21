import { describe, expect, it } from 'vitest';
import type { NearestStreetPoint, Street, StreetNetwork, StreetNode } from '../interfaces/street-network-provider.interface';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT } from './geo-utils';
import { SeededRandom } from './seeded-random';
import { distanceToSegment } from './street-astar';
import { StreetSegmentGrid } from './street-grid';

/**
 * What one `findNearestStreetPoint` costs over a street network the size of a
 * loaded city box, flat search against the segment grid. A measurement, not a
 * test: skipped unless STREET_GRID_PERF=1, then it prints a table.
 *
 *   $env:STREET_GRID_PERF=1; npx vitest run src/app/utils/street-grid.perf.spec.ts
 *
 * The network is the one spawn-preview.perf.spec.ts uses: a grid of streets
 * over +-2000 m around the HQ, a street every 100 m, a way per block, a shape
 * node every 20 m, plus two ways across the whole box whose nodes sit 2 km
 * apart. Real boxes differ; Overpass caps the answer at 4 MB.
 */

const HQ = { lat: 48.9, lon: 9.2 };
const M_PER_DEG_LON = METERS_PER_DEGREE_LAT * Math.cos(HQ.lat * DEG_TO_RAD);
const HALF_M = 2000;
const BLOCK_M = 100;
const NODE_M = 20;

const geoAt = (x: number, z: number) => ({
  lat: HQ.lat + z / METERS_PER_DEGREE_LAT,
  lon: HQ.lon + x / M_PER_DEG_LON,
});

/** The flat search findNearestStreetPoint ran before the grid, as the baseline. */
function linearNearest(network: StreetNetwork, lat: number, lon: number): NearestStreetPoint | null {
  let nearest: NearestStreetPoint | null = null;
  for (const street of network.streets) {
    for (let i = 0; i < street.nodes.length - 1; i++) {
      const node1 = street.nodes[i];
      const node2 = street.nodes[i + 1];
      const dist = distanceToSegment(lat, lon, node1.lat, node1.lon, node2.lat, node2.lon);
      if (!nearest || dist < nearest.distance) {
        nearest = { street, nodeIndex: i, distance: dist };
      }
    }
  }
  return nearest;
}

function cityGrid(): StreetNetwork {
  const nodes = new Map<number, StreetNode>();
  const steps = HALF_M / NODE_M;
  const node = (xi: number, zi: number): StreetNode => {
    const id = (xi + steps) * (2 * steps + 1) + (zi + steps) + 1;
    let n = nodes.get(id);
    if (!n) {
      n = { id, ...geoAt(xi * NODE_M, zi * NODE_M) };
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
  const across: [number, number, number, number][] = [
    [-HALF_M, -30, HALF_M, -30],
    [-40, -HALF_M, -40, HALF_M],
  ];
  let id = 900001;
  for (const [x0, z0, x1, z1] of across) {
    streets.push({
      id: streets.length + 1,
      name: '',
      type: 'motorway',
      nodes: [{ id: id++, ...geoAt(x0, z0) }, { id: id++, ...geoAt(x1, z1) }],
    });
  }
  for (const street of streets) {
    for (const n of street.nodes) nodes.set(n.id, n);
  }
  const min = geoAt(-HALF_M, -HALF_M);
  const max = geoAt(HALF_M, HALF_M);
  return { streets, nodes, bounds: { minLat: min.lat, minLon: min.lon, maxLat: max.lat, maxLon: max.lon } };
}

/** Milliseconds per call of `fn` over `runs` calls after a warm-up: mean, median, 95th percentile, max. */
function measure(name: string, fn: () => void, runs: number) {
  for (let i = 0; i < Math.min(20, runs); i++) fn();
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const ms = (v: number) => Math.round(v * 1000) / 1000;
  return {
    name,
    runs,
    meanMs: ms(times.reduce((s, t) => s + t, 0) / runs),
    medianMs: ms(times[Math.floor(runs / 2)]),
    p95Ms: ms(times[Math.floor(runs * 0.95)]),
    maxMs: ms(times[runs - 1]),
  };
}

describe.skipIf(process.env['STREET_GRID_PERF'] !== '1')('findNearestStreetPoint cost (measurement)', () => {
  it('prints what one lookup costs flat and over the grid', () => {
    const network = cityGrid();
    let segments = 0;
    for (const street of network.streets) segments += street.nodes.length - 1;

    const random = new SeededRandom(3);
    const points: { lat: number; lon: number }[] = [];
    for (let i = 0; i < 512; i++) {
      points.push(geoAt((random.next() - 0.5) * 2 * HALF_M, (random.next() - 0.5) * 2 * HALF_M));
    }
    let at = 0;
    const nextPoint = () => points[at++ % points.length];
    const far = geoAt(HALF_M + 3000, HALF_M + 3000);

    const buildStart = performance.now();
    const grid = new StreetSegmentGrid(network);
    const buildMs = performance.now() - buildStart;

    // The two must agree before their times mean anything.
    for (const p of points) {
      const flat = linearNearest(network, p.lat, p.lon)!;
      const fast = grid.nearest(p.lat, p.lon)!;
      expect(fast.street).toBe(flat.street);
      expect(fast.nodeIndex).toBe(flat.nodeIndex);
      expect(fast.distance).toBe(flat.distance);
    }

    const rows = [
      measure('flat search, point inside the box', () => {
        const p = nextPoint();
        linearNearest(network, p.lat, p.lon);
      }, 200),
      measure('grid, point inside the box', () => {
        const p = nextPoint();
        grid.nearest(p.lat, p.lon);
      }, 2000),
      measure('flat search, point 3 km outside', () => linearNearest(network, far.lat, far.lon), 200),
      measure('grid, point 3 km outside', () => grid.nearest(far.lat, far.lon), 2000),
    ];
    console.log(
      `network: ${network.streets.length} ways, ${segments} segments, ${network.nodes.size} nodes; ` +
      `grid built in ${Math.round(buildMs * 100) / 100} ms`
    );
    console.table(rows);
  });
});
