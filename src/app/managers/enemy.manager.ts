import { signal } from '@angular/core';
import { Vector3 } from 'three';
import { EntityManager } from './entity-manager';
import { Enemy } from '../entities/enemy.entity';
import { EnemyTypeId } from '../models/enemy-types';
import { GeoPosition } from '../models/game.types';
import { EntityPoolService } from '../services/entity-pool.service';
import { GlobalRouteGridService } from '../services/global-route-grid.service';
import { SpatialGridService } from '../services/spatial-grid.service';
import { ThreeTilesEngine } from '../three-engine';
import { GameEventBus } from '../game-engine';
import { GAME_BALANCE } from '../configs/game-balance.config';
import { TIMING } from '../configs/timing.config';

/**
 * Manages all enemy entities - spawning, updating, and lifecycle
 *
 * Framework-agnostic, event-based:
 * - No @Injectable decorator
 * - Constructor injection
 * - Emits events: enemy:died, enemy:reached-base
 */
export class EnemyManager extends EntityManager<Enemy> {
  // Track enemies being killed to prevent double-kill
  private killingEnemies = new Set<string>();

  // Track active timeouts for cleanup on destroy
  private activeTimeouts = new Set<ReturnType<typeof setTimeout>>();

  // Reusable array to avoid allocations in update loop
  private toRemove: Enemy[] = [];

  // Track enemies with active frost visual (for state-change detection)
  private frozenVisualEnemies = new Set<string>();

  // Reusable Vector3 for position conversion in update loop (avoids per-enemy allocation)
  private _tempLocalPos = new Vector3();

  // Reactive signal for alive count (for UI bindings)
  readonly aliveCount = signal(0);

  // Debug toggle: skip movement + visual updates when false
  movementEnabled = true;

  // Cached alive enemies array (invalidated on spawn/kill/remove/clear)
  private cachedAliveEnemies: Enemy[] | null = null;

  constructor(
    private eventBus: GameEventBus,
    private entityPool: EntityPoolService,
    private globalRouteGrid: GlobalRouteGridService,
    private spatialGrid: SpatialGridService
  ) {
    super();
    this.registerDebugHandlers();
  }

  private registerDebugHandlers(): void {
    this.eventBus.on('debug:toggle-movement', (event) => {
      this.movementEnabled = event.enabled;
    });

    this.eventBus.on('debug:remove-enemy', (event) => {
      const enemy = this.getAll().find(e => e.id === event.enemyId);
      if (enemy) {
        this.remove(enemy);
      }
    });

    this.eventBus.on('debug:clear-enemies', () => {
      this.clear();
    });

    this.eventBus.on('debug:spawn-enemy', (event) => {
      if (!this.tilesEngine) {
        console.warn('[EnemyManager] Debug spawn ignored - not initialized');
        return;
      }

      if (!event.path || event.path.length < 2) {
        console.warn('[EnemyManager] Debug spawn ignored - invalid path');
        return;
      }

      const count = event.count ?? 1;
      for (let i = 0; i < count; i++) {
        this.spawn(
          event.path,
          event.enemyType as EnemyTypeId,
          event.speed,
          event.paused ?? false,
          event.health,
          event.forceClassic
        );
      }
    });
  }

  /**
   * Initialize enemy manager with ThreeTilesEngine
   */
  override initialize(tilesEngine: ThreeTilesEngine): void {
    super.initialize(tilesEngine);
  }

