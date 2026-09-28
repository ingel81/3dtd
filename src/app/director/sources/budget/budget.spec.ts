import { describe, expect, it } from 'vitest';
import { budgetSeconds, enemyHp, sizeWave, BUDGET_REALISM, SURE_KILL_SHARE, UNDER_FIRE_SHARE, type BudgetInput } from './budget';
import type { EffectiveDPSPerArmor } from '../../models/game-state-snapshot';
import { ENEMY_TYPES } from '../../../configs/enemy-types.config';

const flat = (v: number) => ({ unarmored: v, light: v, heavy: v, fortified: v, ethereal: v });
const dps = (ground: number, air = ground): EffectiveDPSPerArmor => ({ ground: flat(ground), air: flat(air) });

const base = (over: Partial<BudgetInput> = {}): BudgetInput => ({
  wave: 20,
  enemies: { zombie: 100 },
  strength: 1,
  spawnDelayMs: 1000,
  regulator: 1,
  targetPressure: 0.05,
  leakScale: 1,
  defense: { dps: dps(1000), metersUnderFire: { ground: 400, air: 400 }, hpRemaining: 300 },
  ...over,
});

/** Seconds of defense damage the sized wave costs. */
const cost = (input: BudgetInput, hpMult: Readonly<Record<string, number>>) =>
  Object.entries(input.enemies).reduce((sum, [type, n]) => sum + (n * enemyHp(type) * hpMult[type]) / (1000 * BUDGET_REALISM), 0);

describe('budget curve', () => {
  it('starts at 15 s, rises steadily and flattens towards 100 s', () => {
    expect(budgetSeconds(1)).toBe(15);
    for (let w = 2; w <= 120; w++) expect(budgetSeconds(w)).toBeGreaterThan(budgetSeconds(w - 1));
    expect(budgetSeconds(120)).toBeLessThan(100);
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
    const strong = sizeWave(base({ defense: { ...base().defense, dps: dps(2000) } }));
    expect(strong.hpMult['zombie']).toBeCloseTo(weak.hpMult['zombie'] * 2, 2);
  });

  it('holds an enemy at what the defense deals while it is under fire', () => {
    // One worm, a short stretch under fire: it would take far more than that
    const input = base({ enemies: { worm: 1 }, spawnDelayMs: 0, targetPressure: 10, defense: { dps: dps(50000), metersUnderFire: { ground: 20, air: 20 }, hpRemaining: 300 } });
    const sized = sizeWave(input);
    const fire = 20 / ENEMY_TYPES['worm'].baseSpeed;
    expect(sized.clamped).toEqual(['worm']);
    expect((enemyHp('worm') * sized.hpMult['worm']) / (50000 * BUDGET_REALISM)).toBeCloseTo(UNDER_FIRE_SHARE * fire, 1);
  });

  it('gives the rest of the budget to the others when one type is at its limit', () => {
    const sized = sizeWave(base({ enemies: { worm: 1, skeleton: 300 }, spawnDelayMs: 400, defense: { dps: dps(50000), metersUnderFire: { ground: 60, air: 60 }, hpRemaining: 300 } }));
    expect(sized.clamped).toContain('worm');
    expect(sized.hpMult['skeleton']).toBeGreaterThan(sized.hpMult['worm']);
  });

  it('cuts the budget to the time on the route plus the leaks the curve allows', () => {
    const short = sizeWave(base({ enemies: { zombie: 10 }, spawnDelayMs: 100, defense: { dps: dps(1000), metersUnderFire: { ground: 30, air: 30 }, hpRemaining: 300 } }));
    expect(short.capped).toBe(true);
    expect(short.delivered).toBeLessThan(short.budget);
    const moreHp = sizeWave(base({ enemies: { zombie: 10 }, spawnDelayMs: 100, defense: { dps: dps(1000), metersUnderFire: { ground: 30, air: 30 }, hpRemaining: 3000 } }));
    expect(moreHp.delivered).toBeGreaterThan(short.delivered);
  });

  it('leaves enemies the defense cannot hurt at HP ×1', () => {
    const sized = sizeWave(base({ enemies: { bat: 20, zombie: 50 }, defense: { dps: dps(1000, 0), metersUnderFire: { ground: 400, air: 400 }, hpRemaining: 300 } }));
    expect(sized.unhurt).toEqual(['bat']);
    expect(sized.hpMult['bat']).toBe(1);
    expect(sized.hpMult['zombie']).toBeGreaterThan(1);
  });

  it('answers without a defense', () => {
    const sized = sizeWave(base({ defense: { dps: undefined, metersUnderFire: undefined, hpRemaining: 500 } }));
    expect(sized.hpMult['zombie']).toBe(1);
  });
});

describe('sizeWave, an enemy whose one leak costs more than the wave may', () => {
  it('gets only the sure-kill share of the damage under fire', () => {
    const defense = { dps: dps(50000), metersUnderFire: { ground: 30, air: 30 }, hpRemaining: 300 };
    const cheap = sizeWave(base({ enemies: { worm: 1 }, spawnDelayMs: 0, targetPressure: 10, defense }));
    const dear = sizeWave(base({ enemies: { worm: 1 }, spawnDelayMs: 0, targetPressure: 0.0001, defense }));
    expect(dear.hpMult['worm']).toBeCloseTo((cheap.hpMult['worm'] * SURE_KILL_SHARE) / UNDER_FIRE_SHARE, 2);
  });
});
