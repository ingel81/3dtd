import { describe, it, expect, vi } from 'vitest';
import type { StreetNode } from '../interfaces/street-network-provider.interface';
import { haversineDistance } from './geo-utils';
import { ROUTE_START_NODE_ID, SegmentRoutes, type RouteTail } from './route-start';

/** A segment of 333 m running north along lon 9, and a node beyond each end. */
const A: StreetNode = { id: 1, lat: 48.0, lon: 9.0 };
const B: StreetNode = { id: 2, lat: 48.003, lon: 9.0 };
const BEFORE_A: StreetNode = { id: 10, lat: 47.999, lon: 9.0 };
const BEYOND_B: StreetNode = { id: 20, lat: 48.004, lon: 9.0 };

/** 7 m east of the middle of the segment. */
const MIDDLE = { lat: 48.0015, lon: 9.0001 };

const tail = (path: StreetNode[], cost: number): RouteTail => ({ path, cost });

describe('SegmentRoutes', () => {
  it('starts a route from the middle of a long segment at the foot of the point, not on a node', () => {
    const routes = new SegmentRoutes(A, B, 1, (node) => tail([node, BEYOND_B], 100));
    const start = routes.startAt(MIDDLE.lat, MIDDLE.lon);
    expect(start.id).toBe(ROUTE_START_NODE_ID);
    expect(start.lon).toBe(9.0);
    expect(start.lat).toBeCloseTo(48.0015, 9);
    expect(haversineDistance(start.lat, start.lon, MIDDLE.lat, MIDDLE.lon)).toBeLessThan(7.5);
  });

  it('starts on the node itself where the foot lies within a metre of it', () => {
    const routes = new SegmentRoutes(A, B, 1, () => null);
    // 0.5 m short of B
    expect(routes.startAt(48.003 - 0.0000045, 9.0001)).toBe(B);
    expect(routes.startAt(48.0000045, 8.9999)).toBe(A);
    // 2 m short of B: between the nodes
    expect(routes.startAt(48.003 - 0.000018, 9.0).id).toBe(ROUTE_START_NODE_ID);
  });

  it('goes on through the end whose route costs less, with the piece of the segment up to it', () => {
    const fromA = tail([A, BEFORE_A], 100);
    const fromB = tail([B, BEYOND_B], 100);
    const routes = new SegmentRoutes(A, B, 1, (node) => (node === A ? fromA : fromB));

    // A third of the way from A: A is 111 m off, B 222 m
    const nearA = routes.routeFrom(48.001, 9.0);
    expect(nearA.map((n) => n.id)).toEqual([ROUTE_START_NODE_ID, 1, 10]);
    const nearB = routes.routeFrom(48.002, 9.0);
    expect(nearB.map((n) => n.id)).toEqual([ROUTE_START_NODE_ID, 2, 20]);
  });

  it('weighs the piece of the segment as A* weighs the street', () => {
    // 56 m short of B: via A 278 m + 0, via B 56 m + 100. At weight 0.1 via A costs 28 against 106.
    const routeOn = (node: StreetNode) => (node === A ? tail([A, BEFORE_A], 0) : tail([B, BEYOND_B], 100));
    expect(new SegmentRoutes(A, B, 1, routeOn).routeFrom(48.0025, 9.0)[1]).toBe(B);
    expect(new SegmentRoutes(A, B, 0.1, routeOn).routeFrom(48.0025, 9.0)[1]).toBe(A);
  });

  it('goes straight on to the other end where the route from one end runs back over the segment', () => {
    // A* from A leads over B; from B it found nothing cheaper
    const routes = new SegmentRoutes(A, B, 1, (node) => (node === A ? tail([A, B, BEYOND_B], 450) : null));
    const path = routes.routeFrom(48.001, 9.0);
    expect(path.map((n) => n.id)).toEqual([ROUTE_START_NODE_ID, 2, 20]);
  });

  it('takes a route from a node it snapped to without asking A* from the other end', () => {
    const routeOn = vi.fn((node: StreetNode) => tail([node, BEYOND_B], 100));
    const routes = new SegmentRoutes(A, B, 1, routeOn);
    expect(routes.routeFrom(48.003, 9.0).map((n) => n.id)).toEqual([2, 20]);
    expect(routeOn).toHaveBeenCalledTimes(1);
    expect(routeOn).toHaveBeenCalledWith(B);
  });

  it('runs A* from each end at most once, however many starts it is asked about', () => {
    const routeOn = vi.fn((node: StreetNode) => tail([node], 0));
    const routes = new SegmentRoutes(A, B, 1, routeOn);
    for (let lat = 48.0005; lat < 48.003; lat += 0.0005) routes.routeFrom(lat, 9.0001);
    expect(routeOn).toHaveBeenCalledTimes(2);
  });

  it('gives no route where neither end has one', () => {
    const routes = new SegmentRoutes(A, B, 1, () => null);
    expect(routes.routeFrom(MIDDLE.lat, MIDDLE.lon)).toEqual([]);
  });

  it('hands out a copy, so a caller cannot change the route it keeps', () => {
    const fromB = tail([B, BEYOND_B], 0);
    const routes = new SegmentRoutes(A, B, 1, () => fromB);
    routes.routeFrom(48.003, 9.0).push(A);
    expect(fromB.path).toHaveLength(2);
  });
});
