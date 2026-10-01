import { describe, expect, it } from 'vitest';
import {
  baseBudgetSeconds, bodyParts, budgetSeconds, ENDLESS_GROWTH, enemyHp, meanRush, sizeWave, BOSS_MIN_HP_MULT, BOSS_OVER_ESCORT,
  BUDGET_REALISM, SURE_KILL_HQ_SHARE, SURE_KILL_SHARE, UNDER_FIRE_SHARE, type BudgetInput,
} from './budget';
import type { EffectiveDPSPerArmor } from '../../models/game-state-snapshot';
import { ENEMY_TYPES, WORM_MAX_SEGMENTS } from '../../../configs/enemy-types.config';

const flat = (v: number) => ({ unarmored: v, light: v, heavy: v, fortified: v, ethereal: v });
const scale = <T extends Record<string, number>>(o: T, k: number) =>
  Object.fromEntries(Object.entries(o).map(([key, v]) => [key, v * k])) as T;
const dps = (ground: number, air = ground): EffectiveDPSPerArmor => ({ ground: flat(ground), air: flat(air) });

const base = (over: Partial<BudgetInput> = {}): BudgetInput => ({
  wave: 20,
  enemies: { zombie: 100 },
  strength: 1,
  spawnDelayMs: 1000,
  regulator: 1,
  targetPressure: 0.05,
  leakScale: () => 1,
  defense: { dps: dps(1000), damageMetres: dps(1000 * 400), hpRemaining: 300 },
  ...over,
});

/** Seconds of defense damage the sized wave costs. */
const cost = (input: BudgetInput, hpMult: Readonly<Record<string, number>>) =>
  Object.entries(input.enemies).reduce((sum, [type, n]) => sum + (n * enemyHp(type) * hpMult[type]) / (1000 * BUDGET_REALISM), 0);

describe('budget curve', () => {
  it('starts at 15 s and rises steadily, without a bend at the end of the plan', () => {
    expect(budgetSeconds(1)).toBe(15);
    for (let w = 2; w <= 200; w++) expect(budgetSeconds(w)).toBeGreaterThan(budgetSeconds(w - 1));
    expect(budgetSeconds(60)).toBeCloseTo(baseBudgetSeconds(60) + ENDLESS_GROWTH * (59 / 60) ** 2, 9);
    expect(budgetSeconds(150) - budgetSeconds(100)).toBeGreaterThan(30);
  });

  it('keeps a saturating part that flattens towards 100 s', () => {
    expect(baseBudgetSeconds(1)).toBe(15);
    expect(baseBudgetSeconds(120)).toBeLessThan(100);
  });
});

