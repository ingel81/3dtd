/**
 * What a purchase is worth to the bot (docs/BOT_PLAYER_PLAN.md, B3)
 *
 * One unit for every buy, so the arbiter can weigh a new tower against an
 * upgrade: how much sooner the defense kills the coming waves. The threat is
 * their HP per armor, on the ground and in the air, as the wave panel shows it
 * (WavePeekFacts). The defense's capacity is its damage times the metres of
 * route it has under fire, per armor and side (damageMetresPerArmor, the
 * towers' real lines of sight): over an enemy's speed, the HP it loses on the
 * way past. A purchase adds capacity; what it is worth is the kill time it
 * saves, summed over armor and side:
 *
 *   value = Σ threat × (1 / (capacity + floor) − 1 / (capacity + floor + added))
 *
 * The returns fall with what stands already, so a gap is worth most: with no
 * tower that hits air, the first one is worth more than the tenth gun on the
 * ground. Nothing here knows rules like "build anti-air from wave 4".
 */

import { ARMOR_TYPES, ArmorType } from '../../configs/combat/combat.types';
import { ENEMY_TYPES, EnemyTypeId } from '../../configs/enemy-types.config';
import { TOWER_TYPES, TowerTypeConfig, TowerTypeId } from '../../configs/tower-types.config';
import type { EffectiveDPSPerArmor } from '../../director/models/game-state-snapshot';
import type { WavePeekFacts } from '../../director/wave-source';
import { UpgradeLevels, armorMultipliersFor, computeTowerDPSFromLevels, statMultiplier } from '../../director/tower-dps.util';
import { canTargetAirEffective } from '../../entities/tower-targeting.util';
import { GAME_BALANCE } from '../../configs/game-balance.config';

/** HP of the coming waves, or damage times metres of the defense: per side and armor */
export type ArmorSides = EffectiveDPSPerArmor;

/** The waves after the next count less: the bot may sell, research or build before them */
const WAVE_WEIGHTS = [1, 0.5];

/** Metres from the street a placement stands at (StrategicPlacementService offsets 15 to 25 m) */
const STREET_OFFSET_M = 20;

/** Share of its reach a new tower is expected to see; the placement probes the spot itself (B2) */
const EXPECTED_SIGHT = 0.9;

/** Enemies an ice shard slows per hit: its splash (8 m) catches a few of a crowd */
const SLOWED_PER_HIT = 3;

/** Enemies in a tower's reach at once, for the share of them a slow keeps slowed */
const ENEMIES_IN_REACH = 6;

/** A typical enemy's pace, m/s (the median base speed of the enemy types) */
const TYPICAL_SPEED = 6;

/** HP of a wave the bot cannot read (a beginner does not look at the wave panel) */
const UNREAD_WAVE_HP = 1000;

export function emptySides(): ArmorSides {
  const zero = () => ARMOR_TYPES.reduce((acc, a) => { acc[a] = 0; return acc; }, {} as Record<ArmorType, number>);
  return { ground: zero(), air: zero() };
}

/**
 * The coming waves' HP per armor and side, the next one in full and the one
 * after at half. The air share of an armor comes from the enemy types that
 * wear it in the wave.
 */
export function threatFromWaves(waves: readonly WavePeekFacts[]): ArmorSides {
  const threat = emptySides();
  waves.slice(0, WAVE_WEIGHTS.length).forEach((wave, i) => {
    const weight = WAVE_WEIGHTS[i];
    const share = { air: {} as Partial<Record<ArmorType, number>>, all: {} as Partial<Record<ArmorType, number>> };
    for (const [id, part] of wave.enemies) {
      const type = ENEMY_TYPES[id as EnemyTypeId];
      if (!type) continue;
      share.all[type.armorType] = (share.all[type.armorType] ?? 0) + part;
      if (type.isAirUnit) share.air[type.armorType] = (share.air[type.armorType] ?? 0) + part;
    }
    for (const [armor, hp] of wave.hpByArmor) {
      const all = share.all[armor] ?? 0;
      const air = all > 0 ? (share.air[armor] ?? 0) / all : 0;
      threat.air[armor] += weight * hp * air;
      threat.ground[armor] += weight * hp * (1 - air);
    }
  });
  return threat;
}

