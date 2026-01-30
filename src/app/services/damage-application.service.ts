import { Injectable } from '@angular/core';
import { Enemy } from '../entities/enemy.entity';
import { TowerManager } from '../managers/tower.manager';
import { EnemyManager } from '../managers/enemy.manager';
import { CombatVfxService } from './combat-vfx.service';

/**
 * DamageApplicationService - Applies damage to enemies and handles kills
 *
 * Extracted from CombatEffectService for Single Responsibility.
 * Pure damage logic — applies HP reduction, triggers death, tracks tower kills.
 * Delegates visual effects to CombatVfxService.
 */
@Injectable({ providedIn: 'root' })
export class DamageApplicationService {
  private towerManager: TowerManager | null = null;
  private enemyManager: EnemyManager | null = null;
  private timescaleProvider: (() => number) | null = null;

  initialize(
    towerManager: TowerManager,
    enemyManager: EnemyManager,
    timescaleProvider: () => number
  ): void {
    this.towerManager = towerManager;
    this.enemyManager = enemyManager;
    this.timescaleProvider = timescaleProvider;
  }

  /**
   * Apply damage to an enemy, handle death + kill tracking.
   *
   * @param vfx - CombatVfxService for blood effects (injected to avoid circular deps)
   * @param enemy - Target enemy
   * @param damage - Damage amount
   * @param sourceTowerId - Tower that dealt the damage
   * @param isSplashDamage - Whether this is splash (lower blood intensity)
   * @param skipBloodEffects - Skip blood (e.g. ice projectiles)
   */
  applyDamage(
    vfx: CombatVfxService,
    enemy: Enemy,
    damage: number,
    sourceTowerId: string,
    isSplashDamage: boolean,
    skipBloodEffects: boolean
  ): void {
    if (!this.towerManager || !this.enemyManager) return;

    // Spawn blood effects for enemies that can bleed
    if (!skipBloodEffects) {
      vfx.emitHitBlood(enemy, isSplashDamage);
    }

    const killed = enemy.health.takeDamage(damage);
    if (killed) {
      if (!skipBloodEffects) {
        vfx.emitDeathBlood(enemy);
      }
      this.killEnemy(enemy, sourceTowerId);
    }
  }

  /**
   * Apply continuous beam damage to an enemy (e.g. flamethrower).
   *
   * @param vfx - CombatVfxService for blood effects
   * @param enemy - Target enemy
   * @param damage - Damage amount (typically DPS * deltaTime)
   * @param sourceTowerId - Tower that dealt the damage
   * @param showBloodEffects - Whether to show blood (throttled by caller)
   */
  applyBeamDamage(
    vfx: CombatVfxService,
    enemy: Enemy,
    damage: number,
    sourceTowerId: string,
    showBloodEffects: boolean
  ): void {
    if (!this.towerManager || !this.enemyManager) return;

    if (showBloodEffects && enemy.typeConfig.canBleed) {
      const splatterHeight = enemy.transform.terrainHeight + 1;
      vfx.emitBloodEffect(enemy.position.lat, enemy.position.lon, splatterHeight, 5);
    }

    const killed = enemy.health.takeDamage(damage);
    if (killed) {
      vfx.emitDeathBlood(enemy);
      this.killEnemy(enemy, sourceTowerId);
    }
  }

  /**
   * Handle enemy death — kill + track on source tower.
   */
  private killEnemy(enemy: Enemy, sourceTowerId: string): void {
    if (!this.towerManager || !this.enemyManager) return;

    const timescale = this.timescaleProvider ? this.timescaleProvider() : 1.0;
    this.enemyManager.kill(enemy, timescale);

    // Track kill on source tower
    const sourceTower = this.towerManager.getById(sourceTowerId);
    if (sourceTower) {
      sourceTower.combat.kills++;
    }
  }
}
