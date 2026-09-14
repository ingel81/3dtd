import { describe, expect, it } from 'vitest';
import { MERGE_RADIUS_M, RouteGraph } from './route-graph';
import { METERS_PER_DEGREE_LAT } from './geo-utils';
import { LAT0, LON0, COS, at, line } from '../../test/geo-test-points';
import type { GeoPosition } from '../models/game.types';

/** Metres east and north of the origin, rounded to centimetres. */
const local = (p: GeoPosition) => ({
  x: Math.round((p.lon - LON0) * METERS_PER_DEGREE_LAT * COS * 100) / 100,
  z: Math.round((p.lat - LAT0) * METERS_PER_DEGREE_LAT * 100) / 100,
});

/**
 * Two spawns joining at (0, 100) and walking north together to the HQ at
 * (0, 200). West starts at (-100, 100), south at (0, 0).
 */
function twoSpawns(order: 'west-first' | 'south-first' = 'west-first'): Map<string, GeoPosition[]> {
  const west = line([-100, 100], [-50, 100], [0, 100], [0, 150], [0, 200]);
  const south = line([0, 0], [0, 50], [0, 100], [0, 150], [0, 200]);
  return order === 'west-first'
    ? new Map([['spawn-west', west], ['spawn-south', south]])
    : new Map([['spawn-south', south], ['spawn-west', west]]);
}

