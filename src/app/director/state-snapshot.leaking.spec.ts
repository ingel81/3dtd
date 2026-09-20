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
import type { Enemy } from '../entities/enemy.entity';

/**
 * An ooze flows into the base point by point (enemy:leaking) before its one
 * enemy:reached-base. For the wave's outcome it is a leak from the first
 * point on, like an enemy that walked in; a kill halfway in changes nothing.
 */
describe('StateSnapshotService oozes flowing in', () => {
  let bus: GameEventBus;
  let results: WaveResult[];

  const ooze = (id: string) =>
    ({ id, typeConfig: { id: 'ooze' }, getComponent: () => ({ getPathProgress: () => 1 }) }) as unknown as Enemy;
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

  it('books an ooze killed halfway in as a leak, not a kill', () => {
    const enemy = ooze('o1');
    bus.emit({ type: 'wave:started', wave: 45, enemyCount: 1 });
    bus.emit({ type: 'enemy:spawned', enemy });
    bus.emit({ type: 'enemy:leaking', enemy, damage: 1 });
    bus.emit({ type: 'enemy:leaking', enemy, damage: 1 });
    bus.emit({ type: 'enemy:died', enemy, credits: 0, killedBy: null });
    completeWave(45);

    expect(results[0].outcome).toMatchObject({ enemiesKilled: 0, enemiesReachedBase: 1 });
    expect(results[0].outcome.enemyProgressValues).toEqual([1]);
  });

  it('books an ooze that flowed in whole once', () => {
    const enemy = ooze('o2');
    bus.emit({ type: 'wave:started', wave: 45, enemyCount: 1 });
    bus.emit({ type: 'enemy:spawned', enemy });
    bus.emit({ type: 'enemy:leaking', enemy, damage: 1 });
    bus.emit({ type: 'enemy:reached-base', enemy, damage: 1 });
    completeWave(45);

    expect(results[0].outcome).toMatchObject({ enemiesKilled: 0, enemiesReachedBase: 1 });
  });
});
