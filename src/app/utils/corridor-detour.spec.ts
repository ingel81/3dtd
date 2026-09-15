import { afterEach, describe, expect, it } from 'vitest';
import type { ColumnSample } from '../three-engine/column-sample';
import { resetCorridorConfig } from './route-corridor';
import type { StationProbe } from './route-corridor';
import {
  DetourLine,
  DetourPlan,
  applyDetourPlan,
  derivedClearance,
  offsetAt,
  planDetours,
  rampLength,
  wholeSegment,
} from './corridor-detour';

const CELL = 2;

/** Ground height at local (x, z); a car, a hedge or a jetty has no ground under it in the photogrammetry. */
type Ground = (x: number, z: number) => number;

const columns = (ground: Ground, tileGeometricError = 2) =>
  (x: number, z: number): ColumnSample => ({ groundY: ground(x, z), topY: ground(x, z), tileDepth: 20, tileGeometricError });

/**
 * A street eastbound along z = 0 from x = 0 to 120, so right of travel is
 * +z; the rays allow `left` and `right` of it.
 */
function street(left = 7, right = left, open = [true]): DetourLine {
  return { points: [{ x: 0, z: 0 }, { x: 120, z: 0 }], open, room: (_i, _t, side) => (side === 'left' ? left : right) };
}

/** A parked car 4.5 m long from x = `x`, between `z0` and `z1` across the street, 1.5 m high. */
const car = (x: number, z0: number, z1: number) => (px: number, pz: number) => px >= x && px <= x + 4.5 && pz > z0 && pz < z1;

