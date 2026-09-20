import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('three', async () => await import('@/test/mocks/three.mock'));

// inject() hands out the stubs registered below, by class name
const injections: Record<string, unknown> = {};
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  return {
    ...actual,
    Injectable: () => (target: unknown) => target,
    inject: (token: { name?: string }) => injections[token?.name ?? ''] ?? {},
  };
});

import { StateSnapshotService } from './state-snapshot.service';
import { GameEventBus } from '../game-engine/game-event-bus';
import type { WaveResult } from './models/wave-result';

/**
 * The collector's share of the ability booking: kills reported by
 * `ability:resolved` land in the wave's outcome, where the fairness gate
 * books them as leaks (leakRatio, leak-wiring.spec.ts).
 */
describe('StateSnapshotService ability kills', () => {
  let bus: GameEventBus;
  let results: WaveResult[];

  const impact = (kills: number) =>
    bus.emit({
      type: 'ability:resolved',
      abilityId: 'nuclear-strike',
      strikeId: 1,
      hits: kills + 1,
      kills,
    });
  const completeWave = (wave: number) =>
    bus.emit({ type: 'wave:completed', wave, credits: 0, perfect: false, closeCall: false, hpLost: 0 });

  beforeEach(() => {
    bus = new GameEventBus();
    injections['GameStateManager'] = { getEventBus: () => bus, gameSpeed: () => 1 };
    injections['TowerDefenseStore'] = { baseHealth: () => 100 };
    const collector = new StateSnapshotService();
    results = [];
    collector.onWaveResult((r) => results.push(r));
  });

  it('adds up the kills of every strike in the wave', () => {
    bus.emit({ type: 'wave:started', wave: 12, enemyCount: 40 });
    impact(7);
    impact(3);
    completeWave(12);
    expect(results[0].outcome.abilityKills).toBe(10);
  });

  it('leaves the hero\'s kills out: for the gate they are kills like a tower\'s, not leaks', () => {
    bus.emit({ type: 'wave:started', wave: 12, enemyCount: 40 });
    for (let i = 0; i < 5; i++) bus.emit({ type: 'hero:kill', enemy: {} as never });
    impact(2);
    completeWave(12);
    expect(results[0].outcome.abilityKills).toBe(2);
  });

  it('starts every wave at zero', () => {
    bus.emit({ type: 'wave:started', wave: 12, enemyCount: 40 });
    impact(7);
    completeWave(12);
    bus.emit({ type: 'wave:started', wave: 13, enemyCount: 40 });
    completeWave(13);
    expect(results[1].outcome.abilityKills).toBe(0);
  });
});
