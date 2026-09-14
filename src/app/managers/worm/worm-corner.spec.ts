/**
 * The worm through route corners, through the real EnemyManager with
 * rendering mocked: the rings stay joined on the outside of a bend, turn
 * gradually, stay inside the corridor, split there like anywhere else and
 * take the same shape whatever the step length.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('three', async () => {
  const mod = await import('@/test/mocks/three.mock');
  return { ...mod };
});

import { createTestManagers, TestManagers } from '../../integration/test-helpers';
import { ENEMY_TYPES } from '../../configs/enemy-types.config';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT } from '../../utils/geo-utils';
import { corridorConfig, lateralLimit } from '../../utils/route-corridor';
import type { GeoPosition, RouteWaypoint } from '../../models/game.types';
import type { Enemy } from '../../entities/enemy.entity';
import type { WormGroup } from './worm-group';

const chain = ENEMY_TYPES['worm'].chain!;
const SPEED = ENEMY_TYPES['worm'].baseSpeed;
const STEP_MS = 16.667;

// The ring of tools/blender/worm_boss.py at scale 2.5: it spans SEG_REAR
// -0.58 to SEG_FRONT 0.52 model units round its pivot, and is about
// (0.78 * 1.11 + 0.23) units wide either side with its flanges.
const FRONT = 0.52 * 2.5;
const REAR = 0.58 * 2.5;
const HALF_WIDTH = 2.7;

/** Bounds the corner has to keep, see the tests */
const MAX_GAP = 0.5;
const MAX_OVERLAP = 2;
const MAX_YAW_STEP = 20 * DEG_TO_RAD;

const LAT0 = 48.776;
const LON0 = 9.183;
const M_PER_DEG_LON = METERS_PER_DEGREE_LAT * Math.cos(LAT0 * DEG_TO_RAD);
const geo = (east: number, north: number): GeoPosition => ({
  lat: LAT0 + north / METERS_PER_DEGREE_LAT,
  lon: LON0 + east / M_PER_DEG_LON,
  height: 300,
});
const local = (p: GeoPosition): { e: number; n: number } => ({
  e: (p.lon - LON0) * M_PER_DEG_LON,
  n: (p.lat - LAT0) * METERS_PER_DEGREE_LAT,
});

/**
 * 150 m north, then a turn of `deg` to the right and 150 m on; a waypoint
 * every 50 m. The corridor `halfWidth` either side, the default without.
 */
function cornerPath(deg: number, halfWidth?: number): RouteWaypoint[] {
  const points: RouteWaypoint[] = [];
  for (let m = 0; m <= 150; m += 50) points.push(geo(0, m));
  const a = deg * DEG_TO_RAD;
  for (let m = 50; m <= 150; m += 50) points.push(geo(Math.sin(a) * m, 150 + Math.cos(a) * m));
  if (halfWidth !== undefined) {
    for (const p of points) {
      p.corridorLeft = halfWidth;
      p.corridorRight = halfWidth;
    }
  }
  return points;
}

/** Where two neighbouring rings meet: the gap between their ends on either side, and the yaw between them. */
interface Joint {
  /** Largest gap between the ends, on the outside of a bend (m); negative where they overlap */
  gap: number;
  /** Largest overlap of the ends, on the inside (m) */
  overlap: number;
  /** Yaw between the two (rad) */
  yaw: number;
}

function joint(ahead: Enemy, behind: Enemy): Joint {
  const pa = local(ahead.position);
  const pb = local(behind.position);
  const ha = ahead.transform.rotation;
  const hb = behind.transform.rotation;
  // Heading h faces (east, north) = (-sin h, cos h), see TransformComponent.lookAt; right of it is (cos h, sin h)
  const fa = { e: -Math.sin(ha), n: Math.cos(ha) };
  const fb = { e: -Math.sin(hb), n: Math.cos(hb) };
  const ra = { e: Math.cos(ha), n: Math.sin(ha) };
  const rb = { e: Math.cos(hb), n: Math.sin(hb) };
  const me = fa.e + fb.e;
  const mn = fa.n + fb.n;
  const ml = Math.hypot(me, mn);
  // Front corner of the ring behind to the rear corner of the ring ahead,
  // along the mean direction of the two
  const side = (s: number): number => {
    const fe = pb.e + FRONT * fb.e + s * HALF_WIDTH * rb.e;
    const fn = pb.n + FRONT * fb.n + s * HALF_WIDTH * rb.n;
    const re = pa.e - REAR * fa.e + s * HALF_WIDTH * ra.e;
    const rn = pa.n - REAR * fa.n + s * HALF_WIDTH * ra.n;
    return ((re - fe) * me + (rn - fn) * mn) / ml;
  };
  const left = side(-1);
  const right = side(1);
  let yaw = ha - hb;
  while (yaw > Math.PI) yaw -= 2 * Math.PI;
  while (yaw < -Math.PI) yaw += 2 * Math.PI;
  return { gap: Math.max(left, right), overlap: -Math.min(left, right), yaw: Math.abs(yaw) };
}

