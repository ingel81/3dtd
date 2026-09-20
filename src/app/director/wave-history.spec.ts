import { describe, it, expect, beforeEach } from 'vitest';
import { WaveHistory } from './wave-history';
import type { WaveConfig } from './models/wave-config';
import type { WaveOutcome, WaveResult } from './models/wave-result';

const ZOMBIES: WaveConfig = { enemies: [{ type: 'zombie', count: 10 }], totalCount: 10, spawnDelay: 800 };

function wave(n: number, outcome: Partial<WaveOutcome> = {}, config = ZOMBIES): WaveResult {
  return {
    waveNumber: n,
    timestamp: 0,
    config,
    outcome: {
      damagePercent: 0,
      avgPathProgressPercent: 0,
      enemyProgressValues: [],
      waveDurationMs: 1000,
      wasCloseCall: false,
      ...outcome,
    } as WaveOutcome,
  };
}

describe('WaveHistory', () => {
  let history: WaveHistory;

  beforeEach(() => {
    history = new WaveHistory();
  });

  it('keeps the last ten waves and hands out copies', () => {
    for (let n = 1; n <= 12; n++) history.add(wave(n));

    expect(history.all().map((r) => r.waveNumber)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(history.recent(3).map((r) => r.waveNumber)).toEqual([10, 11, 12]);
    history.all().pop();
    expect(history.all()).toHaveLength(10);
    expect(history.summary().damagePerWave).toHaveLength(10);
  });

  it('summarises damage, progress, near misses, types and threat per wave', () => {
    const tanks: WaveConfig = { enemies: [{ type: 'tank', count: 2 }], totalCount: 2, spawnDelay: 400 };
    history.add(wave(1, { damagePercent: 0.2, avgPathProgressPercent: 0.5, enemyProgressValues: [0.5, 0.85, 1] }));
    history.add(wave(2, { avgPathProgressPercent: 0.9, enemyProgressValues: [0.8, 0.9], waveDurationMs: 3000 }, tanks));

    const summary = history.summary();

    expect(summary.damagePerWave).toEqual([0.2, 0]);
    expect(summary.progressPerWave).toEqual([0.5, 0.9]);
    // Strictly above 0.8.
    expect(summary.nearMissPerWave).toEqual([2 / 3, 0.5]);
    expect(summary.enemyTypesUsed).toEqual([['zombie'], ['tank']]);
    expect(summary.avgWaveDuration).toBe(2);
  });

  it('counts the trailing waves without damage and the trailing close calls', () => {
    history.add(wave(1, { damagePercent: 0.1, wasCloseCall: false }));
    history.add(wave(2, { wasCloseCall: true }));
    history.add(wave(3, { wasCloseCall: true }));

    expect(history.summary()).toMatchObject({ winStreak: 2, closeCallStreak: 2 });
  });

  it('is empty after clear', () => {
    history.add(wave(1, { damagePercent: 0.3 }));
    history.clear();

    expect(history.all()).toEqual([]);
    expect(history.summary()).toEqual({
      damagePerWave: [],
      progressPerWave: [],
      nearMissPerWave: [],
      enemyTypesUsed: [],
      avgWaveDuration: 0,
      winStreak: 0,
      closeCallStreak: 0,
    });
  });
});
