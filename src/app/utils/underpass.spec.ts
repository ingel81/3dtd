import { describe, it, expect } from 'vitest';
import type { Street, StreetNode } from '../interfaces/street-network-provider.interface';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT } from './geo-utils';
import { UnderpassIndex, pointAlong, splitAtSpans, streetUnderpasses, wayLevel } from './underpass';

const LAT0 = 48;
const KX = METERS_PER_DEGREE_LAT * Math.cos(LAT0 * DEG_TO_RAD);
/** A node `x` metres east and `z` north of (48, 9). */
const node = (id: number, x: number, z: number): StreetNode => ({ id, lat: LAT0 + z / METERS_PER_DEGREE_LAT, lon: 9 + x / KX });
const way = (id: number, nodes: StreetNode[], tags: Partial<Street> = {}): Street =>
  ({ id, name: `Way ${id}`, type: 'residential', nodes, ...tags });
/** A motorway carriageway of 3 lanes on a bridge: 10 m by its lanes tag, reaching 9 m either side of its line. */
const motorwayBridge = (id: number, nodes: StreetNode[], tags: Partial<Street> = {}): Street =>
  way(id, nodes, { type: 'motorway', lanes: 3, bridge: 'yes', layer: 1, ...tags });
const lerp = (a: StreetNode, b: StreetNode, f: number): StreetNode =>
  ({ id: -1, lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f });
/** Metres east and north of (48, 9). */
const metres = (p: { lat: number; lon: number }) => ({ x: (p.lon - 9) * KX, z: (p.lat - LAT0) * METERS_PER_DEGREE_LAT });

describe('UnderpassIndex.spans', () => {
  /** North along x = 0 from 50 m south to 50 m north. */
  const south = node(1, 0, -50);
  const north = node(2, 0, 50);
  const street = way(100, [south, north]);

  it('reaches as far either side of a bridge across the route as the bridge reaches, over the sine of the angle', () => {
    const across = motorwayBridge(900, [node(901, -20, 0), node(902, 20, 0)]);
    const [span] = new UnderpassIndex([street, across]).spans([south, north], [street], [true]);
    expect(span.wayId).toBe(900);
    expect(span.from).toBeCloseTo(41, 1);
    expect(span.to).toBeCloseTo(59, 1);

    const diagonal = motorwayBridge(900, [node(901, -20, -20), node(902, 20, 20)]);
    const [skew] = new UnderpassIndex([street, diagonal]).spans([south, north], [street], [true]);
    expect(skew.from).toBeCloseTo(50 - 9 * Math.SQRT2, 1);
    expect(skew.to).toBeCloseTo(50 + 9 * Math.SQRT2, 1);
  });

  /**
   * Playtest 2026-09-15, Erlenbach (D2), OSM data of the day: Weinsberger
   * Straße (way 230161781) under the two carriageways of the A6.
   */
  it('joins the stretches under the two carriageways of a motorway (Erlenbach)', () => {
    const weinsberger = way(230161781, [
      { id: 1, lat: 49.16651, lon: 9.265124 },
      { id: 2, lat: 49.166353, lon: 9.26503 },
      { id: 3, lat: 49.165991, lon: 9.264769 },
    ], { type: 'secondary', lanes: 2 });
    const a6 = [
      motorwayBridge(15258911, [{ id: 11, lat: 49.166168, lon: 9.265211 }, { id: 12, lat: 49.166289, lon: 9.264708 }]),
      motorwayBridge(15258913, [{ id: 13, lat: 49.166154, lon: 9.264632 }, { id: 14, lat: 49.166033, lon: 9.265135 }]),
    ];
    const path = weinsberger.nodes;
    const spans = new UnderpassIndex([weinsberger, ...a6]).spans(path, [weinsberger, weinsberger], [true, true]);
    // Crossings 33.6 and 49.7 m along, 85 degrees: 9.0 m either side.
    expect(spans).toHaveLength(1);
    expect(spans[0].wayId).toBe(15258911);
    expect(spans[0].from).toBeCloseTo(24.57, 1);
    expect(spans[0].to).toBeCloseTo(58.72, 1);

    // The second segment (18.8 to 63.3 m) cut at both ends of the stretch.
    const split = splitAtSpans(path, spans, [true, true], lerp);
    expect(split.points).toHaveLength(5);
    expect(split.segment).toEqual([0, 1, 1, 1]);
    expect(split.under).toEqual([null, null, 15258911, null]);
  });

  it('passes under a way on a higher level only, not under its own way, where they meet, or where it cannot', () => {
    const across = (tags: Partial<Street>) => way(900, [node(901, -20, 0), node(902, 20, 0)], tags);
    const spansUnder = (raised: Street, own: Street = street, open = true) =>
      new UnderpassIndex([own, raised]).spans([south, north], [own], [open]);

    expect(spansUnder(across({ bridge: 'yes' }))).toHaveLength(1);
    expect(spansUnder(across({ layer: 1 }))).toHaveLength(1);
    // On the same level: a road over a bridge without its tag, or a crossing mapped without a node.
    expect(spansUnder(across({ bridge: 'yes' }), way(100, [south, north], { layer: 1 }))).toEqual([]);
    expect(spansUnder(across({}))).toEqual([]);
    // A road sunk to layer -1 without a tunnel tag passes under a plain road.
    expect(spansUnder(across({}), way(100, [south, north], { layer: -1 }))).toHaveLength(1);
    // Its own way, and a segment on a bridge or in a tunnel (not open).
    expect(new UnderpassIndex([across({ bridge: 'yes' })]).spans([south, north], [across({ bridge: 'yes' })], [true])).toEqual([]);
    expect(spansUnder(across({ bridge: 'yes' }), street, false)).toEqual([]);
    // Beside the route, not across it.
    expect(spansUnder(way(900, [node(901, 5, 0), node(902, 40, 0)], { bridge: 'yes' }))).toEqual([]);
  });

  it('does not pass under a bridge that starts at a node of the route', () => {
    const middle = node(3, 0, 0);
    const own = way(100, [south, middle, north]);
    const bridge = way(900, [middle, node(902, 40, 0)], { bridge: 'yes' });
    expect(new UnderpassIndex([own, bridge]).spans([south, middle, north], [own, own], [true, true])).toEqual([]);
  });

  it('tells the level of a way by its tags', () => {
    expect(wayLevel({})).toBe(0);
    expect(wayLevel({ bridge: 'yes' })).toBe(1);
    expect(wayLevel({ bridge: 'yes', layer: 2 })).toBe(2);
    expect(wayLevel({ layer: -1 })).toBe(-1);
  });
});

