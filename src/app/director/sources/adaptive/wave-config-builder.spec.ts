import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildWaveConfig, type PressureReading } from './wave-config-builder';
import { buildWaveContext } from './wave-context';
import { MAX_WAVE_DURATION_MS, TEMPLATES } from '../../templates';
import { PressureController } from './pressure-controller';
import { createEmptySnapshot, type GameStateSnapshot } from '../../models/game-state-snapshot';
import type { DirectorDecision, DirectorFactors } from './director-rules';
import { directorParams } from '../../director-params';

/**
 * The decoder shared by both directors, from a decision to the wave that
 * ships. The director specs drive it through the service; these pin its
 * sizing rules on their own.
 */

const gate = (pressureMultiplier = 1): PressureReading => ({
  pressureMultiplier,
  status: new PressureController().status,
});

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

  // W15 of the human run on 2026-09-23: the cap did not bind against the
  // template maximum (60), the controller stood at ×8.15, and the push past
  // countRange[1] sent 489 golems against a cap of 221. The push may grow a
  // wave up to the cap, never through it.
  it('never pushes a wave past its survivability cap, however far the controller opened', () => {
    const golems = TEMPLATES.findIndex((t) => t.id === 'golem_squad');
    let checked = 0;
    for (const dps of [200, 500, 1000, 2000, 5000, 10_000, 50_000]) {
      const config = build(decision(golems, { count: 1, hp: 1 }), defense(dps), gate(8.15));
      const reasons = config.explanation!.reasons.join(' ');
      const cap = /Survivability cap (?:is |holds the count at )?(\d+)/.exec(reasons);
      if (!cap) continue;
      checked++;
      expect(config.totalCount).toBeLessThanOrEqual(Math.ceil(Number(cap[1]) * directorParams().capSlack));
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('compresses the spawn delay of a wave that would run past three minutes', () => {
    const config = build(decision(0, { count: 1, spawn: 1 }), defense(1e6));

    expect(config.spawnDelay).toBe(Math.floor(MAX_WAVE_DURATION_MS / config.totalCount));
    expect(config.explanation!.reasons).toContain(
      `Spawn delay compressed to ${config.spawnDelay} ms to keep the wave under 3 min.`,
    );
  });
});

describe('the campaign intensity', () => {
  /** The same defense planning `wave`, so only the campaign's factor differs. */
  function countAt(wave: number): number {
    const state = defense(200);
    state.waveNumber = wave - 1;
    return build(decision(0), state).totalCount;
  }

  it('lowers the count of a wave the campaign marked as lighter', () => {
    // W26 carries 0.6, W24 carries nothing
    expect(countAt(26)).toBeLessThan(countAt(24));
  });

  it('leaves a wave without a factor to the director', () => {
    const state = defense(200);
    state.waveNumber = 23;
    const shipped = build(decision(0), state);

    expect(shipped.totalCount).toBe(shipped.explanation?.sizing?.count);
  });
});
