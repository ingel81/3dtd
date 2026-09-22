import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { decideWave } from './director-rules';
import { PressureController, wavePressure } from './pressure-controller';
import { buildWaveContext } from './wave-context';
import { buildWaveConfig } from './wave-config-builder';
import { createEmptySnapshot, type GameStateSnapshot } from './models/game-state-snapshot';
import { bossVariantForWave, bossVariantWave } from '../configs/boss-variants.config';

/**
 * Reference run: waves 1 to 60 out of fixed states with an injected random
 * source, against the checked-in `wave-reference.json`.
 *
 * This is the acceptance test of the balancing rebuild (BALANCING_PLAN.md,
 * Phase 1). Renaming, moving files and deleting the training leftovers must
 * not change a single wave; this spec is what says so. It deliberately drives
 * the pieces the way `GameLoopFacadeService` does — context, director, pressure
 * loop, builder, boss rotation — rather than the Angular service, so it needs no
 * injector and no DOM.
 *
 * Regenerate deliberately, and only when a wave change is intended:
 *
 *   UPDATE_WAVE_REFERENCE=1 npx vitest run src/app/director/wave-reference.spec.ts
 *
 * The diff of the JSON is then the review: it shows every wave that moved.
 */

const REFERENCE_PATH = resolve(__dirname, 'wave-reference.json');

/** Templates the director's cooldown remembers, as WaveDirector keeps it. */
const TEMPLATE_HISTORY = 5;

/** mulberry32: small, seeded, and stable across engines. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The defense the reference run plays against: it grows with the wave number
 * on a fixed curve, so the fairness cap and the DPS ramp both move through the
 * run without any of it depending on a real game.
 */
function stateForWave(waveNumber: number): GameStateSnapshot {
  const snapshot = createEmptySnapshot();
  const dps = 120 + 90 * waveNumber;
  const perArmor = { unarmored: dps, light: dps * 0.9, heavy: dps * 0.7, fortified: dps * 0.5, ethereal: dps * 0.6 };
  snapshot.waveNumber = waveNumber;
  snapshot.player.lives = Math.max(20, 100 - waveNumber);
  snapshot.defense.totalDPS = dps;
  snapshot.defense.effectiveDPSPerArmor = { ground: perArmor, air: perArmor };
  snapshot.defense.gateDpsPerArmor = { ground: perArmor, air: perArmor };
  snapshot.defense.killThroughput = { ground: 2 + waveNumber * 0.4, air: 1 + waveNumber * 0.3 };
  snapshot.defense.capabilities = {
    hasAntiAir: waveNumber >= 6,
    hasSplash: waveNumber >= 8,
    hasSlow: waveNumber >= 10,
    hasDoT: waveNumber >= 12,
    hasAntiEthereal: waveNumber >= 14,
  };
  return snapshot;
}

/** HP pattern fed back into the loop: fixed, so it moves reproducibly. */
function hpLost(wave: number): number {
  return wave % 4 === 0 ? 3 : wave % 3 === 0 ? 1 : 0;
}

interface ReferenceWave {
  wave: number;
  template: string;
  count: number;
  spawnDelay: number;
  variation: number;
  strength: number;
  pattern: string | null;
  enemies: string[];
}

function runReference(): ReferenceWave[] {
  const pressure = new PressureController();
  const random = rng(20260920);
  const recent: number[] = [];
  const waves: ReferenceWave[] = [];

  for (let wave = 1; wave <= 60; wave++) {
    const state = stateForWave(wave - 1);
    const context = buildWaveContext(state, recent);
    const decision = decideWave(context.candidates, wave, recent, random);
    let config = buildWaveConfig(decision, state, context.candidateReason, pressure);

    recent.push(config.templateIdx);
    if (recent.length > TEMPLATE_HISTORY) recent.shift();

    // The facade swaps in a boss variant past the campaign, so the reference
    // covers the rotation too.
    const variant = bossVariantForWave(wave);
    if (variant) config = { ...bossVariantWave(variant, config, wave), templateIdx: config.templateIdx };

    waves.push({
      wave,
      template: config.templateName ?? '?',
      count: config.totalCount,
      spawnDelay: config.spawnDelay,
      variation: config.spawnDelayVariation ?? 0,
      strength: config.templateStrength ?? 0,
      pattern: config.pattern ?? null,
      enemies: config.enemies.map((e) => `${e.type}x${e.count}@${e.healthMultiplier}`),
    });

    pressure.recordWave(wavePressure(hpLost(wave), 100, 10), wave);
  }

  return waves;
}

describe('wave reference run', () => {
  it('plans waves 1 to 60 exactly as the checked-in reference', () => {
    const waves = runReference();

    if (process.env['UPDATE_WAVE_REFERENCE'] === '1' || !existsSync(REFERENCE_PATH)) {
      writeFileSync(REFERENCE_PATH, `${JSON.stringify(waves, null, 2)}\n`, 'utf8');
    }

    const expected = JSON.parse(readFileSync(REFERENCE_PATH, 'utf8')) as ReferenceWave[];
    expect(waves).toEqual(expected);
  });

  it('is reproducible: the same seed twice gives the same waves', () => {
    expect(runReference()).toEqual(runReference());
  });
});
