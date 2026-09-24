/**
 * AI Data Collector Service
 *
 * Passively collects game data for AI training and inference.
 * READ-ONLY - does not modify any game state.
 *
 * This service:
 * - Subscribes to game events (enemy:died, wave:completed, etc.)
 * - Generates GameStateSnapshots on demand
 * - Tracks WaveResults for reward calculation
 * - Maintains recent history for AI context
 *
 * The running wave is tracked by WaveOutcomeTracker, the last waves by
 * WaveHistory; the plain snapshot sections live in state-snapshot-parts.ts.
 *
 * IMPORTANT: This service is completely optional.
 * The game works fine without it.
 */

import { Injectable, inject, signal } from '@angular/core';
import { GamePhase } from '../models/game.types';
import { SubscriptionBag } from '../game-engine/game-event-bus';
import { Enemy } from '../entities/enemy.entity';
import { GameStateManager } from '../managers/game-state.manager';
import { TowerDefenseStore } from '../store/tower-defense.store';
import { ResearchStore } from '../store/research.store';
import { GameStateSnapshot } from './models/game-state-snapshot';
import { WaveResult, WaveOutcome } from './models/wave-result';
import { WaveConfig, createSimpleWaveConfig } from './models/wave-config';
import {
  analyzeDefense,
  analyzeVulnerabilities,
  estimatePathCoverage,
  estimateKillZoneStrength,
} from './defense-analyzer';
import { computeDpsByDamageType } from './defense-analyzer';
import { computeTowerDPS } from './tower-dps.util';
import { ComponentType } from '../core/component';
import { MovementComponent } from '../game-components/movement.component';
import { GlobalRouteGridService } from '../services/world/global-route-grid.service';
import { computePathDPSProfile, createEmptyDPSProfile, PathDPSProfile } from './dps-profile';
import { Tower } from '../entities/tower.entity';
import { WaveOutcomeTracker } from './wave-outcome-tracker';
import { WaveHistory } from './wave-history';
import { expectedArmorDistribution, playerState, researchSnapshot } from './state-snapshot-parts';

@Injectable() // Provided in TowerDefenseComponent alongside GameStateManager
export class StateSnapshotService {
  private gameState = inject(GameStateManager);
  private store = inject(TowerDefenseStore);
  private researchStore = inject(ResearchStore);
  private gridService = inject(GlobalRouteGridService);
  // Get eventBus from GameStateManager (not directly injectable)
  private get eventBus() {
    return this.gameState.getEventBus();
  }

  /**
   * Game time (ms) for every duration here: wave length, enemy lifetimes,
   * run time. The wall clock would depend on the frame rate and the
   * timescale, and a re-simulation would not get the same values. Only the
   * `timestamp` labels stay on the wall clock; nothing reads them.
   */
  private now(): number {
    return this.gameState.gameTimeMs;
  }

  private subscriptions = new SubscriptionBag();

  // === DPS PROFILE CACHE ===
  private cachedDPSProfile: PathDPSProfile | null = null;
  private dpsProfileTowerHash = '';

  // === CURRENT WAVE TRACKING ===
  private currentWaveNumber = 0;
  /** Game-time start of the current run (ms), for the encoder's gameTime feature. */
  private gameStartTime = 0;
  private currentWaveConfig: WaveConfig | null = null;
  private readonly currentWave = new WaveOutcomeTracker();

  // === HISTORY ===
  private readonly history = new WaveHistory();

  // === SIGNALS FOR UI ===
  readonly isCollecting = signal(false);
  readonly lastSnapshot = signal<GameStateSnapshot | null>(null);
  readonly waveResultCount = signal(0);

  constructor() {
    // Auto-start collecting when service is created
    this.startCollecting();
  }

  /**
   * Start collecting data (subscribes to events)
   */
  startCollecting(): void {
    if (this.isCollecting()) return;

    this.subscribeToEvents();
    this.isCollecting.set(true);
  }

  /**
   * Stop collecting data (unsubscribes from events)
   */
  stopCollecting(): void {
    this.subscriptions.disposeAll();
    this.isCollecting.set(false);
  }

