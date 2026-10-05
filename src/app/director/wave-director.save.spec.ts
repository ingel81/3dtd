import { describe, it, expect } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { SimMirror } from '../sim/client/mirror/sim-mirror';
import { WaveDirector } from './wave-director';
import { StateSnapshotService } from './state-snapshot.service';
import { createEmptySnapshot, type GameStateSnapshot } from './models/game-state-snapshot';
import type { WaveResult } from './models/wave-result';
import type { BudgetSourceState } from './sources/budget/budget-source';

/**
 * A save game's director (TODO E110): saved between waves and taken back in
 * a fresh director, the run plays on as if never left. The real budget
 * source with its pressure loop; the game's state is a stand-in collector.
 */

const flat = (v: number) => ({ unarmored: v, light: v, heavy: v, fortified: v, ethereal: v });

class Collector {
  snapshot: GameStateSnapshot = (() => {
    const s = createEmptySnapshot();
    s.defense.effectiveDPSPerArmor = { ground: flat(2000), air: flat(2000) };
    s.defense.damageMetres = { ground: flat(600_000), air: flat(600_000) };
    s.player.lives = 500;
    return s;
  })();
  private listeners: ((r: WaveResult) => void)[] = [];
  onWaveResult(listener: (r: WaveResult) => void): () => void {
    this.listeners.push(listener);
    return () => undefined;
  }
  emit(result: WaveResult): void {
    for (const listener of this.listeners) listener(result);
  }
  getStateSnapshot(): GameStateSnapshot {
    return this.snapshot;
  }
  setCurrentWaveConfig(): void {
    // Not read here
  }
}

function result(wave: number, hpLost: number): WaveResult {
  return { waveNumber: wave, outcome: { damageToPlayer: hpLost, healthAtWaveStart: 500, enemiesSpawned: 40 } } as unknown as WaveResult;
}

function director(): { director: WaveDirector; collector: Collector } {
  const collector = new Collector();
  const injector = Injector.create({
    providers: [
      { provide: StateSnapshotService, useValue: collector },
      { provide: SimMirror, useValue: new SimMirror() },
    ],
  });
  const made = runInInjectionContext(injector, () => new WaveDirector());
  made.resetForNewGame();
  return { director: made, collector };
}

describe('WaveDirector in a save game (TODO E110)', () => {
  it('goes on in a fresh director as the run would have: same loop, same committed wave, same next waves', async () => {
    const live = director();
    // Waves that cost nothing, then one that cost a lot: the loop has moved
    for (const [wave, lost] of [[1, 0], [2, 0], [3, 0], [4, 0], [5, 120]] as const) {
      await live.director.getNextWave(wave);
      live.collector.emit(result(wave, lost));
    }
    const save = JSON.parse(JSON.stringify(live.director.saveState())) as ReturnType<WaveDirector['saveState']>;
    expect(save.source).toBe('budget');
    expect(save.planned?.wave).toBe(6);
    expect((save.sourceState as BudgetSourceState).pressure.samples).toBeGreaterThan(0);

    const loaded = director();
    loaded.director.restoreState(save);
    expect(loaded.director.committed).toEqual(live.director.committed);

    for (const [wave, lost] of [[6, 30], [7, 0], [8, 0]] as const) {
      const a = await live.director.getNextWave(wave);
      const b = await loaded.director.getNextWave(wave);
      expect(b.config).toEqual(a.config);
      expect(b.log).toEqual(a.log);
      live.collector.emit(result(wave, lost));
      loaded.collector.emit(result(wave, lost));
    }
    expect(loaded.director.saveState()).toEqual(live.director.saveState());
  });

  it('takes the saved source for this run and the next', () => {
    const { director: loaded } = director();
    loaded.restoreState({ source: 'table', sourceState: null, planned: null });
    expect(loaded.source.id).toBe('table');
    expect(loaded.sourceNextRun).toBe('table');
    expect(loaded.committed).toBeNull();
  });
});
