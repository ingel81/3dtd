import { Injectable, inject } from '@angular/core';
import { ThreeTilesEngine } from '../three-engine';
import { GlobalRouteGridService } from './global-route-grid.service';
import { StatusEffectService } from './status-effect.service';
import { Enemy } from '../entities/enemy.entity';
import { Projectile } from '../entities/projectile.entity';
import { GAME_BALANCE } from '../configs/game-balance.config';
import { geoDistanceFast } from '../utils/geo-utils';
import { TowerManager } from '../managers/tower.manager';
import { EnemyManager } from '../managers/enemy.manager';
import { GameEventBus } from '../game-engine';

/**
 * CombatEffectService - Handles projectile hits, damage application, and visual effects
 *
 * Event-driven: Subscribes to projectile:hit events from GameEventBus
 *
 * Manages:
 * - Projectile hit processing (splash damage, effects)
 * - Damage application to enemies
 * - Blood/death effects
 * - Slow effects (delegated to StatusEffectService)
 */
@Injectable({ providedIn: 'root' })
export class CombatEffectService {
  private readonly globalRouteGrid = inject(GlobalRouteGridService);
  private readonly statusEffectService = inject(StatusEffectService);

  private tilesEngine: ThreeTilesEngine | null = null;
  private eventBus: GameEventBus | null = null;
  private towerManager: TowerManager | null = null;
  private enemyManager: EnemyManager | null = null;
  private timescaleProvider: (() => number) | null = null;

  /**
   * Initialize with engine reference and subscribe to events
   */
  initialize(
    tilesEngine: ThreeTilesEngine,
    eventBus: GameEventBus,
    towerManager: TowerManager,
    enemyManager: EnemyManager,
    timescaleProvider: () => number
  ): void {
    this.tilesEngine = tilesEngine;
    this.eventBus = eventBus;
    this.towerManager = towerManager;
    this.enemyManager = enemyManager;
    this.timescaleProvider = timescaleProvider;

    // Subscribe to projectile:hit events
    this.eventBus.on('projectile:hit', (event) => {
      this.handleProjectileHit(event.projectile, event.target);
    });
  }

  /**
   * Handle projectile hitting an enemy
   * Processes splash damage and visual effects
   */
  private handleProjectileHit(projectile: Projectile, enemy: Enemy): void {
    if (!this.towerManager || !this.enemyManager) {
      console.warn('[CombatEffectService] Not initialized');
      return;
    }

    const splashRadius = projectile.typeConfig.splashRadius;
    const hasSplash = splashRadius && splashRadius > 0;
    const isIceShard = projectile.typeConfig.id === 'ice-shard';

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
      } else if (this.eventBus) {
        const explosionPos = this.tilesEngine.sync.geoToLocalSimple(
          enemy.position.lat,
          enemy.position.lon,
          explosionHeight
        );
        this.eventBus.emitDeferred({
          type: 'vfx:explosion',
          position: explosionPos,
          radius: 30,
        });
      }
    }

    // Apply damage to primary target
    this.applyDamageToEnemy(
      enemy,
      projectile.damage,
      projectile.sourceTowerId,
      false,
      isIceShard
    );

    // Apply slow effect for ice-shard
    if (isIceShard) {
      this.statusEffectService.applySlow(
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
          const dist = geoDistanceFast(enemy.position, nearbyEnemy.position);
          const falloff = 1 - (dist / splashRadius);
          splashDamage = Math.floor(projectile.damage * falloff);
        }

        if (splashDamage > 0) {
          this.applyDamageToEnemy(
            nearbyEnemy,
            splashDamage,
            projectile.sourceTowerId,
            true,
            isIceShard
          );
        }

        // Apply slow effect and ice decal to splash targets
        if (isIceShard) {
          this.statusEffectService.applySlow(
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
  }

  private emitBloodEffect(lat: number, lon: number, height: number, intensity: number): void {
    if (!this.tilesEngine || !this.eventBus) return;

    const position = this.tilesEngine.sync.geoToLocalSimple(lat, lon, height);
    this.eventBus.emitDeferred({
      type: 'vfx:blood',
      position,
      intensity,
    });
  }

  /**
   * Apply damage to an enemy and handle death
   */
  private applyDamageToEnemy(
    enemy: Enemy,
    damage: number,
    sourceTowerId: string,
    isSplashDamage: boolean,
    skipBloodEffects: boolean
  ): void {
    if (!this.towerManager || !this.enemyManager) return;

    // Spawn blood effects for enemies that can bleed
    if (enemy.typeConfig.canBleed && !skipBloodEffects) {
      const splatterHeight = enemy.transform.terrainHeight + 1;
      const intensity = isSplashDamage ? 8 : 15;
      this.emitBloodEffect(enemy.position.lat, enemy.position.lon, splatterHeight, intensity);
    }

    const killed = enemy.health.takeDamage(damage);
    if (killed) {
      if (!skipBloodEffects) {
        this.spawnDeathBloodEffect(enemy);
      }
      const timescale = this.timescaleProvider ? this.timescaleProvider() : 1.0;
      this.enemyManager.kill(enemy, timescale);

      // NOTE: Reward popup is now shown in game-state.manager.ts on enemy:died event
      // This ensures the correct dynamic reward is displayed (not static typeConfig.reward)

      // Track kill on source tower
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

    const splatterHeight = enemy.transform.terrainHeight + 1;
    this.emitBloodEffect(enemy.position.lat, enemy.position.lon, splatterHeight, 40);
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

  // =====================================================
  // PUBLIC METHODS FOR BEAM TOWERS
  // =====================================================

  /**
   * Apply continuous beam damage to an enemy.
   * Used by Fire Tower flamethrower effect.
   *
   * @param enemy - Target enemy
   * @param damage - Damage amount (typically DPS * deltaTime)
   * @param sourceTowerId - Tower that dealt the damage
   * @param showBloodEffects - Whether to show blood/fire effects (throttle for performance)
   */
  applyBeamDamage(
    enemy: Enemy,
    damage: number,
    sourceTowerId: string,
    showBloodEffects = false
  ): void {
    if (!this.towerManager || !this.enemyManager) return;

    // Only show blood effects occasionally for performance
    if (showBloodEffects && enemy.typeConfig.canBleed) {
      const splatterHeight = enemy.transform.terrainHeight + 1;
      this.emitBloodEffect(enemy.position.lat, enemy.position.lon, splatterHeight, 5);
    }

    const killed = enemy.health.takeDamage(damage);
    if (killed) {
      this.spawnDeathBloodEffect(enemy);
      const timescale = this.timescaleProvider ? this.timescaleProvider() : 1.0;
      this.enemyManager.kill(enemy, timescale);

      // Track kill on source tower
      const sourceTower = this.towerManager.getById(sourceTowerId);
      if (sourceTower) {
        sourceTower.combat.kills++;
      }
    }
  }
}
