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
 * IMPORTANT: This service is completely optional.
 * The game works fine without it.
 */

import { Injectable, inject, signal, computed } from '@angular/core';
import { GamePhase } from '../../models/game.types';
import { SubscriptionBag } from '../../game-engine/game-event-bus';
import { Enemy } from '../../entities/enemy.entity';
import { GameStateManager } from '../../managers/game-state.manager';
import { TowerDefenseStore } from '../../store/tower-defense.store';
import { ResearchStore } from '../../store/research.store';
import {
  GameStateSnapshot,
  PlayerState,
  RecentHistory,
  ResearchSnapshot,
} from './models/game-state-snapshot';
import { RESEARCH_TREE } from '../../configs/research/research-tree.config';
import { TOWER_TYPES, TowerTypeId } from '../../configs/tower-types.config';
import { ArmorType } from '../../configs/combat/combat.types';
import { getEnemyType, EnemyTypeId } from '../../models/enemy-types';
import { WaveResult, WaveOutcome } from './models/wave-result';
import { WaveConfig, createSimpleWaveConfig } from './models/wave-config';
import {
  analyzeDefense,
  analyzeVulnerabilities,
  estimatePathCoverage,
  estimateKillZoneStrength,
} from './defense-analyzer';
import { calculateWaveThreat, computeDpsByDamageType } from './game-state-encoder';
import { GAME_BALANCE } from '../../configs/game-balance.config';
import { ComponentType } from '../../core/component';
import { MovementComponent } from '../../game-components/movement.component';
import { GlobalRouteGridService } from '../../services/global-route-grid.service';
import { computePathDPSProfile, createEmptyDPSProfile, PathDPSProfile } from './dps-profile';
import { Tower } from '../../entities/tower.entity';

/** Maximum number of waves to keep in history */
const MAX_HISTORY_SIZE = 10;

/** Close call threshold (health percentage) */
const CLOSE_CALL_THRESHOLD = 0.3;

@Injectable() // Provided in TowerDefenseComponent alongside GameStateManager
export class AIDataCollectorService {
  private gameState = inject(GameStateManager);
  private store = inject(TowerDefenseStore);
  private researchStore = inject(ResearchStore);
  private gridService = inject(GlobalRouteGridService);
  // Get eventBus from GameStateManager (not directly injectable)
  private get eventBus() {
    return this.gameState.getEventBus();
  }

  private subscriptions = new SubscriptionBag();

  // === DPS PROFILE CACHE ===
  private cachedDPSProfile: PathDPSProfile | null = null;
  private dpsProfileTowerHash = '';

  // === CURRENT WAVE TRACKING ===
  private currentWaveNumber = 0;
  private currentWaveStartTime = 0;
  private currentWaveConfig: WaveConfig | null = null;
  private currentWaveOutcome: Partial<WaveOutcome> = {};
  private lowestHealthThisWave = 100;
  private enemySpawnTimes = new Map<string, number>();
  private enemyPathProgress = new Map<string, number>();

  // === HISTORY ===
  private waveHistory: WaveResult[] = [];
  private damageHistory: number[] = [];
  private progressHistory: number[] = [];
  private nearMissHistory: number[] = [];
  private enemyTypesHistory: string[][] = [];
  private threatHistory: number[] = [];

  // === SIGNALS FOR UI ===
  readonly isCollecting = signal(false);
  readonly lastSnapshot = signal<GameStateSnapshot | null>(null);
  readonly waveResultCount = signal(0);

  readonly recentAvgDamage = computed(() => {
    if (this.damageHistory.length === 0) return 0;
    const sum = this.damageHistory.reduce((a, b) => a + b, 0);
    return sum / this.damageHistory.length;
  });

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
    const airTargetingUnlocked = this.researchStore.airTargetingUnlocked();
    const defense = analyzeDefense(towers, airTargetingUnlocked);

    // Enhance defense with spatial metrics
    defense.pathCoverage = estimatePathCoverage(towers, 500); // Estimated 500m path
    defense.defenseReachPercent = this.gridService.getDefenseReachPercent(this.gameState.getCachedRoutes());
    defense.killZoneStrength = estimateKillZoneStrength(towers);

    const capabilities = defense.capabilities;
    const vulnerabilities = analyzeVulnerabilities(towers, capabilities);

