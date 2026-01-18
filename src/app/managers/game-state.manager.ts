import { Injectable, inject, signal, computed } from '@angular/core';
import * as THREE from 'three';
import { EnemyManager } from './enemy.manager';
import { TowerManager } from './tower.manager';
import { ProjectileManager } from './projectile.manager';
import { WaveManager, SpawnPoint, WaveConfig } from './wave.manager';
import { GameUIStateService } from '../services/game-ui-state.service';
import { PathAndRouteService } from '../services/path-route.service';
import { GlobalRouteGridService } from '../services/global-route-grid.service';
import { StreetNetwork } from '../services/osm-street.service';
import { GeoPosition } from '../models/game.types';
import { StatusEffect } from '../models/status-effects';
import { GameObject } from '../core/game-object';
import { Enemy } from '../entities/enemy.entity';
import { Projectile } from '../entities/projectile.entity';
import { EnemyTypeId } from '../models/enemy-types';
import { TowerTypeId, TOWER_TYPES } from '../configs/tower-types.config';
import { GAME_BALANCE } from '../configs/game-balance.config';
import { GAME_SOUNDS } from '../configs/audio.config';
import { Tower } from '../entities/tower.entity';
import { ThreeTilesEngine } from '../three-engine';
import { geoDistance } from '../utils/geo-utils';

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
  private readonly globalRouteGrid = inject(GlobalRouteGridService);

  // Game state signals
  readonly baseHealth = signal<number>(GAME_BALANCE.player.startHealth);
  readonly credits = signal<number>(GAME_BALANCE.player.startCredits);
  readonly showGameOverScreen = signal(false);

  // Computed signals for UI bindings
  readonly phase = computed(() => this.waveManager.phase());
  readonly waveNumber = computed(() => this.waveManager.waveNumber());
  readonly towerCount = computed(() => this.towerManager.getAll().length);
  readonly enemiesAlive = computed(() => this.enemyManager.aliveCount());
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

  // Sound IDs use centralized config from audio.config.ts

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
        GAME_SOUNDS.hqDamage.id,
        GAME_SOUNDS.hqDamage.url,
        {
          refDistance: GAME_SOUNDS.hqDamage.refDistance,
          rolloffFactor: GAME_SOUNDS.hqDamage.rolloffFactor,
          volume: GAME_SOUNDS.hqDamage.volume,
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
      this.credits.update((c) => c + GAME_BALANCE.waves.completionBonus);
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
   * Uses GlobalRouteGrid for O(cells) instead of O(n) enemy checks
   *
   * Optimization strategy:
   * - Ground towers with visibleCells: Query only enemies in visible cells (LOS implicit)
   * - Air towers: Query all enemies (no LOS needed for air units)
   * - Fallback: Full enemy list with runtime LOS check
   */
  private updateTowerShooting(currentTime: number): void {
    // Fallback: full enemy list (used when spatial optimization isn't available)
    const allEnemies = this.enemyManager.getAlive();

    for (const tower of this.towerManager.getAllActive()) {
      // Determine if we can use GlobalRouteGrid optimization
      const hasVisibleCells = tower.visibleCells.length > 0;
      const isPureAirTower =
        (tower.typeConfig.canTargetAir ?? false) &&
        !(tower.typeConfig.canTargetGround ?? true);

      // Get candidate enemies based on tower type and available data
      let candidates: Enemy[];
      let losCheck: ((enemy: Enemy) => boolean) | undefined;

      if (hasVisibleCells && !isPureAirTower) {
        // FAST PATH: Use GlobalRouteGrid for ground towers with visibleCells
        // Enemies from visible cells already passed LOS check implicitly
        candidates = this.globalRouteGrid.getEnemiesForTower(tower.visibleCells);

        // LOS check still needed for enemies outside the grid (edge cases)
        // but should be rare since grid covers the route corridor
        losCheck = this.tilesEngine
          ? (enemy: Enemy) => {
              const pos = this.tilesEngine!.sync.geoToLocalSimple(
                enemy.position.lat,
                enemy.position.lon,
                enemy.transform.terrainHeight
              );
              const visibility = this.globalRouteGrid.isPositionVisibleFromTower(
                tower.id,
                pos.x,
                pos.z
              );
              // If position is in grid, use pre-computed result; otherwise fall back to raycast
              if (visibility !== undefined) {
                return visibility;
              }
              return this.tilesEngine!.towers.hasLineOfSight(
                tower.id,
                pos.x,
                pos.y + 1.5,
                pos.z
              );
            }
          : undefined;
      } else if (isPureAirTower) {
        // Air towers target all enemies (air units are always visible)
        candidates = allEnemies;
        losCheck = undefined; // No LOS needed for air targets
      } else {
        // FALLBACK: Full enemy list with runtime LOS check
        candidates = allEnemies;
        losCheck = this.tilesEngine
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
      }

      // Fast path: get cached target or find new one
      let target = tower.findTarget(candidates, losCheck);

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
              target = tower.findTarget(candidates, losCheck);
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
    this.baseHealth.update((h) => Math.max(0, h - GAME_BALANCE.combat.enemyBaseDamage));
    this.updateFireIntensity();

    // Play HQ damage sound at base position
    if (this.basePosition && this.tilesEngine?.spatialAudio) {
      this.tilesEngine.spatialAudio.playAtGeo(
        GAME_SOUNDS.hqDamage.id,
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
    const isIceShard = projectile.typeConfig.id === 'ice-shard';

    // Spawn explosion effect for splash damage projectiles
    if (hasSplash && this.tilesEngine) {
      // Calculate explosion height: terrain + enemy heightOffset
      // Ground units get +2 offset to lift explosion slightly above ground
      // Air units don't need offset since they're already elevated
      const groundOffset = enemy.typeConfig.isAirUnit ? 0 : 2;
      const explosionHeight = enemy.transform.terrainHeight + (enemy.typeConfig.heightOffset ?? 0) + groundOffset;

      if (isIceShard) {
        // Ice explosion (cyan particles) - more particles
        this.tilesEngine.effects.spawnIceExplosionAtGeo(
          enemy.position.lat,
          enemy.position.lon,
          explosionHeight,
          35
        );

        // Multiple ice decals on ground (only for ground units)
        if (!enemy.typeConfig.isAirUnit) {
          // Main impact decal (large) - use raycast for accurate height
          const mainDecalHeight = this.getTerrainHeightForDecal(
            enemy.position.lat,
            enemy.position.lon,
            enemy.transform.terrainHeight
          );
          this.tilesEngine.effects.spawnIceDecal(
            enemy.position.lat,
            enemy.position.lon,
            mainDecalHeight,
            3.5
          );
          // Additional smaller decals around impact
          for (let i = 0; i < 3; i++) {
            const offsetLat = (Math.random() - 0.5) * 0.00008;
            const offsetLon = (Math.random() - 0.5) * 0.00008;
            const decalLat = enemy.position.lat + offsetLat;
            const decalLon = enemy.position.lon + offsetLon;
            const decalHeight = this.getTerrainHeightForDecal(
              decalLat,
              decalLon,
              enemy.transform.terrainHeight
            );
            this.tilesEngine.effects.spawnIceDecal(
              decalLat,
              decalLon,
              decalHeight,
              1.5 + Math.random() * 1.5
            );
          }
        }
      } else {
        // Normal fire explosion (uses explosionHeight for air unit support)
        this.tilesEngine.effects.spawnExplosionAtGeo(
          enemy.position.lat,
          enemy.position.lon,
          explosionHeight,
          30
        );
      }
    }

    // Apply damage to primary target (skip blood for ice damage)
    this.applyDamageToEnemy(enemy, projectile.damage, projectile.sourceTowerId, false, isIceShard);

    // Apply slow effect for ice-shard
    if (isIceShard) {
      this.applySlowEffect(
        enemy,
        GAME_BALANCE.effects.ice.slowAmount,
        GAME_BALANCE.effects.ice.duration,
        projectile.sourceTowerId
      );
    }

    // Apply splash damage to nearby enemies
    // Uses grid-based lookup: O(cells_in_radius) instead of O(all_enemies)
    if (hasSplash) {
      const nearbyEnemies = this.globalRouteGrid.getEnemiesInRadiusGeo(
        enemy.position,
        splashRadius,
        enemy.id // Exclude primary target
      );

      const useFalloff = projectile.typeConfig.splashDamageFalloff !== false;

      for (const nearbyEnemy of nearbyEnemies) {
        let splashDamage = projectile.damage;

        if (useFalloff) {
          // Calculate distance-based falloff
          const dist = geoDistance(enemy.position, nearbyEnemy.position);
          const falloff = 1 - (dist / splashRadius); // 1.0 at center, 0.0 at edge
          splashDamage = Math.floor(projectile.damage * falloff);
        }

        if (splashDamage > 0) {
          this.applyDamageToEnemy(nearbyEnemy, splashDamage, projectile.sourceTowerId, true, isIceShard);
        }

        // Apply slow effect and ice decal to splash targets for ice-shard
        if (isIceShard) {
          this.applySlowEffect(
            nearbyEnemy,
            GAME_BALANCE.effects.ice.slowAmount,
            GAME_BALANCE.effects.ice.duration,
            projectile.sourceTowerId
          );
          // Ice decal at each splash target position
          if (!nearbyEnemy.typeConfig.isAirUnit && this.tilesEngine) {
            const splashDecalHeight = this.getTerrainHeightForDecal(
              nearbyEnemy.position.lat,
              nearbyEnemy.position.lon,
              nearbyEnemy.transform.terrainHeight
            );
            this.tilesEngine.effects.spawnIceDecal(
              nearbyEnemy.position.lat,
              nearbyEnemy.position.lon,
              splashDecalHeight,
              2.0 + Math.random()
            );
          }
        }
      }
    }
  }

  /**
   * Get terrain height at geo position with raycast (for accurate decal placement)
   */
  private getTerrainHeightForDecal(lat: number, lon: number, fallbackHeight: number): number {
    if (!this.tilesEngine) return fallbackHeight + 0.15;

    const terrainY = this.tilesEngine.getTerrainHeightAtGeo(lat, lon);
    if (terrainY === null) return fallbackHeight + 0.15;

    const origin = this.tilesEngine.sync.getOrigin();
    return terrainY + origin.height + 0.15; // Add small offset to stay above terrain
  }

  /**
   * Apply slow effect to an enemy
   */
  private applySlowEffect(
    enemy: Enemy,
    slowAmount: number,
    duration: number,
    sourceId: string
  ): void {
    const effect: StatusEffect = {
      type: 'slow',
      value: slowAmount,
      duration,
      startTime: performance.now(),
      sourceId,
    };
    enemy.movement.applyStatusEffect(effect);
  }

  /**
   * Apply damage to an enemy and handle death
   */
  private applyDamageToEnemy(
    enemy: Enemy,
    damage: number,
    sourceTowerId: string,
    isSplashDamage = false,
    skipBloodEffects = false
  ): void {
    // Spawn blood effects for enemies that can bleed (skip for ice damage)
    if (enemy.typeConfig.canBleed && this.tilesEngine && !skipBloodEffects) {
      // Blood particle splatter (fewer for splash)
      this.tilesEngine.effects.spawnBloodSplatter(
        enemy.position.lat,
        enemy.position.lon,
        enemy.transform.terrainHeight + 1,
        isSplashDamage ? 8 : 15
      );

      // Blood decal on ground (smaller for splash) - use raycast for accurate height
      if (!isSplashDamage) {
        const bloodDecalHeight = this.getTerrainHeightForDecal(
          enemy.position.lat,
          enemy.position.lon,
          enemy.transform.terrainHeight
        );
        this.tilesEngine.effects.spawnBloodDecal(
          enemy.position.lat,
          enemy.position.lon,
          bloodDecalHeight,
          0.8
        );
      }
    }

    const killed = enemy.health.takeDamage(damage);
    if (killed) {
      if (!skipBloodEffects) {
        this.spawnDeathBloodEffect(enemy);
      }
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

    // Large blood decal on ground - use raycast for accurate height
    const deathDecalHeight = this.getTerrainHeightForDecal(
      enemy.position.lat,
      enemy.position.lon,
      enemy.transform.terrainHeight
    );
    this.tilesEngine.effects.spawnBloodDecal(
      enemy.position.lat,
      enemy.position.lon,
      deathDecalHeight,
      2.0 // Larger decal for death
    );
  }

  /**
   * Update fire intensity based on base health
   *
   * Fire behavior:
   * - HP 51-100%: Brief fire flash that fades away (temporary damage indicator)
   * - HP 1-50%: Permanent fire that scales with damage (bigger as HP decreases)
   * - HP 0%: Handled by triggerGameOver (explosion + inferno)
   */
  private updateFireIntensity(): void {
    if (!this.basePosition || !this.tilesEngine) return;

    const health = this.baseHealth();

    // No fire at full health
    if (health >= 100) {
      if (this.activeFireId) {
        this.tilesEngine.effects.stopFire(this.activeFireId);
        this.activeFireId = null;
      }
      return;
    }

    // Use cached terrain height, or calculate live as fallback
    let fireY = this.hqTerrainHeight;
    if (fireY === null) {
      fireY = this.tilesEngine.getTerrainHeightAtGeo(
        this.basePosition.lat,
        this.basePosition.lon
      ) ?? 0;
    }

    // HP above threshold: Brief fire flash (temporary)
    if (health > GAME_BALANCE.fire.permanentThreshold) {
      // Stop any existing permanent fire
      if (this.activeFireId) {
        this.tilesEngine.effects.stopFire(this.activeFireId);
        this.activeFireId = null;
      }
      // Spawn brief fire flash (will auto-fade)
      this.tilesEngine.effects.spawnFireFlash(
        this.basePosition.lat,
        this.basePosition.lon,
        fireY
      );
      return;
    }

    // HP below threshold: Permanent fire that scales with damage
    // Stop existing fire IMMEDIATELY to free particles before spawning new one
    if (this.activeFireId) {
      this.tilesEngine.effects.stopFireImmediate(this.activeFireId);
    }

    // Calculate fire scale: at threshold = small (0), at 1% HP = maximum (≈1)
    // Linear interpolation: scale = 1 - (health / threshold)
    const threshold = GAME_BALANCE.fire.permanentThreshold;
    const scale = 1 - (health / threshold);

    this.activeFireId = this.tilesEngine.effects.spawnScaledFire(
      this.basePosition.lat,
      this.basePosition.lon,
      fireY,
      scale
    );
  }

  /**
   * Trigger game over state
   */
  private triggerGameOver(): void {
    this.waveManager.phase.set('gameover');
    this.enemyManager.clear();

    // NOTE: Don't clear tower overlays here - the game stays in gameover state
    // and towers remain visible. Only clear them in reset() when changing location.
    // Just deselect any selected tower.
    this.towerManager.selectTower(null);

    // Show HQ explosion and inferno fire at base
    if (this.basePosition && this.tilesEngine) {
      // Stop existing fire IMMEDIATELY to free particles for HQ explosion
      if (this.activeFireId) {
        this.tilesEngine.effects.stopFireImmediate(this.activeFireId);
        this.activeFireId = null;
      }

      // Use cached terrain height (set when tiles loaded), fallback to live calculation
      let localY = this.hqTerrainHeight;
      if (localY === null) {
        localY = this.tilesEngine.getTerrainHeightAtGeo(
          this.basePosition.lat,
          this.basePosition.lon
        ) ?? 0;
      }

      // Spawn massive HQ destruction explosion
      this.tilesEngine.effects.spawnHQExplosion(
        this.basePosition.lat,
        this.basePosition.lon,
        localY
      );

      // Scale existing fire to inferno (or spawn new one if none exists)
      if (this.activeFireId) {
        this.tilesEngine.effects.scaleFireToInferno(this.activeFireId);
      } else {
        // Spawn inferno fire if no fire was active
        this.activeFireId = this.tilesEngine.effects.spawnScaledFire(
          this.basePosition.lat,
          this.basePosition.lon,
          localY,
          1.0 // Maximum intensity
        );
      }
      // Fire stays permanently - no cleanup
    }

    this.onGameOverCallback?.();

    // Game over screen appears 3 seconds after destruction
    setTimeout(() => {
      this.showGameOverScreen.set(true);
    }, 3000);
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
    // Clear tower overlays before clearing towers
    this.clearAllTowerOverlays();

    this.enemyManager.clear();
    this.towerManager.clear();
    this.projectileManager.clear();
    this.waveManager.reset();

    // Clear GlobalRouteGrid (will be re-initialized on location change)
    this.globalRouteGrid.clear();

    if (this.tilesEngine) {
      this.tilesEngine.effects.clear();
      this.activeFireId = null;
    }

    this.baseHealth.set(GAME_BALANCE.player.startHealth);
    this.credits.set(GAME_BALANCE.player.startCredits);
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
   * Clear all tower overlays (LOS visualizations + GlobalRouteGrid registrations)
   * Called on reset to cleanup before starting fresh
   */
  private clearAllTowerOverlays(): void {
    // First deselect any selected tower (hides its LOS visualization)
    this.towerManager.selectTower(null);

    // Then dispose all LOS visualizations
    for (const tower of this.towerManager.getAll()) {
      // Dispose LOS visualization
      if (tower.losVisualization && this.tilesEngine) {
        tower.losVisualization.visible = false; // Ensure hidden
        this.tilesEngine.getScene().remove(tower.losVisualization);
        tower.losVisualization.geometry.dispose();
        (tower.losVisualization.material as THREE.Material).dispose();
        tower.losVisualization = null;
      }

      // Unregister from GlobalRouteGrid
      this.globalRouteGrid.unregisterTower(tower.id);
      tower.visibleCells = [];
    }
  }

  /**
   * Sell a tower and refund 50% of its cost
   */
  sellTower(tower: Tower): number {
    const refund = tower.typeConfig.sellValue;

    // Dispose LOS visualization
    if (tower.losVisualization && this.tilesEngine) {
      this.tilesEngine.getScene().remove(tower.losVisualization);
      tower.losVisualization.geometry.dispose();
      (tower.losVisualization.material as THREE.Material).dispose();
      tower.losVisualization = null;
    }

    // Unregister from GlobalRouteGrid
    this.globalRouteGrid.unregisterTower(tower.id);
    tower.visibleCells = []; // Clear references

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
    if (tower && this.tilesEngine && this.globalRouteGrid.isInitialized()) {
      // Deduct cost
      this.credits.update((c) => c - config.cost);

      // Register tower with GlobalRouteGrid for LOS pre-computation
      // IMPORTANT: Use geoToLocalSimple for consistency with grid cell coordinates
      const terrainPos = this.tilesEngine.sync.geoToLocalSimple(position.lat, position.lon, position.height ?? 0);
      const tipY = terrainPos.y + config.heightOffset + config.shootHeight;

      // Get LOS raycaster from tower renderer
      const losRaycaster = this.tilesEngine.towers.getLosRaycaster();

      if (losRaycaster) {
        // Check if this is a pure air tower (only targets air, not ground)
        const isPureAirTower = (config.canTargetAir ?? false) && !(config.canTargetGround ?? true);

        // Register tower and store visible cells reference
        // Air towers skip LOS checks (air enemies are always visible)
        tower.visibleCells = this.globalRouteGrid.registerTower(
          tower.id,
          terrainPos.x,
          terrainPos.z,
          tipY,
          config.range,
          losRaycaster,
          isPureAirTower
        );

        // Create LOS visualization (hidden by default, shown on selection)
        tower.losVisualization = this.globalRouteGrid.createTowerVisualization(
          tower.id,
          terrainPos.x,
          terrainPos.z,
          config.range
        );

        if (tower.losVisualization) {
          tower.losVisualization.visible = false;
          this.tilesEngine.getScene().add(tower.losVisualization);
        }
      } else {
        console.warn('[GameStateManager] placeTower: no losRaycaster!');
      }
    } else if (tower) {
      // Still deduct cost even if grid not initialized
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

  /**
   * Initialize GlobalRouteGrid after routes are computed
   * Should be called after engine and routes are ready
   */
  initializeGlobalRouteGrid(): void {
    if (!this.tilesEngine) {
      console.warn('[GameStateManager] Cannot initialize GlobalRouteGrid - no engine');
      return;
    }

    // Initialize with terrain raycaster and coordinate sync
    const terrainRaycaster = (x: number, z: number) => this.tilesEngine!.getTerrainHeightAtLocal(x, z);
    this.globalRouteGrid.initialize(terrainRaycaster, this.tilesEngine.sync);

    // Generate cells from routes
    const routes = this.getCachedRoutes();
    if (routes.length > 0) {
      this.globalRouteGrid.generateFromRoutes(routes);
    }
  }

  /**
   * Get GlobalRouteGrid service (for visualization access)
   */
  getGlobalRouteGrid(): GlobalRouteGridService {
    return this.globalRouteGrid;
  }
}