/** Neighbouring rings out on the route, per chain */
function joints(group: WormGroup): Joint[] {
  const result: Joint[] = [];
  for (const c of group.chains) {
    for (let slot = c.first; slot < c.last; slot++) {
      const ahead = group.segments[slot];
      const behind = group.segments[slot + 1];
      if (ahead && behind) result.push(joint(ahead, behind));
    }
  }
  return result;
}

/** Distance from `p` to the nearest point of the route's centre line (m) */
function offCentre(path: GeoPosition[], p: GeoPosition): number {
  const q = local(p);
  let best = Infinity;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = local(path[i]);
    const b = local(path[i + 1]);
    const de = b.e - a.e;
    const dn = b.n - a.n;
    const t = Math.max(0, Math.min(1, ((q.e - a.e) * de + (q.n - a.n) * dn) / (de * de + dn * dn)));
    best = Math.min(best, Math.hypot(q.e - a.e - t * de, q.n - a.n - t * dn));
  }
  return best;
}

interface Walk {
  gap: number;
  overlap: number;
  yawStep: number;
  /** Largest heading change of one ring in one sub-step (rad) */
  turnPerStep: number;
  /** Largest move of one ring in one sub-step (m) */
  movePerStep: number;
  offCentre: number;
}

/** Walk the worm `ms` of game time in sub-steps of `stepMs`, measuring after each. */
function walk(m: TestManagers, group: WormGroup, path: GeoPosition[], ms: number, clock: { now: number }, stepMs = STEP_MS): Walk {
  const worst: Walk = { gap: -Infinity, overlap: -Infinity, yawStep: 0, turnPerStep: 0, movePerStep: 0, offCentre: 0 };
  const last = new Map<Enemy, { heading: number; e: number; n: number }>();
  for (let t = 0; t < ms; t += stepMs) {
    clock.now += stepMs;
    m.enemyManager.update(stepMs, clock.now);
    for (const j of joints(group)) {
      worst.gap = Math.max(worst.gap, j.gap);
      worst.overlap = Math.max(worst.overlap, j.overlap);
      worst.yawStep = Math.max(worst.yawStep, j.yaw);
    }
    for (const e of group.segments) {
      if (!e) continue;
      const q = local(e.position);
      const before = last.get(e);
      if (before) {
        let turn = e.transform.rotation - before.heading;
        while (turn > Math.PI) turn -= 2 * Math.PI;
        while (turn < -Math.PI) turn += 2 * Math.PI;
        worst.turnPerStep = Math.max(worst.turnPerStep, Math.abs(turn));
        worst.movePerStep = Math.max(worst.movePerStep, Math.hypot(q.e - before.e, q.n - before.n));
      }
      last.set(e, { heading: e.transform.rotation, e: q.e, n: q.n });
      worst.offCentre = Math.max(worst.offCentre, offCentre(path, e.position));
    }
  }
  return worst;
}

const distance = (e: Enemy): number => e.movement.getDistanceAlongPath();

