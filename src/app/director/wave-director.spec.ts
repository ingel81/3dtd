import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';

import { WaveDirector } from './wave-director';
import { StateSnapshotService } from './state-snapshot.service';
import { MAX_WAVE_DURATION_MS, MIN_SPAWN_DELAY_MS, TEMPLATES } from './templates';
import { LEAK_ADAPT_WINDOW } from './leak-controller';
import { createEmptySnapshot, type GameStateSnapshot } from './models/game-state-snapshot';
import type { WaveConfig } from './models/wave-config';
import type { WaveResult } from './models/wave-result';

/**
 * Characterization of the director's public surface that leak-wiring.spec and
 * decision-explainer.spec leave alone: the rule path's bookkeeping and the
 * knobs the debug window turns.
 */

class StubCollector {
  snapshot: GameStateSnapshot = createEmptySnapshot();
  setCurrentWaveConfig = vi.fn<(config: WaveConfig) => void>();
  onWaveResult(): () => void {
    return () => undefined;
  }
  getStateSnapshot(): GameStateSnapshot {
    return this.snapshot;
  }
}

/** A defense strong enough that the fairness gate has no finite cap. */
function overwhelmingDefense(snapshot: GameStateSnapshot, waveNumber: number): void {
  const dps = { unarmored: 1e6, light: 1e6, heavy: 1e6, fortified: 1e6, ethereal: 1e6 };
  snapshot.waveNumber = waveNumber;
  snapshot.defense.totalDPS = 1e6;
  snapshot.defense.effectiveDPSPerArmor = { ground: dps, air: dps };
  snapshot.defense.gateDpsPerArmor = { ground: dps, air: dps };
  snapshot.defense.killThroughput = { ground: 1e6, air: 1e6 };
  snapshot.defense.capabilities = {
    hasAntiAir: true, hasSplash: true, hasSlow: true, hasDoT: true, hasAntiEthereal: true,
  };
}

function waveResult(outcome: Partial<WaveResult['outcome']>): WaveResult {
  return {
    waveNumber: 1,
    timestamp: 0,
    config: { enemies: [], totalCount: 0, spawnDelay: 500 },
    outcome,
  } as WaveResult;
}

describe('WaveDirector', () => {
  let collector: StubCollector;
  let director: WaveDirector;

  beforeEach(() => {
    collector = new StubCollector();
    const injector = Injector.create({ providers: [{ provide: StateSnapshotService, useValue: collector }] });
    director = runInInjectionContext(injector, () => new WaveDirector());

    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('starts without a decision and without debug logging', () => {
      expect(director.lastDecision()).toBeNull();
      expect(director.isDebugMode()).toBe(false);
    });
  });

  describe('rule path', () => {
    it('ships the pinned campaign template for wave 1 and records the decision', async () => {
      const config = await director.getNextWave();

      expect(config.templateIdx).toBe(0);
      expect(config.templateName).toBe(TEMPLATES[0].name);
      expect(config.confidence).toBe(1);
      expect(config.enemies.map((e) => e.type)).toEqual(TEMPLATES[0].enemies.map(([type]) => type));
      expect(config.enemies.reduce((s, e) => s + e.count, 0)).toBe(config.totalCount);
      for (const group of config.enemies) expect(group.healthMultiplier).toBe(config.templateStrength);
      expect(config.spawnDelay).toBeGreaterThanOrEqual(MIN_SPAWN_DELAY_MS);

      expect(director.lastDecision()).toBe(config);
      expect(collector.setCurrentWaveConfig).toHaveBeenCalledWith(config);
      expect(director.decisionTimeMs()).toBeGreaterThanOrEqual(0);
    });

    it('does not repeat a template on consecutive free waves', async () => {
      overwhelmingDefense(collector.snapshot, 40);
      const picks: number[] = [];
      for (let i = 0; i < 6; i++) picks.push((await director.getNextWave()).templateIdx!);
      for (let i = 1; i < picks.length; i++) expect(picks[i]).not.toBe(picks[i - 1]);
    });

    it('remembers the last five templates and forgets them on a new game', async () => {
      overwhelmingDefense(collector.snapshot, 40);
      for (let i = 0; i < 7; i++) await director.getNextWave();
      const capped = (await director.getNextWave()).explanation!.reasons[0];
      expect(capped).toMatch(/in the last 5 waves/);

      director.resetForNewGame();
      const fresh = (await director.getNextWave()).explanation!.reasons[0];
      expect(fresh).toMatch(/no history yet/);
    });

    it('keeps every wave inside the duration cap', async () => {
      overwhelmingDefense(collector.snapshot, 40);
      for (let i = 0; i < 10; i++) {
        const config = await director.getNextWave();
        const withinCap = config.totalCount * config.spawnDelay <= MAX_WAVE_DURATION_MS;
        expect(withinCap || config.spawnDelay === MIN_SPAWN_DELAY_MS).toBe(true);
      }
    });

    it('plans from the counter alone: after a dev jump to W35 a boss wave, gate and history kept', async () => {
      // The jump only moves the counter (snapshot waveNumber 34, next wave 35).
      // The gate's leak window and the template history stay as they were.
      director.onWaveCompleted(waveResult({ enemyProgressValues: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0], playerSurvived: true }));
      overwhelmingDefense(collector.snapshot, 12);
      const before = (await director.getNextWave()).templateIdx!;
      const gateBefore = director.leak.status;

      overwhelmingDefense(collector.snapshot, 34);
      const config = await director.getNextWave();
      expect(TEMPLATES[config.templateIdx!].bossOnly).toBe(true);
      expect(config.templateIdx).not.toBe(before);
      expect(director.leak.status).toEqual(gateBefore);
    });

    it('does not log wave decisions outside debug mode', async () => {
      await director.getNextWave();
      expect(console.log).not.toHaveBeenCalled();
    });
  });

  describe('completed waves', () => {
    /** Fill the gate's window with waves that leak 10%, inside the target band. */
    function fillInBand(): void {
      const tenPercent = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (let i = 0; i < LEAK_ADAPT_WINDOW; i++) {
        director.onWaveCompleted(waveResult({ enemyProgressValues: tenPercent, playerSurvived: true }));
      }
    }

    it('treats a wave without per-enemy progress as no sample', () => {
      director.onWaveCompleted(waveResult({}));
      expect(director.leak.status.samples).toBe(0);
    });

    it('counts a wave with no survival flag as survived', () => {
      fillInBand();
      director.onWaveCompleted(waveResult({ enemyProgressValues: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0] }));
      expect(director.leak.status.lastStep).toBe('held');
      expect(director.leak.leakMultiplier).toBe(1);
    });

    it('logs the result and the gate in debug mode', () => {
      director.setDebugMode(true);
      expect(director.isDebugMode()).toBe(true);
      director.onWaveCompleted(waveResult({ enemyProgressValues: [1, 0] }));
      expect(console.log).toHaveBeenCalledWith('[AI] Leak ratio:', 0.5, 'leak x', 1);
    });
  });
});
