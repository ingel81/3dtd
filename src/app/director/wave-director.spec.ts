import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';

import { WaveDirector } from './wave-director';
import { StateSnapshotService } from './state-snapshot.service';
import { createEmptySnapshot, type GameStateSnapshot } from './models/game-state-snapshot';
import type { WaveConfig } from './models/wave-config';
import type { WaveResult } from './models/wave-result';
import type { PlannedWave, WaveSource } from './wave-source';

/**
 * The director's own surface: which source a run plays, which wave is
 * committed, and what it hands on. What a wave looks like is the source's
 * business and is tested there (`sources/adaptive/`).
 *
 * The source here is a stub that counts its calls, so the service cannot pass
 * by accident on an adaptive source doing the work.
 */

class StubCollector {
  snapshot: GameStateSnapshot = createEmptySnapshot();
  setCurrentWaveConfig = vi.fn<(config: WaveConfig) => void>();
  private listeners: ((r: WaveResult) => void)[] = [];

  onWaveResult(listener: (r: WaveResult) => void): () => void {
    this.listeners.push(listener);
    return () => undefined;
  }

  emitWaveResult(result: WaveResult): void {
    for (const l of this.listeners) l(result);
  }

  getStateSnapshot(): GameStateSnapshot {
    return this.snapshot;
  }
}

/** A source that records what it was asked and plans a wave per number. */
class StubSource implements WaveSource {
  readonly id = 'adaptive' as const;
  readonly name = 'Stub source';
  plansAt: 'wave-end' | 'wave-start' = 'wave-start';

  planned: number[] = [];
  results: number[] = [];
  resets = 0;
  /** Numbers the random source handed out, to prove it is asked per plan. */
  draws: number[] = [];
  throwOn: number | null = null;

  plan({ wave, random }: { wave: number; random: () => number }): PlannedWave {
    if (wave === this.throwOn) throw new Error(`stub refuses wave ${wave}`);
    this.planned.push(wave);
    this.draws.push(random());
    return {
      wave,
      config: { enemies: [{ type: 'zombie', count: wave }], totalCount: wave, spawnDelay: 100 },
      explanation: { summary: `Wave ${wave}`, reasons: [] },
      log: { survivableCount: wave, diagnostics: { stub: true } },
    };
  }

  peek({ fromWave, count }: { fromWave: number; count: number }) {
    return Array.from({ length: count }, (_, i) => ({
      wave: fromWave + i,
      name: `W${fromWave + i}`,
      known: true,
      boss: false,
      air: false,
      armors: [],
      hpByArmor: [],
      count: null,
      enemies: [],
      note: '',
      description: '',
    }));
  }

  onWaveResult(result: WaveResult): void {
    this.results.push(result.waveNumber);
  }

  reset(): void {
    this.resets++;
    this.planned = [];
    this.results = [];
  }
}

function waveResult(waveNumber: number): WaveResult {
  return {
    waveNumber,
    timestamp: 0,
    config: { enemies: [], totalCount: 0, spawnDelay: 500 },
    outcome: { damageToPlayer: 0, healthAtWaveStart: 100, enemiesSpawned: 10, playerSurvived: true },
  } as unknown as WaveResult;
}

