/**
 * The worm round a car on the street's centre line, through the real
 * EnemyManager with rendering mocked: the route bends round the car
 * (corridor-detour.ts) on ramps as gentle as the worm's own bend, so its
 * rigid rings stay joined as on a straight street (see worm-corner.spec.ts
 * for the measure).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('three', async () => {
  const mod = await import('@/test/mocks/three.mock');
  return { ...mod };
});

import { createTestManagers, TestManagers } from '../../integration/test-helpers';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT } from '../../utils/geo-utils';
import { applyDetourPlan, planDetours } from '../../utils/corridor-detour';
import type { ColumnSample } from '../../three-engine/column-sample';
import type { RouteWaypoint } from '../../models/game.types';
import type { Enemy } from '../../entities/enemy.entity';
import type { WormGroup } from './worm-group';

const STEP_MS = 16.667;

// The ring as in worm-corner.spec.ts: its ends round the pivot and half its width.
const FRONT = 0.52 * 2.5;
const REAR = 0.58 * 2.5;
const HALF_WIDTH = 2.7;

const LAT0 = 48.776;
const LON0 = 9.183;
const M_PER_DEG_LON = METERS_PER_DEGREE_LAT * Math.cos(LAT0 * DEG_TO_RAD);
const geo = (east: number, north: number): RouteWaypoint => ({
  lat: LAT0 + north / METERS_PER_DEGREE_LAT,
  lon: LON0 + east / M_PER_DEG_LON,
  height: 300,
});
const local = (p: { lat: number; lon: number }): { e: number; n: number } => ({
  e: (p.lon - LON0) * M_PER_DEG_LON,
  n: (p.lat - LAT0) * METERS_PER_DEGREE_LAT,
});

/**
 * 300 m north with a car parked on the centre line at 150 to 154.5 m, 1.8 m
 * wide, and room either side; the route bent round it as PathAndRouteService
 * bends it. In the game's local frame x is east and z south.
 */
function detouredPath(): RouteWaypoint[] {
  const street = [geo(0, 0), geo(0, 300)];
  const points = street.map((p) => ({ x: local(p).e, z: -local(p).n }));
  const onCar = (x: number, z: number) => -z >= 150 && -z <= 154.5 && Math.abs(x) < 0.9;
  const column = (x: number, z: number): ColumnSample => {
    const y = onCar(x, z) ? 1.5 : 0;
    return { groundY: y, topY: y, tileDepth: 20, tileGeometricError: 2 };
  };
  const plan = planDetours({ points, open: [true], room: () => 7 }, column, 2);
  const interpolate = (a: RouteWaypoint, b: RouteWaypoint, f: number): RouteWaypoint =>
    ({ lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f, height: 300 });
  const shift = (p: RouteWaypoint, dx: number, dz: number): RouteWaypoint =>
    ({ lat: p.lat - dz / METERS_PER_DEGREE_LAT, lon: p.lon + dx / M_PER_DEG_LON, height: 300 });
  // The corridor as the walk caps leave it round the car: no room for the
  // worm's arcs on the car's side (lateral limit 0), 2.5 m on the other.
  return applyDetourPlan(street, points, plan, interpolate, shift).points
    .map((p) => ({ ...p, corridorLeft: 1.5, corridorRight: 4 }));
}

/** The largest gap between the ends of two neighbouring rings, and their largest yaw (rad), over the chains out on the route. */
function worstJoint(group: WormGroup): { gap: number; yaw: number } {
  let gap = -Infinity;
  let yaw = 0;
  for (const c of group.chains) {
    for (let slot = c.first; slot < c.last; slot++) {
      const ahead = group.segments[slot];
      const behind = group.segments[slot + 1];
      if (!ahead || !behind) continue;
      const pa = local(ahead.position);
      const pb = local(behind.position);
      const ha = ahead.transform.rotation;
      const hb = behind.transform.rotation;
      const fa = { e: -Math.sin(ha), n: Math.cos(ha) };
      const fb = { e: -Math.sin(hb), n: Math.cos(hb) };
      const ra = { e: Math.cos(ha), n: Math.sin(ha) };
      const rb = { e: Math.cos(hb), n: Math.sin(hb) };
      const me = fa.e + fb.e;
      const mn = fa.n + fb.n;
      const ml = Math.hypot(me, mn);
      for (const s of [-1, 1]) {
        const fe = pb.e + FRONT * fb.e + s * HALF_WIDTH * rb.e;
        const fn = pb.n + FRONT * fb.n + s * HALF_WIDTH * rb.n;
        const re = pa.e - REAR * fa.e + s * HALF_WIDTH * ra.e;
        const rn = pa.n - REAR * fa.n + s * HALF_WIDTH * ra.n;
        gap = Math.max(gap, ((re - fe) * me + (rn - fn) * mn) / ml);
      }
      let d = ha - hb;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      yaw = Math.max(yaw, Math.abs(d));
    }
  }
  return { gap, yaw };
}

describe('Worm round a car on the centre line', () => {
  let m: TestManagers;

  beforeEach(() => {
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    m = createTestManagers();
  });

  afterEach(() => {
    m.enemyManager.clear();
    vi.restoreAllMocks();
  });

  it('keeps its rings joined through the detour', () => {
    const path = detouredPath();
    // The route does bend: 2.5 m east beside the car.
    expect(Math.max(...path.map((p) => local(p).e))).toBeCloseTo(2.5, 6);

    const group = m.enemyManager.spawn(path, 'worm').worm!.group;
    let gap = -Infinity;
    let yaw = 0;
    let turn = 0;
    let passedBeside = false;
    const last = new Map<Enemy, number>();
    for (let t = 0, now = 0; t < 70_000; t += STEP_MS) {
      now += STEP_MS;
      m.enemyManager.update(STEP_MS, now);
      const worst = worstJoint(group);
      gap = Math.max(gap, worst.gap);
      yaw = Math.max(yaw, worst.yaw);
      for (const e of group.segments) {
        if (!e) continue;
        const before = last.get(e);
        if (before !== undefined) {
          let d = e.transform.rotation - before;
          while (d > Math.PI) d -= 2 * Math.PI;
          while (d < -Math.PI) d += 2 * Math.PI;
          turn = Math.max(turn, Math.abs(d));
        }
        last.set(e, e.transform.rotation);
        const at = local(e.position);
        if (at.n > 150 && at.n < 154.5 && at.e > 1) passedBeside = true;
      }
    }

    expect(passedBeside).toBe(true);
    // On a straight street the ends overlap by 0.25 m; worm-corner.spec.ts allows 0.5 m in a corner.
    expect(gap).toBeLessThan(0.5);
    expect(yaw).toBeLessThan(10 * DEG_TO_RAD);
    // A ring turns with the curve it walks, no swing.
    expect(turn).toBeLessThan(0.02);
  });
});
