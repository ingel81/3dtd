import { Injectable, inject, signal, computed } from '@angular/core';
import { EnemyManager } from './enemy.manager';
import { TowerManager } from './tower.manager';
import { ProjectileManager } from './projectile.manager';
import { WaveManager, SpawnPoint, WaveConfig } from './wave.manager';
import { GameUIStateService } from '../services/game-ui-state.service';
import { PathAndRouteService } from '../services/path-route.service';
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
  private readonly uiState = inject(GameUIStateService);
  private readonly pathRouteService = inject(PathAndRouteService);

  // Game state signals
  readonly baseHealth = signal(100);
  readonly credits = signal(70);
  readonly showGameOverScreen = signal(false);

  // Computed signals for UI bindings
  readonly phase = computed(() => this.waveManager.phase());
  readonly waveNumber = computed(() => this.waveManager.waveNumber());
  readonly towerCount = computed(() => this.towerManager.getAll().length);
  get enemiesAlive() { return this.enemyManager.aliveCount; }
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

  // Cached HQ terrain height (calculated when tiles load)
  private hqTerrainHeight: number | null = null;

  // Sound IDs
  private static readonly HQ_DAMAGE_SOUND = 'hq_damage';

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

    // Register HQ damage sound
    if (tilesEngine.spatialAudio) {
      tilesEngine.spatialAudio.registerSound(
        GameStateManager.HQ_DAMAGE_SOUND,
        '/assets/sounds/small_hq_explosion.mp3',
        {
          refDistance: 40,
          rolloffFactor: 1,
          volume: 1.4,
        }
      );
    }

    // NOTE: Terrain height for fire is determined LIVE in updateFireIntensity()
    // because tiles may not be loaded yet at initialization time
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
   * Uses line-of-sight checks to ensure towers can see their targets
   */
  private updateTowerShooting(currentTime: number): void {
    const enemies = this.enemyManager.getAlive();

    for (const tower of this.towerManager.getAllActive()) {
      // Create LOS check function for this tower (used only when searching for NEW target)
      const losCheck = this.tilesEngine
        ? (enemy: Enemy) => {
            const pos = this.tilesEngine!.sync.geoToLocalSimple(
              enemy.position.lat,
              enemy.position.lon,
              enemy.transform.terrainHeight
            );
            return this.tilesEngine!.towers.hasLineOfSight(
              tower.id,
              pos.x,
              pos.y + 1.5,
              pos.z
            );
          }
        : undefined;

      // Fast path: get cached target or find new one
      let target = tower.findTarget(enemies, losCheck);

      if (target) {
        // Always rotate turret towards target
        const heading = this.calculateHeading(tower.position, target.position);
        this.tilesEngine?.towers.updateRotation(tower.id, heading);

        // Only fire if cooldown is ready AND turret is aligned
        const turretAligned = this.tilesEngine?.towers.isTurretAligned(tower.id) ?? true;
        if (tower.combat.canFire(currentTime) && turretAligned) {
          // Periodic LOS recheck (throttled to max ~3/sec per tower)
          // Skip LOS recheck for air enemies - they fly high enough to always be visible
          const isAirTarget = target.typeConfig.isAirUnit ?? false;
          if (losCheck && !isAirTarget && tower.needsLosRecheck(currentTime)) {
            tower.markLosChecked(currentTime);
            if (!losCheck(target)) {
              // Target no longer visible - find new target
              tower.clearTarget();
              target = tower.findTarget(enemies, losCheck);
              if (!target) {
                this.tilesEngine?.towers.resetRotation(tower.id);
                continue;
              }
              // Update rotation to new target, don't fire this frame
              const newHeading = this.calculateHeading(tower.position, target.position);
              this.tilesEngine?.towers.updateRotation(tower.id, newHeading);
              continue;
            }
          }

          tower.combat.fire(currentTime);
          this.projectileManager.spawn(tower, target);
        }
      } else {
        // No target - reset turret to base position
        this.tilesEngine?.towers.resetRotation(tower.id);
      }
    }
  }

  /**
   * Calculate heading angle from one geo position to another
   */
  private calculateHeading(
    from: { lat: number; lon: number },
    to: { lat: number; lon: number }
  ): number {
    const dLon = to.lon - from.lon;
    const dLat = to.lat - from.lat;
    return Math.atan2(dLon, dLat);
  }

  /**
   * Handle enemy reaching the base
   */
  private onEnemyReachedBase(_enemy: Enemy): void {
    this.baseHealth.update((h) => Math.max(0, h - 10));
    this.updateFireIntensity();

    // Play HQ damage sound at base position
    if (this.basePosition && this.tilesEngine?.spatialAudio) {
      this.tilesEngine.spatialAudio.playAtGeo(
        GameStateManager.HQ_DAMAGE_SOUND,
        this.basePosition.lat,
        this.basePosition.lon,
        this.basePosition.height ?? 0
      );
    }
  }

  /**
   * Handle projectile hitting an enemy
   */
  private onProjectileHit(projectile: Projectile, enemy: Enemy): void {
    const splashRadius = projectile.typeConfig.splashRadius;
    const hasSplash = splashRadius && splashRadius > 0;

    // Spawn explosion effect for splash damage projectiles
    if (hasSplash && this.tilesEngine) {
      this.tilesEngine.effects.spawnExplosionAtGeo(
        enemy.position.lat,
        enemy.position.lon,
        enemy.transform.terrainHeight + 2,
        30 // More particles for explosion
      );
    }

    // Apply damage to primary target
    this.applyDamageToEnemy(enemy, projectile.damage, projectile.sourceTowerId);

    // Apply splash damage to nearby enemies
    if (hasSplash) {
      const nearbyEnemies = this.enemyManager.getEnemiesInRadius(
        enemy.position,
        splashRadius,
        enemy.id // Exclude primary target
      );

      const useFalloff = projectile.typeConfig.splashDamageFalloff !== false;

      for (const nearbyEnemy of nearbyEnemies) {
        let splashDamage = projectile.damage;

        if (useFalloff) {
          // Calculate distance-based falloff
          const dist = this.calculateGeoDistance(enemy.position, nearbyEnemy.position);
          const falloff = 1 - (dist / splashRadius); // 1.0 at center, 0.0 at edge
          splashDamage = Math.floor(projectile.damage * falloff);
        }

        if (splashDamage > 0) {
          this.applyDamageToEnemy(nearbyEnemy, splashDamage, projectile.sourceTowerId, true);
        }
      }
    }
  }

  /**
   * Apply damage to an enemy and handle death
   */
  private applyDamageToEnemy(
    enemy: Enemy,
    damage: number,
    sourceTowerId: string,
    isSplashDamage = false
  ): void {
    // Spawn blood effects for enemies that can bleed
    if (enemy.typeConfig.canBleed && this.tilesEngine) {
      // Blood particle splatter (fewer for splash)
      this.tilesEngine.effects.spawnBloodSplatter(
        enemy.position.lat,
        enemy.position.lon,
        enemy.transform.terrainHeight + 1,
        isSplashDamage ? 8 : 15
      );

      // Blood decal on ground (smaller for splash)
      if (!isSplashDamage) {
        this.tilesEngine.effects.spawnBloodDecal(
          enemy.position.lat,
          enemy.position.lon,
          enemy.transform.terrainHeight,
          0.8
        );
      }
    }

    const killed = enemy.health.takeDamage(damage);
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
            color: '#FFD700',
            duration: 1200,
            floatSpeed: 1.5,
            scale: 2.5,
          }
        );
      }

      // Track kill on the source tower
      const sourceTower = this.towerManager.getById(sourceTowerId);
      if (sourceTower) {
        sourceTower.combat.kills++;
      }
    }
  }

  /**
   * Calculate distance between two geo positions in meters
   */
  private calculateGeoDistance(
    pos1: { lat: number; lon: number },
    pos2: { lat: number; lon: number }
  ): number {
    const R = 6371000;
    const dLat = ((pos2.lat - pos1.lat) * Math.PI) / 180;
    const dLon = ((pos2.lon - pos1.lon) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((pos1.lat * Math.PI) / 180) *
        Math.cos((pos2.lat * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
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

    // Use cached terrain height, or calculate live as fallback
    let fireY = this.hqTerrainHeight;
    if (fireY === null) {
      fireY = this.tilesEngine.getTerrainHeightAtGeo(
        this.basePosition.lat,
        this.basePosition.lon
      ) ?? 0;
    }

    this.activeFireId = this.tilesEngine.effects.spawnFireAtLocalY(
      this.basePosition.lat,
      this.basePosition.lon,
      fireY,
      intensity
    );
  }

  /**
   * Trigger game over state
   */
  private triggerGameOver(): void {
    this.waveManager.phase.set('gameover');
    this.enemyManager.clear();

    // Show inferno fire at base (on terrain/roof, not at beacon)
    if (this.basePosition && this.tilesEngine) {
      if (this.activeFireId) {
        this.tilesEngine.effects.stopFire(this.activeFireId);
      }

      // Get terrain height LIVE
      let localY = this.tilesEngine.getTerrainHeightAtGeo(
        this.basePosition.lat,
        this.basePosition.lon
      );

      if (localY === null || Math.abs(localY) > 50) {
        localY = 0;
      }

      this.activeFireId = this.tilesEngine.effects.spawnFireAtLocalY(
        this.basePosition.lat,
        this.basePosition.lon,
        localY,
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
    this.credits.set(70);
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
    paused = false,
    health?: number
  ): Enemy {
    return this.enemyManager.spawn(path, typeId, speed, paused, health);
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
   * @param position Geo position
   * @param typeId Tower type ID
   * @param customRotation Custom rotation set by user (radians)
   */
  placeTower(position: GeoPosition, typeId: TowerTypeId = 'archer', customRotation = 0): Tower | null {
    const config = TOWER_TYPES[typeId];
    if (!config) return null;

    // Check if player has enough credits
    if (this.credits() < config.cost) {
      return null;
    }

    const tower = this.towerManager.placeTower(position, typeId, customRotation);
    if (tower) {
      // Deduct cost
      this.credits.update((c) => c - config.cost);

      // Generate route-based LOS grid for fast O(1) lookups
      const routes = Array.from(this.pathRouteService.getCachedPaths().values());
      if (routes.length > 0 && this.tilesEngine) {
        this.tilesEngine.towers.generateRouteLosGrid(tower.id, routes);
      }
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

  /**
   * Called when tiles are loaded - calculates HQ terrain height
   * and spawns debug point if debug option is enabled
   */
  onTilesLoaded(): void {
    if (!this.basePosition || !this.tilesEngine) return;

    // Calculate and cache HQ terrain height
    const terrainHeight = this.tilesEngine.getTerrainHeightAtGeo(
      this.basePosition.lat,
      this.basePosition.lon
    );

    if (terrainHeight !== null) {
      this.hqTerrainHeight = terrainHeight;

      // Spawn debug point if debug option is enabled
      if (this.uiState.specialPointsDebugVisible()) {
        this.spawnHQDebugPoint();
      }
    }
  }

  /**
   * Spawn or update HQ debug point at cached terrain height
   */
  spawnHQDebugPoint(): void {
    if (!this.basePosition || !this.tilesEngine) return;

    if (this.hqTerrainHeight === null) {
      // Try to calculate it now
      this.hqTerrainHeight = this.tilesEngine.getTerrainHeightAtGeo(
        this.basePosition.lat,
        this.basePosition.lon
      );
      if (this.hqTerrainHeight === null) return;
    }

    this.tilesEngine.effects.spawnDebugSphere(
      this.basePosition.lat,
      this.basePosition.lon,
      this.hqTerrainHeight,
      1, // radius
      0xff0000 // red
    );
  }

  /**
   * Update debug sphere visibility based on UI state
   */
  updateDebugSpheresVisibility(): void {
    if (!this.tilesEngine) return;
    this.tilesEngine.effects.setDebugSpheresVisible(
      this.uiState.specialPointsDebugVisible()
    );
  }

  /**
   * Get cached enemy routes for LOS preview during tower placement
   */
  getCachedRoutes(): GeoPosition[][] {
    return Array.from(this.pathRouteService.getCachedPaths().values());
  }
}