describe('sizeWave', () => {
  it('fills exactly the budget when the wave is long enough', () => {
    const input = base();
    const sized = sizeWave(input);
    expect(sized.capped).toBe(false);
    expect(sized.delivered).toBeCloseTo(budgetSeconds(20));
    expect(cost(input, sized.hpMult)).toBeCloseTo(sized.delivered, 1);
  });

  it('scales with the row strength and the loop, the same way for every wave', () => {
    const one = sizeWave(base()).hpMult['zombie'];
    expect(sizeWave(base({ strength: 1.3 })).hpMult['zombie']).toBeCloseTo(one * 1.3, 2);
    expect(sizeWave(base({ regulator: 0.5 })).hpMult['zombie']).toBeCloseTo(one * 0.5, 2);
  });

  it('gives a stronger defense tougher enemies, not more of them', () => {
    const weak = sizeWave(base());
    const strong = sizeWave(base({ defense: { ...base().defense, dps: dps(2000), damageMetres: dps(2000 * 400) } }));
    expect(strong.hpMult['zombie']).toBeCloseTo(weak.hpMult['zombie'] * 2, 2);
  });

  it('holds an enemy at what the defense deals while it is under fire', () => {
    // One worm, a short stretch under fire: it would take far more than that
    const input = base({ enemies: { ooze: 1 }, spawnDelayMs: 0, targetPressure: 10, defense: { dps: dps(50000), damageMetres: dps(50000 * 20), hpRemaining: 3000 } });
    const sized = sizeWave(input);
    const fire = 20 / ENEMY_TYPES['ooze'].baseSpeed;
    expect(sized.clamped).toEqual(['ooze']);
    expect((enemyHp('ooze') * sized.hpMult['ooze']) / (50000 * BUDGET_REALISM)).toBeCloseTo(UNDER_FIRE_SHARE * fire, 1);
  });

  it('gives the rest of the budget to the others when one type is at its limit', () => {
    const sized = sizeWave(base({ enemies: { ooze: 1, skeleton: 300 }, spawnDelayMs: 400, defense: { dps: dps(50000), damageMetres: dps(50000 * 60), hpRemaining: 300 } }));
    expect(sized.clamped).toContain('ooze');
    expect(sized.hpMult['skeleton']).toBeGreaterThan(sized.hpMult['ooze']);
  });

  it('cuts the budget to the time on the route plus the leaks the curve allows', () => {
    const short = sizeWave(base({ enemies: { zombie: 10 }, spawnDelayMs: 100, defense: { dps: dps(1000), damageMetres: dps(1000 * 30), hpRemaining: 300 } }));
    expect(short.capped).toBe(true);
    expect(short.delivered).toBeLessThan(short.budget);
    const moreHp = sizeWave(base({ enemies: { zombie: 10 }, spawnDelayMs: 100, defense: { dps: dps(1000), damageMetres: dps(1000 * 30), hpRemaining: 3000 } }));
    expect(moreHp.delivered).toBeGreaterThan(short.delivered);
  });

  it('moves the cap with the loop, so a capped wave still answers to it', () => {
    const at = (regulator: number) => sizeWave(base({ enemies: { zombie: 10 }, spawnDelayMs: 100, regulator, defense: { dps: dps(1000), damageMetres: dps(1000 * 30), hpRemaining: 300 } }));
    expect(at(1).capped).toBe(true);
    expect(at(2).capped).toBe(true);
    expect(at(2).delivered).toBeGreaterThan(at(1).delivered * 1.5);
    expect(at(0.5).delivered).toBeLessThan(at(1).delivered);
  });

  it('leaves enemies the defense cannot hurt at the row strength, HP ×1 at strength 1', () => {
    const sized = sizeWave(base({ enemies: { bat: 20, zombie: 50 }, defense: { dps: dps(1000, 0), damageMetres: dps(1000 * 400, 0), hpRemaining: 300 } }));
    expect(sized.unhurt).toEqual(['bat']);
    expect(sized.hpMult['bat']).toBe(1);
    expect(sized.hpMult['zombie']).toBeGreaterThan(1);
  });

  it('answers without a defense', () => {
    const sized = sizeWave(base({ defense: { dps: undefined, damageMetres: undefined, hpRemaining: 500 } }));
    expect(sized.hpMult['zombie']).toBe(1);
  });
});

describe('sizeWave, an enemy whose one leak costs a good part of the HQ', () => {
  it('gets only the sure-kill share of the damage under fire', () => {
    const at = (hpRemaining: number) => sizeWave(base({ enemies: { ooze: 1 }, spawnDelayMs: 0, defense: { dps: dps(50000), damageMetres: dps(50000 * 30), hpRemaining } }));
    // The Ooze's leak (49) against SURE_KILL_HQ_SHARE of 3000 and of 300 HQ HP
    expect(49).toBeLessThan(3000 * SURE_KILL_HQ_SHARE);
    expect(49).toBeGreaterThan(300 * SURE_KILL_HQ_SHARE);
    expect(at(300).hpMult['ooze']).toBeCloseTo((at(3000).hpMult['ooze'] * SURE_KILL_SHARE) / UNDER_FIRE_SHARE, 2);
  });
});