describe('Worm through route corners', () => {
  let m: TestManagers;

  beforeEach(() => {
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    m = createTestManagers();
  });

  afterEach(() => {
    m.enemyManager.clear();
    vi.restoreAllMocks();
  });

  /** Room either side of the centre line on the test routes (no corridor data: the default) */
  const room = (): number => lateralLimit(corridorConfig.defaultHalfWidth);

  // The old sharp corners measured here: 5.2 m gap at 90 degrees, 3.5 m at
  // 45; neighbours 93 and 60 degrees apart. 20 degrees is where the arc is
  // short against the ring spacing and the sway adds most.
  for (const deg of [90, 45, 20]) {
    it(`keeps the rings joined through a ${deg} degree corner`, () => {
      const path = cornerPath(deg);
      const group = m.enemyManager.spawn(path, 'worm').worm!.group;
      // Front from the portal to 270 m: the whole corner, most of the worm through it
      const worst = walk(m, group, path, 60_000, { now: 0 });

      // On a straight street the ends overlap by 0.25 m
      expect(worst.gap).toBeLessThan(MAX_GAP);
      expect(worst.overlap).toBeLessThan(MAX_OVERLAP);
      expect(worst.yawStep).toBeLessThan(MAX_YAW_STEP);
      // A ring turns with the curve it walks, no swing after a corner
      expect(worst.turnPerStep).toBeLessThan(0.02);
      expect(worst.movePerStep).toBeLessThan(2 * SPEED * STEP_MS / 1000);
      expect(worst.offCentre).toBeLessThanOrEqual(room() + 1e-6);
    });
  }

  it('rounds a corner of a narrow street only as far as its corridor lets it', () => {
    // A residential street without tile data: 5.5 m wide, 1.25 m of room either side
    const path = cornerPath(90, 2.75);
    const group = m.enemyManager.spawn(path, 'worm').worm!.group;
    const worst = walk(m, group, path, 60_000, { now: 0 });

    // The arc gets 4.3 m: its apex 1.25 m inside the corner
    expect(group.bend.radiusAt(3)).toBeCloseTo(lateralLimit(2.75) / (1 - Math.cos(Math.PI / 4)), 6);
    expect(worst.offCentre).toBeLessThanOrEqual(lateralLimit(2.75) + 1e-6);
    // Tighter than the wide street (0.8 m measured), still far from the sharp corner
    expect(worst.gap).toBeLessThan(1);
    expect(worst.turnPerStep).toBeLessThan(0.02);
  });

  it('splits in the corner like anywhere else', () => {
    const path = cornerPath(90);
    const group = m.enemyManager.spawn(path, 'worm').worm!.group;
    const clock = { now: 0 };
    // Front 20 m past the corner at 150 m: slot 8 at its apex
    walk(m, group, path, (170 / SPEED) * 1000, clock);
    const rear = group.segments[9]!;
    m.enemyManager.kill(group.segments[8]!);

    const worst = walk(m, group, path, 5_000, clock);

    expect(group.chains.map((c) => c.first)).toEqual([0, 9]);
    expect(rear.worm!.head).toBe(true);
    expect(m.tilesEngine.enemies.setRenderType).toHaveBeenCalledWith(rear.id, 'worm');
    expect(distance(group.segments[7]!) - distance(rear)).toBeCloseTo(2 * chain.spacing, 6);
    expect(worst.gap).toBeLessThan(MAX_GAP);
    expect(worst.yawStep).toBeLessThan(MAX_YAW_STEP);
    expect(worst.turnPerStep).toBeLessThan(0.02);
    expect(worst.movePerStep).toBeLessThan(2 * SPEED * STEP_MS / 1000);
  });

  it('takes the same shape in a corner at 1x and with four sub-steps in one', () => {
    const path = cornerPath(90);
    const fine = m.enemyManager.spawn(path, 'worm').worm!.group;
    walk(m, fine, path, 36_000, { now: 0 });

    const coarse = createTestManagers();
    const group = coarse.enemyManager.spawn(path, 'worm').worm!.group;
    walk(coarse, group, path, 36_000, { now: 0 }, 4 * STEP_MS);

    const out = (g: WormGroup): Enemy[] => g.segments.filter((e): e is Enemy => e !== null);
    const a = out(fine);
    const b = out(group);
    expect(b.length).toBe(a.length);
    // Rings in the corner: the front at 162 m, the corner at 150 m
    expect(a.some((e) => Math.abs(distance(e) - 150) < 5)).toBe(true);
    a.forEach((e, i) => {
      expect(b[i].position.lat).toBeCloseTo(e.position.lat, 10);
      expect(b[i].position.lon).toBeCloseTo(e.position.lon, 10);
      expect(b[i].transform.rotation).toBeCloseTo(e.transform.rotation, 6);
    });
    coarse.enemyManager.clear();
  });
});
