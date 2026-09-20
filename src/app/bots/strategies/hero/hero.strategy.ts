/**
 * Hero Strategy
 *
 * Priority 85: below the anti-air and anti-ethereal placements, which answer
 * a wave the defense cannot hit at all, and above the ordinary fill.
 *
 * Three decisions, in this order:
 *
 * 1. **Hire** once the research is done and the gold is there. He costs a
 *    tower and a half and never dies, so there is no reason to wait.
 * 2. **Ammo** by what the running wave is wearing: explosive rounds against
 *    heavy and fortified armor, rune rounds against ethereal, standard
 *    otherwise. His damage type is the only thing about him the player picks
 *    (docs/HERO.md).
 * 3. **Position** at the crowd: the spot among the living enemies that has
 *    the most others within his range. He holds it on a leash, so a new order
 *    only pays off when the crowd has really moved.
 *
 * Until 2026-09-20 no bot used the hero at all, so every run measured a game
 * without him (BALANCING_PLAN.md, decision D15).
 */

import { BaseStrategy } from '../tower-strategy.interface';
import { GameStateSnapshot } from '../../../director/models/game-state-snapshot';
import { TowerAction } from '../../bots/tower-bot.interface';
import { GameStateManager } from '../../../managers/game-state.manager';
import { HERO, type HeroAmmoId } from '../../../configs/hero.config';
import { densestCenter } from '../ability/ability-aim';
import { haversineDistance } from '../../../utils/geo-utils';

/** Enemies alive before he is sent anywhere. */
const MIN_ENEMIES_FOR_A_MOVE = 3;

/** A new order only when the crowd sits this far from the spot he holds. */
const REORDER_DISTANCE_M = HERO.leashM * 2;

/** Armor shares above which the ammo switches. */
const ARMOR_SHARE = 0.4;

export class HeroStrategy extends BaseStrategy {
  constructor(private gameState: GameStateManager) {
    super('Hero', 85);
  }

  canExecute(state: GameStateSnapshot): boolean {
    const hero = this.gameState.heroManager.getStatus();
    if (!hero.unlocked) return false;
    if (!hero.hired) return state.player.credits >= HERO.cost;
    return true;
  }

  execute(state: GameStateSnapshot): TowerAction | null {
    const hero = this.gameState.heroManager.getStatus();

    if (!hero.hired) {
      if (state.player.credits < HERO.cost) return null;
      return { type: 'hire-hero', reason: 'the mercenary is researched and affordable' };
    }

    const ammo = this.ammoFor(state);
    if (ammo !== hero.ammo) {
      return { type: 'hero-ammo', ammo, reason: `the wave wants ${ammo} rounds` };
    }

    return this.moveToTheCrowd();
  }

  /** The ammo the running wave calls for. */
  private ammoFor(state: GameStateSnapshot): HeroAmmoId {
    const armor = state.expectedArmorDistribution;
    if (!armor) return 'standard';
    if ((armor.ethereal ?? 0) >= ARMOR_SHARE) return 'rune';
    if ((armor.heavy ?? 0) + (armor.fortified ?? 0) >= ARMOR_SHARE) return 'explosive';
    return 'standard';
  }

  /**
   * Send him where the crowd is, but only when it is worth a walk: he holds
   * his spot on a leash and shoots what comes near it, so a new order every
   * few seconds would keep him walking instead of shooting.
   */
  private moveToTheCrowd(): TowerAction | null {
    const enemies = this.gameState.enemyManager.getAlive();
    if (enemies.length < MIN_ENEMIES_FOR_A_MOVE) return null;

    const { center } = densestCenter(enemies, HERO.rangeM);
    const anchor = this.gameState.heroManager.getAnchor();
    const away = anchor
      ? haversineDistance(anchor.lat, anchor.lon, center.position.lat, center.position.lon)
      : Infinity;
    if (away < REORDER_DISTANCE_M) return null;

    return {
      type: 'hero-move',
      position: { x: center.position.lon, z: center.position.lat },
      reason: 'the hero goes where most enemies are',
    };
  }
}
