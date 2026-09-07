import { describe, it, expect, beforeEach } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';

import { WaveDirectorService } from './wave-director.service';
import { AIDataCollectorService } from './ai-data-collector.service';
import { GATE_ADAPT_WINDOW } from './gate-controller';
import { fairMaxCount, TEMPLATES } from './templates';
import { createEmptySnapshot, type GameStateSnapshot } from './models/game-state-snapshot';
import type { WaveResult } from './models/wave-result';

/**
 * Wiring tests, as opposed to unit tests.
 *
 * The gate controller first shipped with full unit coverage, a correct
 * proportional loop, and no caller: `onWaveCompleted` was never invoked
 * anywhere in the project, so `budgetMultiplier` stayed at 1.0 for the lifetime
 * of the app and the mechanism was inert. Every unit test passed, because each
 * one drove the controller directly.
 *
 * The first attempt at closing that gap repeated the mistake: it exercised a
 * hand-written fake of the collector, so deleting the real subscription — the
 * exact defect under test — left it green.
 *
 * These construct the REAL WaveDirectorService against a stubbed collector, so
 * both connections are load-bearing:
 *   1. a finished wave reaches the controller
 *   2. the controller's output actually changes the wave that ships
 */

/** Minimal stand-in for the collector: only what the director actually calls. */
class StubCollector {
  private listeners: ((r: WaveResult) => void)[] = [];
  snapshot: GameStateSnapshot = defenceSnapshot();
  lastConfig: unknown = null;

  onWaveResult(listener: (r: WaveResult) => void): () => void {
    this.listeners.push(listener);
    return () => { /* not exercised: both services share a component injector */ };
  }

  /** Mirrors AIDataCollectorService.addToHistory notifying its listeners. */
  emitWaveResult(result: WaveResult): void {
    for (const l of this.listeners) l(result);
  }

  getStateSnapshot(): GameStateSnapshot {
    return this.snapshot;
  }

  setCurrentWaveConfig(config: unknown): void {
    this.lastConfig = config;
  }
}

/** A snapshot with enough defense for the fairness cap to be finite and binding. */
function defenceSnapshot(): GameStateSnapshot {
  const s = createEmptySnapshot();
  s.waveNumber = 40;                       // past the curriculum pin: a real choice
  s.player.lives = 100;
  s.defense.totalDPS = 400;
  s.defense.towerCount = 8;
  s.defense.effectiveDPSPerArmor = {
    ground: { unarmored: 120, light: 120, heavy: 120, fortified: 120, ethereal: 120 },
    air: { unarmored: 120, light: 120, heavy: 120, fortified: 120, ethereal: 120 },
  } as GameStateSnapshot['defense']['effectiveDPSPerArmor'];
  s.defense.killThroughput = { ground: 3, air: 3 };
  s.defense.capabilities = {
    hasAntiAir: true, hasSplash: true, hasSlow: true, hasDoT: true, hasAntiEthereal: true,
  } as GameStateSnapshot['defense']['capabilities'];
  return s;
}

function waveResult(progress: number[], survived = true): WaveResult {
  return {
    waveNumber: 1,
    timestamp: 0,
    config: { enemies: [], totalCount: progress.length, spawnDelay: 500 },
    outcome: { enemyProgressValues: progress, playerSurvived: survived },
  } as unknown as WaveResult;
}

