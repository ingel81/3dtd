/**
 * Player abilities: actions the player takes during a wave, as opposed to
 * towers, which act on their own. Design and decisions in
 * docs/game-design/PLAYER_AGENCY_CONCEPT.md (sections 5 and 7).
 *
 * A research unlocks an ability by granting the global perk `perkId`. The
 * ability holds up to `maxCharges` charges and gets one back per
 * `rechargeWaves` completed waves. Charges come back per wave, not in game
 * time: between waves the clock keeps running (research ticks) and the player
 * starts the next wave, so a cooldown in game time could be filled by waiting.
 */

import type { ResearchId } from './research/research.types';
import type { EnemyTypeConfig } from './enemy-types.config';
import type { TdIconName } from '../components/icon/icon.component';

export type AbilityId = 'nuclear-strike';

export interface AbilityConfig {
  id: AbilityId;
  /** UI label; the game UI is English */
  name: string;
  /** Tooltip text */
  description: string;
  /** Icon of its button in the ability bar */
  icon: TdIconName;
  /**
   * Key that works like a press on its button, one letter, case ignored. It
   * must not be one hotkey-map.ts or InputHandlerService already use;
   * hotkey-map.spec.ts checks that.
   */
  hotkey: string;
  /** Research that unlocks the ability */
  researchId: ResearchId;
  /** Global perk that research grants; the manager unlocks on it */
  perkId: string;
  maxCharges: number;
  /** Completed waves per charge */
  rechargeWaves: number;
  /** Strike radius around the impact point in metres, 2D: ground and air alike */
  radiusM: number;
  /** Game time between the command and the impact, ms */
  warningMs: number;
  /** Share of its max HP an enemy loses, independent of the damage matrix */
  maxHpFraction: number;
  /** The same for enemies with `isBoss` */
  bossMaxHpFraction: number;
  /**
   * The impact lands on the centre of the nearest route cell within this
   * distance of the target; with none in reach the command is rejected. Clicks
   * land on roofs, the enemies walk on the street.
   */
  snapRadiusM: number;
}

export const ABILITIES: Record<AbilityId, AbilityConfig> = {
  'nuclear-strike': {
    id: 'nuclear-strike',
    name: 'Nuclear Strike',
    description:
      'Strike a spot on the route: 1.5 s later everything within 25 m loses 60% of its max HP, bosses 20%. '
      + 'One charge, a new one every 3 waves.',
    icon: 'radiation',
    hotkey: 'K',
    researchId: 'nuclear-strike',
    perkId: 'nuclear-strike',
    maxCharges: 1,
    rechargeWaves: 3,
    radiusM: 25,
    warningMs: 1500,
    maxHpFraction: 0.6,
    bossMaxHpFraction: 0.2,
    snapRadiusM: 30,
  },
};

export const ABILITY_IDS = Object.keys(ABILITIES) as AbilityId[];

/** Share of its max HP an enemy of `enemyType` loses to `ability`. */
export function abilityDamageFraction(
  ability: AbilityConfig,
  enemyType: Pick<EnemyTypeConfig, 'isBoss'>,
): number {
  return enemyType.isBoss ? ability.bossMaxHpFraction : ability.maxHpFraction;
}

/** One ability as the UI and the bot see it: the AbilityManager's snapshot. */
export interface AbilityStatus {
  id: AbilityId;
  unlocked: boolean;
  charges: number;
  maxCharges: number;
  /** Completed waves until the next charge; 0 while the charges are full */
  wavesUntilCharge: number;
  /** A strike is on its way: commanded, not yet landed */
  pending: boolean;
}

/** Why a use was refused. */
export type AbilityRejectReason = 'unknown' | 'locked' | 'no-charge' | 'no-wave' | 'no-route';

/** Status of an ability before its research is done. */
export function lockedAbilityStatus(id: AbilityId): AbilityStatus {
  return {
    id,
    unlocked: false,
    charges: 0,
    maxCharges: ABILITIES[id].maxCharges,
    wavesUntilCharge: 0,
    pending: false,
  };
}
