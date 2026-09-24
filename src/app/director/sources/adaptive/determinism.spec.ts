import { describe, it, expect } from 'vitest';

import { AdaptiveWaveSource } from './adaptive-source';
import { adaptDirectorWave } from '../../wave-config-adapter';
import { createEmptySnapshot, type GameStateSnapshot } from '../../models/game-state-snapshot';
import type { WaveResult } from '../../models/wave-result';
import { GameRng } from '../../../utils/game-rng';
import { drawSpawnGap } from '../../../managers/wave.manager';

/**
 * Stage 1 of the determinism ladder (BALANCING_PLAN.md, section 5): the same
 * seed plans the same waves and schedules the same spawns, as long as the run
 * takes the same course.
 *
 * What this cannot promise: identical outcomes. The survivability cap and the
 * pressure loop read the defense and the HP lost, and line of sight hangs on the
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
  const random = rng.stream('director');
  const spawn = rng.stream('spawn');
  // Through the source, not through the pieces: a checksum that rebuilds the
  // pipeline by hand can drift away from the one the game runs, and it did
  // (docs/WAVE_SOURCE_PLAN.md, R2 and the tie-break that followed).
  const source = new AdaptiveWaveSource();
  const lines: string[] = [];

  for (let wave = 1; wave <= waves; wave++) {
    const { config } = source.plan({ wave, state: stateForWave(wave - 1), random });

    const schedule = adaptDirectorWave(config, spawn).schedule;
    const entries = schedule.entries.map((e) => e.enemyType).join(',');
    const delays = Array.from({ length: 5 }, () => drawSpawnGap(schedule, spawn)).join('/');
    lines.push(`${wave}|${config.templateIdx}|${config.totalCount}|${config.spawnDelay}|${entries}|${delays}`);

    source.onWaveResult({
      waveNumber: wave,
      timestamp: 0,
      config: { enemies: [], totalCount: 10, spawnDelay: 500 },
      outcome: {
        damageToPlayer: wave % 4,
        healthAtWaveStart: 100,
        enemiesSpawned: 10,
        playerSurvived: true,
      },
    } as unknown as WaveResult);
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
