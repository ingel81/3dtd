import { Injectable, inject, signal, computed } from '@angular/core';
import { EnemyManager } from './enemy.manager';
import { TowerManager } from './tower.manager';
import { ProjectileManager } from './projectile.manager';
import { WaveManager, SpawnPoint, WaveConfig } from './wave.manager';
import { StreetNetwork } from '../services/osm-street.service';
import { GeoPosition } from '../models/game.types';
import { GameObject } from '../core/game-object';
import { Enemy } from '../entities/enemy.entity';
import { Projectile } from '../entities/projectile.entity';
import { EnemyTypeId } from '../models/enemy-types';
import { TowerTypeId, TOWER_TYPES } from '../configs/tower-types.config';
import { Tower } from '../entities/tower.entity';
import { ThreeTilesEngine } from '../three-engine';

/** Fire intensity levels for visual effects */
type FireIntensity = 'tiny' | 'small' | 'medium' | 'large' | 'inferno';

/**
 * Main game state orchestrator - coordinates all entity managers
 *
 * Handles game lifecycle, wave progression, and provides a unified API
 * for the game component to interact with.
 */
@Injectable()
export class GameStateManager {
  // Entity managers
  readonly enemyManager = inject(EnemyManager);
  readonly towerManager = inject(TowerManager);
  readonly projectileManager = inject(ProjectileManager);
  readonly waveManager = inject(WaveManager);

  // Game state signals
  readonly baseHealth = signal(100);
  readonly credits = signal(100);
  readonly showGameOverScreen = signal(false);

  // Computed signals for UI bindings
  readonly phase = computed(() => this.waveManager.phase());
  readonly waveNumber = computed(() => this.waveManager.waveNumber());
  readonly towerCount = computed(() => this.towerManager.getAll().length);
  readonly enemiesAlive = computed(() => this.enemyManager.getAliveCount());
  readonly selectedTowerId = computed(() => this.towerManager.getSelectedId());
  readonly selectedTower = computed(() => this.towerManager.getSelected());

  // Engine reference
  private tilesEngine: ThreeTilesEngine | null = null;
  private lastUpdateTime = 0;
  private basePosition: GeoPosition | null = null;

  // Callbacks
  private onGameOverCallback?: () => void;
  private onDebugLogCallback?: (msg: string) => void;

  // Track active fire effect ID
  private activeFireId: string | null = null;

  /**
   * Initialize game state with ThreeTilesEngine
   */
  initialize(
    tilesEngine: ThreeTilesEngine,
    streetNetwork: StreetNetwork,
    basePosition: GeoPosition,
    spawnPoints: SpawnPoint[],
    cachedPaths: Map<string, GeoPosition[]>,
    onDebugLog?: (msg: string) => void,
    onGameOver?: () => void
  ): void {
    this.tilesEngine = tilesEngine;
    this.basePosition = basePosition;
    this.onGameOverCallback = onGameOver;
    this.onDebugLogCallback = onDebugLog;

    // Initialize entity managers
    this.enemyManager.initialize(
      tilesEngine,
      (enemy) => this.onEnemyReachedBase(enemy)
    );

    this.towerManager.initializeWithContext(
      tilesEngine,
      streetNetwork,
      basePosition,
      spawnPoints.map((s) => ({ lat: s.latitude, lon: s.longitude }))
    );

    this.projectileManager.initialize(
      tilesEngine,
      (proj, enemy) => this.onProjectileHit(proj, enemy)
    );

    this.waveManager.initialize(spawnPoints, cachedPaths);

    console.log('[GameStateManager] Initialized');
  }

  /**
   * Main update loop - called each frame during wave phase
   */
  update(currentTime: number): void {
    const deltaTime = this.lastUpdateTime ? currentTime - this.lastUpdateTime : 16;
    this.lastUpdateTime = currentTime;

    if (this.waveManager.phase() !== 'wave') return;

    // Update all entity managers
    this.enemyManager.update(deltaTime);
    this.updateTowerShooting(currentTime);
    this.projectileManager.update(deltaTime);

    // Check wave completion
    if (this.waveManager.checkWaveComplete()) {
      this.waveManager.endWave();
      this.credits.update((c) => c + 50);
    }

    // Check game over
    if (this.baseHealth() <= 0 && this.waveManager.phase() !== 'gameover') {
      this.triggerGameOver();
    } else if (this.baseHealth() < 100 && this.baseHealth() > 0) {
      this.updateFireIntensity();
    }
  }