describe('planDetours', () => {
  afterEach(() => resetCorridorConfig());

  it('bends round a car on the centre line where the street leaves room beside it', () => {
    const onCar = car(55, -0.9, 0.9);
    const plan = planDetours(street(), columns((x, z) => (onCar(x, z) ? 1.5 : 0)), CELL);

    expect(plan.passages).toEqual([]);
    const [rampIn, hold, rampOut] = plan.pieces;
    expect(plan.pieces).toHaveLength(3);
    // Car points 55 to 59 m, held 2 m either side. 2 m aside, the columns
    // within 1.5 m of the path reach onto the car; 2.5 m keeps them off it.
    // Both sides as good: the right.
    expect(hold).toEqual({ from: 53, to: 61, offsetFrom: 2.5, offsetTo: 2.5 });
    // A half cosine as gentle as the worm's bend: 5 pi m for 2.5 m.
    expect(rampIn.to).toBe(53);
    expect(rampIn.to - rampIn.from).toBeCloseTo(5 * Math.PI, 9);
    expect(rampIn).toMatchObject({ offsetFrom: 0, offsetTo: 2.5 });
    expect(rampOut.from).toBe(61);
    expect(rampOut.to - rampOut.from).toBeCloseTo(rampLength(2.5), 9);
    expect(rampOut).toMatchObject({ offsetFrom: 2.5, offsetTo: 0 });
    expect(offsetAt(plan, 20)).toBe(0);
    expect(offsetAt(plan, 57)).toBe(2.5);
    expect(offsetAt(plan, 53 - 5 * Math.PI / 2)).toBeCloseTo(1.25, 9);
  });

  it('bends only as far as needed, to the side with more room beside the car', () => {
    // The line 0.3 m inside the car's left edge: 2 m left of it is enough, the right needs 3.5 m.
    const onCar = car(55, -0.3, 1.6);
    const plan = planDetours(street(), columns((x, z) => (onCar(x, z) ? 1.5 : 0)), CELL);
    expect(plan.pieces[1]).toMatchObject({ offsetFrom: -2, offsetTo: -2 });

    // A garden 1.2 m up from 1.5 m left of the line: no room there.
    const walled = planDetours(street(), columns((x, z) => (onCar(x, z) ? 1.5 : z < -1.5 ? 1.2 : 0)), CELL);
    expect(walled.pieces[1]).toMatchObject({ offsetFrom: 3.5, offsetTo: 3.5 });
  });

  it('lets enemies climb over a car that fills a narrow lane', () => {
    // Houses 2 m either side of the line; the rays allow 1.5 m.
    const onCar = car(55, -0.9, 0.9);
    const plan = planDetours(street(1.5), columns((x, z) => (Math.abs(z) >= 2 ? 8 : onCar(x, z) ? 1.5 : 0)), CELL);
    expect(plan).toEqual({ pieces: [], passages: [] });
  });

  it('runs a passage under a jetty the mesh fills down to a narrow lane', () => {
    const plan = planDetours(street(1.5), columns((x, z) => (Math.abs(z) >= 2 ? 8 : x >= 55.5 && x <= 58.5 ? 5 : 0)), CELL);
    expect(plan.pieces).toEqual([]);
    // Jetty points 56 to 58 m, a metre either side.
    expect(plan.passages).toEqual([{ from: 55, to: 59 }]);
  });

  it('bends round a roof corner over the line where the street leaves room', () => {
    // Houses from 3 m left of the line, a corner of one reaching 0.8 m past it, 8 m up.
    const plan = planDetours(street(2.5, 7), columns((x, z) => (z <= -3 || (x >= 55.5 && x <= 58.5 && z < 0.8) ? 8 : 0)), CELL);
    expect(plan.passages).toEqual([]);
    expect(plan.pieces[1]).toEqual({ from: 54, to: 60, offsetFrom: 2.5, offsetTo: 2.5 });
  });

  it('bends round a hedge on the line', () => {
    const plan = planDetours(street(), columns((x, z) => (x > 30 && x < 50 && Math.abs(z) < 0.4 ? 1.2 : 0)), CELL);
    expect(plan.pieces[1]).toEqual({ from: 29, to: 51, offsetFrom: 2, offsetTo: 2 });
  });

  const plain: Record<string, Ground> = {
    'a steep street': (x) => x * 0.3,
    'a street across a slope': (_x, z) => z * 0.15,
    'a kerb': (_x, z) => (Math.abs(z) > 3 ? 0.15 : 0),
    'a quay wall': (_x, z) => (z > 3 ? -4 : 0),
    'a street on a dam': (_x, z) => -Math.max(0, Math.abs(z) - 1.5),
    'photogrammetry noise': (x, z) => ((Math.floor(x) + Math.floor(z * 2)) % 2 === 0 ? 0.1 : -0.1),
    'a car at the edge': (x, z) => (car(55, 2.5, 4.3)(x, z) ? 1.5 : 0),
  };
  for (const [name, ground] of Object.entries(plain)) {
    it(`finds nothing on ${name}`, () => {
      expect(planDetours(street(), columns(ground), CELL)).toEqual({ pieces: [], passages: [] });
    });
  }

  it('looks for nothing on a segment that is no street on the ground, nor on coarse tiles', () => {
    const onCar = car(55, -0.9, 0.9);
    const ground: Ground = (x, z) => (onCar(x, z) ? 1.5 : 0);
    expect(planDetours(street(7, 7, [false]), columns(ground), CELL)).toEqual({ pieces: [], passages: [] });
    expect(planDetours(street(), columns(ground, 20), CELL)).toEqual({ pieces: [], passages: [] });
  });

  it('holds the offset along a row of parked cars with a gap', () => {
    const first = car(40, -0.9, 0.9);
    const second = car(48, -0.9, 0.9);
    const plan = planDetours(street(), columns((x, z) => (first(x, z) || second(x, z) ? 1.5 : 0)), CELL);
    expect(plan.pieces).toHaveLength(3);
    expect(plan.pieces[1]).toEqual({ from: 38, to: 54, offsetFrom: 2.5, offsetTo: 2.5 });
  });

  it('swings from one side to the other between two cars close together', () => {
    // The first car mostly left of the line, the second mostly right of it.
    const first = car(55, -1.6, 0.3);
    const second = car(80, -0.3, 1.6);
    const plan = planDetours(street(), columns((x, z) => (first(x, z) || second(x, z) ? 1.5 : 0)), CELL);
    expect(plan.pieces.map((p) => [p.offsetFrom, p.offsetTo])).toEqual([[0, 2], [2, 2], [2, -2], [-2, -2], [-2, 0]]);
    expect(plan.pieces[2]).toMatchObject({ from: 61, to: 78 });
  });

  it('bends no further than the ramp can go before the route ends', () => {
    // A car 6 m after the start: no room for a ramp.
    const onCar = car(6, -0.9, 0.9);
    expect(planDetours(street(), columns((x, z) => (onCar(x, z) ? 1.5 : 0)), CELL).pieces).toEqual([]);
  });
});