describe('RouteGraph', () => {
  it('merges the waypoints two routes share into one node', () => {
    const graph = RouteGraph.fromRoutes(twoSpawns());
    // 5 + 5 waypoints, three of them shared
    expect(graph.nodes.length).toBe(7);
    expect(graph.edges.length).toBe(6);
  });

  it('merges waypoints closer than the merge radius, not farther ones', () => {
    const near = new Map([
      ['a', line([0, 0], [0, 10])],
      ['b', line([MERGE_RADIUS_M * 0.5, 10], [20, 10])],
    ]);
    expect(RouteGraph.fromRoutes(near).nodes.length).toBe(3);

    const far = new Map([
      ['a', line([0, 0], [0, 10])],
      ['b', line([MERGE_RADIUS_M * 2, 10], [20, 10])],
    ]);
    expect(RouteGraph.fromRoutes(far).nodes.length).toBe(4);
  });

  it('walks from one spawn to the other through the junction', () => {
    const graph = RouteGraph.fromRoutes(twoSpawns());
    const from = graph.nearestPoint(at(-100, 100).lat, at(-100, 100).lon)!;
    const to = graph.nearestPoint(at(0, 0).lat, at(0, 0).lon)!;
    const path = graph.shortestPath(from, to)!;

    expect(path.length).toBeCloseTo(200, 3);
    expect(path.points.map(local)).toEqual([
      { x: -100, z: 100 }, { x: -50, z: 100 }, { x: 0, z: 100 }, { x: 0, z: 50 }, { x: 0, z: 0 },
    ]);
  });

  it('starts and ends part-way along edges', () => {
    const graph = RouteGraph.fromRoutes(twoSpawns());
    const from = graph.nearestPoint(at(-75, 103).lat, at(-75, 103).lon)!; // 3 m off the west street
    const to = graph.nearestPoint(at(2, 175).lat, at(2, 175).lon)!;
    const path = graph.shortestPath(from, to)!;

    expect(path.length).toBeCloseTo(75 + 75, 3);
    expect(path.points.map(local)).toEqual([
      { x: -75, z: 100 }, { x: -50, z: 100 }, { x: 0, z: 100 }, { x: 0, z: 150 }, { x: 0, z: 175 },
    ]);
  });

  it('builds the same graph and the same path whatever order the routes arrive in', () => {
    const a = RouteGraph.fromRoutes(twoSpawns('west-first'));
    const b = RouteGraph.fromRoutes(twoSpawns('south-first'));
    expect(b.nodes).toEqual(a.nodes);
    expect(b.edges).toEqual(a.edges);

    const query = (g: RouteGraph) => {
      const from = g.nearestPoint(at(-100, 100).lat, at(-100, 100).lon)!;
      const to = g.nearestPoint(at(0, 200).lat, at(0, 200).lon)!;
      return g.shortestPath(from, to);
    };
    expect(query(b)).toEqual(query(a));
  });

  it('picks the same one of two equally long ways every time', () => {
    // A square: from its south-west to its north-east corner is 200 m both ways
    const loop = new Map([
      ['east', line([0, 0], [100, 0], [100, 100])],
      ['north', line([0, 0], [0, 100], [100, 100])],
    ]);
    const graph = RouteGraph.fromRoutes(loop);
    const from = graph.nearestPoint(at(0, 0).lat, at(0, 0).lon)!;
    const to = graph.nearestPoint(at(100, 100).lat, at(100, 100).lon)!;

    const first = graph.shortestPath(from, to)!;
    expect(first.length).toBeCloseTo(200, 3);
    for (let i = 0; i < 5; i++) {
      expect(graph.shortestPath(from, to)).toEqual(first);
    }
    expect(RouteGraph.fromRoutes(new Map([...loop].reverse())).shortestPath(from, to)).toEqual(first);
  });

  it('joins a route that meets another between two of its waypoints', () => {
    // The branch ends on the middle of the long east-west segment
    const routes = new Map([
      ['main', line([0, 0], [100, 0])],
      ['branch', line([50, 80], [50, 40], [50, 0.5])],
    ]);
    const graph = RouteGraph.fromRoutes(routes);
    const from = graph.nearestPoint(at(50, 80).lat, at(50, 80).lon)!;
    const to = graph.nearestPoint(at(100, 0).lat, at(100, 0).lon)!;
    const path = graph.shortestPath(from, to)!;

    expect(path.length).toBeCloseTo(79.5 + 50, 1);
    expect(path.points.map(local).at(-2)).toEqual({ x: 50, z: 0.5 });
  });

  it('snaps to the nearest route within the radius and refuses beyond it', () => {
    const graph = RouteGraph.fromRoutes(twoSpawns());
    const hit = graph.nearestPoint(at(12, 60).lat, at(12, 60).lon, 30)!;
    expect(hit.distanceM).toBeCloseTo(12, 3);
    expect(local(graph.pointGeo(hit))).toEqual({ x: 0, z: 60 });

    expect(graph.nearestPoint(at(40, 60).lat, at(40, 60).lon, 30)).toBeNull();
  });

  it('finds no way between routes that do not touch', () => {
    const apart = new Map([
      ['a', line([0, 0], [0, 50])],
      ['b', line([100, 0], [100, 50])],
    ]);
    const graph = RouteGraph.fromRoutes(apart);
    const from = graph.nearestPoint(at(0, 0).lat, at(0, 0).lon)!;
    const to = graph.nearestPoint(at(100, 50).lat, at(100, 50).lon)!;
    expect(graph.shortestPath(from, to)).toBeNull();
  });

  describe('closestWithinReach (the leash)', () => {
    const graph = RouteGraph.fromRoutes(twoSpawns());
    const anchor = graph.nearestPoint(at(0, 150).lat, at(0, 150).lon)!;

    it('goes as far as the reach toward an enemy beyond it, along the route', () => {
      const p = graph.closestWithinReach(anchor, 20, at(0, 60).lat, at(0, 60).lon);
      expect(local(graph.pointGeo(p))).toEqual({ x: 0, z: 130 });
    });

    it('stops at the enemy when it is within reach', () => {
      const p = graph.closestWithinReach(anchor, 20, at(3, 160).lat, at(3, 160).lon);
      expect(local(graph.pointGeo(p))).toEqual({ x: 0, z: 160 });
    });

    it('measures the reach along the route, round the corner, not in a straight line', () => {
      // Anchor 10 m south of the junction; an enemy on the west street is
      // 10 m from the junction, 14 m away in a straight line, 20 m along the route
      const nearCorner = graph.nearestPoint(at(0, 90).lat, at(0, 90).lon)!;
      const p = graph.closestWithinReach(nearCorner, 15, at(-10, 100).lat, at(-10, 100).lon);
      expect(local(graph.pointGeo(p))).toEqual({ x: -5, z: 100 });
    });
  });
});
