/**
 * The worm through the real EnemyManager and WaveManager, rendering mocked:
 * spawn, coming out of the portal, the chain's spacing and sway, holds,
 * gaps, the queue in the portal, leaks and the wave's end and gold.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('three', async () => {
  const mod = await import('@/test/mocks/three.mock');
  return { ...mod };
});

import {
  createTestManagers,
  createTestCachedPaths,
  TestManagers,
  tickEngine,
  TEST_SPAWN_POINTS,
} from '../../integration/test-helpers';
import { ENEMY_TYPES } from '../../configs/enemy-types.config';
import { goldBudgetForWave } from '../../configs/wave-curriculum.config';
import { METERS_PER_DEGREE_LAT } from '../../utils/geo-utils';
import { getRouteProfile } from '../../utils/route-corridor';
import type { GeoPosition } from '../../models/game.types';
import type { Enemy } from '../../entities/enemy.entity';
import { wormSegmentCount, wormSway, type WormGroup } from './worm-group';

const chain = ENEMY_TYPES['worm'].chain!;
const SPEED = ENEMY_TYPES['worm'].baseSpeed;

/** Straight route north, a waypoint every 50 m */
function straightPath(meters: number): GeoPosition[] {
  const points: GeoPosition[] = [];
  for (let m = 0; m < meters; m += 50) {
    points.push({ lat: 48.776 + m / METERS_PER_DEGREE_LAT, lon: 9.183, height: 300 });
  }
  points.push({ lat: 48.776 + meters / METERS_PER_DEGREE_LAT, lon: 9.183, height: 300 });
  return points;
}

const out = (group: WormGroup): Enemy[] => group.segments.filter((e): e is Enemy => e !== null);
const distance = (e: Enemy): number => e.movement.getDistanceAlongPath();

