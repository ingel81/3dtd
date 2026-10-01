/**
 * Defense Analyzer
 *
 * Analyzes the player's tower defense setup.
 * READ-ONLY - does not modify any game state.
 *
 * Used by StateSnapshotService to generate GameStateSnapshots.
 */

import { Tower } from '../entities/tower.entity';
import { TowerTypeId, TOWER_TYPES, type TowerTypeConfig } from '../configs/tower-types.config';
import { PROJECTILE_TYPES } from '../configs/projectile-types.config';
import { ArmorType, ARMOR_TYPES, DamageType, DAMAGE_TYPES } from '../configs/combat/combat.types';
import {
  GameStateSnapshot,
  DefenseAnalysis,
  DefenseCapabilities,
  EffectiveDPSPerArmor,
  TowerDistribution,
  VulnerabilityAnalysis,
} from './models/game-state-snapshot';
import { computeTowerDPS, canTargetAirEffective, airTargetingFor, type AirTargeting, armorMultipliersFor } from './tower-dps.util';
import { METERS_PER_DEGREE_LAT, DEG_TO_RAD } from '../utils/geo-utils';
import type { HeroDefenseProfile } from '../configs/hero.config';
import { DetMath } from '../utils/det-math';


/**
 * Tower capabilities mapping
 * Maps tower types to their special capabilities
 */
/** Ethereal armor multiplier at which a tower counts as anti-ethereal. */
const ANTI_ETHEREAL_MIN_MULTIPLIER = 1.0;

// Splash steht nicht in dieser Tabelle, isSplashTower() leitet es aus der
// Tower-Config ab.
const TOWER_CAPABILITIES: Record<
  TowerTypeId,
  { antiAir?: boolean; slow?: boolean; dot?: boolean }
> = {
  archer: {},
  cannon: {},
  magic: { dot: true },
  'dual-gatling': {},
  rocket: {},
  ice: { slow: true },
  fire: {},
  tentacle: {}, // Melee tower — no special capabilities yet
  poison: { dot: true }, // Poison Tower applies DOT
  lightning: { antiAir: true },
  chaos: { antiAir: true }, // Generalist: air and ground, 1.0 against every armor
  'research-center': {}, // Passive building — no combat capabilities
  'missile-silo': {}, // Passive building: the nuclear strike is an ability, not tower fire
};

/**
 * Analyze a list of towers and return defense metrics.
 *
 * @param hero the hired hero (HeroManager.getDefenseProfile), null without;
 *   in coop the heroes of all players, each counted.
 *   He counts as a virtual tower at his presence factor in the armor-weighted
 *   DPS, nowhere else: not in totalDPS, the capabilities or the AoE share
 *   (docs/HERO.md).
 */
export function analyzeDefense(
  towers: Tower[],
  airTargetingUnlocked: AirTargeting,
  hero: HeroDefenseProfile | readonly HeroDefenseProfile[] | null = null,
): DefenseAnalysis {
  const heroes = hero === null ? [] : Array.isArray(hero) ? hero : [hero as HeroDefenseProfile];
  if (towers.length === 0 && heroes.length === 0) {
    return createEmptyDefenseAnalysis();
  }

  const towerDistribution = calculateTowerDistribution(towers);
  const capabilities = detectCapabilities(towers, airTargetingUnlocked);
  const totalDPS = calculateTotalDPS(towers);
  const antiAirDPS = calculateAntiAirDPS(towers, airTargetingUnlocked);
  const avgLevel = calculateAvgLevel(towers);
  const towerVariety = calculateTowerVariety(towers);
  const effectiveDPSPerArmor = calculateDPSPerArmor(towers, airTargetingUnlocked);
  const aoeDpsShare = calculateAoeDpsShare(towers, airTargetingUnlocked);
  for (const h of heroes) addHero(h, effectiveDPSPerArmor);

  return {
    towerCount: towers.length,
    totalDPS,
    antiAirDPS,
    avgTowerLevel: avgLevel,
    pathCoverage: 0, // Requires path data - calculated separately
    defenseReachPercent: 0, // Requires path data - calculated separately
    damageMetres: undefined, // Requires path data - calculated separately
    killZoneStrength: 0, // Requires spatial analysis - calculated separately
    towerVariety,
    capabilities,
    towerDistribution,
    effectiveDPSPerArmor,
    aoeDpsShare,
  };
}