  /**
   * Spawn a new enemy at the start of a path
   */
  spawn(
    path: GeoPosition[],
    typeId: EnemyTypeId,
    speedOverride?: number,
    paused = false,
    healthOverride?: number,
    forceClassic?: boolean
  ): Enemy {
    if (!this.tilesEngine) {
      throw new Error('EnemyManager not initialized');
    }

    const enemy = new Enemy(typeId, path, speedOverride);

    // Override health if specified
    if (healthOverride !== undefined) {
      enemy.health.resetMaxHp(healthOverride);
    }

    // Initialize audio with spatial audio manager
    if (this.tilesEngine.spatialAudio) {
      enemy.audio.initialize(this.tilesEngine.spatialAudio);
    }

    // Apply random lateral offset for movement variety
    if (enemy.typeConfig.lateralOffset && enemy.typeConfig.lateralOffset > 0) {
      const maxOffset = enemy.typeConfig.lateralOffset;
      const randomOffset = (Math.random() * 2 - 1) * maxOffset;
      enemy.movement.setLateralOffset(randomOffset);
    }

    // Apply random height variation for air units
    if (enemy.typeConfig.heightVariation && enemy.typeConfig.heightVariation > 0) {
      const maxVar = enemy.typeConfig.heightVariation;
      const randomVar = (Math.random() * 2 - 1) * maxVar;
      enemy.movement.setHeightVariation(randomVar);
    }

    // Get height at spawn position - prefer path height (smoothed) over live sampling
    const startPos = path[0];
    const origin = this.tilesEngine.sync.getOrigin();
    let geoHeight: number;

    if (startPos.height !== undefined && startPos.height !== 0) {
      // Path has pre-computed smoothed height - use it
      geoHeight = startPos.height;
    } else {
      // Fallback: sample terrain height at spawn position
      const localTerrainY = this.tilesEngine.getTerrainHeightAtGeo(startPos.lat, startPos.lon);
      // Convert local Y to geo height for proper round-trip through geoToLocalSimple
      // geoToLocalSimple does: Y = height - originHeight
      // So we need: geoHeight = localY + originHeight
      geoHeight = localTerrainY !== null ? localTerrainY + origin.height : origin.height;
    }

    enemy.transform.terrainHeight = geoHeight;

    // Apply height variation to initial spawn height (for air units)
    const heightVar = enemy.movement.getHeightVariation();
    if (heightVar !== 0) {
      geoHeight += heightVar;
      enemy.transform.terrainHeight = geoHeight;
    }

    // Force classic renderer for debug enemies (needed for live override support)
    if (forceClassic) {
      this.tilesEngine.enemies.markForClassic(enemy.id);
    }

    // Create 3D model and start animation
    this.tilesEngine.enemies
      .create(enemy.id, typeId, startPos.lat, startPos.lon, geoHeight)
      .then((renderData) => {
        if (renderData && !paused) {
          this.tilesEngine!.enemies.startWalkAnimation(enemy.id);
        }
      });

    if (paused) {
      enemy.movement.pause();
    } else {
      // Start moving and sounds immediately if not paused
      enemy.startMoving();
    }

    // Play spawn sound (always, even if paused)
    enemy.playSpawnSound();

    this.add(enemy);
    this.aliveCount.update(c => c + 1);
    this.cachedAliveEnemies = null; // Invalidate cache

    // Emit enemy:spawned event for AI tracking
    this.eventBus.emit({
      type: 'enemy:spawned',
      enemy,
    });

    return enemy;
  }

  /**
   * Calculate dynamic reward based on actual enemy HP and speed
   * Scales with AI-generated healthMultiplier to keep rewards fair
   */
  private calculateDynamicReward(enemy: Enemy): number {
    const healthMultiplier = enemy.health.maxHp / enemy.typeConfig.baseHp;
    const effectiveHP = enemy.health.maxHp;
    const speedBonus = Math.floor(enemy.typeConfig.baseSpeed / 10); // Reduced from /5

    // Sublinear scaling (sqrt) prevents inflation
    // 150 HP per credit (was 50) - roughly 1/3 of previous rewards
    const hpReward = Math.floor(effectiveHP / 150);
    const scaleFactor = 1 + Math.sqrt(Math.max(0, healthMultiplier - 1)) * 0.4; // Reduced from 0.6

    const baseReward = Math.max(1, hpReward + speedBonus);
    const dynamicReward = Math.round(baseReward * Math.min(scaleFactor, 2.0)); // Reduced cap from 2.5

    return Math.min(25, Math.max(1, dynamicReward)); // Cap: 1-25 (was 1-40)
  }

  /**
   * Kill an enemy - plays death animation then removes
   * Emits enemy:died event with credits
   * @param enemy Enemy to kill
   * @param timescale Game speed multiplier (for death animation timing)
   */
  kill(enemy: Enemy, timescale = 1.0): void {
    // Prevent double-kill
    if (this.killingEnemies.has(enemy.id)) return;
    this.killingEnemies.add(enemy.id);

    // Decrement alive count (killingEnemies set prevents double-counting)
    this.aliveCount.update(c => Math.max(0, c - 1));
    this.cachedAliveEnemies = null; // Invalidate cache

    // Ensure enemy is marked dead if not already
    if (!enemy.health.isDead) {
      enemy.health.takeDamage(enemy.health.hp);
    }
    enemy.stopMoving();

    // Calculate dynamic reward based on actual enemy stats
    const credits = this.calculateDynamicReward(enemy);

    // Emit enemy:died event
    this.eventBus.emit({
      type: 'enemy:died',
      enemy,
      credits,
    });

    // If enemy has death animation, play it and wait before removing
    if (enemy.typeConfig.deathAnimation) {
      this.tilesEngine?.enemies.playDeathAnimation(enemy.id);
      const realTimeDelay = TIMING.deathAnimationDuration / timescale; // Scale death animation duration
      const timeoutId = setTimeout(() => {
        this.activeTimeouts.delete(timeoutId);
        this.killingEnemies.delete(enemy.id);
        this.remove(enemy);
      }, realTimeDelay);
      this.activeTimeouts.add(timeoutId);
    } else {
      // No death animation - remove immediately
      this.killingEnemies.delete(enemy.id);
      this.remove(enemy);
    }
  }

