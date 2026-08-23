import { Injectable, inject } from '@angular/core';
import { GameEventBus, SubscriptionBag } from '../../game-engine/game-event-bus';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { ResearchStore } from '../../store/research.store';

/**
 * GameStateSyncService — Bridges GSM (GameStateManager) events to the Store.
 *
 * The GSM is the authoritative game engine that processes game logic.
 * It emits events via the EventBus when state changes.
 * This service listens to those events and writes the changes to the Store,
 * making the Store the single source of truth for ALL state reads.
 *
 * Flow:
 *   GSM (game logic) → EventBus events → GameStateSyncService → Store (signals)
 *   Component/Facade reads → Store (only)
 *
 * Lifecycle:
 *   - initialize(eventBus) — subscribes to all relevant events
 *   - dispose() — cleans up subscriptions
 *   - Called once per game session from TowerDefenseFacadeService
 */
@Injectable({ providedIn: 'root' })
export class GameStateSyncService {
  private readonly store = inject(TowerDefenseStore);
  private readonly researchStore = inject(ResearchStore);
  private readonly subs = new SubscriptionBag();

  /**
   * Subscribe to EventBus events and sync state changes to the Store.
   * Must be called after GameStateManager.initialize() so the EventBus is ready.
   */
  initialize(eventBus: GameEventBus): void {
    // Defensive: clear any prior subscriptions so a future re-init path can't
    // double-subscribe (consistent with combat-effect/hq-damage/game-state).
    this.subs.disposeAll();
    // ── Wave lifecycle ────────────────────────────────────────────
    this.subs.add(eventBus.on('wave:started', (event) => {
      this.store.phase.set('wave');
      this.store.waveNumber.set(event.wave);
      this.store.enemiesAlive.set(0);
    }));

    this.subs.add(eventBus.on('wave:completed', (_event) => {
      this.store.phase.set('setup');
      this.store.enemiesAlive.set(0);
    }));

    // ── Game state events ─────────────────────────────────────────
    this.subs.add(eventBus.on('game:over', (_event) => {
      this.store.phase.set('gameover');
      this.store.showGameOverScreen.set(true);
    }));

    this.subs.add(eventBus.on('game:reset', () => {
      this.store.resetGameState();
    }));

    // ── Credits ───────────────────────────────────────────────────
    this.subs.add(eventBus.on('credits:changed', (event) => {
      this.store.credits.set(event.credits);
    }));

    // ── Health ────────────────────────────────────────────────────
    this.subs.add(eventBus.on('health:changed', (event) => {
      this.store.baseHealth.set(event.health);
    }));

    // ── Tower lifecycle ───────────────────────────────────────────
    this.subs.add(eventBus.on('tower:placed', (_event) => {
      this.store.towerCount.update(n => n + 1);
    }));

    this.subs.add(eventBus.on('tower:sold', (event) => {
      this.store.towerCount.update(n => Math.max(0, n - 1));

      // Clear selection if the sold tower was the selected one
      const selected = this.store.selectedTower();
      if (selected && selected.id === event.tower.id) {
        this.store.selectedTower.set(null);
      }
    }));

    this.subs.add(eventBus.on('tower:selected', (event) => {
      this.store.selectedTower.set(event.tower);
    }));

    this.subs.add(eventBus.on('tower:deselected', () => {
      this.store.selectedTower.set(null);
    }));

    // ── Enemy lifecycle ───────────────────────────────────────────
    this.subs.add(eventBus.on('enemy:spawned', (_event) => {
      this.store.enemiesAlive.update(n => n + 1);
    }));

    this.subs.add(eventBus.on('enemy:died', (_event) => {
      this.store.enemiesAlive.update(n => Math.max(0, n - 1));
    }));

    this.subs.add(eventBus.on('enemy:reached-base', (_event) => {
      this.store.enemiesAlive.update(n => Math.max(0, n - 1));
    }));

    // ── Research lifecycle ────────────────────────────────────────
    // research:state-changed ist der Single-Source-of-Truth-Sync-Pfad —
    // ResearchManager emittiert ihn nach jeder State-Mutation.
    this.subs.add(eventBus.on('research:state-changed', (event) => {
      this.researchStore.activeResearches.set(event.activeResearches);
      this.researchStore.completedResearches.set(event.completedResearches);
      this.researchStore.centerLevel.set(event.centerLevel);
      this.researchStore.researchSlots.set(event.maxSlots);
    }));

    // research:completed bleibt zusätzlich, um Effects auf den Store anzuwenden
    // (DamageMultiplier-Buffs etc.) — `state-changed` deckt nur die Pflicht-Felder ab.
    this.subs.add(eventBus.on('research:completed', (event) => {
      this.researchStore.applyResearchEffects(event.effects);
    }));
  }

  /**
   * Clean up all EventBus subscriptions.
   * Called on game dispose / location change.
   */
  dispose(): void {
    this.subs.disposeAll();
  }
}