/**
 * The hero as a virtual tower, counted at his presence factor: he is one
 * unit and cannot be everywhere on the route (docs/HERO.md).
 *
 * Against each armor his best ammo counts, since the player can switch it at
 * any time: judged by the ammo loaded when the wave is planned, loading a bad
 * one before the start would soften the wave and switching afterwards would
 * beat it. He hits ground and air alike, so both sides get the same numbers.
 */
function addHero(hero: HeroDefenseProfile, effective: EffectiveDPSPerArmor): void {
  for (const armor of ARMOR_TYPES) {
    let best = 0;
    for (const ammo of hero.ammo) {
      best = Math.max(best, ammo.dps * armorMultipliersFor(ammo.damageType)[armor]);
    }
    const dps = best * hero.presence;
    effective.ground[armor] += dps;
    effective.air[armor] += dps;
  }
}

/**
 * Fraction of the defense's DPS that comes from area-of-effect towers.
 *
 * Splash, chain and beam width are baked into `computeTowerDPS` as constant
 * multipliers, so a cannon looks like "more DPS" rather than "DPS that hits
 * many enemies at once". The distinction matters to the wave director more
 * than to anyone else: it chooses enemy density directly through count and
 * spawn delay, and against an AoE-heavy defense a dense swarm is worth far
 * less than the raw DPS number suggests.
 */
function calculateAoeDpsShare(
  towers: Tower[],
  airTargetingUnlocked: AirTargeting,
): { ground: number; air: number } {
  let groundTotal = 0;
  let groundAoe = 0;
  let airTotal = 0;
  let airAoe = 0;

  for (const tower of towers) {
    const typeId = tower.typeConfig.id as TowerTypeId;
    const cfg = TOWER_TYPES[typeId];
    if (!cfg || cfg.attackType === 'passive') continue;

    const dps = computeTowerDPS(tower);
    if (dps <= 0) continue;
    const isAoe = isSplashTower(typeId) || cfg.attackType === 'chain';

    if (cfg.canTargetGround !== false) {
      groundTotal += dps;
      if (isAoe) groundAoe += dps;
    }
    if (canTargetAirEffective(typeId, airTargetingFor(airTargetingUnlocked, tower))) {
      airTotal += dps;
      if (isAoe) airAoe += dps;
    }
  }

  return {
    ground: groundTotal > 0 ? groundAoe / groundTotal : 0,
    air: airTotal > 0 ? airAoe / airTotal : 0,
  };
}

/**
 * Analyze vulnerabilities in the defense
 */
export function analyzeVulnerabilities(
  towers: Tower[],
  capabilities: DefenseCapabilities
): VulnerabilityAnalysis {
  const vulnerabilities: VulnerabilityAnalysis = {
    airDefenseGap: !capabilities.hasAntiAir,
    splashGap: !capabilities.hasSplash,
    slowGap: !capabilities.hasSlow,
    etherealGap: !capabilities.hasAntiEthereal,
    uncoveredPathSegments: [], // Requires path data
    overallVulnerability: 0,
  };

  // Calculate overall vulnerability score. The ethereal gap weighs as heavily
  // as the air gap: both are hard walls rather than soft weaknesses — without
  // the right damage type the wave simply cannot be killed.
  let vulnScore = 0;
  if (vulnerabilities.airDefenseGap) vulnScore += 0.3;
  if (vulnerabilities.etherealGap) vulnScore += 0.3;
  if (vulnerabilities.splashGap) vulnScore += 0.25;
  if (vulnerabilities.slowGap) vulnScore += 0.2;

  // Low tower count = more vulnerable
  if (towers.length < 3) vulnScore += 0.25;
  else if (towers.length < 5) vulnScore += 0.1;

  vulnerabilities.overallVulnerability = Math.min(1, vulnScore);

  return vulnerabilities;
}

/**
 * Calculate tower distribution by type
 */