describe('splitAtSpans', () => {
  /** 100 m north, then 50 m east. */
  const path = [node(1, 0, -50), node(2, 0, 50), node(3, 50, 50)];

  it('cuts the path where a stretch begins and ends, and marks the piece between', () => {
    const split = splitAtSpans(path, [{ from: 41, to: 59, wayId: 900 }], [true, true], lerp);
    expect(split.points.map((p) => metres(p).z)).toEqual([-50, -9, 9, 50, 50].map((z) => expect.closeTo(z, 3)));
    expect(split.segment).toEqual([0, 0, 0, 1]);
    expect(split.under).toEqual([null, 900, null, null]);
  });

  it('leaves out a cut within a metre of a point, and pieces of a segment that cannot pass under anything', () => {
    // 99.4 m lies 0.6 m before the corner at 100 m.
    const snapped = splitAtSpans(path, [{ from: 99.4, to: 120, wayId: 900 }], [true, true], lerp);
    expect(snapped.points).toHaveLength(4);
    expect(snapped.under).toEqual([null, 900, null]);
    expect(metres(snapped.points[2]).x).toBeCloseTo(20, 3);

    const bridge = splitAtSpans(path, [{ from: 99.4, to: 120, wayId: 900 }], [true, false], lerp);
    expect(bridge.under).toEqual([null, null, null]);
  });

  it('leaves the path as it is without a stretch', () => {
    expect(splitAtSpans(path, [], [true, true], lerp)).toEqual({ points: path, segment: [0, 1], under: [null, null] });
  });
});

describe('pointAlong', () => {
  it('goes on past either end of the path along its first or last edge', () => {
    const path = [node(1, 0, 0), node(2, 0, 10), node(3, 10, 10)];
    expect(metres(pointAlong(path, -2)).z).toBeCloseTo(-2, 3);
    expect(metres(pointAlong(path, 15)).x).toBeCloseTo(5, 3);
    expect(metres(pointAlong(path, 22)).x).toBeCloseTo(12, 3);
  });
});

describe('streetUnderpasses', () => {
  it('gives a node under a bridge the portals of its stretch and how far it lies between them', () => {
    // A street north along x = 0 with a node 5 m south of a motorway bridge across it.
    const street = way(100, [node(1, 0, -50), node(2, 0, -5), node(3, 0, 50)]);
    const bridge = motorwayBridge(900, [node(901, -20, 0), node(902, 20, 0)]);
    const tunnel = way(300, [node(301, -20, 2), node(302, 20, 2)], { tunnel: 'yes' });
    const found = streetUnderpasses([street, bridge, tunnel]);

    expect([...found.keys()]).toEqual([100]);
    const [first, under, last] = found.get(100)!;
    expect(first).toBeNull();
    expect(last).toBeNull();
    // The stretch from 41 to 59 m along, the portals 2 m outside it.
    expect(under!.wayId).toBe(900);
    expect(metres(under!.portals[0]).z).toBeCloseTo(-11, 1);
    expect(metres(under!.portals[1]).z).toBeCloseTo(11, 1);
    expect(under!.f).toBeCloseTo(6 / 22, 2);
  });
});
