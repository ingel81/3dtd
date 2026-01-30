import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameEventBus } from '../game-engine/game-event-bus';
import { GameStore } from '../store/game.store';
import { GAME_BALANCE } from '../configs/game-balance.config';

/**
 * Tests for GSM→Store sync logic.
 *
 * Since GameStateSyncService uses Angular `inject()`, we test the sync logic
 * directly by simulating what the service does: listen to EventBus events
 * and write to the GameStore.
 *
 * This mirrors the exact event→store mapping from game-state-sync.service.ts.
 */
describe('GameStateSyncService (sync logic)', () => {
  let store: GameStore;
  let eventBus: GameEventBus;

  beforeEach(() => {
    store = new GameStore();
    eventBus = new GameEventBus();

    // Mirror the sync subscriptions from GameStateSyncService
    eventBus.on('wave:started', (event) => {
      store.phase.set('wave');
      store.waveNumber.set(event.wave);
      store.enemiesAlive.set(event.enemyCount);
    });

    eventBus.on('wave:completed', () => {
      store.phase.set('setup');
      store.enemiesAlive.set(0);
    });

    eventBus.on('game:over', () => {
      store.phase.set('gameover');
      store.showGameOverScreen.set(true);
    });

    eventBus.on('command:restart-game', () => {
      store.resetGameState();
    });

    eventBus.on('credits:changed', (event) => {
      store.credits.set(event.credits);
    });

    eventBus.on('health:changed', (event) => {
      store.baseHealth.set(event.health);
    });

    eventBus.on('tower:placed', () => {
      store.towerCount.update(n => n + 1);
    });

    eventBus.on('tower:sold', () => {
      store.towerCount.update(n => Math.max(0, n - 1));
    });

    eventBus.on('tower:selected', (event) => {
      store.selectedTower.set(event.tower);
    });

    eventBus.on('tower:deselected', () => {
      store.selectedTower.set(null);
    });

    eventBus.on('enemy:spawned', () => {
      store.enemiesAlive.update(n => n + 1);
    });

    eventBus.on('enemy:died', () => {
      store.enemiesAlive.update(n => Math.max(0, n - 1));
    });

    eventBus.on('enemy:reached-base', () => {
      store.enemiesAlive.update(n => Math.max(0, n - 1));
    });
  });

  afterEach(() => {
    eventBus.clear();
  });

  // ── Wave lifecycle ────────────────────────────────────────

  it('should sync wave:started to store', () => {
    eventBus.emit({ type: 'wave:started', wave: 3, enemyCount: 12 });

    expect(store.phase()).toBe('wave');
    expect(store.waveNumber()).toBe(3);
    expect(store.enemiesAlive()).toBe(12);
  });

  it('should sync wave:completed to store', () => {
    eventBus.emit({ type: 'wave:started', wave: 1, enemyCount: 5 });
    expect(store.phase()).toBe('wave');

    eventBus.emit({ type: 'wave:completed', wave: 1, credits: 50 });
    expect(store.phase()).toBe('setup');
    expect(store.enemiesAlive()).toBe(0);
  });

  // ── Game state ────────────────────────────────────────────

  it('should sync game:over to store', () => {
    eventBus.emit({ type: 'game:over', reason: 'base-destroyed' });

    expect(store.phase()).toBe('gameover');
    expect(store.showGameOverScreen()).toBe(true);
  });

  it('should sync command:restart-game to store reset', () => {
    store.credits.set(999);
    store.phase.set('wave');
    store.waveNumber.set(5);

    eventBus.emit({ type: 'command:restart-game' });

    expect(store.credits()).toBe(GAME_BALANCE.player.startCredits);
    expect(store.phase()).toBe('setup');
    expect(store.waveNumber()).toBe(0);
  });

  // ── Credits ───────────────────────────────────────────────

  it('should sync credits:changed to store', () => {
    eventBus.emit({ type: 'credits:changed', credits: 750, delta: -50 });
    expect(store.credits()).toBe(750);
  });

  // ── Health ────────────────────────────────────────────────

  it('should sync health:changed to store', () => {
    eventBus.emit({ type: 'health:changed', health: 80, delta: -20 });
    expect(store.baseHealth()).toBe(80);
  });

  // ── Tower lifecycle ───────────────────────────────────────

  it('should increment towerCount on tower:placed', () => {
    expect(store.towerCount()).toBe(0);

    eventBus.emit({
      type: 'tower:placed',
      tower: {} as never,
      position: { lat: 0, lon: 0 },
      cost: 100,
    });

    expect(store.towerCount()).toBe(1);
  });

  it('should decrement towerCount on tower:sold', () => {
    store.towerCount.set(3);

    eventBus.emit({
      type: 'tower:sold',
      tower: {} as never,
      refund: 50,
    });

    expect(store.towerCount()).toBe(2);
  });

  it('should not go below 0 on tower:sold', () => {
    store.towerCount.set(0);

    eventBus.emit({
      type: 'tower:sold',
      tower: {} as never,
      refund: 50,
    });

    expect(store.towerCount()).toBe(0);
  });

  it('should set selectedTower on tower:selected', () => {
    const mockTower = { id: 'tower-1' } as never;
    eventBus.emit({ type: 'tower:selected', tower: mockTower });
    expect(store.selectedTower()).toBe(mockTower);
  });

  it('should clear selectedTower on tower:deselected', () => {
    store.selectedTower.set({ id: 'tower-1' } as never);
    eventBus.emit({ type: 'tower:deselected' });
    expect(store.selectedTower()).toBeNull();
  });

  // ── Enemy lifecycle ───────────────────────────────────────

  it('should increment enemiesAlive on enemy:spawned', () => {
    store.enemiesAlive.set(5);

    eventBus.emit({ type: 'enemy:spawned', enemy: {} as never });
    expect(store.enemiesAlive()).toBe(6);
  });

  it('should decrement enemiesAlive on enemy:died', () => {
    store.enemiesAlive.set(5);

    eventBus.emit({ type: 'enemy:died', enemy: {} as never, credits: 10 });
    expect(store.enemiesAlive()).toBe(4);
  });

  it('should decrement enemiesAlive on enemy:reached-base', () => {
    store.enemiesAlive.set(5);

    eventBus.emit({ type: 'enemy:reached-base', enemy: {} as never, damage: 10 });
    expect(store.enemiesAlive()).toBe(4);
  });

  it('should not go below 0 on enemy:died', () => {
    store.enemiesAlive.set(0);

    eventBus.emit({ type: 'enemy:died', enemy: {} as never, credits: 10 });
    expect(store.enemiesAlive()).toBe(0);
  });

  // ── Combined scenarios ────────────────────────────────────

  it('should handle full wave lifecycle', () => {
    // Wave starts
    eventBus.emit({ type: 'wave:started', wave: 1, enemyCount: 3 });
    expect(store.waveActive()).toBe(true);
    expect(store.enemiesAlive()).toBe(3);

    // Enemies spawn and die
    eventBus.emit({ type: 'enemy:died', enemy: {} as never, credits: 10 });
    expect(store.enemiesAlive()).toBe(2);

    eventBus.emit({ type: 'enemy:reached-base', enemy: {} as never, damage: 5 });
    expect(store.enemiesAlive()).toBe(1);

    // Health drops
    eventBus.emit({ type: 'health:changed', health: 95, delta: -5 });
    expect(store.baseHealth()).toBe(95);

    // Credits change
    eventBus.emit({ type: 'credits:changed', credits: 810, delta: 10 });
    expect(store.credits()).toBe(810);

    // Wave completes
    eventBus.emit({ type: 'wave:completed', wave: 1, credits: 50 });
    expect(store.waveActive()).toBe(false);
    expect(store.phase()).toBe('setup');
  });

  it('should handle game over scenario', () => {
    eventBus.emit({ type: 'wave:started', wave: 5, enemyCount: 20 });
    eventBus.emit({ type: 'health:changed', health: 0, delta: -100 });
    eventBus.emit({ type: 'game:over', reason: 'base-destroyed' });

    expect(store.isGameOver()).toBe(true);
    expect(store.showGameOverScreen()).toBe(true);
    expect(store.baseHealth()).toBe(0);
  });
});
