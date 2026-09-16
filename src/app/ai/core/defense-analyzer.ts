/**
 * Defense Analyzer
 *
 * Analyzes the player's tower defense setup.
 * READ-ONLY - does not modify any game state.
 *
 * Used by AIDataCollector to generate GameStateSnapshots.
 */

import { Tower } from '../../entities/tower.entity';
import { TowerTypeId, TOWER_TYPES } from '../../configs/tower-types.config';
import { PROJECTILE_TYPES } from '../../configs/projectile-types.config';
import { ArmorType, ARMOR_TYPES } from '../../configs/combat/combat.types';
import {
  DefenseAnalysis,
  DefenseCapabilities,
  EffectiveDPSPerArmor,
  TowerDistribution,
  VulnerabilityAnalysis,
} from './models/game-state-snapshot';
import { computeTowerDPS, canTargetAirEffective, armorMultipliersFor } from './tower-dps.util';
import { FAIRNESS_MATCHUP_FLOOR } from './templates';
import { METERS_PER_DEGREE_LAT, DEG_TO_RAD } from '../../utils/geo-utils';
import type { HeroDefenseProfile } from '../../configs/hero.config';

/**
 * Tower capabilities mapping
 * Maps tower types to their special capabilities
 */
/**
 * Enemies an area-of-effect shot is assumed to catch. A rough stand-in for
 * blast radius against unknown enemy spacing — deliberately conservative,
 * since overestimating it reopens the swarm hole this models.
 */
const SPLASH_TARGETS_PER_SHOT = 3;

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
};

/**
 * Analyze a list of towers and return defense metrics.
 *
 * @param hero the hired hero (HeroManager.getDefenseProfile), null without.
 *   He counts as a virtual tower at his presence factor in the armor-weighted
 *   DPS (effective and gate) and in the kill throughput, nowhere else: not in
 *   totalDPS, the capabilities or the AoE share (docs/HERO.md).
 */
export function analyzeDefense(
  towers: Tower[],
  airTargetingUnlocked: boolean,
  hero: HeroDefenseProfile | null = null,
): DefenseAnalysis {
  if (towers.length === 0 && !hero) {
    return createEmptyDefenseAnalysis();
  }

  const towerDistribution = calculateTowerDistribution(towers);
  const capabilities = detectCapabilities(towers, airTargetingUnlocked);
  const totalDPS = calculateTotalDPS(towers);
  const antiAirDPS = calculateAntiAirDPS(towers, airTargetingUnlocked);
  const avgLevel = calculateAvgLevel(towers);
  const towerVariety = calculateTowerVariety(towers);
  const { effective: effectiveDPSPerArmor, gate: gateDpsPerArmor } =
    calculateDPSPerArmor(towers, airTargetingUnlocked);
  const aoeDpsShare = calculateAoeDpsShare(towers, airTargetingUnlocked);
  const killThroughput = calculateKillThroughput(towers, airTargetingUnlocked);
  if (hero) addHero(hero, effectiveDPSPerArmor, gateDpsPerArmor, killThroughput);

  return {
    towerCount: towers.length,
    totalDPS,
    antiAirDPS,
    avgTowerLevel: avgLevel,
    pathCoverage: 0, // Requires path data - calculated separately
    defenseReachPercent: 0, // Requires path data - calculated separately
    killZoneStrength: 0, // Requires spatial analysis - calculated separately
    towerVariety,
    capabilities,
    towerDistribution,
    effectiveDPSPerArmor,
    gateDpsPerArmor,
    aoeDpsShare,
    killThroughput,
  };
}

/**
 * The hero as a virtual tower, counted at his presence factor: he is one
 * unit and cannot be everywhere on the route (docs/HERO.md, fairness gate).
 *
 * Against each armor the gate credits his best ammo, since the player can
 * switch it at any time: judged by the ammo loaded when the wave is planned,
 * loading a bad one before the start would shrink the wave and switching
 * afterwards would beat it. He hits ground and air alike, so both sides get
 * the same numbers. The gate view floors bad ground matchups like a tower's.
 * Kill throughput: his fastest ammo's shots per second.
 */
function addHero(
  hero: HeroDefenseProfile,
  effective: EffectiveDPSPerArmor,
  gate: EffectiveDPSPerArmor,
  killThroughput: { ground: number; air: number },
): void {
  for (const armor of ARMOR_TYPES) {
    let best = 0;
    let bestFloored = 0;
    for (const ammo of hero.ammo) {
      const mult = armorMultipliersFor(ammo.damageType)[armor];
      best = Math.max(best, ammo.dps * mult);
      bestFloored = Math.max(bestFloored, ammo.dps * Math.max(mult, FAIRNESS_MATCHUP_FLOOR));
    }
    const dps = best * hero.presence;
    effective.ground[armor] += dps;
    effective.air[armor] += dps;
    gate.ground[armor] += armor === 'ethereal' ? dps : bestFloored * hero.presence;
    gate.air[armor] += dps;
  }
  const shots = hero.ammo.reduce((max, ammo) => Math.max(max, ammo.shotsPerSecond), 0) * hero.presence;
  killThroughput.ground += shots;
  killThroughput.air += shots;
}

