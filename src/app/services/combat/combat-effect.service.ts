import { Injectable, inject } from '@angular/core';
import { ThreeTilesEngine } from '../../three-engine';
import { GlobalRouteGridService } from '../world/global-route-grid.service';
import { StatusEffectService } from './status-effect.service';
import { CombatVfxService } from './combat-vfx.service';
import { DamageApplicationService } from './damage-application.service';
import { Enemy } from '../../entities/enemy.entity';
import { Projectile } from '../../entities/projectile.entity';
import { GAME_BALANCE } from '../../configs/game-balance.config';
import { TIMING } from '../../configs/timing.config';
import { geoDistanceFast } from '../../utils/geo-utils';
import { TowerManager } from '../../managers/tower.manager';
import { EnemyManager } from '../../managers/enemy.manager';
import { GameEventBus, SubscriptionBag } from '../../game-engine';
import { DamageType, DamageResult } from '../../configs/combat/combat.types';
import { EFFECTIVENESS_COLORS, EFFECTIVENESS_SCALES } from '../../configs/combat/damage-matrix.config';

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
  private readonly eventBusSubs = new SubscriptionBag();

  /** Whether damage numbers are shown on hits (toggled via display options) */
  damageNumbersEnabled = true;

  /**
   * Dispose event subscriptions. Call from GameStateManager.dispose().
   */
  destroy(): void {
    this.eventBusSubs.disposeAll();
  }

  /**
   * Initialize with engine reference and subscribe to events
   */
  initialize(
    tilesEngine: ThreeTilesEngine,
    eventBus: GameEventBus,
    towerManager: TowerManager,
    enemyManager: EnemyManager,
  ): void {
    // Clean up previous subscriptions on re-init
    this.eventBusSubs.disposeAll();

    this.tilesEngine = tilesEngine;
    this.eventBus = eventBus;

    // Initialize sub-services
    this.vfx.initialize(tilesEngine, eventBus);
    this.damageService.initialize(towerManager, enemyManager);

    // Subscribe to projectile:hit events
    this.eventBusSubs.add(this.eventBus.on('projectile:hit', (event) => {
      this.handleProjectileHit(event.projectile, event.target, event.damageType);
    }));

    // Subscribe to DOT damage events (poison ticks)
    this.eventBusSubs.add(this.eventBus.on('dot:damage', (event) => {
      this.handleDotDamage(event.enemy, event.damage, event.damageType);
    }));
  }

  /**
   * Handle projectile hitting an enemy.
   * Processes splash damage and visual effects.
   */
  private handleProjectileHit(projectile: Projectile, enemy: Enemy, damageType: DamageType): void {
    const splashRadius = projectile.typeConfig.splashRadius;
    const hasSplash = splashRadius && splashRadius > 0;
    const isIceShard = projectile.typeConfig.id === 'ice-shard';
    const isPoisonGlob = projectile.typeConfig.id === 'poison-glob';

    // Spawn explosion/ice effects for splash projectiles
    if (hasSplash) {
      if (isIceShard) {
        this.vfx.emitIceExplosion(enemy);
      } else {
        this.vfx.emitExplosion(enemy);
      }
    }

    // Apply damage to primary target (suppress blood for ice and poison)
    const suppressBlood = isIceShard || isPoisonGlob;
    const result = this.damageService.applyDamage(
      this.vfx,
      enemy,
      projectile.damage,
      damageType,
      projectile.sourceTowerId,
      false,
      suppressBlood
    );

    // Spawn damage number for direct hit (color/size based on effectiveness)
    if (result) {
      this.spawnDamageNumberFromResult(enemy, result);
    }

    // Apply slow effect for ice-shard
    if (isIceShard) {
      this.statusEffectService.applySlow(
        enemy,
        GAME_BALANCE.effects.ice.slowAmount,
        GAME_BALANCE.effects.ice.duration,
        projectile.sourceTowerId
      );
    }

    // Apply poison DOT for poison-glob
    if (isPoisonGlob) {
      // Scale DOT DPS with tower damage upgrade multiplier
      const baseDamage = 5; // Poison tower base damage
      const upgradeMultiplier = projectile.damage / baseDamage;
      const dotDps = GAME_BALANCE.effects.poison.dotDamagePerSecond * upgradeMultiplier;

      this.statusEffectService.applyPoison(
        enemy,
        dotDps,
        GAME_BALANCE.effects.poison.duration,
        projectile.sourceTowerId
      );
    }

    // Apply splash damage to nearby enemies
    if (hasSplash) {
      this.applySplashDamage(projectile, enemy, splashRadius, damageType, isIceShard, isPoisonGlob);
    }
  }

  /**
   * Apply splash damage to enemies near the impact point.
   */
  private applySplashDamage(
    projectile: Projectile,
    origin: Enemy,
    splashRadius: number,
    damageType: DamageType,
    isIceShard: boolean,
    isPoisonGlob = false
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
        const result = this.damageService.applyDamage(
          this.vfx,
          nearbyEnemy,
          splashDamage,
          damageType,
          projectile.sourceTowerId,
          true,
          isIceShard || isPoisonGlob
        );

        // Spawn damage number for splash hit
        if (result) {
          this.spawnDamageNumberFromResult(nearbyEnemy, result);
        }
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

      // Apply poison DOT to splash targets
      if (isPoisonGlob) {
        const baseDamage = 5;
        const upgradeMultiplier = projectile.damage / baseDamage;
        const dotDps = GAME_BALANCE.effects.poison.dotDamagePerSecond * upgradeMultiplier;

        this.statusEffectService.applyPoison(
          nearbyEnemy,
          dotDps,
          GAME_BALANCE.effects.poison.duration,
          projectile.sourceTowerId
        );
      }
    }
  }

  /**
   * Spawn a floating damage number with effectiveness-based color and scale.
   */
  private spawnDamageNumberFromResult(enemy: Enemy, result: DamageResult): void {
    if (!this.damageNumbersEnabled || !this.tilesEngine) return;
    const rounded = Math.round(result.finalDamage);
    const color = EFFECTIVENESS_COLORS[result.effectiveness];
    const effectivenessScale = EFFECTIVENESS_SCALES[result.effectiveness];
    // Scale text size with damage: small splash hits → small, big direct hits → large
    const t = Math.min(rounded / 80, 1);
    const baseScale = 0.25 + t * 0.3; // 0.25 (low dmg) → 0.55 (high dmg)
    const scale = baseScale * effectivenessScale;
    this.tilesEngine.effects.spawnFloatingText(
      `-${rounded}`,
      enemy.position.lat,
      enemy.position.lon,
      enemy.transform.terrainHeight + (enemy.typeConfig.heightOffset ?? 0) + 5,
      {
        color,
        duration: TIMING.damagePopupDuration,
        floatSpeed: 1.2,
        scale,
      }
    );
  }

  /**
   * Handle DOT damage tick (poison).
   * Applies damage through the matrix and spawns green damage number.
   */
  private handleDotDamage(enemy: Enemy, damage: number, damageType: DamageType): void {
    if (!enemy.alive || !this.tilesEngine) return;

    const result = this.damageService.applyDamage(
      this.vfx,
      enemy,
      damage,
      damageType,
      '',
      false,
      true // suppress blood for DOT
    );

    // Green damage number for poison (keep green regardless of effectiveness)
    if (this.damageNumbersEnabled && result) {
      const rounded = Math.round(result.finalDamage);
      this.tilesEngine.effects.spawnFloatingText(
        `-${rounded}`,
        enemy.position.lat,
        enemy.position.lon,
        enemy.transform.terrainHeight + (enemy.typeConfig.heightOffset ?? 0) + 5,
        {
          color: '#44CC22',
          duration: TIMING.damagePopupDuration,
          floatSpeed: 1.2,
          scale: 0.2,
        }
      );
    }
  }

  // =====================================================
  // PUBLIC METHODS FOR BEAM TOWERS
  // =====================================================

  /**
   * Apply melee damage to an enemy.
   * Used by Tentacle Tower direct strikes.
   */
  applyMeleeDamage(
    enemy: Enemy,
    damage: number,
    damageType: DamageType,
    sourceTowerId: string
  ): void {
    const result = this.damageService.applyBeamDamage(this.vfx, enemy, damage, damageType, sourceTowerId, true);

    // Spawn damage number with effectiveness feedback
    if (result) {
      this.spawnDamageNumberFromResult(enemy, result);
    }
  }

  /**
   * Apply continuous beam damage to an enemy.
   * Used by Fire Tower flamethrower effect.
   */
  applyBeamDamage(
    enemy: Enemy,
    damage: number,
    damageType: DamageType,
    sourceTowerId: string,
    showBloodEffects = false
  ): void {
    this.damageService.applyBeamDamage(this.vfx, enemy, damage, damageType, sourceTowerId, showBloodEffects);
  }

  /**
   * Apply chain-lightning damage to a single enemy. No blood effects (electric, not physical).
   * Used by Lightning Tower hitscan chain. Spawns a damage number per hit and
   * triggers a brief electric-blue tint flash on the target.
   */
  applyChainDamage(
    enemy: Enemy,
    damage: number,
    damageType: DamageType,
    sourceTowerId: string,
  ): void {
    const result = this.damageService.applyBeamDamage(this.vfx, enemy, damage, damageType, sourceTowerId, false);
    if (result) {
      this.spawnDamageNumberFromResult(enemy, result);
    }
    this.tilesEngine?.enemies.triggerHitFlash(enemy.id);
  }

  /**
   * Emit a 'vfx:chain-lightning' event with the polyline of hit points
   * (tower tip → primary → jump1 → …) in local space.
   */
  emitChainLightningVfx(points: { x: number; y: number; z: number }[], sourceTowerId: string): void {
    if (!this.eventBus || points.length < 2) return;
    this.eventBus.emit({ type: 'vfx:chain-lightning', points, sourceTowerId });
  }
}
