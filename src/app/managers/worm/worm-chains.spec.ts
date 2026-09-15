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
import { getRouteProfile } from '../../utils/route-corridor';
import { wormSegmentCount, wormSway, type WormGroup } from './worm-group';
import { straightPath, out, distance } from '../../../test/worm-test-helpers';

const chain = ENEMY_TYPES['worm'].chain!;
const SPEED = ENEMY_TYPES['worm'].baseSpeed;

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

    // Not a whole number of spacings, so no slot sits exactly at the start
    tickEngine(m, 10_500);

    const front = SPEED * 10.5;
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

  it('brings its last segment out as the tail', () => {
    const head = m.enemyManager.spawn(straightPath(100), 'worm');
    const group = head.worm!.group;
    const last = group.size - 1;

    tickEngine(m, 20_000);
    expect(group.isPending(last)).toBe(true);
    expect(out(group).some((e) => e.worm!.tail)).toBe(false);

    // Out after (size - 1) spacings at 4.5 m/s
    tickEngine(m, 2_500);
    const tail = group.segments[last]!;
    expect(tail.worm).toMatchObject({ head: false, tail: true });
    expect(m.tilesEngine.enemies.create).toHaveBeenCalledWith(tail.id, 'worm-tail', expect.anything(), expect.anything(), expect.anything());
    expect(m.tilesEngine.enemies.setRenderType).not.toHaveBeenCalledWith(tail.id, expect.anything());
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
    tickEngine(m, 10_500);
    const fineDistances = out(fine.worm!.group).map(distance);

    const coarse = createTestManagers();
    const head = coarse.enemyManager.spawn(path, 'worm');
    for (let t = 100; t <= 10_500; t += 100) coarse.enemyManager.update(100, t);
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
    // The first five of the 19 segments out: the mean pace drops to about 0.87
    for (let slot = 0; slot < 5; slot++) {
      group.segments[slot]!.movement.applyStatusEffect({ type: 'slow', value: 0.5, duration: 60_000, startTime: clock.now });
    }

    tickEngine(m, 10_000, clock);

    const front = distance(head);
    expect(front).toBeGreaterThan(SPEED * 10 + SPEED * 10 * 0.5);
    expect(front).toBeLessThan(SPEED * 20 - 2);
    for (const e of out(group)) {
      expect(distance(e)).toBeCloseTo(front - e.worm!.slot * chain.spacing, 6);
    }
  });

  it('stands whole while one segment is frozen or stunned, and walks on once it thaws', () => {
    const clock = { now: 0 };
    const head = m.enemyManager.spawn(straightPath(400), 'worm');
    const group = head.worm!.group;
    tickEngine(m, 10_000, clock);
    const before = distance(head);
    // One segment in the middle, 2 s frozen, then another 1 s stunned
    group.segments[4]!.movement.applyStatusEffect({ type: 'freeze', value: 1, duration: 2000, startTime: clock.now, sourceId: 'frost' });
    tickEngine(m, 1900, clock);
    expect(distance(head)).toBeCloseTo(before, 6);
    for (const e of out(group)) {
      expect(distance(e)).toBeCloseTo(before - e.worm!.slot * chain.spacing, 6);
    }

    tickEngine(m, 1000, clock);
    const walked = distance(head);
    expect(walked).toBeGreaterThan(before + 1);
    group.segments[7]!.movement.applyStatusEffect({ type: 'stun', value: 1, duration: 1000, startTime: clock.now, sourceId: 'emp' });
    tickEngine(m, 900, clock);
    expect(distance(head)).toBeCloseTo(walked, 6);
    tickEngine(m, 500, clock);
    expect(distance(head)).toBeGreaterThan(walked + 1);
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
    /** A worm 20 s out: its front at 90 m, the first 37 segments on the route */
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

    it('makes the segment in front of the gap the tail of the front worm', () => {
      const group = wormOut();
      const front = group.segments[4]!;
      m.enemyManager.kill(group.segments[5]!);
      tickEngine(m, 16);

      expect(front.worm!.tail).toBe(true);
      expect(m.tilesEngine.enemies.setRenderType).toHaveBeenCalledWith(front.id, 'worm-tail');
      // The rear worm's tail is still in the portal
      const tails = out(group).filter((e) => e.worm!.tail);
      expect(tails).toEqual([front]);
    });

    it('lets a segment left alone lead rather than end, a tail included', () => {
      const group = wormOut();
      m.enemyManager.kill(group.segments[5]!);
      tickEngine(m, 16);
      const lone = group.segments[4]!;
      expect(lone.worm!.tail).toBe(true);

      // Slot 4 is a worm of its own now, slot 2 ends the one in front
      m.enemyManager.kill(group.segments[3]!);
      tickEngine(m, 16);

      expect(lone.worm).toMatchObject({ head: true, tail: false });
      expect(m.tilesEngine.enemies.setRenderType).toHaveBeenCalledWith(lone.id, 'worm');
      expect(group.segments[2]!.worm!.tail).toBe(true);
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
      tickEngine(m, 1_000); // slot 0 at 4.5 m, slot 1 at 2.0 m, the rest inside
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

  describe('placed in Enemy Debug', () => {
    /** Halfway along the third 50 m segment: 125 m along the route */
    const placement = () => ({ segmentIndex: 2, segmentProgress: 0.5, lateralFactor: 0, heightVariation: 0, groundHeight: 300 });

    it('comes out where it was placed and walks the route itself', () => {
      const path = straightPath(400);
      const profile = getRouteProfile(path);
      const origin = profile.cumulativeLength[2] + profile.segmentLengths[2] * 0.5;
      const head = m.enemyManager.spawn(path, 'worm', undefined, true, undefined, placement());
      const group = head.worm!.group;
      expect(group.origin).toBeCloseTo(origin, 9);
      expect(distance(head)).toBeCloseTo(origin, 6);
      expect(head.movement.path).toBe(path);
      expect(group.size).toBe(wormSegmentCount(chain, profile.totalLength - origin));

      head.startMoving();
      tickEngine(m, 5_500);

      // 24.75 m, not a whole number of spacings
      const walked = SPEED * 5.5;
      const segments = out(group);
      expect(segments.length).toBe(Math.floor(walked / chain.spacing) + 1);
      for (const e of segments) {
        expect(distance(e)).toBeCloseTo(origin + walked - e.worm!.slot * chain.spacing, 6);
        expect(e.movement.getLateralFactor()).toBeCloseTo(wormSway(chain, distance(e), origin), 9);
      }
      expect(m.enemyManager.getPendingSpawnCount()).toBe(group.size - segments.length);
    });

    it('holds a worm from the portal behind it until it is out', () => {
      const path = straightPath(400);
      const placed = m.enemyManager.spawn(path, 'worm', undefined, false, undefined, placement());
      const origin = placed.worm!.group.origin;
      const fromPortal = m.enemyManager.spawn(path, 'worm');

      // Unhindered its head would be at 180 m; the placed worm is still coming out
      tickEngine(m, 40_000);

      expect(placed.worm!.group.pending).toBeGreaterThan(0);
      expect(distance(fromPortal)).toBeCloseTo(origin - 2 * chain.spacing, 6);
    });

    it('is removed as a whole with the head the debug list shows', () => {
      const head = m.enemyManager.spawn(straightPath(300), 'worm', undefined, true);
      const group = head.worm!.group;
      head.startMoving();
      tickEngine(m, 10_000);
      expect(out(group).length).toBeGreaterThan(5);

      m.eventBus.emit({ type: 'debug:remove-enemy', enemyId: head.id });

      expect(group.remaining).toBe(0);
      expect(m.enemyManager.getAll()).toHaveLength(0);
      expect(m.enemyManager.getPendingSpawnCount()).toBe(0);
    });

    it('is removed as a whole also after its head was killed', () => {
      const head = m.enemyManager.spawn(straightPath(300), 'worm');
      const group = head.worm!.group;
      tickEngine(m, 10_000);
      m.enemyManager.kill(head);
      tickEngine(m, 3_000);

      m.eventBus.emit({ type: 'debug:remove-enemy', enemyId: head.id });
      expect(group.remaining).toBe(0);
      expect(m.enemyManager.getAll()).toHaveLength(0);
    });

    it('lets the rest of an idle worm come out once its head is killed', () => {
      const head = m.enemyManager.spawn(straightPath(300), 'worm', undefined, true);
      const group = head.worm!.group;
      tickEngine(m, 2_000);
      m.enemyManager.kill(head);

      tickEngine(m, 5_000);

      expect(out(group).length).toBeGreaterThan(0);
      expect(group.pending).toBeLessThan(group.size - 1);
    });
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
