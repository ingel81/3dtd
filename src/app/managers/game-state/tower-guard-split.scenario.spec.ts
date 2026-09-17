/**
 * Playtest 336 (night 2026-09-14): between waves, towers built, a debug
 * skeleton as the only enemy. The real EnemyManager kills and splits it, the
 * real WaveManager runs kill-all; TowerLifecycle.turnToGuardIfClear listens on
 * enemy:died and debug:kill-all as GameStateManager wires it
 * (game-state.manager.ts, registerEventHandlers). TowerCombatService is a spy:
 * only whether the towers are turned to their guard heading is checked, not
 * the aiming itself. Rendering is mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('three', async () => {
  const mod = await import('@/test/mocks/three.mock');
  return { ...mod };
});

import { createTestManagers, TestManagers, TEST_PATH } from '../../integration/test-helpers';
import { TowerLifecycle } from './tower-lifecycle';
import { ENEMY_TYPES } from '../../configs/enemy-types.config';
import type { Enemy } from '../../entities/enemy.entity';

describe('Guard heading after a debug skeleton outside a wave (playtest 336)', () => {
  let m: TestManagers;
  let turnTowersToGuard: ReturnType<typeof vi.fn>;
  /** How many were alive while each enemy:died ran */
  let aliveAtDeath: number[];

  const placeSkeleton = (): Enemy => {
    // What Enemy Debug's Place sends: an idle skeleton on the route
    m.eventBus.emit({ type: 'debug:spawn-enemy', enemyType: 'skeleton', path: TEST_PATH, paused: true });
    return m.enemyManager.getAlive().find((e) => e.typeConfig.id === 'skeleton')!;
  };
  const minions = () => m.enemyManager.getAlive().filter((e) => e.typeConfig.id === 'skeleton-minion');

  beforeEach(() => {
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    m = createTestManagers();
    turnTowersToGuard = vi.fn();
    const lifecycle = new TowerLifecycle(
      m.towerManager,
      {} as never,
      {} as never,
      m.waveManager,
      m.enemyManager,
      {} as never,
      { turnTowersToGuard } as never,
      {} as never,
      {} as never,
      m.eventBus,
      () => null,
      () => false,
    );
    aliveAtDeath = [];
    m.eventBus.on('enemy:died', () => aliveAtDeath.push(m.enemyManager.getAlive().length));
    m.eventBus.on('enemy:died', (event) => lifecycle.turnToGuardIfClear(event.enemy));
    m.eventBus.on('debug:kill-all', () => lifecycle.turnToGuardIfClear());
  });

  afterEach(() => {
    m.enemyManager.clear();
    vi.restoreAllMocks();
  });

  it('336: the towers stay on the minions when the skeleton dies, and turn to guard after the last one', () => {
    expect(m.waveManager.phase()).not.toBe('wave');
    const skeleton = placeSkeleton();
    const split = ENEMY_TYPES['skeleton'].splitOnDeath!;

    m.enemyManager.kill(skeleton);
    // While its enemy:died ran nothing was alive yet: the minions come right after
    expect(aliveAtDeath).toEqual([0]);
    expect(minions()).toHaveLength(split.count);
    expect(turnTowersToGuard).not.toHaveBeenCalled();

    const [first, ...rest] = minions();
    m.enemyManager.kill(first);
    expect(turnTowersToGuard).not.toHaveBeenCalled();
    for (const minion of rest) m.enemyManager.kill(minion);
    expect(turnTowersToGuard).toHaveBeenCalledTimes(1);
    expect(turnTowersToGuard).toHaveBeenCalledWith(m.towerManager);
  });

  it('336: the kill cheat with a skeleton splits nothing and turns the towers to guard once', () => {
    placeSkeleton();
    m.eventBus.emit({ type: 'debug:kill-all' });

    expect(m.enemyManager.getAlive()).toEqual([]);
    expect(minions()).toEqual([]);
    expect(turnTowersToGuard).toHaveBeenCalledTimes(1);
  });
});
