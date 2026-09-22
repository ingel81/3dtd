import { describe, it, expect, beforeEach } from 'vitest';

import { WAVE_SOURCES } from './wave-source.registry';
import { MAX_WAVE_DURATION_MS, MIN_SPAWN_DELAY_MS } from './templates';
import { createEmptySnapshot, type GameStateSnapshot } from './models/game-state-snapshot';
import type { WaveResult } from './models/wave-result';
import type { WaveSource, WaveSourceId } from './wave-source';
import { ENEMY_TYPES, type EnemyTypeId } from '../configs/enemy-types.config';
import { campaignIntensity } from '../configs/campaign.config';
import { mulberry32 } from '../utils/game-rng';

/**
 * What every wave source has to do, whatever it is. A new source is finished
 * when it passes this file.
 *
 * It runs over the registry, so an implementation cannot be added without
 * being held to it (docs/WAVE_SOURCE_PLAN.md, section 10).
 *
 * The waves are planned against a defense that grows with the wave number,
 * the same shape the reference run uses: a source that reads the defense sees
 * it move, one that does not is unaffected.
 */

const SEED = 20260922;

function stateForWave(wave: number): GameStateSnapshot {
  const snapshot = createEmptySnapshot();
  const dps = 120 + 90 * wave;
  const perArmor = { unarmored: dps, light: dps * 0.9, heavy: dps * 0.7, fortified: dps * 0.5, ethereal: dps * 0.6 };
  snapshot.waveNumber = wave - 1;
  snapshot.player.lives = Math.max(20, 100 - wave);
  snapshot.defense.totalDPS = dps;
  snapshot.defense.effectiveDPSPerArmor = { ground: perArmor, air: perArmor };
  snapshot.defense.gateDpsPerArmor = { ground: perArmor, air: perArmor };
  snapshot.defense.killThroughput = { ground: 2 + wave * 0.4, air: 1 + wave * 0.3 };
  snapshot.defense.capabilities = {
    hasAntiAir: wave >= 6,
    hasSplash: wave >= 8,
    hasSlow: wave >= 10,
    hasDoT: wave >= 12,
    hasAntiEthereal: wave >= 14,
  };
  return snapshot;
}

function waveResult(wave: number): WaveResult {
  return {
    waveNumber: wave,
    timestamp: 0,
    config: { enemies: [], totalCount: 10, spawnDelay: 500 },
    outcome: {
      damageToPlayer: wave % 4 === 0 ? 3 : 0,
      healthAtWaveStart: 100,
      enemiesSpawned: 10,
      playerSurvived: true,
    },
  } as WaveResult;
}

/** Waves 1 to `last`, each planned and then reported as finished. */
function playRun(source: WaveSource, last = 40): ReturnType<WaveSource['plan']>[] {
  const random = mulberry32(SEED);
  const planned = [];
  for (let wave = 1; wave <= last; wave++) {
    planned.push(source.plan({ wave, state: stateForWave(wave), random }));
    source.onWaveResult(waveResult(wave));
  }
  return planned;
}