  /**
   * Get current game state as snapshot (for AI input)
   */
  getStateSnapshot(): GameStateSnapshot {
    const towers = this.gameState.towerManager.getAll();
    // In coop every client plans the next wave from what they all share, so
    // the plan and the director stream stay the same on each
    // (docs/COOP_PLAN.md, C4): air targeting when any player has it, the
    // first hired hero in roster order, the credits of all players. The
    // single player game reads the same as before.
    const players = this.gameState.players;
    const airTargetingUnlocked = players.some((id) => this.gameState.researchOf(id).airTargetingUnlocked);
    const hero = players.map((id) => this.gameState.heroOf(id).getDefenseProfile()).find((profile) => profile) ?? null;
    const credits = players.reduce((sum, id) => sum + this.gameState.creditsOf(id), 0);
    // The hired hero counts as a virtual tower at half presence (docs/HERO.md)
    const defense = analyzeDefense(towers, airTargetingUnlocked, hero);

    // Enhance defense with spatial metrics
    defense.pathCoverage = estimatePathCoverage(towers, 500); // Estimated 500m path
    defense.defenseReachPercent = this.gridService.getDefenseReachPercent(this.gameState.getCachedRoutes());
    defense.killZoneStrength = estimateKillZoneStrength(towers);

    const capabilities = defense.capabilities;
    const vulnerabilities = analyzeVulnerabilities(towers, capabilities);

    const snapshot: GameStateSnapshot = {
      timestamp: Date.now(),
      waveNumber: this.store.waveNumber(),
      // Time since the RUN started, not since the current wave started — the
      // encoder normalises this against a one-hour horizon, so a per-wave value
      // made the feature a near-constant.
      gameTimeSeconds: (this.now() - this.gameStartTime) / 1000,
      phase: this.store.phase() as GamePhase,

      player: playerState(this.store.baseHealth(), credits),
      defense,
      vulnerabilities,
      recentHistory: this.history.summary(),
      dpsProfile: this.getDPSProfile(towers, airTargetingUnlocked),
      research: researchSnapshot(this.researchStore),
      expectedArmorDistribution: expectedArmorDistribution(this.currentWaveConfig, this.store.waveNumber() + 1),
    };

    // Pre-compute dpsByDamageType so Python backend receives it via WebSocket
    // (encoder fallback also works, but pre-computing guarantees sync).
    snapshot.dpsByDamageType = computeDpsByDamageType(snapshot);

    this.lastSnapshot.set(snapshot);
    return snapshot;
  }

  /**
   * Get wave history for AI context
   */
  getWaveHistory(): WaveResult[] {
    return this.history.all();
  }

  /**
   * Get the last N wave results
   */
  getRecentWaveResults(count = 5): WaveResult[] {
    return this.history.recent(count);
  }

  /**
   * Manually set the current wave config (called by WaveDirector)
   */
  setCurrentWaveConfig(config: WaveConfig): void {
    this.currentWaveConfig = config;
  }

  /**
   * Clear all collected data (for new game)
   */
  clearHistory(): void {
    this.history.clear();
    this.waveResultCount.set(0);
    this.resetCurrentWave();
  }

  // === PRIVATE METHODS ===

  private subscribeToEvents(): void {
    // Wave lifecycle
    this.subscriptions.add(
      this.eventBus.onLive('wave:started', (event) => this.onWaveStarted(event))
    );
    this.subscriptions.add(
      this.eventBus.onLive('wave:completed', (event) => this.onWaveCompleted(event))
    );

    // Enemy events
    this.subscriptions.add(
      this.eventBus.onLive('enemy:spawned', (event) => this.onEnemySpawned(event))
    );
    this.subscriptions.add(
      this.eventBus.onLive('enemy:died', (event) => this.onEnemyDied(event))
    );
    this.subscriptions.add(
      this.eventBus.onLive('enemy:reached-base', (event) => this.onEnemyReachedBase(event))
    );
    // An ooze is a leak from its first point that flows into the base on
    this.subscriptions.add(
      this.eventBus.onLive('enemy:leaking', (event) => {
        this.currentWave.enemyLeaking(event.enemy.id, event.enemy.typeConfig.id, this.now());
      })
    );
    this.subscriptions.add(
      this.eventBus.onLive('enemy:split', (event) => this.onEnemySplit(event))
    );
    // A worm is one announced enemy and one body per segment, like a split
    this.subscriptions.add(
      this.eventBus.onLive('worm:spawned', (event) => this.currentWave.enemiesSplit(event.group.size - 1))
    );
    // Ability kills: the fairness gate books them as leaks (leakRatio).
    // Their enemy:died already recorded them as killed.
    this.subscriptions.add(
      this.eventBus.onLive('ability:resolved', (event) => {
        this.currentWave.abilityKilled(event.kills);
      })
    );

    // Health tracking
    this.subscriptions.add(
      this.eventBus.onLive('health:changed', (event) => this.onHealthChanged(event))
    );

    // Game lifecycle
    this.subscriptions.add(
      this.eventBus.onLive('game:started', () => this.onGameStarted())
    );
    this.subscriptions.add(
      this.eventBus.onLive('game:over', (event) => this.onGameOver(event))
    );

    // Tower events → invalidate DPS profile cache
    this.subscriptions.add(
      this.eventBus.onLive('tower:placed', () => this.invalidateDPSProfile())
    );
    this.subscriptions.add(
      this.eventBus.onLive('tower:sold', () => this.invalidateDPSProfile())
    );
    this.subscriptions.add(
      this.eventBus.onLive('tower:upgraded', () => this.invalidateDPSProfile())
    );
  }

