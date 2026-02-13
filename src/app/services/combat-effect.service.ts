import { Injectable, inject } from '@angular/core';
import { ThreeTilesEngine } from '../three-engine';
import { GlobalRouteGridService } from './global-route-grid.service';
import { StatusEffectService } from './status-effect.service';
import { CombatVfxService } from './combat-vfx.service';
import { DamageApplicationService } from './damage-application.service';
import { Enemy } from '../entities/enemy.entity';
import { Projectile } from '../entities/projectile.entity';
import { GAME_BALANCE } from '../configs/game-balance.config';
import { TIMING } from '../configs/timing.config';
import { geoDistanceFast } from '../utils/geo-utils';
import { TowerManager } from '../managers/tower.manager';
import { EnemyManager } from '../managers/enemy.manager';
import { GameEventBus } from '../game-engine';

/**
 * CombatEffectService - Orchestrates projectile hits
 *
 * Event-driven: Subscribes to projectile:hit events from GameEventBus.
 * Delegates to:
 * - DamageApplicationService for damage + kills
 * - CombatVfxService for visual effects
 * - StatusEffectService for slow/burn/poison
 */
@Injectable({ providedIn: 'root' })
export class CombatEffectService {
  private readonly globalRouteGrid = inject(GlobalRouteGridService);
  private readonly statusEffectService = inject(StatusEffectService);
  private readonly vfx = inject(CombatVfxService);
  private readonly damageService = inject(DamageApplicationService);

  private tilesEngine: ThreeTilesEngine | null = null;
  private eventBus: GameEventBus | null = null;

  /** Whether damage numbers are shown on hits (toggled via display options) */
  damageNumbersEnabled = true;

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

    // Initialize sub-services
    this.vfx.initialize(tilesEngine, eventBus);
    this.damageService.initialize(towerManager, enemyManager, timescaleProvider);

    // Subscribe to projectile:hit events
    this.eventBus.on('projectile:hit', (event) => {
      this.handleProjectileHit(event.projectile, event.target);
    });
  }

  /**
   * Handle projectile hitting an enemy.
   * Processes splash damage and visual effects.
   */
  private handleProjectileHit(projectile: Projectile, enemy: Enemy): void {
    const splashRadius = projectile.typeConfig.splashRadius;
    const hasSplash = splashRadius && splashRadius > 0;
    const isIceShard = projectile.typeConfig.id === 'ice-shard';

    // Spawn explosion/ice effects for splash projectiles
    if (hasSplash) {
      if (isIceShard) {
        this.vfx.emitIceExplosion(enemy);
      } else {
        this.vfx.emitExplosion(enemy);
      }
    }

    // Apply damage to primary target
    this.damageService.applyDamage(
      this.vfx,
      enemy,
      projectile.damage,
      projectile.sourceTowerId,
      false,
      isIceShard
    );

    // Spawn damage number for direct hit
    this.spawnDamageNumber(enemy, projectile.damage);

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
      this.applySplashDamage(projectile, enemy, splashRadius, isIceShard);
    }
  }

  /**
   * Apply splash damage to enemies near the impact point.
   */
  private applySplashDamage(
    projectile: Projectile,
    origin: Enemy,
    splashRadius: number,
    isIceShard: boolean
  ): void {
    const nearbyEnemies = this.globalRouteGrid.getEnemiesInRadiusGeo(
      origin.position,
      splashRadius,
      origin.id
    );

    const useFalloff = projectile.typeConfig.splashDamageFalloff !== false;

    for (const nearbyEnemy of nearbyEnemies) {
      let splashDamage = projectile.damage;

      if (useFalloff) {
        const dist = geoDistanceFast(origin.position, nearbyEnemy.position);
        const falloff = 1 - (dist / splashRadius);
        splashDamage = Math.floor(projectile.damage * falloff);
      }

      if (splashDamage > 0) {
        this.damageService.applyDamage(
          this.vfx,
          nearbyEnemy,
          splashDamage,
          projectile.sourceTowerId,
          true,
          isIceShard
        );

        // Spawn damage number for splash hit
        this.spawnDamageNumber(nearbyEnemy, splashDamage);
      }

      // Apply slow effect and ice decal to splash targets
      if (isIceShard) {
        this.statusEffectService.applySlow(
          nearbyEnemy,
          GAME_BALANCE.effects.ice.slowAmount,
          GAME_BALANCE.effects.ice.duration,
          projectile.sourceTowerId
        );
        this.vfx.emitIceDecal(nearbyEnemy);
      }
    }
  }

  /**
   * Spawn a red floating damage number above an enemy.
   */
  private spawnDamageNumber(enemy: Enemy, damage: number): void {
    if (!this.damageNumbersEnabled || !this.tilesEngine) return;
    const rounded = Math.round(damage);
    // Scale text size with damage: small splash hits → small, big direct hits → large
    const t = Math.min(rounded / 80, 1);
    const scale = 0.25 + t * 0.3; // 0.25 (low dmg) → 0.55 (high dmg)
    this.tilesEngine.effects.spawnFloatingText(
      `-${rounded}`,
      enemy.position.lat,
      enemy.position.lon,
      enemy.transform.terrainHeight + 5,
      {
        color: '#FF4444',
        duration: TIMING.damagePopupDuration,
        floatSpeed: 1.2,
        scale,
      }
    );
  }

  // =====================================================
  // PUBLIC METHODS FOR BEAM TOWERS
  // =====================================================

  /**
   * Apply continuous beam damage to an enemy.
   * Used by Fire Tower flamethrower effect.
   */
  applyBeamDamage(
    enemy: Enemy,
    damage: number,
    sourceTowerId: string,
    showBloodEffects = false
  ): void {
    this.damageService.applyBeamDamage(this.vfx, enemy, damage, sourceTowerId, showBloodEffects);
  }
}