  /**
   * Update tower shooting - find targets and spawn projectiles
   */
  private updateTowerShooting(currentTime: number): void {
    const enemies = this.enemyManager.getAlive();

    for (const tower of this.towerManager.getAllActive()) {
      if (!tower.combat.canFire(currentTime)) continue;

      const target = tower.findTarget(enemies);
      if (target) {
        tower.combat.fire(currentTime);
        this.projectileManager.spawn(tower, target);
      }
    }
  }

  /**
   * Handle enemy reaching the base
   */
  private onEnemyReachedBase(enemy: Enemy): void {
    this.baseHealth.update((h) => Math.max(0, h - 10));
    this.updateFireIntensity();
  }

  /**
   * Handle projectile hitting an enemy
   */
  private onProjectileHit(projectile: Projectile, enemy: Enemy): void {
    // Spawn blood effects for enemies that can bleed
    if (enemy.typeConfig.canBleed && this.tilesEngine) {
      // Blood particle splatter
      this.tilesEngine.effects.spawnBloodSplatter(
        enemy.position.lat,
        enemy.position.lon,
        enemy.transform.terrainHeight + 1,
        15 // Fewer particles for hits
      );

      // Blood decal on ground (small)
      this.tilesEngine.effects.spawnBloodDecal(
        enemy.position.lat,
        enemy.position.lon,
        enemy.transform.terrainHeight,
        0.8 // Small decal for hit
      );
    }

    const killed = enemy.health.takeDamage(projectile.damage);
    if (killed) {
      this.spawnDeathBloodEffect(enemy);
      this.enemyManager.kill(enemy);

      const reward = enemy.typeConfig.reward;
      this.credits.update((c) => c + reward);

      // Show reward popup
      if (this.tilesEngine && reward > 0) {
        this.tilesEngine.effects.spawnFloatingText(
          `+${reward}`,
          enemy.position.lat,
          enemy.position.lon,
          enemy.transform.terrainHeight + 5,
          {
            color: '#FFD700', // Gold
            duration: 1200,
            floatSpeed: 1.5,
            scale: 2.5,
          }
        );
      }

      // Track kill on the source tower
      const sourceTower = this.towerManager.getById(projectile.sourceTowerId);
      if (sourceTower) {
        sourceTower.combat.kills++;
      }
    }
  }

  /**
   * Spawn large blood effect when enemy dies
   */
  private spawnDeathBloodEffect(enemy: Enemy): void {
    if (!enemy.typeConfig.canBleed || !this.tilesEngine) return;

    // Large blood splatter
    this.tilesEngine.effects.spawnBloodSplatter(
      enemy.position.lat,
      enemy.position.lon,
      enemy.transform.terrainHeight + 1,
      40 // More particles for death
    );

    // Large blood decal on ground
    this.tilesEngine.effects.spawnBloodDecal(
      enemy.position.lat,
      enemy.position.lon,
      enemy.transform.terrainHeight,
      2.0 // Larger decal for death
    );
  }

  /**
   * Update fire intensity based on base health
   */
  private updateFireIntensity(): void {
    if (!this.basePosition || !this.tilesEngine) return;

    const health = this.baseHealth();
    let intensity: FireIntensity;

    if (health < 20) intensity = 'large';
    else if (health < 40) intensity = 'medium';
    else if (health < 60) intensity = 'small';
    else intensity = 'tiny';

    if (this.activeFireId) {
      this.tilesEngine.effects.stopFire(this.activeFireId);
    }

    this.activeFireId = this.tilesEngine.effects.spawnFire(
      this.basePosition.lat,
      this.basePosition.lon,
      this.basePosition.height || 235,
      intensity
    );
  }

