import { Injectable } from '@angular/core';
import { Enemy } from '../../entities/enemy.entity';
import { TowerManager } from '../../managers/tower.manager';
import { EnemyManager } from '../../managers/enemy.manager';
import { CombatVfxService } from './combat-vfx.service';
import { DamageType, DamageResult } from '../../configs/combat/combat.types';
import { calculateDamage } from '../../utils/damage-calculator';
import { GameEventBus } from '../../game-engine/game-event-bus';
import { enemyBloodColor, enemyHitSpot } from '../../utils/enemy-hit-spot';
import { isHeroSource } from '../../configs/hero.config';
import type { KilledBy } from '../../game-engine/game-event-bus';

/**
 * DamageApplicationService - Applies damage to enemies and handles kills
 *
 * Extracted from CombatEffectService for Single Responsibility.
 * Pure damage logic — applies HP reduction, triggers death, tracks tower kills
 * and announces them as `tower:kill`; a kill by the hero's shots (source
 * HERO_SOURCE_ID) as `hero:kill`.
 * Delegates visual effects to CombatVfxService.
 */
@Injectable({ providedIn: 'root' })
export class DamageApplicationService {
  private towerManager: TowerManager | null = null;
  private enemyManager: EnemyManager | null = null;
  private eventBus: GameEventBus | null = null;

  initialize(
    towerManager: TowerManager,
    enemyManager: EnemyManager,
    eventBus: GameEventBus,
  ): void {
    this.towerManager = towerManager;
    this.enemyManager = enemyManager;
    this.eventBus = eventBus;
  }

  /**
   * Apply damage to an enemy, handle death + kill tracking.
   * Uses the damage matrix to calculate effective damage based on damageType vs armorType.
   *
   * @param vfx - CombatVfxService for blood effects (injected to avoid circular deps)
   * @param enemy - Target enemy
   * @param damage - Raw damage amount (before matrix multiplier)
   * @param damageType - Type of damage being dealt
   * @param sourceTowerId - Tower that dealt the damage, or HERO_SOURCE_ID
   * @param isSplashDamage - Whether this is splash (lower blood intensity)
   * @param skipBloodEffects - Skip blood (e.g. ice projectiles)
   * @returns DamageResult with effective damage info, or null if not initialized
   */
  applyDamage(
    vfx: CombatVfxService,
    enemy: Enemy,
    damage: number,
    damageType: DamageType,
    sourceTowerId: string,
    isSplashDamage: boolean,
    skipBloodEffects: boolean
  ): DamageResult | null {
    if (!this.towerManager || !this.enemyManager) return null;

    const armorType = enemy.getEffectiveArmorType();
    const result = calculateDamage(damage, damageType, armorType);

    // Spawn blood effects for enemies that can bleed
    if (!skipBloodEffects) {
      vfx.emitHitBlood(enemy, isSplashDamage);
    }

    const hpBefore = enemy.health.hp;
    const killed = enemy.health.takeDamage(result.finalDamage);
    this.creditDamage(sourceTowerId, hpBefore - enemy.health.hp);
    if (killed) {
      if (!skipBloodEffects) {
        vfx.emitDeathBlood(enemy);
      }
      this.killEnemy(enemy, sourceTowerId);
    }

    return result;
  }

  /**
   * Apply continuous beam damage to an enemy (e.g. flamethrower).
   * Uses the damage matrix to calculate effective damage based on damageType vs armorType.
   *
   * @param vfx - CombatVfxService for blood effects
   * @param enemy - Target enemy
   * @param damage - Raw damage amount (typically DPS * deltaTime)
   * @param damageType - Type of damage being dealt
   * @param sourceTowerId - Tower that dealt the damage
   * @param showBloodEffects - Whether to show blood (throttled by caller)
   * @returns DamageResult with effective damage info, or null if not initialized
   */
  applyBeamDamage(
    vfx: CombatVfxService,
    enemy: Enemy,
    damage: number,
    damageType: DamageType,
    sourceTowerId: string,
    showBloodEffects: boolean
  ): DamageResult | null {
    if (!this.towerManager || !this.enemyManager) return null;

    const armorType = enemy.getEffectiveArmorType();
    const result = calculateDamage(damage, damageType, armorType);

    if (showBloodEffects && enemy.typeConfig.canBleed) {
      const spot = enemyHitSpot(enemy);
      vfx.emitBloodEffect(spot.lat, spot.lon, spot.height + 1, 5, false, enemyBloodColor(enemy));
    }

    const hpBefore = enemy.health.hp;
    const killed = enemy.health.takeDamage(result.finalDamage);
    this.creditDamage(sourceTowerId, hpBefore - enemy.health.hp);
    if (killed) {
      vfx.emitDeathBlood(enemy);
      this.killEnemy(enemy, sourceTowerId);
    }

    return result;
  }

  /**
   * Take `fraction` of the enemy's max HP, past the damage matrix and armor.
   *
   * The path for abilities: a share of max HP scales over every wave without
   * retuning and does not undercut the spread of the matrix
   * (PLAYER_AGENCY_CONCEPT.md, section 7). The kill credits no tower; it pays its
   * share of the wave's kill budget like any other kill.
   *
   * @param vfx - CombatVfxService for the death blood
   * @param enemy - Target enemy
   * @param fraction - Share of max HP to take, 0..1
   * @param showDeathBlood - Whether a kill spawns death blood (the caller caps mass kills)
   * @returns true when this hit killed the enemy
   */
  applyMaxHpFraction(
    vfx: CombatVfxService,
    enemy: Enemy,
    fraction: number,
    showDeathBlood: boolean,
    /** Whose ability it was: the kill's gold goes to them */
    ownerId?: string,
  ): boolean {
    if (!this.towerManager || !this.enemyManager) return false;

    const killed = enemy.health.takeDamage(enemy.health.maxHp * fraction);
    // kill() ignores an enemy that is already dying
    if (!killed || !this.enemyManager.kill(enemy, 'combat', { kind: 'ability', ownerId })) return false;

    if (showDeathBlood) {
      vfx.emitDeathBlood(enemy);
    }
    return true;
  }

  /**
   * Add the HP a hit actually took to its tower's damageDealt. Overkill and
   * hits on an enemy already at 0 HP add nothing; a sold tower is not found.
   * Ability damage (applyMaxHpFraction) belongs to no tower and is not counted.
   */
  private creditDamage(sourceTowerId: string, dealt: number): void {
    if (dealt <= 0 || !this.towerManager) return;
    const tower = this.towerManager.getById(sourceTowerId);
    if (tower) tower.combat.damageDealt += dealt;
  }

  /**
   * Handle enemy death: kill + track on source tower, or on the hero.
   */
  private killEnemy(enemy: Enemy, sourceTowerId: string): void {
    if (!this.towerManager || !this.enemyManager) return;

    // kill() ignores an enemy that is already dying; only credit real kills
    const hero = isHeroSource(sourceTowerId);
    const killedBy: KilledBy = hero
      ? { kind: 'hero', heroId: sourceTowerId }
      : { kind: 'tower', towerId: sourceTowerId };
    if (!this.enemyManager.kill(enemy, 'combat', killedBy)) return;

    // The hero's shots: his HeroManager counts the kill toward his levels
    if (hero) {
      this.eventBus?.emit({ type: 'hero:kill', enemy, heroId: sourceTowerId });
      return;
    }

    // Track kill on source tower
    const sourceTower = this.towerManager.getById(sourceTowerId);
    if (sourceTower) {
      sourceTower.combat.kills++;
      this.eventBus?.emit({ type: 'tower:kill', tower: sourceTower });
    }
  }
}