function calculateTowerDistribution(towers: Tower[]): TowerDistribution {
  const distribution: TowerDistribution = {};

  for (const tower of towers) {
    const typeId = tower.typeConfig.id;

    if (!distribution[typeId]) {
      distribution[typeId] = {
        count: 0,
        avgLevel: 0,
        totalDamage: 0,
        totalDPS: 0,
      };
    }

    const entry = distribution[typeId];
    entry.count++;
    entry.totalDamage += tower.combat.damage;
    entry.totalDPS += computeTowerDPS(tower);
  }

  // Calculate average level per type
  for (const typeId of Object.keys(distribution)) {
    const towersOfType = towers.filter((t) => t.typeConfig.id === typeId);
    const totalLevel = towersOfType.reduce((sum, t) => sum + getTowerLevel(t), 0);
    distribution[typeId].avgLevel = totalLevel / towersOfType.length;
  }

  return distribution;
}

/**
 * Detect defense capabilities from tower types
 */
function detectCapabilities(
  towers: Tower[],
  airTargetingUnlocked: AirTargeting,
): DefenseCapabilities {
  const capabilities: DefenseCapabilities = {
    hasAntiAir: false,
    hasSplash: false,
    hasSlow: false,
    hasDoT: false,
    hasAntiEthereal: false,
  };

  for (const tower of towers) {
    const typeId = tower.typeConfig.id as TowerTypeId;
    const towerCaps = TOWER_CAPABILITIES[typeId];

    if (canTargetAirEffective(typeId, airTargetingFor(airTargetingUnlocked, tower))) {
      capabilities.hasAntiAir = true;
    }
    if (isAntiEtherealTower(typeId)) {
      capabilities.hasAntiEthereal = true;
    }
    if (isSplashTower(typeId)) {
      capabilities.hasSplash = true;
    }

    if (towerCaps) {
      if (towerCaps.slow) capabilities.hasSlow = true;
      if (towerCaps.dot) capabilities.hasDoT = true;
    }
  }

  return capabilities;
}

/**
 * Does this tower type deal area damage? Derived from the tower config, so the
 * model and the game cannot disagree: a projectile with a splash radius
 * (cannon, ice, poison, and since 2026-09-22 the rocket), the fire cone and
 * the lightning chain count.
 *
 * Es war einmal eine von Hand gepflegte Liste. Sie nannte die Rakete einen
 * Splash-Tower, obwohl ihr Geschoss keinen Radius hatte — dreifacher
 * Kill-Durchsatz im Deckel für eine Wirkung, die es nicht gab — und übersah
 * Eis und Gift. Seitdem entscheidet die Config.
 */
export function isSplashTower(typeId: TowerTypeId): boolean {
  const cfg = TOWER_TYPES[typeId];
  if (!cfg) return false;
  const attack = cfg.attackType ?? 'projectile';
  if (attack === 'beam' || attack === 'chain') return true;
  if (attack !== 'projectile') return false;
  return (PROJECTILE_TYPES[cfg.projectileType]?.splashRadius ?? 0) > 0;
}

/**
 * Ethereal armor is the one category that cannot be brute-forced: physical,
 * pierce and fire are all at 0.1, so only magic (2.0), ice (1.5) and
 * lightning (1.5) actually threaten ghosts and wraiths. Read the multiplier
 * from the damage matrix rather than listing tower ids, so a new tower with a
 * suitable damage type counts automatically.
 */
export function isAntiEtherealTower(typeId: TowerTypeId): boolean {
  const cfg = TOWER_TYPES[typeId];
  if (!cfg || cfg.attackType === 'passive') return false;
  return armorMultipliersFor(cfg.damageType).ethereal >= ANTI_ETHEREAL_MIN_MULTIPLIER;
}

/**
 * Calculate total DPS across all towers. The director sizes waves by it;
 * NEXT in the WAVE panel reads the same number.
 */
export function calculateTotalDPS(towers: Tower[]): number {
  return towers.reduce((sum, tower) => sum + computeTowerDPS(tower), 0);
}

/**
 * Calculate DPS from towers that can target air units (including AA-Retrofit).
 */
function calculateAntiAirDPS(towers: Tower[], airTargetingUnlocked: AirTargeting): number {
  return towers.reduce((sum, tower) => {
    const typeId = tower.typeConfig.id as TowerTypeId;
    return canTargetAirEffective(typeId, airTargetingFor(airTargetingUnlocked, tower))
      ? sum + computeTowerDPS(tower)
      : sum;
  }, 0);
}

