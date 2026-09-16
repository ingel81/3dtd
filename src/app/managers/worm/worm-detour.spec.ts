/**
 * The worm past a van on the street's centre line, through the real
 * EnemyManager with rendering mocked: the enemies' line runs in the middle
 * of the walkable band (corridor-band.ts), which leaves the street's line as
 * gently as the worm bends, so its rigid rings stay joined (see
 * worm-corner.spec.ts for the measure).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('three', async () => {
  const mod = await import('@/test/mocks/three.mock');
  return { ...mod };
});

import { createTestManagers, TestManagers } from '../../integration/test-helpers';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT } from '../../utils/geo-utils';
import { BandRoute, bandPath, buildBand } from '../../utils/corridor-band';
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
 * 300 m north with a van parked on the centre line at 150 to 154.5 m, 2.2 m
 * wide, and room either side; the enemies' line in the band beside it, as
 * PathAndRouteService lays it. In the game's local frame x is east and z
 * south.
 */
function bandedPath(): RouteWaypoint[] {
  const street = [geo(0, 0), geo(0, 300)];
  const points = street.map((p) => ({ x: local(p).e, z: -local(p).n }));
  const onCar = (x: number, z: number) => -z >= 150 && -z <= 154.5 && Math.abs(x) <= 1.1;
  const columns = (x: number, z: number) => {
    const y = onCar(x, z) ? 1.5 : 0;
    return { ground: y, top: y };
  };
  const stations = 150;
  const route: BandRoute = {
    points,
    open: [true],
    covered: [false],
    streetHalfWidth: [3.5],
    wallLeft: [new Array<number>(stations).fill(7)],
    wallRight: [new Array<number>(stations).fill(7)],
  };
  const band = buildBand(route, columns, 2);
  return bandPath(route, band).map((node) => ({
    lat: LAT0 - node.z / METERS_PER_DEGREE_LAT,
    lon: LON0 + node.x / M_PER_DEG_LON,
    height: 300,
    corridorLeft: node.left,
    corridorRight: node.right,
  }));
}

/** Tightest bend of a path, 1 per metre: the second difference of its offset east over its northing. */
function maxCurvature(path: readonly RouteWaypoint[]): number {
  const e = path.map((p) => local(p).e);
  const n = path.map((p) => local(p).n);
  let worst = 0;
  for (let k = 1; k + 1 < path.length; k++) {
    const h1 = n[k] - n[k - 1];
    const h2 = n[k + 1] - n[k];
    if (Math.abs(h1) < 1e-6 || Math.abs(h2) < 1e-6) continue;
    worst = Math.max(worst, Math.abs(((e[k + 1] - e[k]) / h2 - (e[k] - e[k - 1]) / h1) / ((h1 + h2) / 2)));
  }
  return worst;
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

describe('Worm past a car on the centre line', () => {
  let m: TestManagers;

  beforeEach(() => {
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    m = createTestManagers();
  });

  afterEach(() => {
    m.enemyManager.clear();
    vi.restoreAllMocks();
  });

  it('keeps its rings joined where the band takes the line off the street line', () => {
    const path = bandedPath();
    // The line does leave the street's line: the band beside the van is 1 to 7 m out.
    const offset = Math.max(...path.map((p) => Math.abs(local(p).e)));
    expect(offset).toBeGreaterThan(2);
    expect(offset).toBeLessThan(7);
    // And it bends no more than the worm does: 1/20 m (WORM_BEND_RADIUS_M).
    expect(maxCurvature(path)).toBeLessThan(1 / 20);

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
        if (at.n > 150 && at.n < 154.5 && Math.abs(at.e) > 1) passedBeside = true;
      }
    }

    expect(passedBeside).toBe(true);
    // The rings sit across the corridor (wormSway), so they follow its
    // width, and beside the van the corridor narrows: from 7 to 1.5 m in
    // the band, as it did from 7 to 2.5 m in the fitting before it. Both
    // turn neighbouring rings against each other, 16.6 degrees with the
    // band's widths and 14.6 with the fitting's, and open their ends by
    // 0.64 m; with the widths pinned all along, as this spec had them
    // before, it is 0.5 m and under 10 degrees. worm-corner.spec.ts allows
    // 20 degrees between neighbours in a corner.
    expect(gap).toBeLessThan(0.7);
    expect(yaw).toBeLessThan(20 * DEG_TO_RAD);
    // A ring turns with the curve it walks; where the room beside the line
    // changes it turns a little faster, as the sway carries it across the
    // corridor. Measured over this route: 0.025 rad a step (16.7 ms) with
    // the band's widths, which move with the line, under 0.02 both with the
    // widths pinned all along and with the one-sided step from 7 to 2.5 m
    // the fitting gave at a car.
    expect(turn).toBeLessThan(0.03);
  });
});
