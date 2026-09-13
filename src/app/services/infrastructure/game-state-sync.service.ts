import { Injectable, inject } from '@angular/core';
import { GameEventBus, SubscriptionBag } from '../../game-engine/game-event-bus';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { ResearchStore } from '../../store/research.store';
import { RunStatsTracker } from './run-stats';

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
  /** Counts the run for the game-over screen */
  private readonly runStats = new RunStatsTracker();

  /**
   * Subscribe to EventBus events and sync state changes to the Store.
   * Must be called after GameStateManager.initialize() so the EventBus is ready.
   *
   * @param gameClock game time in ms (GameStateManager.gameTimeMs), read once
   *   at game over for the run's duration
   */
  initialize(eventBus: GameEventBus, gameClock: () => number = () => 0): void {
    // Defensive: clear any prior subscriptions so a future re-init path can't
    // double-subscribe (consistent with combat-effect/hq-damage/game-state).
    this.subs.disposeAll();
    this.runStats.reset();
    this.runStats.attach(eventBus, this.subs);
    // ── Wave lifecycle ────────────────────────────────────────────
    this.subs.add(eventBus.on('wave:started', (event) => {
      this.store.phase.set('wave');
      this.store.waveNumber.set(event.wave);
      this.store.enemiesAlive.set(0);
      this.store.waveEnemyTotal.set(event.enemyCount);
      this.store.waveEnemiesLeft.set(event.enemyCount);
    }));

    this.subs.add(eventBus.on('wave:completed', (_event) => {
      this.store.phase.set('setup');
      this.store.enemiesAlive.set(0);
      this.store.waveEnemyTotal.set(0);
      this.store.waveEnemiesLeft.set(0);
    }));

    // Kill-all also drops the enemies still to spawn (WaveManager.stopSpawning),
    // so nothing of the wave is left. The deaths it causes clamp at 0.
    this.subs.add(eventBus.on('debug:kill-all', () => {
      this.store.waveEnemiesLeft.set(0);
    }));

    // ── Game state events ─────────────────────────────────────────
    this.subs.add(eventBus.on('game:over', (_event) => {
      this.store.phase.set('gameover');
      this.store.runSummary.set(this.runStats.summary(gameClock()));
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

    // Tower sind mutable Entities: Kills und Upgrades des gewählten Towers
    // zählen eine Revision hoch, aus der die Sidebar ihre Anzeige ableitet.
    const bumpIfSelected = (towerId: string) => {
      if (towerId === this.store.selectedTowerId()) {
        this.store.selectedTowerRevision.update(n => n + 1);
      }
    };
    this.subs.add(eventBus.on('tower:kill', (event) => bumpIfSelected(event.tower.id)));
    this.subs.add(eventBus.on('tower:upgraded', (event) => bumpIfSelected(event.tower.id)));

    // ── Enemy lifecycle ───────────────────────────────────────────
    this.subs.add(eventBus.on('enemy:spawned', (_event) => {
      this.store.enemiesAlive.update(n => n + 1);
    }));

    // Killed or through: either way the enemy no longer counts as left
    this.subs.add(eventBus.on('enemy:died', (_event) => {
      this.store.enemiesAlive.update(n => Math.max(0, n - 1));
      this.store.waveEnemiesLeft.update(n => Math.max(0, n - 1));
    }));

    this.subs.add(eventBus.on('enemy:reached-base', (_event) => {
      this.store.enemiesAlive.update(n => Math.max(0, n - 1));
      this.store.waveEnemiesLeft.update(n => Math.max(0, n - 1));
    }));

    // A split adds its children to the wave: more left and a larger total,
    // so the bar still runs out at zero. Outside a wave (debug) there is none.
    this.subs.add(eventBus.on('enemy:split', (event) => {
      if (this.store.phase() !== 'wave') return;
      const n = event.children.length;
      this.store.waveEnemyTotal.update(total => total + n);
      this.store.waveEnemiesLeft.update(left => left + n);
    }));

    // A worm is one entry of the wave and one enemy per segment on the route
    this.subs.add(eventBus.on('worm:spawned', (event) => {
      if (this.store.phase() !== 'wave') return;
      const n = event.group.size - 1;
      this.store.waveEnemyTotal.update(total => total + n);
      this.store.waveEnemiesLeft.update(left => left + n);
    }));

    // ── Abilities ─────────────────────────────────────────────────
    // Snapshot after every AbilityManager mutation (unlock, use, impact, recharge)
    this.subs.add(eventBus.on('ability:state-changed', (event) => {
      this.store.abilities.update((current) => {
        const next = { ...current };
        for (const status of event.abilities) next[status.id] = status;
        return next;
      });
    }));

    // ── Research lifecycle ────────────────────────────────────────
    // research:state-changed ist der Single-Source-of-Truth-Sync-Pfad —
    // ResearchManager emittiert ihn nach jeder State-Mutation.
    this.subs.add(eventBus.on('research:state-changed', (event) => {
      this.researchStore.activeResearches.set(event.activeResearches);
      this.researchStore.researchElapsed.set(
        new Map(event.activeResearches.map(a => [a.researchId, a.elapsed])),
      );
      this.researchStore.completedResearches.set(event.completedResearches);
      this.researchStore.queuedResearches.set(event.queuedResearches);
      this.researchStore.centerLevel.set(event.centerLevel);
      this.researchStore.researchSlots.set(event.maxSlots);
    }));

    // Fortschritt zwischen den Snapshots, vom ResearchManager auf 10 Hz gedrosselt
    this.subs.add(eventBus.on('research:progress', (event) => {
      this.researchStore.researchElapsed.set(event.elapsed);
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
