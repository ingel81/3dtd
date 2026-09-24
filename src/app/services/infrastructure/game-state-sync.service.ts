import { Injectable, inject } from '@angular/core';
import { GameEventBus, SubscriptionBag } from '../../game-engine/game-event-bus';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { ResearchStore } from '../../store/research.store';
import { RunLogFacade } from '../../run-log/run-log.facade';
import { runSummary } from '../../run-log/run-summary';
import { TOWER_TYPES, type TowerTypeId } from '../../configs/tower-types.config';

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
  /** The run log the game-over screen reads its numbers from */
  private readonly runLog = inject(RunLogFacade);

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
    // ── Wave lifecycle ────────────────────────────────────────────
    this.subs.add(eventBus.onLive('wave:started', (event) => {
      this.store.phase.set('wave');
      this.store.waveNumber.set(event.wave);
      this.store.enemiesAlive.set(0);
      this.store.waveEnemyTotal.set(event.enemyCount);
      this.store.waveEnemiesLeft.set(event.enemyCount);
    }));

    this.subs.add(eventBus.onLive('wave:completed', (_event) => {
      this.store.phase.set('setup');
      this.store.enemiesAlive.set(0);
      this.store.waveEnemyTotal.set(0);
      this.store.waveEnemiesLeft.set(0);
    }));

    // The dev jump moves the counter between waves (GameStateManager.jumpToWave):
    // the last wave counts as played, the wave button shows the next one
    this.subs.add(eventBus.onLive('wave:jumped', (event) => {
      this.store.waveNumber.set(event.wave - 1);
    }));

    // Kill-all also drops the enemies still to spawn (WaveManager.stopSpawning),
    // so nothing of the wave is left. The deaths it causes clamp at 0.
    this.subs.add(eventBus.onLive('debug:kill-all', () => {
      this.store.waveEnemiesLeft.set(0);
    }));

    // ── Game state events ─────────────────────────────────────────
    this.subs.add(eventBus.onLive('game:over', (_event) => {
      this.store.phase.set('gameover');
      // The fatal wave has no wave:completed; the log writes its block here
      this.runLog.collector.flushOpenWave();
      this.store.runSummary.set(runSummary(
        this.runLog.current(),
        gameClock(),
        (type) => TOWER_TYPES[type as TowerTypeId]?.name ?? type,
      ));
      this.store.showGameOverScreen.set(true);
    }));

    this.subs.add(eventBus.onLive('game:reset', () => {
      this.store.resetGameState();
    }));

    // ── Credits ───────────────────────────────────────────────────
    this.subs.add(eventBus.onLive('credits:changed', (event) => {
      if (event.local) this.store.credits.set(event.credits);
    }));

    // ── Health ────────────────────────────────────────────────────
    this.subs.add(eventBus.onLive('health:changed', (event) => {
      this.store.baseHealth.set(event.health);
    }));

    // ── Tower lifecycle ───────────────────────────────────────────
    this.subs.add(eventBus.onLive('tower:placed', (event) => {
      this.store.towerCount.update(n => n + 1);
      const type = event.tower.typeConfig;
      if (type.unique) this.store.placedUniqueTypes.update(set => new Set(set).add(type.id));
    }));

    this.subs.add(eventBus.onLive('tower:sold', (event) => {
      this.store.towerCount.update(n => Math.max(0, n - 1));
      const type = event.tower.typeConfig;
      if (type.unique) {
        this.store.placedUniqueTypes.update(set => {
          const next = new Set(set);
          next.delete(type.id);
          return next;
        });
      }

      // Clear selection if the sold tower was the selected one
      const selected = this.store.selectedTower();
      if (selected && selected.id === event.tower.id) {
        this.store.selectedTower.set(null);
      }
    }));

    this.subs.add(eventBus.onLive('tower:selected', (event) => {
      this.store.selectedTower.set(event.tower);
    }));

    this.subs.add(eventBus.onLive('tower:manned', (event) => {
      this.store.mannedTowerId.set(event.towerId);
    }));

    this.subs.add(eventBus.onLive('tower:deselected', () => {
      this.store.selectedTower.set(null);
    }));

    // Tower sind mutable Entities: Kills und Upgrades des gewählten Towers
    // zählen eine Revision hoch, aus der die Sidebar ihre Anzeige ableitet.
    // Jedes Upgrade zählt außerdem towerUpgrades, für die DPS aller Tower.
    const bumpIfSelected = (towerId: string) => {
      if (towerId === this.store.selectedTowerId()) {
        this.store.selectedTowerRevision.update(n => n + 1);
      }
    };
    this.subs.add(eventBus.onLive('tower:kill', (event) => bumpIfSelected(event.tower.id)));
    this.subs.add(eventBus.onLive('tower:upgraded', (event) => {
      this.store.towerUpgrades.update(n => n + 1);
      bumpIfSelected(event.tower.id);
    }));

    // ── Enemy lifecycle ───────────────────────────────────────────
    this.subs.add(eventBus.onLive('enemy:spawned', (_event) => {
      this.store.enemiesAlive.update(n => n + 1);
    }));

    // Killed or through: either way the enemy no longer counts as left
    this.subs.add(eventBus.onLive('enemy:died', (_event) => {
      this.store.enemiesAlive.update(n => Math.max(0, n - 1));
      this.store.waveEnemiesLeft.update(n => Math.max(0, n - 1));
    }));

    this.subs.add(eventBus.onLive('enemy:reached-base', (_event) => {
      this.store.enemiesAlive.update(n => Math.max(0, n - 1));
      this.store.waveEnemiesLeft.update(n => Math.max(0, n - 1));
    }));

    // A split adds its children to the wave: more left and a larger total,
    // so the bar still runs out at zero. Outside a wave (debug) there is none.
    this.subs.add(eventBus.onLive('enemy:split', (event) => {
      if (this.store.phase() !== 'wave') return;
      const n = event.children.length;
      this.store.waveEnemyTotal.update(total => total + n);
      this.store.waveEnemiesLeft.update(left => left + n);
    }));

    // A worm is one entry of the wave and one enemy per segment on the route
    this.subs.add(eventBus.onLive('worm:spawned', (event) => {
      if (this.store.phase() !== 'wave') return;
      const n = event.group.size - 1;
      this.store.waveEnemyTotal.update(total => total + n);
      this.store.waveEnemiesLeft.update(left => left + n);
    }));

    // ── Abilities ─────────────────────────────────────────────────
    // Snapshot after every AbilityManager mutation (unlock, use, impact, recharge)
    this.subs.add(eventBus.onLive('ability:state-changed', (event) => {
      this.store.abilities.update((current) => {
        const next = { ...current };
        for (const status of event.abilities) next[status.id] = status;
        return next;
      });
    }));

    // ── Hero ──────────────────────────────────────────────────────
    // Snapshot after every HeroManager change (unlock, hire, order, kill)
    this.subs.add(eventBus.onLive('hero:state-changed', (event) => {
      this.store.hero.set(event.hero);
    }));

    // ── Research lifecycle ────────────────────────────────────────
    // research:state-changed ist der Single-Source-of-Truth-Sync-Pfad —
    // ResearchManager emittiert ihn nach jeder State-Mutation.
    this.subs.add(eventBus.onLive('research:state-changed', (event) => {
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
    this.subs.add(eventBus.onLive('research:progress', (event) => {
      this.researchStore.researchElapsed.set(event.elapsed);
    }));

    // research:completed bleibt zusätzlich, um Effects auf den Store anzuwenden
    // (DamageMultiplier-Buffs etc.) — `state-changed` deckt nur die Pflicht-Felder ab.
    this.subs.add(eventBus.onLive('research:completed', (event) => {
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