    const snapshot: GameStateSnapshot = {
      timestamp: Date.now(),
      waveNumber: this.store.waveNumber(),
      gameTimeSeconds: (Date.now() - this.currentWaveStartTime) / 1000,
      phase: this.store.phase() as GamePhase,

      player: this.getPlayerState(),
      defense,
      vulnerabilities,
      recentHistory: this.getRecentHistory(),
      dpsProfile: this.getDPSProfile(towers, airTargetingUnlocked),
      research: this.getResearchSnapshot(),
      expectedArmorDistribution: this.getExpectedArmorDistribution(),
    };

    // Pre-compute dpsByDamageType so Python backend receives it via WebSocket
    // (encoder fallback also works, but pre-computing guarantees sync).
    snapshot.dpsByDamageType = computeDpsByDamageType(snapshot);

    this.lastSnapshot.set(snapshot);
    return snapshot;
  }

  /** Build a research-state snapshot from ResearchStore. */
  private getResearchSnapshot(): ResearchSnapshot {
    const completed = this.researchStore.completedResearches();
    const totalCount = Object.keys(RESEARCH_TREE).length;

    // Build per-tower unlock map
    const towerUnlocked: Record<TowerTypeId, boolean> = {} as Record<TowerTypeId, boolean>;
    for (const id of Object.keys(TOWER_TYPES) as TowerTypeId[]) {
      towerUnlocked[id] = this.researchStore.isTowerUnlocked(id);
    }

    const activeResearches = this.researchStore.activeResearches();
    return {
      completedIds: [...completed],
      completedCount: completed.size,
      totalCount,
      activeIds: activeResearches.map(a => a.researchId),
      centerLevel: this.researchStore.centerLevel(),
      slotsUsed: activeResearches.length,
      maxSlots: this.researchStore.researchSlots(),
      airTargetingUnlocked: this.researchStore.airTargetingUnlocked(),
      maxUpgradeTier: this.researchStore.maxUpgradeTier(),
      towerUnlocked,
    };
  }

  /** Approximate the armor distribution expected in the current wave config. */
  private getExpectedArmorDistribution(): Record<ArmorType, number> | undefined {
    const config = this.currentWaveConfig;
    if (!config || !config.enemies || config.enemies.length === 0) return undefined;

    const dist: Record<ArmorType, number> = {
      unarmored: 0, light: 0, heavy: 0, fortified: 0, ethereal: 0,
    };
    let total = 0;
    for (const group of config.enemies) {
      const enemyCfg = getEnemyType(group.type as EnemyTypeId);
      if (!enemyCfg?.armorType) continue;
      dist[enemyCfg.armorType] += group.count;
      total += group.count;
    }
    if (total === 0) return undefined;
    for (const k of Object.keys(dist) as ArmorType[]) {
      dist[k] /= total;
    }
    return dist;
  }

  /**
   * Get wave history for AI context
   */
  getWaveHistory(): WaveResult[] {
    return [...this.waveHistory];
  }

  /**
   * Get the last N wave results
   */
  getRecentWaveResults(count = 5): WaveResult[] {
    return this.waveHistory.slice(-count);
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
    this.waveHistory = [];
    this.damageHistory = [];
    this.progressHistory = [];
    this.nearMissHistory = [];
    this.enemyTypesHistory = [];
    this.threatHistory = [];
    this.waveResultCount.set(0);
    this.resetCurrentWave();
  }

  // === PRIVATE METHODS ===

  private subscribeToEvents(): void {
    // Wave lifecycle
    this.subscriptions.add(
      this.eventBus.on('wave:started', (event) => this.onWaveStarted(event))
    );
    this.subscriptions.add(
      this.eventBus.on('wave:completed', (event) => this.onWaveCompleted(event))
    );

    // Enemy events
    this.subscriptions.add(
      this.eventBus.on('enemy:spawned', (event) => this.onEnemySpawned(event))
    );
    this.subscriptions.add(
      this.eventBus.on('enemy:died', (event) => this.onEnemyDied(event))
    );
    this.subscriptions.add(
      this.eventBus.on('enemy:reached-base', (event) => this.onEnemyReachedBase(event))
    );

    // Health tracking
    this.subscriptions.add(
      this.eventBus.on('health:changed', (event) => this.onHealthChanged(event))
    );

    // Game lifecycle
    this.subscriptions.add(
      this.eventBus.on('game:started', () => this.onGameStarted())
    );
    this.subscriptions.add(
      this.eventBus.on('game:over', (event) => this.onGameOver(event))
    );

    // Tower events → invalidate DPS profile cache
    this.subscriptions.add(
      this.eventBus.on('tower:placed', () => this.invalidateDPSProfile())
    );
    this.subscriptions.add(
      this.eventBus.on('tower:sold', () => this.invalidateDPSProfile())
    );
    this.subscriptions.add(
      this.eventBus.on('tower:upgraded', () => this.invalidateDPSProfile())
    );
  }

  private onWaveStarted(event: { wave: number; enemyCount: number }): void {
    this.currentWaveNumber = event.wave;
    this.currentWaveStartTime = Date.now();
    this.lowestHealthThisWave = this.store.baseHealth();

    // Reset outcome tracking
    this.currentWaveOutcome = {
      enemiesSpawned: event.enemyCount,
      enemiesKilled: 0,
      enemiesReachedBase: 0,
      damageToPlayer: 0,
      damagePercent: 0,
      waveDurationMs: 0,
      avgEnemyLifetimeMs: 0,
      avgPathProgressPercent: 0,
      lowestPlayerHealth: this.lowestHealthThisWave,
      wasCloseCall: false,
      playerSurvived: true,
      enemyPerformance: {},
    };

    this.enemySpawnTimes.clear();
    this.enemyPathProgress.clear();
  }

  private onEnemySpawned(event: { enemy: Enemy }): void {
    // Track spawn time for lifetime calculation
    this.enemySpawnTimes.set(event.enemy.id, Date.now());

    // Update per-enemy-type spawn count
    const enemyType = event.enemy.typeConfig.id;
    const perf = this.currentWaveOutcome.enemyPerformance || {};
    if (!perf[enemyType]) {
      perf[enemyType] = {
        spawned: 0,
        killed: 0,
        reachedBase: 0,
        avgLifetimeMs: 0,
        totalDamageDealt: 0,
      };
    }
    perf[enemyType].spawned++;
    this.currentWaveOutcome.enemyPerformance = perf;
  }

  private onWaveCompleted(event: { wave: number; credits: number }): void {
    const duration = Date.now() - this.currentWaveStartTime;

    // Get training timescale for normalization
    const timescale = this.gameState.trainingTimescale();

    // Finalize outcome (normalize time metrics by dividing by timescale)
    this.currentWaveOutcome.waveDurationMs = duration / timescale;
    this.currentWaveOutcome.lowestPlayerHealth = this.lowestHealthThisWave;
    this.currentWaveOutcome.wasCloseCall =
      this.lowestHealthThisWave / GAME_BALANCE.player.startHealth < CLOSE_CALL_THRESHOLD;

    // Calculate average enemy lifetime (normalized)
    if (this.enemySpawnTimes.size > 0) {
      let totalLifetime = 0;
      let count = 0;
      for (const spawnTime of this.enemySpawnTimes.values()) {
        totalLifetime += Date.now() - spawnTime;
        count++;
      }
      this.currentWaveOutcome.avgEnemyLifetimeMs = (totalLifetime / count) / timescale;
    }

    // Calculate path progress metrics
    if (this.enemyPathProgress.size > 0) {
      const progressValues = Array.from(this.enemyPathProgress.values());
      let totalProgress = 0;
      for (const progress of progressValues) {
        totalProgress += progress;
      }
      this.currentWaveOutcome.avgPathProgressPercent = totalProgress / progressValues.length;
      this.currentWaveOutcome.enemyProgressValues = progressValues;
    } else {
      this.currentWaveOutcome.avgPathProgressPercent = 0;
      this.currentWaveOutcome.enemyProgressValues = [];
    }

    // Normalize per-enemy-type lifetimes
    if (this.currentWaveOutcome.enemyPerformance) {
      for (const enemyType in this.currentWaveOutcome.enemyPerformance) {
        const perf = this.currentWaveOutcome.enemyPerformance[enemyType];
        if (perf.avgLifetimeMs > 0) {
          perf.avgLifetimeMs = perf.avgLifetimeMs / timescale;
        }
      }
    }

    // Create wave result
    const config = this.currentWaveConfig || createSimpleWaveConfig('zombie', 10);
    const result: WaveResult = {
      waveNumber: event.wave,
      timestamp: Date.now(),
      config,
      outcome: this.currentWaveOutcome as WaveOutcome,
    };

    // Store in history
    this.addToHistory(result);
    this.waveResultCount.update((n) => n + 1);

    // Reset for next wave
    this.resetCurrentWave();
  }

  private onEnemyDied(event: { enemy: Enemy; credits: number }): void {
    this.currentWaveOutcome.enemiesKilled =
      (this.currentWaveOutcome.enemiesKilled || 0) + 1;

    // Track per-enemy-type performance
    const enemyType = event.enemy.typeConfig.id;
    this.updateEnemyPerformance(enemyType, 'killed');

    // Calculate lifetime
    const spawnTime = this.enemySpawnTimes.get(event.enemy.id);
    if (spawnTime) {
      const lifetime = Date.now() - spawnTime;
      this.updateEnemyLifetime(enemyType, lifetime);
    }

    // Track path progress (Enemy IS a GameObject, so access components directly)
    const movement = event.enemy.getComponent(ComponentType.MOVEMENT) as MovementComponent | undefined;
    if (movement) {
      const progress = movement.getPathProgress();
      this.enemyPathProgress.set(event.enemy.id, progress);
    }
  }

  private onEnemyReachedBase(event: { enemy: { id: string; typeConfig: { id: string } }; damage: number }): void {
    this.currentWaveOutcome.enemiesReachedBase =
      (this.currentWaveOutcome.enemiesReachedBase || 0) + 1;
    this.currentWaveOutcome.damageToPlayer =
      (this.currentWaveOutcome.damageToPlayer || 0) + event.damage;

    // Update damage percent
    const maxHealth = GAME_BALANCE.player.startHealth;
    this.currentWaveOutcome.damagePercent =
      (this.currentWaveOutcome.damageToPlayer || 0) / maxHealth;

    // Track per-enemy-type performance
    const enemyType = event.enemy.typeConfig.id;
    this.updateEnemyPerformance(enemyType, 'reachedBase');

    // Track path progress (enemies that reached base completed 100% of path)
    this.enemyPathProgress.set(event.enemy.id, 1.0);
  }

  private onHealthChanged(event: { health: number; delta: number }): void {
    if (event.health < this.lowestHealthThisWave) {
      this.lowestHealthThisWave = event.health;
    }
  }

  private onGameStarted(): void {
    this.clearHistory();
    this.currentWaveStartTime = Date.now();
  }

  private onGameOver(event: { reason: string }): void {
    // Mark current wave as player death if applicable
    if (event.reason === 'base-destroyed') {
      this.currentWaveOutcome.playerSurvived = false;

      // Finalize current wave outcome (since wave:completed won't be emitted on game over)
      if (this.currentWaveNumber > 0) {
        const duration = Date.now() - this.currentWaveStartTime;
        const timescale = this.gameState.trainingTimescale();

        // Finalize outcome
        this.currentWaveOutcome.waveDurationMs = duration / timescale;
        this.currentWaveOutcome.lowestPlayerHealth = this.lowestHealthThisWave;
        this.currentWaveOutcome.wasCloseCall = this.lowestHealthThisWave <= 0;

        // Calculate average enemy lifetime
        if (this.enemySpawnTimes.size > 0) {
          let totalLifetime = 0;
          let count = 0;
          for (const spawnTime of this.enemySpawnTimes.values()) {
            totalLifetime += Date.now() - spawnTime;
            count++;
          }
          this.currentWaveOutcome.avgEnemyLifetimeMs = (totalLifetime / count) / timescale;
        }

        // Calculate average path progress
        if (this.enemyPathProgress.size > 0) {
          let totalProgress = 0;
          for (const progress of this.enemyPathProgress.values()) {
            totalProgress += progress;
          }
          this.currentWaveOutcome.avgPathProgressPercent = totalProgress / this.enemyPathProgress.size;
        }

        // Normalize per-enemy-type lifetimes
        if (this.currentWaveOutcome.enemyPerformance) {
          for (const enemyType in this.currentWaveOutcome.enemyPerformance) {
            const perf = this.currentWaveOutcome.enemyPerformance[enemyType];
            if (perf.avgLifetimeMs > 0) {
              perf.avgLifetimeMs = perf.avgLifetimeMs / timescale;
            }
          }
        }

        // Create wave result
        const config = this.currentWaveConfig || createSimpleWaveConfig('zombie', 10);
        const result: WaveResult = {
          waveNumber: this.currentWaveNumber,
          timestamp: Date.now(),
          config,
          outcome: this.currentWaveOutcome as WaveOutcome,
        };

        // Store in history
        this.addToHistory(result);
        this.waveResultCount.update((n) => n + 1);

      }
    }
  }

  private updateEnemyPerformance(enemyType: string, outcome: 'killed' | 'reachedBase'): void {
    const perf = this.currentWaveOutcome.enemyPerformance || {};

    if (!perf[enemyType]) {
      perf[enemyType] = {
        spawned: 0,
        killed: 0,
        reachedBase: 0,
        avgLifetimeMs: 0,
        totalDamageDealt: 0,
      };
    }

    if (outcome === 'killed') {
      perf[enemyType].killed++;
    } else {
      perf[enemyType].reachedBase++;
    }

    this.currentWaveOutcome.enemyPerformance = perf;
  }

  private updateEnemyLifetime(enemyType: string, lifetimeMs: number): void {
    const perf = this.currentWaveOutcome.enemyPerformance || {};
    if (perf[enemyType]) {
      // Running average
      const current = perf[enemyType].avgLifetimeMs;
      const count = perf[enemyType].killed;
      perf[enemyType].avgLifetimeMs = (current * (count - 1) + lifetimeMs) / count;
    }
  }

  private addToHistory(result: WaveResult): void {
    this.waveHistory.push(result);
    this.damageHistory.push(result.outcome.damagePercent);
    this.progressHistory.push(result.outcome.avgPathProgressPercent);
    // Derive near-miss ratio from enemyProgressValues: fraction reaching >0.8
    const progressValues = result.outcome.enemyProgressValues ?? [];
    const nearMissRatio = progressValues.length > 0
      ? progressValues.filter((p) => p > 0.80).length / progressValues.length
      : 0;
    this.nearMissHistory.push(nearMissRatio);
    this.enemyTypesHistory.push(
      result.config.enemies.map((e) => e.type)
    );

    // Calculate and store threat rating for this wave
    const threatRating = calculateWaveThreat(result.config);
    this.threatHistory.push(threatRating);

    // Trim to max size
    if (this.waveHistory.length > MAX_HISTORY_SIZE) {
      this.waveHistory.shift();
      this.damageHistory.shift();
      this.progressHistory.shift();
      this.nearMissHistory.shift();
      this.enemyTypesHistory.shift();
      this.threatHistory.shift();
    }
  }

  private resetCurrentWave(): void {
    this.currentWaveConfig = null;
    this.currentWaveOutcome = {};
    this.lowestHealthThisWave = 100;
    this.enemySpawnTimes.clear();
    this.enemyPathProgress.clear();
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
    // Simple hash: tower count + sum of IDs + total DPS
    // Changes on place/sell/upgrade
    let hash = towers.length.toString();
    let dpsSum = 0;
    for (const t of towers) {
      dpsSum += t.combat.damage * t.combat.fireRate;
    }
    hash += '_' + Math.round(dpsSum);
    return hash;
  }

  private getPlayerState(): PlayerState {
    const health = this.store.baseHealth();
    const maxHealth = GAME_BALANCE.player.startHealth;

    return {
      credits: this.store.credits(),
      lives: health,
      maxLives: maxHealth,
      livesPercent: health / maxHealth,
    };
  }

  private getRecentHistory(): RecentHistory {
    // Count win streak (consecutive waves with 0 damage)
    let winStreak = 0;
    for (let i = this.damageHistory.length - 1; i >= 0; i--) {
      if (this.damageHistory[i] === 0) {
        winStreak++;
      } else {
        break;
      }
    }

    // Count close call streak
    let closeCallStreak = 0;
    for (let i = this.waveHistory.length - 1; i >= 0; i--) {
      if (this.waveHistory[i].outcome.wasCloseCall) {
        closeCallStreak++;
      } else {
        break;
      }
    }

    // Average wave duration
    let avgDuration = 0;
    if (this.waveHistory.length > 0) {
      const totalDuration = this.waveHistory.reduce(
        (sum, w) => sum + w.outcome.waveDurationMs,
        0
      );
      avgDuration = totalDuration / this.waveHistory.length / 1000; // Convert to seconds
    }

    // Get last wave threat rating (0 if no waves yet)
    const lastWaveThreat = this.threatHistory.length > 0
      ? this.threatHistory[this.threatHistory.length - 1]
      : 0;

    return {
      damagePerWave: [...this.damageHistory],
      progressPerWave: [...this.progressHistory],
      nearMissPerWave: [...this.nearMissHistory],
      enemyTypesUsed: [...this.enemyTypesHistory],
      lastWaveThreat,
      avgWaveDuration: avgDuration,
      winStreak,
      closeCallStreak,
    };
  }
}
