/**
 * Playtest 555 (fix session 2026-09-14): the camera turned away from the
 * worm of W35. The worm through the real EnemyManager, the arrows through
 * what OffscreenIndicatorsComponent runs per scan: isArrowBoss and
 * isOffscreenThreat pick the enemies, OffscreenClusterer bundles them by
 * direction (8 sectors) into arrows with a count.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('three', async () => {
  const mod = await import('@/test/mocks/three.mock');
  return { ...mod };
});

import { createTestManagers, TestManagers, tickEngine } from '../../integration/test-helpers';
import { ENEMY_TYPES } from '../../configs/enemy-types.config';
import { METERS_PER_DEGREE_LAT } from '../../utils/geo-utils';
import { isArrowBoss, isOffscreenThreat, NEAR_HQ_PROGRESS, OffscreenClusterer } from '../../utils/offscreen-indicators';
import type { GeoPosition } from '../../models/game.types';
import type { Enemy } from '../../entities/enemy.entity';
import type { WormGroup } from './worm-group';

/** Straight route north, a waypoint every 50 m */
function straightPath(meters: number): GeoPosition[] {
  const points: GeoPosition[] = [];
  for (let m = 0; m < meters; m += 50) {
    points.push({ lat: 48.776 + m / METERS_PER_DEGREE_LAT, lon: 9.183, height: 300 });
  }
  points.push({ lat: 48.776 + meters / METERS_PER_DEGREE_LAT, lon: 9.183, height: 300 });
  return points;
}

/** The enemies the component would give an arrow, as its scan() picks them. */
function threats(m: TestManagers): Enemy[] {
  return m.enemyManager.getAlive().filter((e) =>
    isOffscreenThreat(isArrowBoss(e.typeConfig.isBoss === true, e.worm), e.movement.getPathProgress()));
}

/** The arrows for `points` (NDC, all off-screen), each flagged boss or not. */
function arrows(points: { x: number; y: number; boss: boolean }[]) {
  const clusterer = new OffscreenClusterer(8);
  clusterer.begin(800, 600, 20);
  for (const p of points) clusterer.add(p.x, p.y, false, p.boss);
  return clusterer.build(6);
}

describe('Offscreen arrows for the worm (playtest 555)', () => {
  let m: TestManagers;

  beforeEach(() => {
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    m = createTestManagers();
  });

  afterEach(() => {
    m.enemyManager.clear();
    vi.restoreAllMocks();
  });

  const wormOut = (): WormGroup => {
    const group = m.enemyManager.spawn(straightPath(400), 'worm').worm!.group;
    tickEngine(m, 20_000);
    return group;
  };

  it('points one boss arrow at the head, not an arrow with a count for every ring', () => {
    expect(ENEMY_TYPES['worm'].isBoss).toBe(true);
    const group = wormOut();
    const rings = m.enemyManager.getAlive().filter((e) => e.worm?.group === group);
    expect(rings.length).toBeGreaterThan(5);

    expect(threats(m)).toEqual([group.segments[0]]);
    // Before 66a5468a every ring was a boss and so a threat anywhere on the route
    const everyRing = m.enemyManager.getAlive().filter((e) =>
      isOffscreenThreat(e.typeConfig.isBoss === true, e.movement.getPathProgress()));
    expect(everyRing).toHaveLength(rings.length);

    // Behind the camera, all in one direction: one arrow, boss, no count label (count 1)
    expect(arrows([{ x: 3, y: 0, boss: true }])).toEqual([expect.objectContaining({ count: 1, boss: true })]);
  });

  it('gives the piece behind a destroyed middle segment its own boss: two heads', () => {
    const group = wormOut();
    m.enemyManager.kill(group.segments[5]!);
    tickEngine(m, 5_000);

    const heads = threats(m);
    expect(heads).toEqual([group.segments[0], group.segments[6]]);
    expect(heads.every((e) => isArrowBoss(true, e.worm))).toBe(true);
  });

  it('draws the two heads as a second boss arrow only when they lie in another direction sector', () => {
    // The clusterer bundles by direction from the view centre, 45 degrees a
    // sector. The two pieces follow each other on the route a few metres
    // apart, so seen from a camera turned away they usually fall into one
    // sector: one boss arrow with the count 2.
    expect(arrows([{ x: 3, y: 0, boss: true }, { x: 3, y: 0.2, boss: true }]))
      .toEqual([expect.objectContaining({ count: 2, boss: true })]);
    // Only in two sectors (the camera between the pieces, a bend) two boss arrows
    expect(arrows([{ x: 3, y: 0, boss: true }, { x: 0, y: 3, boss: true }]))
      .toEqual([expect.objectContaining({ count: 1, boss: true }), expect.objectContaining({ count: 1, boss: true })]);
  });

  it('takes rings on the last 15 % of the route as ordinary threats, merged into the boss arrow in its sector', () => {
    const group = wormOut();
    const head = group.segments[0]!;
    // Walk the head past NEAR_HQ_PROGRESS, some rings behind it with it
    for (let i = 0; i < 60 && head.movement.getPathProgress() < 0.95; i++) tickEngine(m, 1_000);
    expect(head.alive).toBe(true);

    const found = threats(m);
    const nearRings = found.filter((e) => e !== head);
    expect(nearRings.length).toBeGreaterThan(0);
    for (const ring of nearRings) {
      expect(ring.movement.getPathProgress()).toBeGreaterThanOrEqual(NEAR_HQ_PROGRESS);
      expect(isArrowBoss(true, ring.worm)).toBe(false);
    }
    // Rings far back on the route stay without an arrow
    const back = m.enemyManager.getAlive().filter((e) => e.worm?.group === group && !found.includes(e));
    expect(back.every((e) => e.movement.getPathProgress() < NEAR_HQ_PROGRESS)).toBe(true);

    // Alone in a sector a ring is a normal arrow; next to the head it counts into the boss arrow
    expect(arrows([{ x: -3, y: 0, boss: false }])).toEqual([expect.objectContaining({ boss: false })]);
    expect(arrows([{ x: 3, y: 0, boss: true }, { x: 3, y: 0.1, boss: false }]))
      .toEqual([expect.objectContaining({ count: 2, boss: true })]);
  });
});