describe('Worm chains', () => {
  let m: TestManagers;

  beforeEach(() => {
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    m = createTestManagers();
  });

  afterEach(() => {
    m.enemyManager.clear();
    vi.restoreAllMocks();
  });

  it('puts the head on the route at once and the rest in the portal', () => {
    const spawned = vi.fn();
    m.eventBus.on('worm:spawned', spawned);
    const path = straightPath(300);

    const head = m.enemyManager.spawn(path, 'worm');
    const group = head.worm!.group;

    expect(head.worm!.slot).toBe(0);
    expect(head.worm!.head).toBe(true);
    expect(group.size).toBe(wormSegmentCount(chain, getRouteProfile(path).totalLength));
    expect(m.enemyManager.getAliveCount()).toBe(1);
    expect(m.enemyManager.getPendingSpawnCount()).toBe(group.size - 1);
    expect(spawned).toHaveBeenCalledWith(expect.objectContaining({ head, group }));
    // Body segments are drawn from the segment pool, the head from its own
    expect(m.tilesEngine.enemies.create).toHaveBeenCalledWith(head.id, 'worm', expect.anything(), expect.anything(), expect.anything());
  });

  it('comes out one segment per spacing and keeps the spacing', () => {
    const head = m.enemyManager.spawn(straightPath(400), 'worm');
    const group = head.worm!.group;

    tickEngine(m, 10_000);

    const front = SPEED * 10;
    const segments = out(group);
    expect(segments.length).toBe(Math.floor(front / chain.spacing) + 1);
    for (const e of segments) {
      expect(distance(e)).toBeCloseTo(front - e.worm!.slot * chain.spacing, 6);
      expect(e.typeConfig.id).toBe('worm');
    }
    expect(m.enemyManager.getPendingSpawnCount()).toBe(group.size - segments.length);
    const bodyCreates = m.tilesEngine.enemies.create.mock.calls.filter((c: unknown[]) => c[1] === 'worm-segment');
    expect(bodyCreates.length).toBe(segments.length - 1);
  });

  it('sways by the distance each segment has reached, straight out of the portal', () => {
    const head = m.enemyManager.spawn(straightPath(400), 'worm');
    tickEngine(m, 15_000);
    const segments = out(head.worm!.group);
    for (const e of segments) {
      expect(e.movement.getLateralFactor()).toBeCloseTo(wormSway(chain, distance(e)), 9);
    }
    expect(segments.some((e) => Math.abs(e.movement.getLateralFactor()) > chain.sway * 0.8)).toBe(true);
  });

  it('keeps the chain exact with the longest sub-steps', () => {
    const path = straightPath(400);
    const fine = m.enemyManager.spawn(path, 'worm');
    tickEngine(m, 10_000);
    const fineDistances = out(fine.worm!.group).map(distance);

    const coarse = createTestManagers();
    const head = coarse.enemyManager.spawn(path, 'worm');
    for (let t = 100; t <= 10_000; t += 100) coarse.enemyManager.update(100, t);
    const coarseDistances = out(head.worm!.group).map(distance);

    expect(coarseDistances.length).toBe(fineDistances.length);
    coarseDistances.forEach((d, i) => expect(d).toBeCloseTo(fineDistances[i], 6));
    coarse.enemyManager.clear();
  });

  it('drags the whole worm at the mean pace of a slowed segment', () => {
    const clock = { now: 0 };
    const head = m.enemyManager.spawn(straightPath(400), 'worm');
    const group = head.worm!.group;
    tickEngine(m, 10_000, clock);
    head.movement.applyStatusEffect({ type: 'slow', value: 0.5, duration: 60_000, startTime: clock.now });

    tickEngine(m, 10_000, clock);

    const front = distance(head);
    expect(front).toBeGreaterThan(SPEED * 10 + SPEED * 10 * 0.5);
    expect(front).toBeLessThan(SPEED * 20 - 1);
    for (const e of out(group)) {
      expect(distance(e)).toBeCloseTo(front - e.worm!.slot * chain.spacing, 6);
    }
  });

  it('stands while its head is held and walks once it is started', () => {
    const head = m.enemyManager.spawn(straightPath(300), 'worm', undefined, true);
    const group = head.worm!.group;

    tickEngine(m, 5_000);
    expect(distance(head)).toBe(0);
    expect(group.pending).toBe(group.size - 1);

    head.startMoving();
    tickEngine(m, 5_000);
    expect(distance(head)).toBeCloseTo(SPEED * 5, 6);
    expect(out(group).length).toBeGreaterThan(1);
  });

  describe('a destroyed segment', () => {
    /** A worm 20 s out: 26 segments on the route */
    const wormOut = (): WormGroup => {
      const group = m.enemyManager.spawn(straightPath(400), 'worm').worm!.group;
      tickEngine(m, 20_000);
      return group;
    };
    const slowAll = (group: WormGroup, first: number, last: number, now: number): void => {
      for (let slot = first; slot <= last; slot++) {
        group.segments[slot]!.movement.applyStatusEffect({ type: 'slow', value: 0.5, duration: 60_000, startTime: now });
      }
    };

    it('splits the worm in two, the first segment behind the gap as the new head', () => {
      const group = wormOut();
      const rear = group.segments[6]!;
      m.enemyManager.kill(group.segments[5]!);
      expect(group.remaining).toBe(group.size - 1);
      tickEngine(m, 5_000);

      expect(group.chains.map((c) => c.first)).toEqual([0, 6]);
      expect(rear.worm!.head).toBe(true);
      expect(group.segments[4]!.worm!.head).toBe(false);
      expect(m.tilesEngine.enemies.setRenderType).toHaveBeenCalledWith(rear.id, 'worm');
      expect(distance(group.segments[4]!) - distance(rear)).toBeCloseTo(2 * chain.spacing, 6);
    });

    it('lets the next segment lead when the head goes', () => {
      const group = wormOut();
      m.enemyManager.kill(group.segments[0]!);
      tickEngine(m, 16);
      expect(group.chains[0].first).toBe(1);
      expect(group.segments[1]!.worm!.head).toBe(true);
    });

    it('lets the rear worm queue behind a slowed front one, never closer than the gap', () => {
      const clock = { now: 20_000 };
      const group = wormOut();
      m.enemyManager.kill(group.segments[5]!);
      slowAll(group, 0, 4, clock.now);
      tickEngine(m, 10_000, clock);

      expect(distance(group.segments[0]!)).toBeCloseTo(SPEED * 20 + SPEED * 0.5 * 10, 3);
      expect(distance(group.segments[4]!) - distance(group.segments[6]!)).toBeCloseTo(2 * chain.spacing, 3);
    });

    it('lets a slowed rear worm fall behind while the front one walks on', () => {
      const clock = { now: 20_000 };
      const group = wormOut();
      m.enemyManager.kill(group.segments[5]!);
      slowAll(group, 6, 25, clock.now);
      tickEngine(m, 10_000, clock);

      expect(distance(group.segments[0]!)).toBeCloseTo(SPEED * 30, 3);
      const gap = distance(group.segments[4]!) - distance(group.segments[6]!);
      expect(gap).toBeGreaterThan(2 * chain.spacing + 10);
      for (let slot = 7; slot <= 25; slot++) {
        expect(distance(group.segments[slot - 1]!) - distance(group.segments[slot]!)).toBeCloseTo(chain.spacing, 6);
      }
    });

    it('sends the rest out of the portal behind a gap, led by a head', () => {
      const head = m.enemyManager.spawn(straightPath(400), 'worm');
      const group = head.worm!.group;
      tickEngine(m, 1_000); // slot 0 at 4.5 m, slot 1 at 0.9 m, the rest inside
      m.enemyManager.kill(group.segments[1]!);
      expect(group.isPending(2)).toBe(true);

      tickEngine(m, 3_000);

      const lead = group.segments[2]!;
      expect(lead.worm!.head).toBe(true);
      expect(m.tilesEngine.enemies.create).toHaveBeenCalledWith(lead.id, 'worm', expect.anything(), expect.anything(), expect.anything());
      expect(m.tilesEngine.enemies.setRenderType).not.toHaveBeenCalled();
      expect(distance(head) - distance(lead)).toBeCloseTo(2 * chain.spacing, 6);
    });
  });

  it('waits in the portal behind a worm still coming out on the same path', () => {
    const path = straightPath(300);
    const first = m.enemyManager.spawn(path, 'worm');
    tickEngine(m, 2_000);

    const second = m.enemyManager.spawn(path, 'worm');
    expect(second.worm!.target).toBeLessThan(0);
    tickEngine(m, 10_000);

    expect(distance(second)).toBe(0);
    expect(second.worm!.group.pending).toBe(second.worm!.group.size - 1);
    expect(distance(first)).toBeCloseTo(SPEED * 12, 6);
  });

  it('leaves nothing of a worm after a clear, the segments in the portal included', () => {
    const group = m.enemyManager.spawn(straightPath(300), 'worm').worm!.group;
    tickEngine(m, 5_000);
    m.enemyManager.clear();
    expect(group.remaining).toBe(0);
    expect(m.enemyManager.getPendingSpawnCount()).toBe(0);
    tickEngine(m, 5_000);
    expect(m.enemyManager.getAll()).toHaveLength(0);
  });

  it('goes into the HQ one segment after another', () => {
    const reached = vi.fn();
    m.eventBus.on('enemy:reached-base', reached);
    const head = m.enemyManager.spawn(straightPath(60), 'worm');
    const group = head.worm!.group;

    tickEngine(m, 60_000);

    expect(reached).toHaveBeenCalledTimes(group.size);
    expect(group.remaining).toBe(0);
    expect(m.enemyManager.getAll()).toHaveLength(0);
    expect(m.enemyManager.getPendingSpawnCount()).toBe(0);
  });

  describe('in a wave', () => {
    beforeEach(() => {
      m.waveManager.initialize(TEST_SPAWN_POINTS, createTestCachedPaths());
      m.enemyManager.setWaveNumberProvider(() => m.waveManager.waveNumber());
      m.enemyManager.setWaveSizeProvider(() => m.waveManager.getExpectedBodyCount());
    });

    const startWorm = (): WormGroup => {
      m.waveManager.startWave({ schedule: { entries: [{ enemyType: 'worm', speed: SPEED }], baseDelay: 100 } });
      tickEngine(m, 16);
      return m.enemyManager.getAlive()[0].worm!.group;
    };

    /** Kill whatever is out, sub-step by sub-step, until the wave ends. */
    const beatWave = (): void => {
      for (let t = 0; t < 300_000 && !m.waveManager.checkWaveComplete(); t += 16) {
        tickEngine(m, 16);
        for (const e of m.enemyManager.getAlive()) m.enemyManager.kill(e);
      }
    };

    it('counts every segment as a body of the wave', () => {
      const group = startWorm();
      expect(m.waveManager.getExpectedEnemyCount()).toBe(1);
      expect(m.waveManager.getExpectedBodyCount()).toBe(group.size);
    });

    it('lasts while segments are still in the portal', () => {
      const group = startWorm();
      m.enemyManager.kill(group.segments[0]!);
      expect(m.enemyManager.getAliveCount()).toBe(0);
      expect(m.waveManager.checkWaveComplete()).toBe(false);

      beatWave();
      expect(m.waveManager.checkWaveComplete()).toBe(true);
      expect(group.remaining).toBe(0);
    });

    it('takes the segments still in the portal along on kill-all', () => {
      const group = startWorm();
      tickEngine(m, 2_000);
      m.eventBus.emit({ type: 'debug:kill-all' });
      expect(group.remaining).toBe(0);
      tickEngine(m, 3_000);
      expect(m.waveManager.checkWaveComplete()).toBe(true);
    });

    it('splits the kill gold over the worm spawned after the first kill', () => {
      const credits: number[] = [];
      m.eventBus.on('enemy:died', (e) => credits.push(e.credits));
      m.waveManager.startWave({
        schedule: {
          entries: [{ enemyType: 'zombie', speed: 5 }, { enemyType: 'worm', speed: SPEED }],
          baseDelay: 500,
        },
      });
      tickEngine(m, 16);
      m.enemyManager.kill(m.enemyManager.getAlive()[0]); // the zombie, before the worm is out
      tickEngine(m, 600);

      beatWave();

      const budget = goldBudgetForWave(1).kill;
      const worm = credits.slice(1);
      expect(credits.reduce((s, c) => s + c, 0)).toBe(budget);
      expect(Math.max(...worm) - Math.min(...worm)).toBeLessThanOrEqual(1);
    });
  });
});
