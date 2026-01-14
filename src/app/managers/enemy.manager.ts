import { Injectable, inject, signal } from '@angular/core';
import { EntityManager } from './entity-manager';
import { Enemy } from '../entities/enemy.entity';
import { EnemyTypeId } from '../models/enemy-types';
import { GeoPosition } from '../models/game.types';
import { EntityPoolService } from '../services/entity-pool.service';
import { ThreeTilesEngine } from '../three-engine';

/**
 * Manages all enemy entities - spawning, updating, and lifecycle
 */
@Injectable()
export class EnemyManager extends EntityManager<Enemy> {
  private entityPool = inject(EntityPoolService);
  private onEnemyReachedBase?: (enemy: Enemy) => void;

  // Track enemies being killed to prevent double-kill
  private killingEnemies = new Set<string>();

  // Reusable array to avoid allocations in update loop
  private toRemove: Enemy[] = [];

  // Reactive signal for alive count (for UI bindings)
  readonly aliveCount = signal(0);

  /**
   * Initialize enemy manager with ThreeTilesEngine
   */
  override initialize(
    tilesEngine: ThreeTilesEngine,
    onEnemyReachedBase?: (enemy: Enemy) => void
  ): void {
    super.initialize(tilesEngine);
    this.onEnemyReachedBase = onEnemyReachedBase;
  }

  /**
   * Spawn a new enemy at the start of a path
   */
  spawn(
    path: GeoPosition[],
    typeId: EnemyTypeId,
    speedOverride?: number,
    paused = false
  ): Enemy {
    if (!this.tilesEngine) {
      throw new Error('EnemyManager not initialized');
    }

    const enemy = new Enemy(typeId, path, speedOverride);

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
    return enemy;
  }

  /**
   * Kill an enemy - plays death animation then removes
   */
  kill(enemy: Enemy): void {
    // Prevent double-kill
    if (this.killingEnemies.has(enemy.id)) return;
    this.killingEnemies.add(enemy.id);

    // Decrement alive count when enemy dies
    if (enemy.alive) {
      this.aliveCount.update(c => Math.max(0, c - 1));
      enemy.health.takeDamage(enemy.health.hp);
    }
    enemy.stopMoving();

    // Play death animation
    this.tilesEngine?.enemies.playDeathAnimation(enemy.id);

    // Remove after death animation completes
    setTimeout(() => {
      this.killingEnemies.delete(enemy.id);
      this.remove(enemy);
    }, 2000);
  }

  /**
   * Update all enemies - movement and rendering
   */
  override update(deltaTime: number): void {
    // Clear reusable array (no allocation)
    this.toRemove.length = 0;
    const origin = this.tilesEngine?.sync.getOrigin();

    for (const enemy of this.getAllActive()) {
      if (!enemy.alive) continue;

      // Update components
      enemy.update(deltaTime);

      // Move enemy along path
      const moveResult = enemy.movement.move(deltaTime);
      if (moveResult === 'reached_end') {
        this.onEnemyReachedBase?.(enemy);
        this.toRemove.push(enemy);
        continue;
      }

      // Check if path has valid heights (no object allocation)
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

      // Get speed multiplier from animation state (walk vs run)
      const speedMultiplier = this.tilesEngine?.enemies.getSpeedMultiplier(enemy.id) ?? 1.0;
      enemy.movement.speedMultiplier = speedMultiplier;

      // Update visual representation (including animation speed based on effective speed)
      this.tilesEngine?.enemies.update(
        enemy.id,
        enemy.position.lat,
        enemy.position.lon,
        geoHeight,
        enemy.transform.rotation,
        enemy.health.healthPercent,
        enemy.movement.effectiveSpeed
      );
    }

    // Remove enemies that reached base
    for (let i = 0; i < this.toRemove.length; i++) {
      this.remove(this.toRemove[i]);
    }
  }

  /**
   * Start all paused enemies with configurable delay between each
   */
  startAll(defaultDelayBetween = 300): void {
    const paused = this.getAll().filter((e) => e.movement.paused);

    let accumulatedDelay = 0;
    paused.forEach((enemy) => {
      const delay = enemy.typeConfig.spawnStartDelay ?? defaultDelayBetween;
      setTimeout(() => {
        // Check both alive (health) AND active (not destroyed)
        if (enemy.alive && enemy.active) {
          enemy.startMoving();
          this.tilesEngine?.enemies.startWalkAnimation(enemy.id);
        }
      }, accumulatedDelay);
      accumulatedDelay += delay;
    });
  }

  /**
   * Remove enemy and cleanup resources
   */
  override remove(entity: Enemy): void {
    // Decrement alive count if enemy was still alive (e.g., reached base)
    if (entity.alive) {
      this.aliveCount.update(c => Math.max(0, c - 1));
    }
    this.tilesEngine?.enemies.remove(entity.id);
    super.remove(entity);
  }

  /**
   * Clear all enemies and cleanup resources
   */
  override clear(): void {
    this.tilesEngine?.enemies.clear();
    this.killingEnemies.clear();
    super.clear();
    this.aliveCount.set(0);
  }

  /**
   * Get all alive enemies
   */
  getAlive(): Enemy[] {
    return this.getAll().filter((e) => e.alive);
  }

  /**
   * Get count of alive enemies
   */
  getAliveCount(): number {
    return this.getAlive().length;
  }
}
