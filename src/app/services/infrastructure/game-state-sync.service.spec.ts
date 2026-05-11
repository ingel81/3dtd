import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock Angular DI: inject() returns the actual stores we construct in beforeEach.
// Decorator must be a no-op so providedIn doesn't reach the real platform.
const injectionRegistry: Record<string, unknown> = {};
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  return {
    ...actual,
    Injectable: () => (target: unknown) => target,
    inject: (token: { name?: string }) => {
      const name = token?.name;
      if (!name) return undefined;
      return injectionRegistry[name];
    },
  };
});

import { GameStateSyncService } from './game-state-sync.service';
import { GameEventBus } from '../../game-engine/game-event-bus';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { ResearchStore } from '../../store/research.store';
import { GameStore } from '../../store/game.store';
import { UIStore } from '../../store/ui.store';
import { EngineStore } from '../../store/engine.store';
import { LocationStore } from '../../store/location.store';

/**
 * Echter Service-Test: instantiates GameStateSyncService und prüft, dass die
 * `initialize(eventBus)`-Methode den Store korrekt updated, wenn Events
 * über den GameEventBus laufen.
 *
 * Der frühere Spec testete nur eine Inline-Re-Implementierung der
 * Subscriptions. Diese Version greift den echten Service durch und schützt
 * vor stillen Handler-Drift, wenn die Service-Subscriptions sich ändern.
 */