describe.each(Object.keys(WAVE_SOURCES) as WaveSourceId[])('wave source contract: %s', (id) => {
  let source: WaveSource;

  beforeEach(() => {
    source = WAVE_SOURCES[id]();
  });

  it('names itself', () => {
    expect(source.id).toBe(id);
    expect(source.name.length).toBeGreaterThan(0);
    expect(['wave-end', 'wave-start']).toContain(source.plansAt);
  });

  it('plans the wave it was asked for', () => {
    for (const wave of [1, 7, 30, 31, 35, 60]) {
      expect(source.plan({ wave, state: stateForWave(wave), random: mulberry32(SEED) }).wave).toBe(wave);
    }
  });

  it('ships a wave that can actually spawn', () => {
    for (const planned of playRun(source)) {
      const { config } = planned;
      expect(config.totalCount).toBeGreaterThanOrEqual(1);
      expect(config.enemies.length).toBeGreaterThanOrEqual(1);
      expect(config.enemies.reduce((sum, group) => sum + group.count, 0)).toBe(config.totalCount);
      for (const group of config.enemies) {
        expect(group.count).toBeGreaterThanOrEqual(1);
        expect(ENEMY_TYPES[group.type as EnemyTypeId]).toBeDefined();
      }
    }
  });

  it('keeps the spawn delay and the wave duration in their limits', () => {
    for (const { wave, config } of playRun(source)) {
      // A wave with one enemy in it has nothing to space out: the boss waves
      // of the rotation ship with a delay of 0 and that is correct.
      const floor = config.totalCount > 1 ? MIN_SPAWN_DELAY_MS : 0;
      expect(config.spawnDelay, `wave ${wave}`).toBeGreaterThanOrEqual(floor);
      // The duration cap is applied before the campaign's intensity scales the
      // count, so a wave meant to lean harder may run over it by that factor
      // (docs/WAVE_SOURCE_PLAN.md, R4).
      const slack = Math.max(1, campaignIntensity(wave));
      expect(config.totalCount * config.spawnDelay).toBeLessThanOrEqual(MAX_WAVE_DURATION_MS * slack);
    }
  });

  it('plans the same run twice from the same seed', () => {
    const first = playRun(source);
    const second = playRun(WAVE_SOURCES[id]());
    expect(second.map((p) => p.config)).toEqual(first.map((p) => p.config));
  });

  it('starts over on reset', () => {
    const before = playRun(source, 12);
    source.reset();
    const after = playRun(source, 12);
    expect(after.map((p) => p.config)).toEqual(before.map((p) => p.config));
  });

  it('explains every wave it plans', () => {
    for (const { wave, explanation } of playRun(source, 12)) {
      expect(explanation, `wave ${wave}`).not.toBeNull();
      expect(explanation!.summary.length).toBeGreaterThan(0);
      expect(explanation!.reasons.length).toBeGreaterThan(0);
    }
  });

  describe('the waves ahead', () => {
    const request = (fromWave: number, count: number) =>
      ({ fromWave, count, defense: { totalDps: 400 } });

    it('answers as many as asked, in order, from the wave asked for', () => {
      const facts = source.peek(request(5, 5));
      expect(facts.map((f) => f.wave)).toEqual([5, 6, 7, 8, 9]);
    });

    it('answers the same twice and does not disturb the next plan', () => {
      const first = source.peek(request(5, 5));
      expect(source.peek(request(5, 5))).toEqual(first);

      const planned = source.plan({ wave: 5, state: stateForWave(5), random: mulberry32(SEED) });
      const fresh = WAVE_SOURCES[id]();
      const expected = fresh.plan({ wave: 5, state: stateForWave(5), random: mulberry32(SEED) });
      expect(planned.config).toEqual(expected.config);
    });

    it('says what it knows without inventing numbers', () => {
      for (const fact of source.peek(request(1, 40))) {
        expect(fact.name.length).toBeGreaterThan(0);
        if (fact.count) {
          expect(fact.count.lo).toBeGreaterThanOrEqual(1);
          expect(fact.count.hi).toBeGreaterThanOrEqual(fact.count.lo);
          expect(fact.count.max).toBeGreaterThanOrEqual(fact.count.hi);
        }
        // A wave it does not know carries no armor, enemies or count either.
        if (!fact.known) {
          expect(fact.count).toBeNull();
          expect(fact.enemies).toEqual([]);
          expect(fact.hpByArmor).toEqual([]);
        }
      }
    });

    /**
     * A source that commits the next wave at the end of the previous one has
     * to be able to name it, or the commitment buys the player nothing.
     */
    it('knows the next wave when it commits it at wave end', () => {
      if (source.plansAt !== 'wave-end') return;
      playRun(source, 3);
      expect(source.peek(request(4, 1))[0].known).toBe(true);
    });
  });
});