  /**
   * Trigger game over state
   */
  private triggerGameOver(): void {
    this.waveManager.phase.set('gameover');
    this.enemyManager.clear();

    // Show inferno fire at base
    if (this.basePosition && this.tilesEngine) {
      if (this.activeFireId) {
        this.tilesEngine.effects.stopFire(this.activeFireId);
      }
      this.activeFireId = this.tilesEngine.effects.spawnFire(
        this.basePosition.lat,
        this.basePosition.lon,
        this.basePosition.height || 235,
        'inferno'
      );
    }

    this.onGameOverCallback?.();

    setTimeout(() => {
      this.showGameOverScreen.set(true);
    }, 5000);
  }

  // ============================================
  // Public API
  // ============================================

  /**
   * Start a new wave with config
   */
  startWave(config: WaveConfig): void {
    this.waveManager.startWave(config);
  }

  /**
   * Begin wave phase without auto-spawning
   */
  beginWave(): void {
    this.waveManager.beginWave();
  }

  /**
   * Heal base to full health
   */
  healBase(): void {
    this.baseHealth.set(100);
    if (this.tilesEngine) {
      this.tilesEngine.effects.stopAllFires();
      this.activeFireId = null;
    }
  }

  /**
   * Reset game to initial state
   */
  reset(): void {
    this.enemyManager.clear();
    this.towerManager.clear();
    this.projectileManager.clear();
    this.waveManager.reset();

    if (this.tilesEngine) {
      this.tilesEngine.effects.clear();
      this.activeFireId = null;
    }

    this.baseHealth.set(100);
    this.credits.set(100);
    this.showGameOverScreen.set(false);
    this.lastUpdateTime = 0;

    GameObject.resetIdCounter();
  }

  /**
   * Get all towers
   */
  towers(): Tower[] {
    return this.towerManager.getAll();
  }

  /**
   * Get all enemies
   */
  enemies(): Enemy[] {
    return this.enemyManager.getAll();
  }

  /**
   * Spawn an enemy
   */
  spawnEnemy(
    path: GeoPosition[],
    typeId: EnemyTypeId,
    speed?: number,
    paused = false
  ): Enemy {
    return this.enemyManager.spawn(path, typeId, speed, paused);
  }

  /**
   * Start all paused enemies
   */
  startAllEnemies(delayBetween = 300): void {
    this.enemyManager.startAll(delayBetween);
  }

  /**
   * Select a tower
   */
  selectTower(id: string): void {
    this.towerManager.selectTower(id);
  }

  /**
   * Deselect all towers
   */
  deselectAll(): void {
    this.towerManager.selectTower(null);
  }

  /**
   * Sell a tower and refund 50% of its cost
   */
  sellTower(tower: Tower): number {
    const refund = tower.typeConfig.sellValue;
    this.towerManager.selectTower(null);
    this.towerManager.remove(tower);
    this.credits.update((c) => c + refund);
    return refund;
  }

  /**
   * Spend credits (for upgrades etc.)
   * @returns true if credits were spent, false if not enough
   */
  spendCredits(amount: number): boolean {
    if (this.credits() < amount) return false;
    this.credits.update((c) => c - amount);
    return true;
  }

  /**
   * Place a new tower
   */
  placeTower(position: GeoPosition, typeId: TowerTypeId = 'archer'): Tower | null {
    const config = TOWER_TYPES[typeId];
    if (!config) return null;

    // Check if player has enough credits
    if (this.credits() < config.cost) {
      console.log(`[GameState] Not enough credits: have ${this.credits()}, need ${config.cost}`);
      return null;
    }

    const tower = this.towerManager.placeTower(position, typeId);
    if (tower) {
      // Deduct cost
      this.credits.update((c) => c - config.cost);
    }
    return tower;
  }

  /**
   * Kill an enemy
   */
  killEnemy(enemy: Enemy): void {
    this.enemyManager.kill(enemy);
  }

  /**
   * Check if wave is complete
   */
  checkWaveComplete(): boolean {
    return this.waveManager.checkWaveComplete();
  }

  /**
   * End current wave
   */
  endWave(): void {
    this.waveManager.endWave();
  }

  /**
   * Log debug message
   */
  debugLog(msg: string): void {
    this.onDebugLogCallback?.(msg);
  }
}
