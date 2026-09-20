import { describe, it, expect } from 'vitest';

import { decideWave } from './director-rules';
import { LeakController, leakRatio } from './leak-controller';
import { buildWaveContext } from './wave-context';
import { buildWaveConfig } from './wave-config-builder';
import { adaptDirectorWave } from './wave-config-adapter';
import { createEmptySnapshot, type GameStateSnapshot } from './models/game-state-snapshot';
import { GameRng } from '../utils/game-rng';

/**
 * Stage 1 of the determinism ladder (BALANCING_PLAN.md, section 5): the same
 * seed plans the same waves and schedules the same spawns, as long as the run
 * takes the same course.
 *
 * What this cannot promise: identical outcomes. The survivability cap and the
 * leak loop read the defense and the leaks, and line of sight hangs on the
 * frame, so two live runs diverge from the first difference on. Here the
 * course is fixed, which is exactly what makes the random source measurable.
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
    hasAntiAir: waveNumber >= 6, hasSplash: true, hasSlow: true, hasDoT: true,
    hasAntiEthereal: waveNumber >= 14,
  };
  return snapshot;
}

/** One line per wave: what was decided, and the spawns it turned into. */
function runChecksum(seed: number, waves = 25): string[] {
  const rng = new GameRng(seed);
  const director = rng.stream('director');
  const spawn = rng.stream('spawn');
  const leak = new LeakController();
  const recent: number[] = [];
  const lines: string[] = [];

  for (let wave = 1; wave <= waves; wave++) {
    const state = stateForWave(wave - 1);
    const context = buildWaveContext(state, recent);
    const decision = decideWave(context.candidates, wave, recent, director);
    const config = buildWaveConfig(decision, state, context.candidateReason, leak);

    recent.push(config.templateIdx);
    if (recent.length > 5) recent.shift();

    const schedule = adaptDirectorWave(config, spawn).schedule;
    const entries = schedule.entries.map((e) => e.enemyType).join(',');
    const delays = Array.from({ length: 5 }, () => schedule.getDelay?.() ?? schedule.baseDelay).join('/');
    lines.push(`${wave}|${config.templateIdx}|${config.totalCount}|${config.spawnDelay}|${entries}|${delays}`);

    leak.recordWave(leakRatio(Array.from({ length: 10 }, (_, i) => (i < wave % 4 ? 1 : 0.2)), 0), true);
  }
  return lines;
}

describe('seeded runs', () => {
  it('plans the same waves and spawns twice for the same seed', () => {
    expect(runChecksum(20260920)).toEqual(runChecksum(20260920));
  });

  it('plans differently for a different seed', () => {
    expect(runChecksum(20260920)).not.toEqual(runChecksum(20260921));
  });

  it('keeps the bot stream out of the waves', () => {
    // A bot that decides differently draws from its own stream. If that moved
    // the enemies, an A/B run would measure the random source, not the rule.
    const rng = new GameRng(5);
    const bot = rng.stream('bot');
    for (let i = 0; i < 100; i++) bot();
    const director = rng.stream('director');
    const fresh = new GameRng(5).stream('director');
    expect(Array.from({ length: 10 }, () => director()))
      .toEqual(Array.from({ length: 10 }, () => fresh()));
  });
});