describe('applyDetourPlan', () => {
  interface P { lat: number; lon: number }
  /** A frame where lon is local x and lat local z. */
  const geo = (x: number, z: number): P => ({ lat: z, lon: x });
  const interpolate = (a: P, b: P, f: number): P => ({ lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f });
  const shift = (p: P, dx: number, dz: number): P => ({ lat: p.lat + dz, lon: p.lon + dx });
  const localOf = (path: P[]) => path.map((p) => ({ x: p.lon, z: p.lat }));

  it('keeps the path outside the plan and cuts it where the pieces begin and end and along the ramps', () => {
    const path = [geo(0, 0), geo(100, 0)];
    const plan: DetourPlan = {
      pieces: [
        { from: 30, to: 40, offsetFrom: 0, offsetTo: 2 },
        { from: 40, to: 60, offsetFrom: 2, offsetTo: 2 },
        { from: 60, to: 70, offsetFrom: 2, offsetTo: 0 },
      ],
      passages: [],
    };
    const { points, parent, passage } = applyDetourPlan(path, localOf(path), plan, interpolate, shift);

    expect(points[0]).toBe(path[0]);
    expect(points[points.length - 1]).toBe(path[1]);
    // 0, 30, 31 to 39, 40, 60, 61 to 69, 70, 100
    expect(points.map((p) => p.lon)).toEqual([0, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 100]);
    expect(points[1].lat).toBe(0);
    expect(points[6].lat).toBeCloseTo(1, 9);
    expect(points[11]).toEqual(geo(40, 2));
    expect(points[12]).toEqual(geo(60, 2));
    expect(parent[0]).toEqual({ segment: 0, from: 0, to: 0.3, offsetFrom: 0, offsetTo: 0 });
    expect(parent[11]).toEqual({ segment: 0, from: 0.4, to: 0.6, offsetFrom: 2, offsetTo: 2 });
    expect(passage.every((p) => !p)).toBe(true);
  });

  it('moves a point of the path inside a detour along the mitre of its segments', () => {
    const path = [geo(0, 0), geo(50, 0), geo(100, 50)];
    const plan: DetourPlan = { pieces: [{ from: 40, to: 60, offsetFrom: 2, offsetTo: 2 }], passages: [] };
    const { points, parent } = applyDetourPlan(path, localOf(path), plan, interpolate, shift);
    const joint = points.find((p) => Math.abs(p.lon - 50) < 2 && p.lat > 1)!;
    // 2 m from both segments: right of eastbound is +z, right of north-east is (-1, 1) / sqrt 2.
    expect(joint.lat).toBeCloseTo(2, 9);
    expect(joint.lon).toBeCloseTo(50 - 2 * (Math.SQRT2 - 1), 9);
    expect(parent.map((p) => p.segment)).toEqual([0, 0, 1, 1]);
  });

  it('cuts a passage out of the path on the line', () => {
    const path = [geo(0, 0), geo(100, 0)];
    const { points, parent, passage } = applyDetourPlan(path, localOf(path), { pieces: [], passages: [{ from: 45, to: 55 }] }, interpolate, shift);
    expect(points.map((p) => p.lat)).toEqual([0, 0, 0, 0]);
    [0, 45, 55, 100].forEach((x, k) => expect(points[k].lon).toBeCloseTo(x, 9));
    expect(passage).toEqual([false, true, false]);
    expect(parent[1]).toMatchObject({ segment: 0, offsetFrom: 0, offsetTo: 0 });
    expect(parent[1].from).toBeCloseTo(0.45, 9);
    expect(parent[1].to).toBeCloseTo(0.55, 9);
  });

  it('leaves a path without a plan as it is', () => {
    const path = [geo(0, 0), geo(50, 0), geo(100, 50)];
    const { points, parent } = applyDetourPlan(path, localOf(path), { pieces: [], passages: [] }, interpolate, shift);
    expect(points).toEqual(path);
    expect(parent).toEqual([wholeSegment(0), wholeSegment(1)]);
  });
});

describe('derivedClearance', () => {
  const probe = (left: number, right: number): StationProbe => ({ unmeasured: null, tileError: 2, left: [left, left], right: [right, right] });

  it('gives a piece of a segment the free space of its stations, moved by its offset', () => {
    const unmeasured: StationProbe = { unmeasured: 'coarse tile', tileError: 20, left: [], right: [] };
    const measured = { left: [3, 4, NaN, 5], right: [6, 6, 6, 6], probes: [probe(3, 6), probe(4, 6), unmeasured, probe(5, 6)] };
    // The second half of the segment, the path 1 m to the right.
    const derived = derivedClearance(measured, { segment: 0, from: 0.5, to: 1, offsetFrom: 1, offsetTo: 1 });
    expect(derived.left).toEqual([NaN, 6]);
    expect(derived.right).toEqual([5, 5]);
    expect(derived.probes[0]).toBe(unmeasured);
    expect(derived.probes[1]).toMatchObject({ left: [6, 6], right: [5, 5] });
  });

  it('keeps about as many stations as the segment has along the piece', () => {
    const measured = { left: new Array<number>(50).fill(7), right: new Array<number>(50).fill(7), probes: new Array(50).fill(null) };
    expect(derivedClearance(measured, { segment: 0, from: 0.1, to: 0.3, offsetFrom: 0, offsetTo: 2 }).left).toHaveLength(10);
    expect(derivedClearance(measured, { segment: 0, from: 0.1, to: 0.105, offsetFrom: 0, offsetTo: 2 }).left).toHaveLength(1);
  });
});
