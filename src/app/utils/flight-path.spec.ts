import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { buildFlightPath } from './flight-path';

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

describe('buildFlightPath', () => {
  it('Höhensprünge ändern weder Länge noch Starttangente', () => {
    const flat = buildFlightPath([v(0, 0, 0), v(20, 0, 0), v(20, 0, 80), v(60, 0, 120)]);
    // Grobe Tiles bei kaltem Cache: Routenhöhen springen um Hunderte Meter.
    const cold = buildFlightPath([v(0, 12, 0), v(20, -300, 0), v(20, 180, 80), v(60, -40, 120)]);

    expect(cold.length).toBeCloseTo(flat.length, 6);

    const tangent = cold.curve.getTangentAt(0);
    expect(tangent.y).toBe(0);
    expect(tangent.x).toBeGreaterThan(0.9);
  });

  it('alle Kurvenpunkte liegen bei y = 0', () => {
    const path = buildFlightPath([v(0, 50, 0), v(30, -20, 10), v(60, 400, -5)]);
    for (let t = 0; t <= 1; t += 0.1) {
      expect(path.curve.getPointAt(t).y).toBe(0);
    }
  });

  it('routeYAt: linear zwischen den Punkten, außerhalb die Endhöhe', () => {
    const path = buildFlightPath([v(0, 10, 0), v(40, 30, 0), v(100, -10, 0)]);

    expect(path.length).toBeCloseTo(100, 3);
    expect(path.routeYAt(0)).toBe(10);
    expect(path.routeYAt(20)).toBeCloseTo(20, 3);
    expect(path.routeYAt(40)).toBeCloseTo(30, 3);
    expect(path.routeYAt(70)).toBeCloseTo(10, 3);
    expect(path.routeYAt(path.length)).toBe(-10);
    expect(path.routeYAt(-60)).toBe(10);
    expect(path.routeYAt(path.length + 60)).toBe(-10);
  });
});
