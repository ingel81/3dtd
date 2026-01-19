import { Injectable, inject } from '@angular/core';
import { ThreeTilesEngine } from '../three-engine';
import { GlobalRouteGridService } from './global-route-grid.service';
import { Enemy } from '../entities/enemy.entity';
import { Projectile } from '../entities/projectile.entity';
import { StatusEffect } from '../models/status-effects';
import { GAME_BALANCE } from '../configs/game-balance.config';
import { geoDistance } from '../utils/geo-utils';
import { TowerManager } from '../managers/tower.manager';
import { EnemyManager } from '../managers/enemy.manager';

/**
 * Result of applying damage to an enemy
 */
export interface DamageResult {
  killed: boolean;
  reward: number;
}

/**
 * CombatEffectService - Handles projectile hits, damage application, and visual effects
 *
 * Extracted from GameStateManager to reduce god object complexity.
 * Manages:
 * - Projectile hit processing (splash damage, effects)
 * - Damage application to enemies
 * - Blood/death effects
 * - Slow effects (ice towers)
 */
@Injectable({ providedIn: 'root' })
export class CombatEffectService {
  private readonly globalRouteGrid = inject(GlobalRouteGridService);

  private tilesEngine: ThreeTilesEngine | null = null;

  /**
   * Initialize with engine reference
   */
  initialize(tilesEngine: ThreeTilesEngine): void {
    this.tilesEngine = tilesEngine;
  }

  /**
   * Handle projectile hitting an enemy
   * Processes splash damage, visual effects, and returns total rewards
   */
  onProjectileHit(
    projectile: Projectile,
    enemy: Enemy,
    towerManager: TowerManager,
    enemyManager: EnemyManager
  ): DamageResult {
    const splashRadius = projectile.typeConfig.splashRadius;
    const hasSplash = splashRadius && splashRadius > 0;
    const isIceShard = projectile.typeConfig.id === 'ice-shard';

    let totalReward = 0;
    let anyKilled = false;

    // Spawn explosion effect for splash damage projectiles
    if (hasSplash && this.tilesEngine) {
      const groundOffset = enemy.typeConfig.isAirUnit ? 0 : 2;
      const explosionHeight = enemy.transform.terrainHeight + (enemy.typeConfig.heightOffset ?? 0) + groundOffset;

      if (isIceShard) {
        this.tilesEngine.effects.spawnIceExplosionAtGeo(
          enemy.position.lat,
          enemy.position.lon,
          explosionHeight,
          35
        );

        // Ice decals on ground (only for ground units)
        if (!enemy.typeConfig.isAirUnit) {
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
          // Additional smaller decals
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
        this.tilesEngine.effects.spawnExplosionAtGeo(
          enemy.position.lat,
          enemy.position.lon,
          explosionHeight,
          30
        );
      }
    }

    // Apply damage to primary target
    const primaryResult = this.applyDamageToEnemy(
      enemy,
      projectile.damage,
      projectile.sourceTowerId,
      false,
      isIceShard,
      towerManager,
      enemyManager
    );
    totalReward += primaryResult.reward;
    anyKilled = anyKilled || primaryResult.killed;

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
    if (hasSplash) {
      const nearbyEnemies = this.globalRouteGrid.getEnemiesInRadiusGeo(
        enemy.position,
        splashRadius,
        enemy.id
      );

      const useFalloff = projectile.typeConfig.splashDamageFalloff !== false;

      for (const nearbyEnemy of nearbyEnemies) {
        let splashDamage = projectile.damage;

        if (useFalloff) {
          const dist = geoDistance(enemy.position, nearbyEnemy.position);
          const falloff = 1 - (dist / splashRadius);
          splashDamage = Math.floor(projectile.damage * falloff);
        }

        if (splashDamage > 0) {
          const splashResult = this.applyDamageToEnemy(
            nearbyEnemy,
            splashDamage,
            projectile.sourceTowerId,
            true,
            isIceShard,
            towerManager,
            enemyManager
          );
          totalReward += splashResult.reward;
          anyKilled = anyKilled || splashResult.killed;
        }

        // Apply slow effect and ice decal to splash targets
        if (isIceShard) {
          this.applySlowEffect(
            nearbyEnemy,
            GAME_BALANCE.effects.ice.slowAmount,
            GAME_BALANCE.effects.ice.duration,
            projectile.sourceTowerId
          );
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

    return { killed: anyKilled, reward: totalReward };
  }

  /**
   * Apply damage to an enemy and handle death
   * Returns reward if enemy was killed
   */
  applyDamageToEnemy(
    enemy: Enemy,
    damage: number,
    sourceTowerId: string,
    isSplashDamage: boolean,
    skipBloodEffects: boolean,
    towerManager: TowerManager,
    enemyManager: EnemyManager
  ): DamageResult {
    // Spawn blood effects for enemies that can bleed
    if (enemy.typeConfig.canBleed && this.tilesEngine && !skipBloodEffects) {
      this.tilesEngine.effects.spawnBloodSplatter(
        enemy.position.lat,
        enemy.position.lon,
        enemy.transform.terrainHeight + 1,
        isSplashDamage ? 8 : 15
      );

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
      enemyManager.kill(enemy);

      const reward = enemy.typeConfig.reward;

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

      // Track kill on source tower
      const sourceTower = towerManager.getById(sourceTowerId);
      if (sourceTower) {
        sourceTower.combat.kills++;
      }

      return { killed: true, reward };
    }

    return { killed: false, reward: 0 };
  }

  /**
   * Spawn large blood effect when enemy dies
   */
  private spawnDeathBloodEffect(enemy: Enemy): void {
    if (!enemy.typeConfig.canBleed || !this.tilesEngine) return;

    this.tilesEngine.effects.spawnBloodSplatter(
      enemy.position.lat,
      enemy.position.lon,
      enemy.transform.terrainHeight + 1,
      40
    );

    const deathDecalHeight = this.getTerrainHeightForDecal(
      enemy.position.lat,
      enemy.position.lon,
      enemy.transform.terrainHeight
    );
    this.tilesEngine.effects.spawnBloodDecal(
      enemy.position.lat,
      enemy.position.lon,
      deathDecalHeight,
      2.0
    );
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
   * Get terrain height at geo position with raycast (for accurate decal placement)
   */
  private getTerrainHeightForDecal(lat: number, lon: number, fallbackHeight: number): number {
    if (!this.tilesEngine) return fallbackHeight + 0.15;

    const terrainY = this.tilesEngine.getTerrainHeightAtGeo(lat, lon);
    if (terrainY === null) return fallbackHeight + 0.15;

    const origin = this.tilesEngine.sync.getOrigin();
    return terrainY + origin.height + 0.15;
  }
}
