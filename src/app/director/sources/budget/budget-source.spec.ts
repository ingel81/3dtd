import { describe, expect, it } from 'vitest';
import { BudgetWaveSource, BUDGET_REGULATOR_LIMITS } from './budget-source';
import { planRowForWave } from './run-plan';
import { budgetSeconds } from './budget';
import { WAVE_MUTATORS } from '../../../configs/wave-mutators.config';
import { createEmptySnapshot, type GameStateSnapshot } from '../../models/game-state-snapshot';
import type { WaveResult } from '../../models/wave-result';

const flat = (v: number) => ({ unarmored: v, light: v, heavy: v, fortified: v, ethereal: v });

function state(wave: number, dps = 2000): GameStateSnapshot {
  const s = createEmptySnapshot();
  s.waveNumber = wave - 1;
  s.defense.effectiveDPSPerArmor = { ground: flat(dps), air: flat(dps) };
  s.defense.damageMetres = { ground: flat(dps * 300), air: flat(dps * 300) };
  s.player.lives = 500;
  return s;
}

const plan = (source: BudgetWaveSource, wave: number, dps?: number) =>
  source.plan({ wave, state: state(wave, dps), random: () => 0.5 });

function result(wave: number, hpLost: number): WaveResult {
  return { waveNumber: wave, outcome: { damageToPlayer: hpLost, healthAtWaveStart: 500, enemiesSpawned: 50 } } as unknown as WaveResult;
}

describe('BudgetWaveSource', () => {
  it('sends the plan row as written, only the HP set against the defense', () => {
    const wave = plan(new BudgetWaveSource(), 12);
    const row = planRowForWave(12)!;
    expect(Object.fromEntries(wave.config.enemies.map((g) => [g.type, g.count]))).toEqual(row.enemies);
    expect(wave.config.spawnDelay).toBe(row.spawnDelay);
    expect(wave.config.enemies.every((g) => (g.healthMultiplier ?? 0) > 0)).toBe(true);
  });

  it('sends a Swift wave faster, with its budget cut by the mutator', () => {
    const swift = plan(new BudgetWaveSource(), 14);
    expect(swift.config.enemies.every((g) => g.speedMultiplier === WAVE_MUTATORS.swift.speed)).toBe(true);
    const expected = budgetSeconds(14) * planRowForWave(14)!.strength * WAVE_MUTATORS.swift.budget!;
    expect(swift.log.diagnostics?.['budget']).toBeCloseTo(expected, 0);
    expect(swift.log.diagnostics?.['mutator']).toBe('swift');
    expect(swift.explanation!.reasons.some((r) => r.includes(WAVE_MUTATORS.swift.name))).toBe(true);

    const plain = plan(new BudgetWaveSource(), 13);
    expect(plain.config.enemies.every((g) => g.speedMultiplier === undefined)).toBe(true);
    expect(plain.log.diagnostics?.['mutator']).toBeNull();
  });

  it('plans a boss wave the same way as any other', () => {
    const boss = plan(new BudgetWaveSource(), 30);
    expect(boss.config.templateName).toBe(planRowForWave(30)!.name);
    expect(boss.log.diagnostics?.['budget']).toBeGreaterThan(0);
  });

  it('gives a stronger defense tougher enemies', () => {
    const weak = plan(new BudgetWaveSource(), 15, 1000).config.enemies[0].healthMultiplier!;
    const strong = plan(new BudgetWaveSource(), 15, 4000).config.enemies[0].healthMultiplier!;
    expect(strong).toBeGreaterThan(weak);
  });

  it('opens the budget after waves that cost nothing, up to its stop, and forgets it on reset', () => {
    const source = new BudgetWaveSource();
    const before = plan(source, 26).log.diagnostics!['budget'] as number;
    for (let w = 1; w <= 30; w++) source.onWaveResult(result(w, 0));
    const after = source.plan({ wave: 26, state: state(26), random: () => 0.5 });
    expect(after.log.pressureMultiplier).toBe(BUDGET_REGULATOR_LIMITS.max);
    expect(after.log.diagnostics!['budget'] as number).toBeCloseTo(before * BUDGET_REGULATOR_LIMITS.max, 0);
    source.reset();
    expect(plan(source, 20).log.pressureMultiplier).toBe(1);
  });

  it('sizes the committed wave again at its start: same enemies, HP against the defense built in the break', () => {
    const source = new BudgetWaveSource();
    const planned = plan(source, 15, 1000);
    const started = source.sizeAtStart(planned, { wave: 15, state: state(15, 1500), random: () => 0.5 });
    expect(started.config.enemies.map((g) => [g.type, g.count])).toEqual(planned.config.enemies.map((g) => [g.type, g.count]));
    expect(started.config.spawnDelay).toBe(planned.config.spawnDelay);
    expect(started.config.enemies[0].healthMultiplier!).toBeGreaterThan(planned.config.enemies[0].healthMultiplier!);
    expect(() => source.sizeAtStart(planned, { wave: 16, state: state(16), random: () => 0.5 })).toThrow();
  });

  it('peeks every coming wave by its row', () => {
    const facts = new BudgetWaveSource().peek({ fromWave: 9, count: 3 });
    expect(facts.map((f) => f.wave)).toEqual([9, 10, 11]);
    expect(facts[1].boss).toBe(true);
    expect(facts.every((f) => f.known && f.count !== null)).toBe(true);
  });

  it('lays out the loop, the budget, the defense and each type for the wave debug window', () => {
    const wave = plan(new BudgetWaveSource(), 12);
    const b = wave.explanation!.budget!;
    expect(b.row).toBe(12);
    expect(b.regulator).toBe(1);
    expect([b.regulatorMin, b.regulatorMax]).toEqual([BUDGET_REGULATOR_LIMITS.min, BUDGET_REGULATOR_LIMITS.max]);
    expect(b.budget).toBeCloseTo(wave.log.diagnostics!['budget'] as number, 1);
    expect(b.types.map((t) => t.type)).toEqual(wave.config.enemies.map((g) => g.type));
    for (const t of b.types) {
      const group = wave.config.enemies.find((g) => g.type === t.type)!;
      expect(t.count).toBe(group.count);
      expect(t.hpMult).toBe(group.healthMultiplier);
      if (t.state === 'limit') expect(t.hpMult).toBe(t.limit);
    }
  });
});