/**
 * Per-armor-class DPS, split into ground (hits ground enemies) and air (hits
 * air enemies): tower DPS × damage matrix, what actually lands.
 */
function calculateDPSPerArmor(
  towers: Tower[],
  airTargetingUnlocked: AirTargeting,
): EffectiveDPSPerArmor {
  const zero = () => ARMOR_TYPES.reduce((acc, a) => { acc[a] = 0; return acc; }, {} as Record<ArmorType, number>);
  const effective: EffectiveDPSPerArmor = { ground: zero(), air: zero() };
  for (const tower of towers) {
    addTowerDps(effective, tower.typeConfig, computeTowerDPS(tower), airTargetingFor(airTargetingUnlocked, tower));
  }
  return effective;
}

/**
 * One tower's matrix damage into `out`, per armor, ground and air as it can
 * target them. Pure: the live analysis and the balance calculator
 * (tools/balance-calc) share it.
 */
export function addTowerDps(out: EffectiveDPSPerArmor, cfg: TowerTypeConfig, dps: number, airTargeting: boolean): void {
  if (dps <= 0) return;
  const mults = armorMultipliersFor(cfg.damageType);
  const canGround = cfg.canTargetGround ?? true;
  const canAir = canTargetAirEffective(cfg.id as TowerTypeId, airTargeting);
  for (const armor of ARMOR_TYPES) {
    const dpsVsArmor = dps * mults[armor];
    if (canGround) out.ground[armor] += dpsVsArmor;
    if (canAir) out.air[armor] += dpsVsArmor;
  }
}

/**
 * Damage times metres of route under fire, per armor, ground and air: each
 * tower's matrix damage times the metres of route it sees
 * (GlobalRouteGridService.metersUnderFire, byTower). Over an enemy's speed
 * it is the HP the defense takes off that enemy on its way past; with towers
 * that cover different stretches each counts only its own (review 2026-09-28:
 * the union of metres times the total damage overcounted N-fold).
 */
export function damageMetresPerArmor(
  towers: Tower[],
  airTargetingUnlocked: AirTargeting,
  metresByTower: ReadonlyMap<string, { ground: number; air: number }>,
): EffectiveDPSPerArmor {
  const zero = () => ARMOR_TYPES.reduce((acc, a) => { acc[a] = 0; return acc; }, {} as Record<ArmorType, number>);
  const out: EffectiveDPSPerArmor = { ground: zero(), air: zero() };
  for (const tower of towers) {
    const metres = metresByTower.get(tower.id);
    if (!metres) continue;
    const dps = computeTowerDPS(tower);
    if (dps <= 0) continue;
    const mults = armorMultipliersFor(tower.typeConfig.damageType);
    const canGround = tower.typeConfig.canTargetGround ?? true;
    const canAir = canTargetAirEffective(tower.typeConfig.id as TowerTypeId, airTargetingFor(airTargetingUnlocked, tower));
    for (const armor of ARMOR_TYPES) {
      if (canGround) out.ground[armor] += dps * mults[armor] * metres.ground;
      if (canAir) out.air[armor] += dps * mults[armor] * metres.air;
    }
  }
  return out;
}

/**
 * Calculate average tower level (1-based)
 */
function calculateAvgLevel(towers: Tower[]): number {
  if (towers.length === 0) return 0;

  const totalLevel = towers.reduce((sum, tower) => sum + getTowerLevel(tower), 0);
  return totalLevel / towers.length;
}

/**
 * Get effective level of a tower (1 + number of upgrades)
 */
function getTowerLevel(tower: Tower): number {
  // Base level is 1, each upgrade adds 1
  // Access upgrade levels through the tower's upgrade system
  let level = 1;

  // Check each possible upgrade
  const upgradeIds = ['speed', 'damage', 'range'] as const;
  for (const upgradeId of upgradeIds) {
    const upgradeLevel = tower.getUpgradeLevel(upgradeId);
    level += upgradeLevel;
  }

  return level;
}

/**
 * Calculate tower variety score (0-1)
 * Higher = more diverse tower types
 */
