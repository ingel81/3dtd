import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { smoothPathHeights } from './route-height-smoothing';

/** Points one metre apart along x, heights from `height(i)`. */
const line = (count: number, height: (i: number) => number) =>
  Array.from({ length: count }, (_, i) => new Vector3(i, height(i), 0));

describe('smoothPathHeights', () => {
  it('copies short paths without touching them', () => {
    const points = line(2, (i) => i * 10);
    const result = smoothPathHeights(points);
    expect(result.map((p) => p.y)).toEqual([0, 10]);
    expect(result[0]).not.toBe(points[0]);
  });

  it('drops a tree crown the raycast hit back to the street', () => {
    const points = line(21, (i) => (i === 10 ? 10 : 0));
    const result = smoothPathHeights(points, 'residential');
    expect(Math.max(...result.map((p) => p.y))).toBeCloseTo(0, 9);
    // The input stays as it was.
    expect(points[10].y).toBe(10);
  });

  it('caps a step below the obstacle threshold at the grade of the road type', () => {
    // A 4 m step: too low for the obstacle pass, so only the slope limit acts.
    const step = (i: number) => (i < 10 ? 0 : 4);
    // Motorway, 8 %: the end point climbs 0.08 m per metre for 21 m.
    expect(smoothPathHeights(line(31, step), 'motorway').at(-1)!.y).toBeCloseTo(0.08 * 21, 9);
    // Footway, 35 %: steep enough to reach the full 4 m.
    expect(smoothPathHeights(line(31, step), 'footway').at(-1)!.y).toBeCloseTo(4, 9);
  });
});
