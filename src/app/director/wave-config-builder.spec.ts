import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildWaveConfig, type LeakReading } from './wave-config-builder';
import { buildWaveContext } from './wave-context';
import { MAX_WAVE_DURATION_MS, TEMPLATES } from './templates';
import { LeakController } from './leak-controller';
import { createEmptySnapshot, type GameStateSnapshot } from './models/game-state-snapshot';
import type { DirectorDecision, DirectorFactors } from './director-rules';

/**
 * The decoder shared by both directors, from a decision to the wave that
 * ships. The director specs drive it through the service; these pin its
 * sizing rules on their own.
 */

const gate = (leakMultiplier = 1): LeakReading => ({ leakMultiplier, status: new LeakController().status });

function decision(templateIdx: number, factors: Partial<DirectorFactors> = {}): DirectorDecision {
  return {
    templateIdx,
    factors: { count: 0.5, spawn: 0.5, hp: 0.5, variation: 0.5, ...factors },
    why: { candidates: 1, lastRanWavesAgo: null, history: 0, tied: 1, ramp: 0.5 },
  };
}

/** Planning wave 41 against a defense dealing `dps` to every armor type, with shots to spare. */
function defense(dps: number, totalDps = 1e6): GameStateSnapshot {
  const snapshot = createEmptySnapshot();
  const perArmor = { unarmored: dps, light: dps, heavy: dps, fortified: dps, ethereal: dps };
  snapshot.waveNumber = 40;
  snapshot.defense.totalDPS = totalDps;
  snapshot.defense.gateDpsPerArmor = { ground: perArmor, air: perArmor };
  snapshot.defense.killThroughput = { ground: 1e6, air: 1e6 };
  return snapshot;
}

const build = (d: DirectorDecision, state: GameStateSnapshot, g = gate()) =>
  buildWaveConfig(d, state, buildWaveContext(state).candidateReason, g);

const HORDE = TEMPLATES[0];

describe('buildWaveConfig', () => {
  afterEach(() => vi.restoreAllMocks());

  it('splits the count over the template groups at one health multiplier', () => {
    const config = build(decision(0), defense(1e6));

    expect(config.templateIdx).toBe(0);
    expect(config.templateName).toBe(HORDE.name);
    expect(config.enemies.map((e) => e.type)).toEqual(HORDE.enemies.map(([type]) => type));
    expect(config.enemies.reduce((s, e) => s + e.count, 0)).toBe(config.totalCount);
    for (const group of config.enemies) expect(group.healthMultiplier).toBe(config.templateStrength);
    expect(config.totalCount).toBeGreaterThanOrEqual(HORDE.countRange[0]);
    expect(config.totalCount).toBeLessThanOrEqual(HORDE.countRange[1]);
  });

  it('reports full confidence: a rule decision has no distribution behind it', () => {
    expect(build(decision(0), defense(1e6)).confidence).toBe(1);
  });

  it('ships slot 0 for an index the template table does not have', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(build(decision(999), defense(1e6)).templateIdx).toBe(0);
    expect(build(decision(-1), defense(1e6)).templateIdx).toBe(0);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('invalid template index 999'));
  });

  it('narrows the count range for a weak defense', () => {
    const strong = build(decision(0, { count: 1 }), defense(1e6, 1e6));
    const weak = build(decision(0, { count: 1 }), defense(1e6, 0));

    expect(strong.totalCount).toBe(HORDE.countRange[1]);
    expect(weak.totalCount).toBeLessThan(strong.totalCount);
  });

  it('ships a bigger wave for a wider gate budget where the cap binds', () => {
    const state = defense(1000);
    const tight = build(decision(0, { count: 1 }), state, gate(1));
    const wide = build(decision(0, { count: 1 }), state, gate(4));

    expect(tight.totalCount).toBeLessThan(HORDE.countRange[1]);
    expect(wide.totalCount).toBeGreaterThan(tight.totalCount);
  });

  it('compresses the spawn delay of a wave that would run past three minutes', () => {
    const config = build(decision(0, { count: 1, spawn: 1 }), defense(1e6));

    expect(config.spawnDelay).toBe(Math.floor(MAX_WAVE_DURATION_MS / config.totalCount));
    expect(config.explanation!.reasons).toContain(
      `Spawn delay compressed to ${config.spawnDelay} ms to keep the wave under 3 min.`,
    );
  });
});
