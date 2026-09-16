/**
 * Player abilities: actions the player takes during a wave, as opposed to
 * towers, which act on their own. Design and decisions in
 * docs/game-design/PLAYER_AGENCY_CONCEPT.md (section 7).
 *
 * A research unlocks an ability by granting the global perk `perkId`. The
 * ability holds up to `maxCharges` charges and gets one back per
 * `rechargeWaves` completed waves. Charges come back per wave, not in game
 * time: between waves the clock keeps running (research ticks) and the player
 * starts the next wave, so a cooldown in game time could be filled by waiting.
 */

import type { ResearchId } from './research/research.types';
import type { EnemyTypeConfig } from './enemy-types.config';
import type { ArmorType, DamageType } from './combat/combat.types';
import { DAMAGE_MATRIX } from './combat/damage-matrix.config';
import type { TdIconName } from '../components/icon/icon.component';

export type AbilityId = 'nuclear-strike' | 'frost-bomb' | 'emp' | 'orbital-laser';

/**
 * What an ability does where it lands. AbilityManager.resolve() has one
 * branch per kind.
 *
 * max-hp-fraction: every enemy in the radius loses `fraction` of its max
 * HP, bosses (`isBoss`) `bossFraction`, independent of the damage matrix.
 *
 * freeze: every enemy in the radius freezes solid (freeze status, it
 * halts) for `durationMs` of game time, bosses for `bossDurationMs`.
 *
 * stun: every enemy in the radius is stunned (stun status, it halts):
 * machines (`mechanical`) for `mechanicalDurationMs`, bosses for
 * `bossDurationMs`, everything else for `durationMs`.
 *
 * beam: a beam `radiusM` wide comes down on the route and runs along it
 * toward the spawn at `speedMps` for `durationMs`, less where the route
 * begins sooner. Every sub-step each enemy under it loses
 * `fractionPerSecond` of its max HP per second (bosses
 * `bossFractionPerSecond`), times the damage matrix of `damageType`
 * against its armor, at most `maxFraction` (bosses `bossMaxFraction`) over
 * the whole beam.
 */
export type AbilityEffect =
  | { kind: 'max-hp-fraction'; fraction: number; bossFraction: number }
  | { kind: 'freeze'; durationMs: number; bossDurationMs: number }
  | { kind: 'stun'; durationMs: number; mechanicalDurationMs: number; bossDurationMs: number }
  | {
      kind: 'beam';
      damageType: DamageType;
      speedMps: number;
      durationMs: number;
      fractionPerSecond: number;
      bossFractionPerSecond: number;
      maxFraction: number;
      bossMaxFraction: number;
    };

/** Status an ability halts its targets with (AbilityWorld.halt). */
export type AbilityHaltStatus = 'freeze' | 'stun';

/** Status source id of an ability's effects, the same for each of its strikes. */
export function abilitySourceId(id: AbilityId): string {
  return `ability:${id}`;
}