/**
 * Targets a defense can destroy per second, ignoring their health.
 *
 * This is the ceiling raw DPS cannot express. A tower shoots one target at a
 * time, so against enemies that die to a single shot the kill rate is set by
 * fire rate, not damage — an archer doing 25 damage per shot at 1 shot/s kills
 * one 3 HP rat per second and wastes 22 damage doing it. That is precisely how
 * a wave of 848 rats walked through a defense whose DPS said it could handle
 * twice their total health.
 *
 * Splash and chain towers hit more than one target per activation, so they
 * count for a multiple. Beam towers have no discrete shots; they are damage-
 * limited rather than rate-limited, so they are excluded here and the DPS side
 * of the comparison covers them.
 */
function calculateKillThroughput(
  towers: Tower[],
  airTargetingUnlocked: boolean,
): { ground: number; air: number } {
  let ground = 0;
  let air = 0;

  for (const tower of towers) {
    const typeId = tower.typeConfig.id as TowerTypeId;
    const cfg = TOWER_TYPES[typeId];
    if (!cfg || cfg.attackType === 'passive' || cfg.attackType === 'beam') continue;

    const shotsPerSecond = tower.combat?.fireRate ?? cfg.fireRate ?? 0;
    if (shotsPerSecond <= 0) continue;

    // Targets hit per activation. Chain towers reach maxJumps extra enemies;
    // splash is approximated by the same soft multiplier used for DPS.
    let targetsPerShot = 1;
    if (cfg.attackType === 'chain') {
      targetsPerShot = 1 + (cfg.maxJumps ?? 0);
    } else if (isSplashTower(typeId)) {
      targetsPerShot = SPLASH_TARGETS_PER_SHOT;
    }

    const rate = shotsPerSecond * targetsPerShot;
    if (cfg.canTargetGround !== false) ground += rate;
    if (canTargetAirEffective(typeId, airTargetingUnlocked)) air += rate;
  }

  return { ground, air };
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
  airTargetingUnlocked: boolean,
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
    if (canTargetAirEffective(typeId, airTargetingUnlocked)) {
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
  airTargetingUnlocked: boolean,
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

    if (canTargetAirEffective(typeId, airTargetingUnlocked)) {
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
 * (cannon, ice, poison), the fire cone and the lightning chain count. A
 * hand-kept list used to call the rocket a splash tower (it has none, x3 kill
 * throughput in the gate) and missed ice and poison.
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
function calculateAntiAirDPS(towers: Tower[], airTargetingUnlocked: boolean): number {
  return towers.reduce((sum, tower) => {
    const typeId = tower.typeConfig.id as TowerTypeId;
    return canTargetAirEffective(typeId, airTargetingUnlocked)
      ? sum + computeTowerDPS(tower)
      : sum;
  }, 0);
}

/**
 * Per-armor-class DPS, split into ground (hits ground enemies) and air (hits
 * air enemies), in two views:
 *  - effective: tower DPS × damage matrix, what actually lands.
 *  - gate: the same, except that against ground unarmored, light, heavy and
 *    fortified every tower counts at least FAIRNESS_MATCHUP_FLOOR. The fairness
 *    gate reads this one (see the constant in templates.ts). Ethereal and air
 *    stay on the plain matrix, they are hard gates of their own.
 */
function calculateDPSPerArmor(
  towers: Tower[],
  airTargetingUnlocked: boolean,
): { effective: EffectiveDPSPerArmor; gate: EffectiveDPSPerArmor } {
  const zero = () =>
    ARMOR_TYPES.reduce((acc, a) => {
      acc[a] = 0;
      return acc;
    }, {} as Record<ArmorType, number>);

  const effective: EffectiveDPSPerArmor = { ground: zero(), air: zero() };
  const gate: EffectiveDPSPerArmor = { ground: zero(), air: zero() };

  for (const tower of towers) {
    const typeId = tower.typeConfig.id as TowerTypeId;
    const dps = computeTowerDPS(tower);
    if (dps <= 0) continue;

    const mults = armorMultipliersFor(tower.typeConfig.damageType);
    const canGround = tower.typeConfig.canTargetGround ?? true;
    const canAir = canTargetAirEffective(typeId, airTargetingUnlocked);

    for (const armor of ARMOR_TYPES) {
      const dpsVsArmor = dps * mults[armor];
      if (canGround) {
        effective.ground[armor] += dpsVsArmor;
        gate.ground[armor] += armor === 'ethereal'
          ? dpsVsArmor
          : dps * Math.max(mults[armor], FAIRNESS_MATCHUP_FLOOR);
      }
      if (canAir) {
        effective.air[armor] += dpsVsArmor;
        gate.air[armor] += dpsVsArmor;
      }
    }
  }

  return { effective, gate };
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
    gateDpsPerArmor: { ground: zeroArmor(), air: zeroArmor() },
    aoeDpsShare: { ground: 0, air: 0 },
    killThroughput: { ground: 0, air: 0 },
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
      const lonDiff = (t1.lon - t2.lon) * METERS_PER_DEGREE_LAT * Math.cos(t1.lat * DEG_TO_RAD);
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