/** A wave the bot does not read: the expected armor mix on the ground, at a nominal size */
export function threatFromMix(mix: Partial<Record<ArmorType, number>> | undefined): ArmorSides {
  const threat = emptySides();
  for (const armor of ARMOR_TYPES) threat.ground[armor] = UNREAD_WAVE_HP * (mix ? mix[armor] ?? 0 : 1 / ARMOR_TYPES.length);
  return threat;
}

/** Route metres a tower of `range` covers, standing next to the street: the chord through its reach */
export function chordMetres(range: number): number {
  const offset = Math.min(STREET_OFFSET_M, 0.7 * range);
  return 2 * Math.sqrt(Math.max(0, range * range - offset * offset));
}

/** Range of a tower at these upgrade levels */
export function rangeAt(cfg: TowerTypeConfig, levels: UpgradeLevels): number {
  return cfg.range * statMultiplier(cfg, 'range', levels);
}

/**
 * Metres of route a new tower of `typeId` is expected to have under fire,
 * before its spot is known. Per route like metersUnderFire, which averages
 * over the routes.
 */
export function expectedMetres(typeId: TowerTypeId, routes: number): number {
  return chordMetres(TOWER_TYPES[typeId].range) * EXPECTED_SIGHT / Math.max(1, routes);
}

/**
 * Capacity a new tower of `typeId` is expected to add before its spot is
 * known: its own, and with a slow what it adds to `capacity` (slowAdded).
 */
export function newTowerCapacity(
  typeId: TowerTypeId,
  airUnlocked: boolean,
  routes: number,
  capacity: ArmorSides,
  routeMetres: number,
): ArmorSides {
  const metres = expectedMetres(typeId, routes);
  const cfg = TOWER_TYPES[typeId];
  const at = { ground: metres, air: metres };
  return ownCapacity(cfg, {}, airUnlocked, at, capacity, routeMetres);
}

/**
 * Everything one tower brings at these levels on these metres: its own
 * damage, the damage over time it leaves behind (lingerAdded) and what its
 * slow adds to the others (slowAdded).
 */
export function ownCapacity(
  cfg: TowerTypeConfig,
  levels: UpgradeLevels,
  airUnlocked: boolean,
  metres: { ground: number; air: number },
  capacity: ArmorSides,
  routeMetres: number,
): ArmorSides {
  return sum(
    sum(towerCapacity(cfg, levels, airUnlocked, metres), lingerAdded(cfg, levels, airUnlocked)),
    slowAdded(cfg, levels, metres, capacity, routeMetres),
  );
}

/** Capacity of one tower: its matrix damage times the metres it has under fire, per armor and side */
export function towerCapacity(
  cfg: TowerTypeConfig,
  levels: UpgradeLevels,
  airUnlocked: boolean,
  metres: { ground: number; air: number },
): ArmorSides {
  const out = emptySides();
  const dps = computeTowerDPSFromLevels(cfg, levels);
  if (dps <= 0) return out;
  const mults = armorMultipliersFor(cfg.damageType);
  const ground = cfg.canTargetGround ?? true;
  const air = canTargetAirEffective(cfg.id as TowerTypeId, airUnlocked);
  for (const armor of ARMOR_TYPES) {
    if (ground) out.ground[armor] = dps * mults[armor] * metres.ground;
    if (air) out.air[armor] = dps * mults[armor] * metres.air;
  }
  return out;
}

/**
 * Capacity the slow of an ice tower adds to the others: a slowed enemy stays
 * longer in their fire. On the stretch it covers (its metres over the route's)
 * the towers there fire `slowAmount / (1 - slowAmount)` longer at the share of
 * enemies it keeps slowed (its hits times the enemies a hit catches, over the
 * enemies in reach). The others are taken as spread evenly along the route.
 */