describe('gate wiring', () => {
  let collector: StubCollector;
  let director: WaveDirectorService;

  beforeEach(() => {
    collector = new StubCollector();
    const injector = Injector.create({
      providers: [{ provide: AIDataCollectorService, useValue: collector }],
    });
    director = runInInjectionContext(injector, () => new WaveDirectorService());
  });

  describe('completed waves reach the gate', () => {
    it('subscribes to the collector on construction', () => {
      // Deleting the subscription in the constructor must fail this.
      expect(director.gate.budgetMultiplier).toBe(1);
      for (let i = 0; i < GATE_ADAPT_WINDOW * 3; i++) {
        collector.emitWaveResult(waveResult([0.2, 0.4, 0.3]));  // nothing arrived
      }
      expect(director.gate.budgetMultiplier).toBeGreaterThan(1);
    });

    it('backs off when a wave ends the run', () => {
      // Reachable only because the collector notifies from addToHistory, which
      // the game-over finaliser also calls — `wave:completed` is not emitted
      // when the base falls, so an event subscription would never see this.
      for (let i = 0; i < GATE_ADAPT_WINDOW * 3; i++) {
        collector.emitWaveResult(waveResult([0.1, 0.2]));
      }
      const opened = director.gate.budgetMultiplier;
      expect(opened).toBeGreaterThan(1);

      collector.emitWaveResult(waveResult([1, 1, 1], false));
      expect(director.gate.budgetMultiplier).toBeLessThan(opened);
    });

    it('closes the budget when too much is arriving', () => {
      for (let i = 0; i < GATE_ADAPT_WINDOW * 3; i++) {
        collector.emitWaveResult(waveResult([0.1, 0.2]));
      }
      const opened = director.gate.budgetMultiplier;
      for (let i = 0; i < GATE_ADAPT_WINDOW * 3; i++) {
        collector.emitWaveResult(waveResult([1, 1, 1, 0.5]));   // 75% arrived
      }
      expect(director.gate.budgetMultiplier).toBeLessThan(opened);
    });

    it('ignores waves that carry no per-enemy data', () => {
      // An empty progress array is "no sample", not "nothing leaked". Counting
      // it as zero opens the budget on evidence that does not exist.
      for (let i = 0; i < GATE_ADAPT_WINDOW * 3; i++) {
        collector.emitWaveResult(waveResult([]));
      }
      expect(director.gate.budgetMultiplier).toBe(1);
    });

    it('clears the gate for a new run', () => {
      for (let i = 0; i < GATE_ADAPT_WINDOW * 3; i++) {
        collector.emitWaveResult(waveResult([0.1, 0.2]));
      }
      expect(director.gate.budgetMultiplier).toBeGreaterThan(1);
      director.resetForNewGame();
      expect(director.gate.budgetMultiplier).toBe(1);
    });
  });

  describe('the gate changes the wave that ships', () => {
    it('a wider budget ships bigger waves', async () => {
      // The other half of the blocker: a correctly-fed controller still does
      // nothing unless its output reaches fairMaxCount. Dropping the
      // `this.gate.budgetMultiplier` argument in buildWaveConfig must fail this.
      //
      // Averaged over many waves rather than compared one to one: the director
      // rotates templates to enforce variety, and templates carry different
      // count ranges, so any single pair can differ by template choice alone.
      const meanCount = async (waves: number) => {
        let total = 0;
        for (let i = 0; i < waves; i++) total += (await director.getNextWave()).totalCount;
        return total / waves;
      };

      const tight = await meanCount(20);

      director.resetForNewGame();
      for (let i = 0; i < 60; i++) {
        collector.emitWaveResult(waveResult([0.1, 0.2, 0.3]));   // starve the gate
      }
      expect(director.gate.budgetMultiplier).toBeGreaterThan(2);

      const wide = await meanCount(20);
      expect(wide).toBeGreaterThan(tight);
    });

    it('produces a shippable wave with no history at all', async () => {
      const config = await director.getNextWave();
      expect(config.totalCount).toBeGreaterThan(0);
      expect(config.enemies.length).toBeGreaterThan(0);
      expect(collector.lastConfig).toBe(config);
    });
  });

  describe('fairMaxCount honours the multiplier', () => {
    // Spawn delay and throughput kept low enough that `1 - budget * delay`
    // stays positive across the range under test — otherwise fairMaxCount
    // returns null ("unbounded") and the assertions compare nothing. That guard
    // is real behaviour: a wave whose spawn window outlasts the defense's kill
    // rate has no finite cap.
    const capWith = (multiplier: number) => fairMaxCount(
      TEMPLATES[0], 1, 100,
      { ground: { unarmored: 100 }, air: { unarmored: 100 } },
      { ground: 2, air: 2 },
      () => 'unarmored', () => false, () => 50, () => 5,
      100, 1, multiplier,
    );

    it('opens and closes with the multiplier', () => {
      const base = capWith(1);
      expect(typeof base).toBe('number');
      expect(capWith(4)!).toBeGreaterThan(base!);
      expect(capWith(0.5)!).toBeLessThanOrEqual(base!);
    });

    it('defaults to neutral when omitted, so existing callers are unchanged', () => {
      const omitted = fairMaxCount(
        TEMPLATES[0], 1, 100,
        { ground: { unarmored: 100 }, air: { unarmored: 100 } },
        { ground: 2, air: 2 },
        () => 'unarmored', () => false, () => 50, () => 5,
        100, 1,
      );
      expect(omitted).toBe(capWith(1));
    });

    it('never produces a negative budget from a hostile multiplier', () => {
      const cap = capWith(-5);
      if (cap !== null) expect(cap).toBeGreaterThan(0);
    });
  });
});