  /**
   * Update all enemies - movement and rendering
   * @param deltaTime Delta time in milliseconds (already scaled by timescale)
   * @param timescale Game speed multiplier (for status effect duration)
   */
  // Performance profiling callback (set by PerformanceProfilerService)
  onProfileTiming: ((move: number, grid: number, height: number, render: number, total: number) => void) | null = null;

  override update(deltaTime: number, timescale = 1.0): void {
    // Skip all per-enemy work when movement is disabled (debug toggle)
    if (!this.movementEnabled) return;

    const profiling = this.onProfileTiming !== null;
    let tMove = 0, tGrid = 0, tHeight = 0, tRender = 0;
    const tTotal = profiling ? performance.now() : 0;

    // Clear reusable array (no allocation)
    this.toRemove.length = 0;
    const origin = this.tilesEngine?.sync.getOrigin();

    for (const enemy of this.getAllActive()) {
      if (!enemy.alive) continue;

      // Update components + Move enemy along path
      let t0 = profiling ? performance.now() : 0;
      enemy.update(deltaTime);
      enemy.movement.removeExpiredEffects(timescale);
      const moveResult = enemy.movement.move(deltaTime, timescale);
      if (profiling) tMove += performance.now() - t0;

      if (moveResult === 'reached_end') {
        // Emit enemy:reached-base event
        this.eventBus.emit({
          type: 'enemy:reached-base',
          enemy,
          damage: GAME_BALANCE.combat.enemyBaseDamage,
        });
        this.toRemove.push(enemy);
        continue;
      }

      // Update global route grid position for O(1) tower targeting
      // Also update spatial grid for O(1) proximity queries (sleep wake-checks, fallback targeting)
      t0 = profiling ? performance.now() : 0;
      if (this.tilesEngine) {
        // Compute local position ONCE — reuse for grid update AND frost visual below
        this.tilesEngine.sync.geoToLocalSimpleInto(
          enemy.position.lat,
          enemy.position.lon,
          0, // Height not needed for X/Z cell lookup
          this._tempLocalPos
        );
        if (this.globalRouteGrid.isInitialized()) {
          this.globalRouteGrid.updateEnemyPosition(enemy, this._tempLocalPos.x, this._tempLocalPos.z);
        }
        this.spatialGrid.updateEnemy(enemy.id, this._tempLocalPos.x, this._tempLocalPos.z);
      }
      if (profiling) tGrid += performance.now() - t0;

      // Check if path has valid heights (no object allocation)
      t0 = profiling ? performance.now() : 0;
      const pathHasHeights = enemy.movement.hasCurrentSegmentHeights();

      let geoHeight: number;
      if (pathHasHeights) {
        // Path has smoothed heights - use the interpolated height from MovementComponent
        geoHeight = enemy.transform.terrainHeight;
      } else {
        // Path doesn't have heights - sample terrain live (fallback)
        const localTerrainY = this.tilesEngine?.getTerrainHeightAtGeo(
          enemy.position.lat,
          enemy.position.lon
        );
        geoHeight = localTerrainY != null && origin
          ? localTerrainY + origin.height
          : enemy.transform.terrainHeight;
        enemy.transform.terrainHeight = geoHeight;
      }
      if (profiling) tHeight += performance.now() - t0;

      // Get speed multiplier from animation state (walk vs run)
      const speedMultiplier = this.tilesEngine?.enemies.getSpeedMultiplier(enemy.id) ?? 1.0;
      enemy.movement.speedMultiplier = speedMultiplier;

      // Update visual representation (including animation speed based on effective speed)
      t0 = profiling ? performance.now() : 0;
      this.tilesEngine?.enemies.update(
        enemy.id,
        enemy.position.lat,
        enemy.position.lon,
        geoHeight,
        enemy.transform.rotation,
        enemy.health.healthPercent,
        enemy.movement.effectiveSpeed
      );

      // Frost visual: toggle blue tint + particle aura based on slow state
      if (this.tilesEngine) {
        const isSlowed = enemy.movement.isSlowed(timescale);
        const hasFrost = this.frozenVisualEnemies.has(enemy.id);

        if (isSlowed && !hasFrost) {
          // Apply frost visual — reuse _tempLocalPos (set Y for correct height)
          this.tilesEngine.enemies.setFreezeVisual(enemy.id, true);
          this._tempLocalPos.y = origin ? geoHeight - origin.height : 0;
          this.tilesEngine.effects.spawnFrostAura(enemy.id, this._tempLocalPos);
          this.frozenVisualEnemies.add(enemy.id);
        } else if (isSlowed && hasFrost) {
          // Update frost aura position — reuse _tempLocalPos
          this._tempLocalPos.y = origin ? geoHeight - origin.height : 0;
          this.tilesEngine.effects.updateFrostAuraPosition(enemy.id, this._tempLocalPos);
        } else if (!isSlowed && hasFrost) {
          // Remove frost visual
          this.tilesEngine.enemies.setFreezeVisual(enemy.id, false);
          this.tilesEngine.effects.stopFrostAura(enemy.id);
          this.frozenVisualEnemies.delete(enemy.id);
        }
      }
      if (profiling) tRender += performance.now() - t0;
    }

    // Remove enemies that reached base
    for (const enemy of this.toRemove) {
      this.remove(enemy);
    }

    // Send profiling data to PerformanceProfilerService
    if (profiling) {
      this.onProfileTiming!(tMove, tGrid, tHeight, tRender, performance.now() - tTotal);
    }
  }