  private onWaveStarted(event: { wave: number; enemyCount: number }): void {
    this.currentWaveNumber = event.wave;
    this.currentWave.start(event.enemyCount, this.store.baseHealth(), this.now());
  }

  private onEnemySpawned(event: { enemy: Enemy }): void {
    this.currentWave.enemySpawned(event.enemy.id, event.enemy.typeConfig.id, this.now());
  }

  /**
   * Split children count as spawned. `enemiesSpawned` starts at the wave's
   * announced size and is the backend's count of bodies, like the per-enemy
   * progress list the leak share is read from: every body the wave put on the
   * route, children included, so a leaked minion is a leak like any other.
   */
  private onEnemySplit(event: { children: readonly Enemy[] }): void {
    this.currentWave.enemiesSplit(event.children.length);
  }

  private onWaveCompleted(event: { wave: number; credits: number; perfect: boolean }): void {
    // Drop the wave the game-over path already finalised.
    //
    // When the last leaker of a wave is also the one that destroys the base,
    // both fire for the same wave: the wave-complete check runs before the
    // game-over check, but `wave:completed` is emitted deferred while
    // `game:over` is synchronous, so the finaliser goes first and this handler
    // arrives afterwards for a wave that is already recorded. That produced a
    // duplicate history entry, and now also a second recordWave — a doubled
    // gate back-off on the most common way a run ends.
    if (this.finalizedWaveNumber === event.wave) {
      this.finalizedWaveNumber = null;
      return;
    }

    const outcome = this.currentWave.finalize('completed', this.now());
    // The WaveManager's verdict, the one the PerfectBonus pays on
    outcome.perfect = event.perfect;
    this.recordWave(event.wave, outcome);

    // Reset for next wave
    this.resetCurrentWave();
  }

  private onEnemyDied(event: { enemy: Enemy; credits: number }): void {
    // Track path progress (Enemy IS a GameObject, so access components directly)
    const movement = event.enemy.getComponent(ComponentType.MOVEMENT) as MovementComponent | undefined;
    this.currentWave.enemyDied(
      event.enemy.id,
      event.enemy.typeConfig.id,
      movement ? movement.getPathProgress() : undefined,
      this.now(),
    );
  }

  private onEnemyReachedBase(event: { enemy: { id: string; typeConfig: { id: string } }; damage: number }): void {
    // NOTE: `event.damage` is the NOMINAL leak cost. What the player actually
    // loses is accumulated in `onHealthChanged` from the health delta, which
    // is also what a base already at zero stops paying.
    this.currentWave.enemyReachedBase(event.enemy.id, event.enemy.typeConfig.id, this.now());
  }

  private onHealthChanged(event: { health: number; delta: number }): void {
    // Actual HP lost. This is the figure the analysis is computed from; the
    // nominal per-enemy cost is not.
    this.currentWave.healthChanged(event.health, event.delta);
  }

  private onGameStarted(): void {
    this.clearHistory();
    this.gameStartTime = this.now();
    this.currentWave.restartClock(this.gameStartTime);
  }

  private onGameOver(event: { reason: string }): void {
    // Finalize the current wave as a player death (wave:completed is not
    // emitted on game over). Nothing to record before the first wave.
    if (event.reason !== 'base-destroyed' || this.currentWaveNumber <= 0) return;

    const outcome = this.currentWave.finalize('base-destroyed', this.now());
    this.finalizedWaveNumber = this.currentWaveNumber;
    this.recordWave(this.currentWaveNumber, outcome);
  }