function calculateTowerVariety(towers: Tower[]): number {
  if (towers.length === 0) return 0;

  const uniqueTypes = new Set(towers.map((t) => t.typeConfig.id));
  const totalTypes = Object.keys(TOWER_TYPES).length;

  // Variety score: unique types / total possible types
  // But cap at the number of towers (can't have more types than towers)
  const maxPossible = Math.min(towers.length, totalTypes);
  return uniqueTypes.size / maxPossible;
}

/**
 * Create empty defense analysis
 */
function createEmptyDefenseAnalysis(): DefenseAnalysis {
  const zeroArmor = () =>
    ARMOR_TYPES.reduce((acc, a) => {
      acc[a] = 0;
      return acc;
    }, {} as Record<ArmorType, number>);

  return {
    towerCount: 0,
    totalDPS: 0,
    antiAirDPS: 0,
    avgTowerLevel: 0,
    pathCoverage: 0,
    defenseReachPercent: 0,
    damageMetres: undefined,
    killZoneStrength: 0,
    towerVariety: 0,
    capabilities: {
      hasAntiAir: false,
      hasSplash: false,
      hasSlow: false,
      hasDoT: false,
      hasAntiEthereal: false,
    },
    towerDistribution: {},
    effectiveDPSPerArmor: { ground: zeroArmor(), air: zeroArmor() },
    aoeDpsShare: { ground: 0, air: 0 },
  };
}

/**
 * Estimate path coverage (simplified - without actual path data)
 * Returns a value between 0-1 based on tower count and range
 */
export function estimatePathCoverage(towers: Tower[], estimatedPathLength: number): number {
  if (towers.length === 0 || estimatedPathLength <= 0) return 0;

  // Sum of all tower ranges (simplified: assume circular coverage)
  const totalCoverage = towers.reduce((sum, t) => sum + t.combat.range * 2, 0);

  // Ratio of coverage to path length (capped at 1)
  return Math.min(1, totalCoverage / estimatedPathLength);
}

/**
 * Estimate kill zone strength based on tower clustering
 * Returns 0-1 where higher means towers are more concentrated
 */
export function estimateKillZoneStrength(towers: Tower[]): number {
  if (towers.length < 2) return 0;

  // Calculate average distance between towers
  let totalDistance = 0;
  let pairs = 0;

  for (let i = 0; i < towers.length; i++) {
    for (let j = i + 1; j < towers.length; j++) {
      const t1 = towers[i].transform.position;
      const t2 = towers[j].transform.position;

      // Simple Euclidean approximation (good enough for nearby towers)
      const latDiff = (t1.lat - t2.lat) * METERS_PER_DEGREE_LAT;
      const lonDiff = (t1.lon - t2.lon) * METERS_PER_DEGREE_LAT * DetMath.cos(t1.lat * DEG_TO_RAD);
      const distance = Math.sqrt(latDiff * latDiff + lonDiff * lonDiff);

      totalDistance += distance;
      pairs++;
    }
  }

  const avgDistance = totalDistance / pairs;

  // Average tower range
  const avgRange = towers.reduce((sum, t) => sum + t.combat.range, 0) / towers.length;

  // Kill zone strength: how much towers overlap
  // If avg distance < avg range, towers overlap = strong kill zone
  if (avgDistance < avgRange) {
    return Math.min(1, (avgRange - avgDistance) / avgRange);
  }

  return 0;
}

/**
 * DPS the defense deals per damage type, summed over the combat towers.
 *
 * Used to be normalised to 0..1 against a fixed ceiling because the state
 * encoder fed it to a neural net; it now reports raw DPS, which is what the
 * debug window and the run log want (BALANCING_PLAN.md, Phase 1a).
 */
export function computeDpsByDamageType(snapshot: GameStateSnapshot): Record<DamageType, number> {
  const result = {} as Record<DamageType, number>;
  for (const dt of DAMAGE_TYPES) result[dt] = 0;

  for (const [towerId, stats] of Object.entries(snapshot.defense.towerDistribution)) {
    const cfg = TOWER_TYPES[towerId as TowerTypeId];
    if (!cfg || cfg.attackType === 'passive') continue;
    // stats.totalDPS is pre-computed from damage * fireRate; for beams we fall back to damagePerSecond
    result[cfg.damageType] += stats.totalDPS ?? 0;
  }

  return result;
}