  /**
   * Start all paused enemies with configurable delay between each
   * @param defaultDelayBetween Default delay in milliseconds (game-time)
   * @param timescale Game speed multiplier (converts game-time to real-time)
   */
  startAll(defaultDelayBetween = TIMING.defaultSpawnStartDelay, timescale = 1.0): void {
    const paused = this.getAll().filter((e) => e.movement.paused);

    let accumulatedDelay = 0;
    paused.forEach((enemy) => {
      const gameTimeDelay = enemy.typeConfig.spawnStartDelay ?? defaultDelayBetween;
      const realTimeDelay = gameTimeDelay / timescale; // Convert to real-time
      const timeoutId = setTimeout(() => {
        this.activeTimeouts.delete(timeoutId);
        // Check both alive (health) AND active (not destroyed)
        if (enemy.alive && enemy.active) {
          enemy.startMoving();
          this.tilesEngine?.enemies.startWalkAnimation(enemy.id);
        }
      }, accumulatedDelay);
      this.activeTimeouts.add(timeoutId);
      accumulatedDelay += realTimeDelay;
    });
  }

  /**
   * Remove enemy and cleanup resources
   */
  override remove(entity: Enemy): void {
    // Decrement alive count if enemy was still alive (e.g., reached base)
    if (entity.alive) {
      this.aliveCount.update(c => Math.max(0, c - 1));
      this.cachedAliveEnemies = null; // Invalidate cache
    }
    // Cleanup frost visual if active
    if (this.frozenVisualEnemies.has(entity.id)) {
      this.tilesEngine?.effects.stopFrostAura(entity.id);
      this.frozenVisualEnemies.delete(entity.id);
    }
    // Remove from global route grid and spatial grid
    this.globalRouteGrid.removeEnemy(entity);
    this.spatialGrid.removeEnemy(entity.id);
    this.tilesEngine?.enemies.remove(entity.id);
    super.remove(entity);
  }

  /**
   * Clear all enemies and cleanup resources
   */
  override clear(): void {
    // Clear all pending timeouts (death animations, spawn delays)
    for (const timeoutId of this.activeTimeouts) {
      clearTimeout(timeoutId);
    }
    this.activeTimeouts.clear();

    // Remove all enemies from global route grid before clearing
    for (const enemy of this.getAll()) {
      this.globalRouteGrid.removeEnemy(enemy);
    }

    // Clear spatial grid
    this.spatialGrid.clear();

    this.tilesEngine?.enemies.clear();
    this.killingEnemies.clear();

    // Stop frost auras before clearing the tracking set
    for (const enemyId of this.frozenVisualEnemies) {
      this.tilesEngine?.effects.stopFrostAura(enemyId);
    }
    this.frozenVisualEnemies.clear();
    super.clear();
    this.aliveCount.set(0);
    this.cachedAliveEnemies = null; // Invalidate cache
  }

  /**
   * Get all alive enemies (cached per frame)
   */
  getAlive(): Enemy[] {
    if (this.cachedAliveEnemies === null) {
      this.cachedAliveEnemies = this.getAll().filter((e) => e.alive);
    }
    return this.cachedAliveEnemies;
  }

  /**
   * Get count of alive enemies (uses signal, no array allocation)
   */
  getAliveCount(): number {
    return this.aliveCount();
  }

  /**
   * Get grid stats for debugging
   */
  getGridStats(): { trackedEnemies: number; occupiedCells: number } {
    const stats = this.globalRouteGrid.getStats();
    return {
      trackedEnemies: stats.trackedEnemies,
      occupiedCells: stats.occupiedCells,
    };
  }

  /**
   * Destroy the enemy manager - cleanup all resources and timeouts
   */
  override destroy(): void {
    // Clear all pending timeouts
    for (const timeoutId of this.activeTimeouts) {
      clearTimeout(timeoutId);
    }
    this.activeTimeouts.clear();
    this.killingEnemies.clear();
    super.destroy();
  }
}