describe('sizeWave, a boss', () => {
  const defense = { dps: dps(3000), damageMetres: dps(3000 * 40), metresUnderFire: { ground: 200, air: 200 }, hpRemaining: 300 };

  it('is never weaker than BOSS_OVER_ESCORT times the toughest escort body', () => {
    const sized = sizeWave(base({ wave: 10, enemies: { herbert: 1, tank: 10, zombie: 9 }, spawnDelayMs: 2000, defense }));
    const herbert = enemyHp('herbert') * sized.hpMult['herbert'];
    const tank = enemyHp('tank') * sized.hpMult['tank'];
    expect(herbert).toBeGreaterThanOrEqual(BOSS_OVER_ESCORT * tank * 0.999);
    expect(sized.floored).toContain('herbert');
  });

  it('keeps at least BOSS_MIN_HP_MULT of its base HP, however short its time under fire', () => {
    const sized = sizeWave(base({ wave: 20, enemies: { ooze: 1 }, spawnDelayMs: 0, defense: { ...defense, damageMetres: dps(3000 * 2) } }));
    expect(sized.hpMult['ooze']).toBe(BOSS_MIN_HP_MULT);
  });

  it('takes its floor out of the budget of its escort', () => {
    const alone = sizeWave(base({ wave: 10, enemies: { tank: 10, zombie: 9 }, spawnDelayMs: 2000, defense }));
    const led = sizeWave(base({ wave: 10, enemies: { herbert: 1, tank: 10, zombie: 9 }, spawnDelayMs: 2000, defense }));
    expect(led.hpMult['tank']).toBeLessThan(alone.hpMult['tank']);
  });
});

describe('sizeWave, a chain', () => {
  it('counts every segment as a body of its own, with the time the chain takes to come out', () => {
    const defense = { dps: dps(5000), damageMetres: dps(5000 * 60), metresUnderFire: { ground: 60, air: 60 }, hpRemaining: 300 };
    const worm = sizeWave(base({ wave: 30, enemies: { worm: 1 }, spawnDelayMs: 0, defense }));
    // A segment takes little damage alone: no limit holds it, and the window is the chain coming out
    expect(worm.clamped).toEqual([]);
    const out = (WORM_MAX_SEGMENTS * ENEMY_TYPES['worm'].chain!.spacing) / ENEMY_TYPES['worm'].baseSpeed;
    expect(worm.window).toBeGreaterThan(out);
    expect(worm.hpMult['worm']).toBeGreaterThan(1);
  });

  it('counts the head as a body of its own, with its HP and armor', () => {
    const chain = ENEMY_TYPES['worm'].chain!;
    const [head, segments] = bodyParts('worm');
    expect(head).toMatchObject({ bodies: 1, hp: 400 * chain.head.hpFactor, armor: chain.head.armorType });
    expect(segments).toMatchObject({ bodies: WORM_MAX_SEGMENTS - 1, hp: 400, armor: ENEMY_TYPES['worm'].armorType });
    expect(enemyHp('worm')).toBe(400 * (WORM_MAX_SEGMENTS - 1 + chain.head.hpFactor));
  });

  it('holds the whole worm lower against a defense weak against the head', () => {
    const at = (fortified: number) => {
      const d = { ...flat(5000), fortified };
      const defense = { dps: { ground: d, air: d }, damageMetres: { ground: scale(d, 60), air: scale(d, 60) }, metresUnderFire: { ground: 60, air: 60 }, hpRemaining: 300 };
      return sizeWave(base({ wave: 30, enemies: { worm: 1 }, spawnDelayMs: 0, regulator: 20, defense })).hpMult['worm'];
    };
    expect(at(200)).toBeLessThan(at(5000));
  });

  it('passes the towers faster on average the more it rushes', () => {
    expect(meanRush(0)).toBe(1);
    expect(meanRush(1)).toBeCloseTo(1 / Math.log(2), 6);
    expect(bodyParts('worm')[1].speed).toBeCloseTo(ENEMY_TYPES['worm'].baseSpeed * meanRush(ENEMY_TYPES['worm'].chain!.rush), 9);
  });
});

describe('sizeWave before any tower stands', () => {
  it('gives every enemy the row strength as HP factor', () => {
    const sized = sizeWave(base({ strength: 0.75, defense: { dps: undefined, damageMetres: undefined, hpRemaining: 500 } }));
    expect(sized.hpMult['zombie']).toBe(0.75);
  });
});