describe('WaveDirector', () => {
  let collector: StubCollector;
  let director: WaveDirector;
  let source: StubSource;

  /** Put the stub source in place of the configured one. */
  function useStubSource(): StubSource {
    const stub = new StubSource();
    (director as unknown as { activeSource: WaveSource }).activeSource = stub;
    return stub;
  }

  beforeEach(() => {
    collector = new StubCollector();
    const injector = Injector.create({ providers: [{ provide: StateSnapshotService, useValue: collector }] });
    director = runInInjectionContext(injector, () => new WaveDirector());
    source = useStubSource();

    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('starts with the configured source, nothing committed and no debug logging', () => {
      const fresh = runInInjectionContext(
        Injector.create({ providers: [{ provide: StateSnapshotService, useValue: collector }] }),
        () => new WaveDirector(),
      );
      expect(fresh.source.id).toBe('adaptive');
      expect(fresh.sourceNextRun).toBe('adaptive');
      expect(fresh.committed).toBeNull();
      expect(fresh.lastDecision()).toBeNull();
      expect(fresh.isDebugMode()).toBe(false);
    });
  });

  describe('planning', () => {
    it('asks the source for the wave it was asked for and commits it', async () => {
      const planned = await director.getNextWave(7);

      expect(source.planned).toEqual([7]);
      expect(planned.wave).toBe(7);
      expect(director.committed).toBe(planned);
      expect(director.lastDecision()).toBe(planned.config);
      expect(collector.setCurrentWaveConfig).toHaveBeenCalledWith(planned.config);
      expect(director.decisionTimeMs()).toBeGreaterThanOrEqual(0);
    });

    it('plans a wave only once, however often it is asked', () => {
      const first = director.ensurePlanned(7);
      expect(director.ensurePlanned(7)).toBe(first);
      expect(source.planned).toEqual([7]);
    });

    it('replans when the number moved, as a dev jump does', () => {
      director.ensurePlanned(12);
      const jumped = director.ensurePlanned(35);

      expect(source.planned).toEqual([12, 35]);
      expect(jumped.wave).toBe(35);
      expect(director.committed).toBe(jumped);
    });

    it('keeps the commitment when the source throws', () => {
      const good = director.ensurePlanned(7);
      source.throwOn = 8;

      expect(() => director.ensurePlanned(8)).toThrow('stub refuses wave 8');
      expect(director.committed).toBe(good);
    });

    it('asks for the random source per plan, so a run reset is picked up', () => {
      const streams = [() => 0.25, () => 0.75];
      let current = 0;
      director.useRandomSource(() => streams[current]);

      director.ensurePlanned(1);
      current = 1;
      director.ensurePlanned(2);

      expect(source.draws).toEqual([0.25, 0.75]);
    });
  });

  describe('a finished wave', () => {
    it('reaches the source through the collector, without the facade in between', () => {
      collector.emitWaveResult(waveResult(3));
      expect(source.results).toEqual([3]);
    });

    it('does not plan ahead for a source that decides at wave start', () => {
      collector.emitWaveResult(waveResult(3));
      expect(source.planned).toEqual([]);
      expect(director.committed).toBeNull();
    });

    it('commits the next wave for a source that plans at wave end', () => {
      source.plansAt = 'wave-end';
      collector.emitWaveResult(waveResult(3));

      expect(source.planned).toEqual([4]);
      expect(director.committed?.wave).toBe(4);
    });

    it('logs the result in debug mode', () => {
      director.setDebugMode(true);
      expect(director.isDebugMode()).toBe(true);
      const result = waveResult(3);
      collector.emitWaveResult(result);
      expect(console.log).toHaveBeenCalledWith('[AI] Wave result:', result);
    });

    it('does not log outside debug mode', async () => {
      await director.getNextWave(1);
      collector.emitWaveResult(waveResult(1));
      expect(console.log).not.toHaveBeenCalled();
    });

    /**
     * Nothing waits for a wave planned ahead, and `ensurePlanned` runs again
     * when it really starts — where the facade's error path is listening.
     */
    it('swallows a failure while planning ahead', () => {
      source.plansAt = 'wave-end';
      source.throwOn = 4;

      expect(() => collector.emitWaveResult(waveResult(3))).not.toThrow();
      expect(console.error).toHaveBeenCalled();
      expect(director.committed).toBeNull();
    });
  });

  describe('a new run', () => {
    it('clears the commitment and resets the source it keeps', () => {
      director.ensurePlanned(7);
      director.resetForNewGame();

      expect(source.resets).toBe(1);
      expect(director.committed).toBeNull();
      expect(director.lastDecision()).toBeNull();
    });

    it('puts the chosen source into service only with the new run', () => {
      const before = director.source;
      director.useSourceNextRun('adaptive');
      expect(director.source).toBe(before);
      expect(director.sourceNextRun).toBe('adaptive');
    });

    it('commits wave 1 right away for a source that plans at wave end', () => {
      source.plansAt = 'wave-end';
      director.resetForNewGame();

      expect(source.planned).toEqual([1]);
      expect(director.committed?.wave).toBe(1);
    });
  });

  describe('preview', () => {
    it('passes it to the source', () => {
      const facts = director.peek({
        fromWave: 5,
        count: 3,
        defense: { totalDps: 100 },
      });
      expect(facts.map((f) => f.wave)).toEqual([5, 6, 7]);
    });
  });
});