export function slowAdded(
  cfg: TowerTypeConfig,
  levels: UpgradeLevels,
  metres: { ground: number; air: number },
  capacity: ArmorSides,
  routeMetres: number,
): ArmorSides {
  const out = emptySides();
  if (cfg.id !== 'ice' || routeMetres <= 0) return out;
  const { slowAmount, duration } = GAME_BALANCE.effects.ice;
  const rate = cfg.fireRate * statMultiplier(cfg, 'fireRate', levels);
  const held = Math.min(1, (rate * duration / 1000 * SLOWED_PER_HIT) / ENEMIES_IN_REACH);
  const longer = slowAmount / (1 - slowAmount);
  for (const side of ['ground', 'air'] as const) {
    const share = Math.min(1, metres[side] / routeMetres);
    for (const armor of ARMOR_TYPES) out[side][armor] = capacity[side][armor] * share * held * longer;
  }
  return out;
}

/**
 * Capacity of the damage over time a tower leaves behind: poison and the
 * fire's burn keep ticking after the enemy left its reach, over the metres it
 * walks meanwhile (duration times a typical pace). The poison's ticks inside
 * the reach are part of its DPS already (computeTowerDPSFromLevels).
 */
export function lingerAdded(cfg: TowerTypeConfig, levels: UpgradeLevels, airUnlocked: boolean): ArmorSides {
  const effects = GAME_BALANCE.effects;
  let dps = 0;
  let seconds = 0;
  if (cfg.id === 'poison') {
    dps = effects.poison.dotDamagePerSecond;
    seconds = effects.poison.duration / 1000;
  } else if (cfg.id === 'fire') {
    dps = effects.burn.beamDpsShare * computeTowerDPSFromLevels(cfg, levels);
    seconds = effects.burn.duration / 1000;
  }
  const out = emptySides();
  if (dps <= 0) return out;
  const metres = TYPICAL_SPEED * seconds;
  const mults = armorMultipliersFor(cfg.damageType);
  const ground = cfg.canTargetGround ?? true;
  const air = canTargetAirEffective(cfg.id as TowerTypeId, airUnlocked);
  for (const armor of ARMOR_TYPES) {
    if (ground) out.ground[armor] = dps * mults[armor] * metres;
    if (air) out.air[armor] = dps * mults[armor] * metres;
  }
  return out;
}

/** `a` plus `b`, per armor and side */
export function sum(a: ArmorSides, b: ArmorSides): ArmorSides {
  const out = emptySides();
  for (const side of ['ground', 'air'] as const) {
    for (const armor of ARMOR_TYPES) out[side][armor] = a[side][armor] + b[side][armor];
  }
  return out;
}

/**
 * Capacity floor: a quarter of a fresh archer on its chord. Keeps the value of
 * the first answer to an armor finite, and of the same order as a tower.
 */
let floorCache: number | null = null;
function capacityFloor(): number {
  if (floorCache === null) {
    const archer = TOWER_TYPES.archer;
    floorCache = 0.25 * computeTowerDPSFromLevels(archer, {}) * chordMetres(archer.range);
  }
  return floorCache;
}

/** Kill time the coming waves lose when `added` joins `capacity` (see the file comment) */
export function killTimeSaved(threat: ArmorSides, capacity: ArmorSides, added: ArmorSides): number {
  const floor = capacityFloor();
  let saved = 0;
  for (const side of ['ground', 'air'] as const) {
    for (const armor of ARMOR_TYPES) {
      const hp = threat[side][armor];
      const plus = added[side][armor];
      if (hp <= 0 || plus <= 0) continue;
      const before = capacity[side][armor] + floor;
      saved += hp * (1 / before - 1 / (before + plus));
    }
  }
  return saved;
}

/** `b` minus `a`, per armor and side */
export function difference(b: ArmorSides, a: ArmorSides): ArmorSides {
  const out = emptySides();
  for (const side of ['ground', 'air'] as const) {
    for (const armor of ARMOR_TYPES) out[side][armor] = Math.max(0, b[side][armor] - a[side][armor]);
  }
  return out;
}