export interface AbilityConfig {
  id: AbilityId;
  /** UI label; the game UI is English */
  name: string;
  /** Tooltip text */
  description: string;
  /** Icon of its button in the ability bar */
  icon: TdIconName;
  /** What a click does in the targeting mode, for the context hint box: "Click Strike" */
  aimHint: string;
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
  /** What it does where it lands */
  effect: AbilityEffect;
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
    aimHint: 'Strike',
    hotkey: 'K',
    researchId: 'nuclear-strike',
    perkId: 'nuclear-strike',
    maxCharges: 1,
    rechargeWaves: 3,
    radiusM: 25,
    warningMs: 1500,
    effect: { kind: 'max-hp-fraction', fraction: 0.6, bossFraction: 0.2 },
    snapRadiusM: 30,
  },
  'frost-bomb': {
    id: 'frost-bomb',
    name: 'Frost Bomb',
    description:
      'Throw a frost bomb onto the route: 0.5 s later everything within 20 m freezes solid for 3 s, bosses 1 s. '
      + 'One charge, a new one every 3 waves.',
    icon: 'snowflake',
    aimHint: 'Freeze',
    hotkey: 'F',
    researchId: 'frost-bomb',
    perkId: 'frost-bomb',
    maxCharges: 1,
    rechargeWaves: 3,
    radiusM: 20,
    warningMs: 500,
    effect: { kind: 'freeze', durationMs: 3000, bossDurationMs: 1000 },
    snapRadiusM: 30,
  },
  emp: {
    id: 'emp',
    name: 'EMP',
    description:
      'Set off an EMP on the route: 0.5 s later machines within 30 m (tanks, mechs) stop for 6 s, '
      + 'everything else for 1.5 s, bosses 0.75 s. One charge, a new one every 3 waves.',
    icon: 'bolt',
    aimHint: 'Pulse',
    hotkey: 'E',
    researchId: 'emp',
    perkId: 'emp',
    maxCharges: 1,
    rechargeWaves: 3,
    radiusM: 30,
    warningMs: 500,
    effect: { kind: 'stun', durationMs: 1500, mechanicalDurationMs: 6000, bossDurationMs: 750 },
    snapRadiusM: 30,
  },
  'orbital-laser': {
    id: 'orbital-laser',
    name: 'Orbital Laser',
    description:
      'Call a laser down from orbit: 1 s later its beam burns for 4 s along the route toward the spawn, 72 m at most. '
      + 'Fire damage scaled by armor, up to 60% of an enemy\'s max HP, bosses 20%. One charge, a new one every 3 waves.',
    icon: 'laser',
    aimHint: 'Fire',
    hotkey: 'L',
    researchId: 'orbital-laser',
    perkId: 'orbital-laser',
    maxCharges: 1,
    rechargeWaves: 3,
    radiusM: 5,
    warningMs: 1000,
    effect: {
      kind: 'beam',
      damageType: 'fire',
      speedMps: 18,
      durationMs: 4000,
      fractionPerSecond: 1.0,
      bossFractionPerSecond: 0.3,
      maxFraction: 0.6,
      bossMaxFraction: 0.2,
    },
    snapRadiusM: 30,
  },
};

export const ABILITY_IDS = Object.keys(ABILITIES) as AbilityId[];

/** Share of its max HP an enemy of `enemyType` loses to a max-hp-fraction effect. */
export function abilityDamageFraction(
  effect: Extract<AbilityEffect, { kind: 'max-hp-fraction' }>,
  enemyType: Pick<EnemyTypeConfig, 'isBoss'>,
): number {
  return enemyType.isBoss ? effect.bossFraction : effect.fraction;
}

/** Game ms an enemy of `enemyType` stays frozen by a freeze effect. */
export function abilityFreezeMs(
  effect: Extract<AbilityEffect, { kind: 'freeze' }>,
  enemyType: Pick<EnemyTypeConfig, 'isBoss'>,
): number {
  return enemyType.isBoss ? effect.bossDurationMs : effect.durationMs;
}

/** Game ms an enemy of `enemyType` stays stunned by a stun effect: bosses first, then machines. */
export function abilityStunMs(
  effect: Extract<AbilityEffect, { kind: 'stun' }>,
  enemyType: Pick<EnemyTypeConfig, 'isBoss' | 'mechanical'>,
): number {
  if (enemyType.isBoss) return effect.bossDurationMs;
  return enemyType.mechanical ? effect.mechanicalDurationMs : effect.durationMs;
}

type BeamEffect = Extract<AbilityEffect, { kind: 'beam' }>;

/** Metres of route a beam covers when nothing cuts it short. */
export function abilityBeamReachM(effect: BeamEffect): number {
  return (effect.speedMps * effect.durationMs) / 1000;
}

/**
 * Game ms a beam burns along a route stretch `sweepLengthM` long: its
 * duration, less where the stretch ends sooner. A beam without speed stands
 * for its time.
 */
export function abilityBeamBurnMs(effect: BeamEffect, sweepLengthM: number): number {
  return effect.speedMps > 0
    ? Math.min(effect.durationMs, (sweepLengthM / effect.speedMps) * 1000)
    : effect.durationMs;
}

/**
 * Share of its max HP an enemy of `enemyType` wearing `armor` loses to a
 * beam in `stepMs` of game time, before the cap (abilityBeamCap).
 */
export function abilityBeamFraction(
  effect: BeamEffect,
  enemyType: Pick<EnemyTypeConfig, 'isBoss'>,
  armor: ArmorType,
  stepMs: number,
): number {
  const perSecond = enemyType.isBoss ? effect.bossFractionPerSecond : effect.fractionPerSecond;
  return (perSecond * DAMAGE_MATRIX[effect.damageType][armor] * stepMs) / 1000;
}

/** Most of its max HP an enemy of `enemyType` loses to one beam. */
export function abilityBeamCap(effect: BeamEffect, enemyType: Pick<EnemyTypeConfig, 'isBoss'>): number {
  return enemyType.isBoss ? effect.bossMaxFraction : effect.maxFraction;
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