  /** Store a finalised wave with the config it ran (a default when the director set none). */
  private recordWave(waveNumber: number, outcome: WaveOutcome): void {
    const result: WaveResult = {
      waveNumber,
      timestamp: Date.now(),
      config: this.currentWaveConfig || createSimpleWaveConfig('zombie', 10),
      outcome,
    };
    this.addToHistory(result);
    this.waveResultCount.update((n) => n + 1);
  }

  /**
   * Notified for every completed wave, including the game-over one.
   *
   * `addToHistory` is the single point both paths pass through — the normal
   * `wave:completed` handler and the game-over finaliser, which exists because
   * `wave:completed` is never emitted when the base falls. Anything that needs
   * to see every wave has to hang here; subscribing to the event instead would
   * silently miss exactly the wave that ended the run.
   */
  onWaveResult(listener: (result: WaveResult) => void): () => void {
    this.waveResultListeners.push(listener);
    return () => {
      const i = this.waveResultListeners.indexOf(listener);
      if (i >= 0) this.waveResultListeners.splice(i, 1);
    };
  }

  private waveResultListeners: ((result: WaveResult) => void)[] = [];

  /**
   * Wave already recorded by the game-over finaliser, so the deferred
   * `wave:completed` for it must be ignored. See onWaveCompleted.
   */
  private finalizedWaveNumber: number | null = null;

  private addToHistory(result: WaveResult): void {
    this.history.add(result);
    for (const listener of this.waveResultListeners) {
      try {
        listener(result);
      } catch (error) {
        // A misbehaving listener must not cost us the wave history entry.
        console.error('[AI] wave-result listener threw', error);
      }
    }
  }

  private resetCurrentWave(): void {
    this.currentWaveConfig = null;
    this.currentWave.reset();
  }

  /**
   * Get the current DPS profile (public accessor for visualization).
   * Uses cached value if towers haven't changed.
   */
  getCurrentDPSProfile(): PathDPSProfile {
    return this.getDPSProfile(
      this.gameState.towerManager.getAll(),
      this.researchStore.airTargetingUnlocked(),
    );
  }

  /**
   * Compute DPS profile with caching.
   * Only recomputes when towers change (place/sell/upgrade) or AA-Retrofit unlocks.
   */
  private getDPSProfile(towers: Tower[], airTargetingUnlocked: boolean): PathDPSProfile {
    // Compute a hash of tower state for cache invalidation (retrofit changes air bins)
    const hash = `${this.computeTowerHash(towers)}|aa:${airTargetingUnlocked ? 1 : 0}`;

    if (this.cachedDPSProfile && this.dpsProfileTowerHash === hash) {
      return this.cachedDPSProfile;
    }

    // Need grid and coordinateSync to compute profile
    const grid = this.gridService.getGrid();
    const coordinateSync = this.gridService.getCoordinateSync();
    if (!grid || !coordinateSync || !this.gridService.isInitialized()) {
      return createEmptyDPSProfile();
    }

    const routes = this.gameState.getCachedRoutes();
    if (!routes.length) {
      return createEmptyDPSProfile();
    }

    this.cachedDPSProfile = computePathDPSProfile(
      routes,
      grid,
      towers,
      coordinateSync,
      airTargetingUnlocked,
    );
    this.dpsProfileTowerHash = hash;
    return this.cachedDPSProfile;
  }

  private invalidateDPSProfile(): void {
    this.cachedDPSProfile = null;
    this.dpsProfileTowerHash = '';
  }

  private computeTowerHash(towers: Tower[]): string {
    // Cache key for the DPS profile: changes on place, sell and upgrade.
    //
    // Uses the real DPS function rather than `damage * fireRate`. That shortcut
    // is 0 for beam towers (Fire keeps its damage in `damagePerSecond`) and
    // ignores chain falloff, splash and DoT — so upgrading a Fire or Lightning
    // tower left the hash unchanged and the profile stale.
    let hash = towers.length.toString();
    let dpsSum = 0;
    for (const t of towers) {
      dpsSum += computeTowerDPS(t);
    }
    hash += '_' + Math.round(dpsSum);
    return hash;
  }
}
