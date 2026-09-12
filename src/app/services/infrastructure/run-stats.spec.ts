import { describe, it, expect, beforeEach } from 'vitest';
import { GameEventBus, SubscriptionBag } from '../../game-engine/game-event-bus';
import { RunStatsTracker, formatRunTime } from './run-stats';

function tower(id: string, name: string, damageDealt: number, kills: number) {
  return { id, typeConfig: { name }, combat: { damageDealt, kills } };
}

describe('RunStatsTracker', () => {
  let bus: GameEventBus;
  let tracker: RunStatsTracker;

  beforeEach(() => {
    bus = new GameEventBus();
    tracker = new RunStatsTracker();
    tracker.attach(bus, new SubscriptionBag());
  });

  const startWave = (wave: number) => bus.emit({ type: 'wave:started', wave, enemyCount: 10 });
  const leak = (damage: number) => {
    bus.emit({ type: 'enemy:reached-base', enemy: {} as never, damage });
    bus.emit({ type: 'health:changed', health: 0, delta: -damage });
  };

  it('counts kills, leaks and HQ damage per wave, zero-filled up to the wave reached', () => {
    startWave(1);
    bus.emit({ type: 'enemy:died', enemy: {} as never, credits: 5 });
    leak(10);
    startWave(2);
    bus.emit({ type: 'enemy:died', enemy: {} as never, credits: 5 });
    startWave(3);
    leak(10);
    leak(15);

    const s = tracker.summary(60_000);
    expect(s.waveReached).toBe(3);
    expect(s.kills).toBe(2);
    expect(s.leaksPerWave).toEqual([1, 0, 2]);
    expect(s.hqDamagePerWave).toEqual([10, 0, 25]);
    expect(s.durationMs).toBe(60_000);
  });

  it('ignores healing and leaks outside a wave', () => {
    leak(10); // debug enemy before wave 1
    startWave(1);
    bus.emit({ type: 'health:changed', health: 1100, delta: 1000 });
    const s = tracker.summary(0);
    expect(s.leaksPerWave).toEqual([0]);
    expect(s.hqDamagePerWave).toEqual([0]);
  });

  it('keeps refunds and cheat credits out of the gold earned and nets refunds off the gold spent', () => {
    const t = tower('t1', 'Archer Tower', 0, 0);
    bus.emit({ type: 'tower:placed', tower: t as never, position: { lat: 0, lon: 0 }, cost: 100 });
    bus.emit({ type: 'credits:changed', credits: 0, delta: -100 }); // placement
    bus.emit({ type: 'credits:changed', credits: 0, delta: -50 }); // upgrade
    bus.emit({ type: 'credits:changed', credits: 0, delta: 30 }); // kill rewards
    bus.emit({ type: 'credits:changed', credits: 0, delta: 20 }); // wave bonus
    bus.emit({ type: 'tower:sold', tower: t as never, refund: 75 });
    bus.emit({ type: 'credits:changed', credits: 0, delta: 75 });
    bus.emit({ type: 'research:cancelled', researchId: 'x', refund: 10 });
    bus.emit({ type: 'credits:changed', credits: 0, delta: 10 });
    bus.emit({ type: 'debug:add-credits', amount: 1000 });
    bus.emit({ type: 'credits:changed', credits: 0, delta: 1000 });

    const s = tracker.summary(0);
    expect(s.goldEarned).toBe(50);
    expect(s.goldSpent).toBe(150 - 85);
  });

  it('ranks towers by damage dealt, sold ones with their numbers at the sale, at most three', () => {
    const a = tower('a', 'Archer Tower', 500, 4);
    const b = tower('b', 'Cannon Tower', 2000, 9);
    const c = tower('c', 'Ice Tower', 800, 1);
    const d = tower('d', 'Poison Tower', 100, 0);
    const rc = tower('rc', 'Research Center', 0, 0);
    for (const t of [a, b, c, d, rc]) {
      bus.emit({ type: 'tower:placed', tower: t as never, position: { lat: 0, lon: 0 }, cost: 0 });
    }
    bus.emit({ type: 'tower:sold', tower: c as never, refund: 0 });
    c.combat.damageDealt = 99_999; // after the sale, must not count

    const s = tracker.summary(0);
    expect(s.topTowers.map((t) => [t.id, t.damageDealt, t.sold])).toEqual([
      ['b', 2000, false],
      ['c', 800, true],
      ['a', 500, false],
    ]);
  });

  it('leaves towers that dealt nothing out', () => {
    bus.emit({ type: 'tower:placed', tower: tower('rc', 'Research Center', 0, 0) as never, position: { lat: 0, lon: 0 }, cost: 0 });
    expect(tracker.summary(0).topTowers).toEqual([]);
  });

  it('starts over on game:reset', () => {
    startWave(4);
    leak(10);
    bus.emit({ type: 'enemy:died', enemy: {} as never, credits: 5 });
    bus.emit({ type: 'tower:placed', tower: tower('a', 'Archer Tower', 10, 1) as never, position: { lat: 0, lon: 0 }, cost: 0 });
    bus.emit({ type: 'game:reset' });

    const s = tracker.summary(0);
    expect(s).toEqual({
      waveReached: 0,
      kills: 0,
      goldEarned: 0,
      goldSpent: 0,
      durationMs: 0,
      leaksPerWave: [],
      hqDamagePerWave: [],
      topTowers: [],
    });
  });
});

describe('formatRunTime', () => {
  it('reads m:ss, from an hour on h:mm:ss', () => {
    expect(formatRunTime(0)).toBe('0:00');
    expect(formatRunTime(65_400)).toBe('1:05');
    expect(formatRunTime(3_600_000 + 2 * 60_000 + 5_000)).toBe('1:02:05');
  });
});