describe('GameStateSyncService (real service)', () => {
  let store: TowerDefenseStore;
  let researchStore: ResearchStore;
  let service: GameStateSyncService;
  let eventBus: GameEventBus;

  beforeEach(() => {
    // TowerDefenseStore composes sub-stores via inject(). Register every
    // sub-store first, then the composite, then the service.
    injectionRegistry['GameStore'] = new GameStore();
    injectionRegistry['UIStore'] = new UIStore();
    injectionRegistry['EngineStore'] = new EngineStore();
    injectionRegistry['LocationStore'] = new LocationStore();

    researchStore = new ResearchStore();
    injectionRegistry['ResearchStore'] = researchStore;

    // EngineInitializationService is required by TowerDefenseStore but not
    // touched by the sync paths we test — stub it out.
    injectionRegistry['EngineInitializationService'] = {};

    store = new TowerDefenseStore();
    injectionRegistry['TowerDefenseStore'] = store;

    service = new GameStateSyncService();
    eventBus = new GameEventBus();
    service.initialize(eventBus);
  });

  afterEach(() => {
    service.dispose();
    eventBus.clear();
  });

  // ── Wave lifecycle ─────────────────────────────────────────────
  describe('wave events', () => {
    it('wave:started → phase=wave, waveNumber=N, enemiesAlive=0', () => {
      eventBus.emit({ type: 'wave:started', wave: 3, enemyCount: 12 });
      expect(store.phase()).toBe('wave');
      expect(store.waveNumber()).toBe(3);
      expect(store.enemiesAlive()).toBe(0);
    });

    it('wave:completed → phase=setup, enemiesAlive=0', () => {
      eventBus.emit({ type: 'wave:started', wave: 1, enemyCount: 5 });
      store.enemiesAlive.set(7);
      eventBus.emit({
        type: 'wave:completed', wave: 1, credits: 50,
        perfect: false, closeCall: false, hpLost: 0,
      });
      expect(store.phase()).toBe('setup');
      expect(store.enemiesAlive()).toBe(0);
    });
  });

  // ── Game state ─────────────────────────────────────────────────
  describe('game-state events', () => {
    it('game:over → phase=gameover, showGameOverScreen=true', () => {
      eventBus.emit({ type: 'game:over', reason: 'base-destroyed' });
      expect(store.phase()).toBe('gameover');
      expect(store.showGameOverScreen()).toBe(true);
    });

    it('game:reset → resetGameState()', () => {
      store.credits.set(123);
      store.phase.set('wave');
      store.waveNumber.set(7);
      eventBus.emit({ type: 'game:reset' });
      // After reset, phase falls back to setup and waveNumber to 0.
      expect(store.phase()).toBe('setup');
      expect(store.waveNumber()).toBe(0);
    });
  });

  // ── Credits / Health ───────────────────────────────────────────
  describe('credits + health events', () => {
    it('credits:changed → store.credits = event.credits', () => {
      eventBus.emit({ type: 'credits:changed', credits: 750, delta: -50 });
      expect(store.credits()).toBe(750);
    });

    it('health:changed → store.baseHealth = event.health', () => {
      eventBus.emit({ type: 'health:changed', health: 80, delta: -20 });
      expect(store.baseHealth()).toBe(80);
    });
  });

  // ── Tower lifecycle ────────────────────────────────────────────
  describe('tower events', () => {
    it('tower:placed → towerCount++', () => {
      expect(store.towerCount()).toBe(0);
      eventBus.emit({
        type: 'tower:placed',
        tower: {} as never,
        position: { lat: 0, lon: 0 },
        cost: 100,
      });
      expect(store.towerCount()).toBe(1);
    });

    it('tower:sold → towerCount--', () => {
      store.towerCount.set(3);
      eventBus.emit({ type: 'tower:sold', tower: { id: 't1' } as never, refund: 50 });
      expect(store.towerCount()).toBe(2);
    });

    it('tower:sold clears selectedTower if it matches', () => {
      const tower = { id: 'sold-1' } as never;
      store.selectedTower.set(tower);
      eventBus.emit({ type: 'tower:sold', tower, refund: 50 });
      expect(store.selectedTower()).toBeNull();
    });

    it('tower:sold leaves selectedTower if a different tower was selected', () => {
      const selected = { id: 'keep-me' } as never;
      const sold = { id: 'sell-me' } as never;
      store.selectedTower.set(selected);
      eventBus.emit({ type: 'tower:sold', tower: sold, refund: 50 });
      expect(store.selectedTower()).toBe(selected);
    });

    it('towerCount cannot go below 0', () => {
      store.towerCount.set(0);
      eventBus.emit({ type: 'tower:sold', tower: {} as never, refund: 0 });
      expect(store.towerCount()).toBe(0);
    });

    it('tower:selected → selectedTower = event.tower', () => {
      const tower = { id: 'tower-7' } as never;
      eventBus.emit({ type: 'tower:selected', tower });
      expect(store.selectedTower()).toBe(tower);
    });

    it('tower:deselected → selectedTower = null', () => {
      store.selectedTower.set({ id: 'tower-8' } as never);
      eventBus.emit({ type: 'tower:deselected' });
      expect(store.selectedTower()).toBeNull();
    });
  });

  // ── Enemy lifecycle ────────────────────────────────────────────
  describe('enemy events', () => {
    it('enemy:spawned → enemiesAlive++', () => {
      store.enemiesAlive.set(5);
      eventBus.emit({ type: 'enemy:spawned', enemy: {} as never });
      expect(store.enemiesAlive()).toBe(6);
    });

    it('enemy:died → enemiesAlive--', () => {
      store.enemiesAlive.set(5);
      eventBus.emit({ type: 'enemy:died', enemy: {} as never, credits: 10 });
      expect(store.enemiesAlive()).toBe(4);
    });

    it('enemy:reached-base → enemiesAlive--', () => {
      store.enemiesAlive.set(5);
      eventBus.emit({ type: 'enemy:reached-base', enemy: {} as never, damage: 10 });
      expect(store.enemiesAlive()).toBe(4);
    });

    it('enemy:died cannot push enemiesAlive below 0', () => {
      store.enemiesAlive.set(0);
      eventBus.emit({ type: 'enemy:died', enemy: {} as never, credits: 0 });
      expect(store.enemiesAlive()).toBe(0);
    });
  });

  // ── Research lifecycle ─────────────────────────────────────────
  describe('research events', () => {
    it('research:state-changed → updates ResearchStore snapshot', () => {
      const completed = new Set(['gatling-tech']);
      eventBus.emit({
        type: 'research:state-changed',
        activeResearches: [
          { researchId: 'ice-magic', startTime: 0, duration: 15, elapsed: 5, cost: 40 },
        ],
        completedResearches: completed,
        centerLevel: 2,
        maxSlots: 3,
      });

      expect(researchStore.completedResearches().has('gatling-tech')).toBe(true);
      expect(researchStore.activeResearches().length).toBe(1);
      expect(researchStore.centerLevel()).toBe(2);
      expect(researchStore.researchSlots()).toBe(3);
    });

    it('research:completed → applyResearchEffects raises maxUpgradeTier', () => {
      eventBus.emit({
        type: 'research:completed',
        researchId: 'tier-2-tech',
        effects: [{ kind: 'unlock-upgrade-tier', tier: 3 }],
      });
      expect(researchStore.maxUpgradeTier()).toBe(3);
    });

    it('research:completed → applies enable-targeting:air', () => {
      expect(researchStore.airTargetingUnlocked()).toBe(false);
      eventBus.emit({
        type: 'research:completed',
        researchId: 'aa-retrofit',
        effects: [{ kind: 'enable-targeting', capability: 'air' }],
      });
      expect(researchStore.airTargetingUnlocked()).toBe(true);
    });
  });

  // ── Lifecycle: dispose() detaches all subscriptions ────────────
  describe('dispose()', () => {
    it('detaches every subscription so subsequent events are ignored', () => {
      service.dispose();
      eventBus.emit({ type: 'wave:started', wave: 9, enemyCount: 99 });
      eventBus.emit({ type: 'credits:changed', credits: 9999, delta: 0 });
      // Defaults remain — phase from a fresh store starts as 'setup'.
      expect(store.waveNumber()).toBe(0);
      expect(store.credits()).not.toBe(9999);
    });
  });
});
