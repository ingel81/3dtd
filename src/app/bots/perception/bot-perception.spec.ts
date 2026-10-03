import { describe, expect, it } from 'vitest';
import type { ArmorType } from '../../configs/combat/combat.types';
import { BotPerception, LEAK_BINS, PERCEPTION_WAVES, SeenEnemy } from './bot-perception';

let nextId = 0;
function enemy(routeId: string, progress: number, options: { air?: boolean; armor?: ArmorType; maxHp?: number } = {}): SeenEnemy {
  return {
    id: `e${nextId++}`,
    movement: { routeId, getPathProgress: () => progress },
    typeConfig: { isAirUnit: options.air },
    health: { maxHp: options.maxHp ?? 100 },
    getEffectiveArmorType: () => options.armor ?? 'light',
  };
}

function tower(id: string, kills: number, damageDealt: number) {
  return { id, combat: { kills, damageDealt } };
}

describe('BotPerception', () => {
  it('books kills into the stretch of the route they fell on', () => {
    const seen = new BotPerception();
    seen.onWaveStarted(1);
    seen.onEnemyDied(enemy('a', 0.05), true);
    seen.onEnemyDied(enemy('a', 0.55), true);
    seen.onEnemyDied(enemy('a', 1), true);
    seen.onWaveCompleted([]);

    const deaths = seen.lastWave!.routes.get('a')!.deaths;
    expect(deaths).toHaveLength(LEAK_BINS);
    expect(deaths[0]).toBe(1);
    expect(deaths[5]).toBe(1);
    expect(deaths[LEAK_BINS - 1]).toBe(1);
    expect(seen.lastWave!.kills).toBe(3);
  });

  it('counts a death nobody killed as nothing: the leak was booked on arrival', () => {
    const seen = new BotPerception();
    seen.onWaveStarted(1);
    const e = enemy('a', 1, { armor: 'heavy', maxHp: 400 });
    seen.onEnemyArrived(e);
    seen.onEnemyDied(e, false);
    seen.onWaveCompleted([]);

    expect(seen.lastWave!.kills).toBe(0);
    expect(seen.lastWave!.leaks).toBe(1);
    expect(seen.lastWave!.leakedHpByArmor).toEqual({ heavy: 400 });
  });

  it('counts an ooze once: it leaks over many events, arrives, or dies flowing in', () => {
    const seen = new BotPerception();
    seen.onWaveStarted(1);
    const arrives = enemy('a', 1);
    seen.onEnemyLeaking(arrives);
    seen.onEnemyLeaking(arrives);
    seen.onEnemyArrived(arrives);
    const dies = enemy('a', 1);
    seen.onEnemyLeaking(dies);
    seen.onEnemyDied(dies, true);
    seen.onWaveCompleted([]);

    expect(seen.lastWave!.leaks).toBe(2);
    expect(seen.lastWave!.kills).toBe(0);
  });

  it('counts air leaks apart', () => {
    const seen = new BotPerception();
    seen.onWaveStarted(1);
    seen.onEnemyArrived(enemy('a', 1, { air: true }));
    seen.onEnemyArrived(enemy('a', 1));
    seen.onWaveCompleted([]);
    expect(seen.lastWave!.leakedAir).toBe(1);
  });

  it('in coop sees its own lanes only', () => {
    const seen = new BotPerception((routeId) => routeId === 'mine');
    seen.onWaveStarted(1);
    seen.onEnemyDied(enemy('theirs', 0.5), true);
    seen.onEnemyArrived(enemy('theirs', 1));
    seen.onEnemyDied(enemy('mine', 0.5), true);
    seen.onWaveCompleted([]);

    expect(seen.lastWave!.kills).toBe(1);
    expect(seen.lastWave!.leaks).toBe(0);
    expect([...seen.lastWave!.routes.keys()]).toEqual(['mine']);
    // The partner's leaks stand apart, for the gold the bot may send (B6)
    expect(seen.lastWave!.leaksElsewhere.get('theirs')).toBe(1);
  });

  it(`remembers the last ${PERCEPTION_WAVES} waves and forgets them on a restart`, () => {
    const seen = new BotPerception();
    for (let wave = 1; wave <= PERCEPTION_WAVES + 2; wave++) {
      seen.onWaveStarted(wave);
      seen.onWaveCompleted([]);
    }
    expect(seen.waves.map((w) => w.wave)).toEqual([3, 4, 5]);

    seen.onWaveStarted(1);
    expect(seen.waves).toHaveLength(0);
  });

  it('gives each tower what it did per wave, and drops a sold one', () => {
    const seen = new BotPerception();
    seen.onWaveStarted(1);
    seen.onWaveCompleted([tower('t1', 4, 300)]);
    seen.onWaveStarted(2);
    seen.onWaveCompleted([tower('t1', 10, 900), tower('t2', 2, 50)]);

    expect(seen.tower('t1')).toEqual(expect.objectContaining({
      firstWave: 1,
      waves: [{ kills: 4, damage: 300 }, { kills: 6, damage: 600 }],
    }));
    expect(seen.tower('t2')!.firstWave).toBe(2);

    seen.onWaveStarted(3);
    seen.onWaveCompleted([tower('t2', 2, 50)]);
    expect(seen.tower('t1')).toBeNull();
    expect(seen.tower('t2')!.waves.at(-1)).toEqual({ kills: 0, damage: 0 });
  });

  it('names the leaking routes and where the kills thin out before the HQ', () => {
    const seen = new BotPerception();
    seen.onWaveStarted(1);
    // All kills in the first third of route a, then it leaks; route b holds
    for (let i = 0; i < 9; i++) seen.onEnemyDied(enemy('a', 0.05 + (i % 3) * 0.1), true);
    seen.onEnemyArrived(enemy('a', 1));
    seen.onEnemyArrived(enemy('a', 1));
    seen.onEnemyDied(enemy('b', 0.9), true);
    seen.onWaveCompleted([]);

    expect(seen.leakingRoutes()).toEqual([{ routeId: 'a', leaks: 2, thinFrom: 0.3 }]);
  });
});
