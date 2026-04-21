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
import { ArmorType, ARMOR_TYPES } from '../../configs/combat/combat.types';
import {
  DefenseAnalysis,
  DefenseCapabilities,
  EffectiveDPSPerArmor,
  TowerDistribution,
  VulnerabilityAnalysis,
} from './models/game-state-snapshot';
import { computeTowerDPS, canTargetAirEffective, armorMultipliersFor } from './tower-dps.util';

/**
 * Tower capabilities mapping
 * Maps tower types to their special capabilities
 */
const TOWER_CAPABILITIES: Record<
  TowerTypeId,
  { antiAir?: boolean; splash?: boolean; slow?: boolean; dot?: boolean }
> = {
  archer: {},
  cannon: { splash: true },
  magic: { dot: true },
  'dual-gatling': {},
  rocket: { splash: true },
  ice: { slow: true },
  fire: { splash: true }, // Fire Tower has cone-based splash damage
  tentacle: {}, // Melee tower — no special capabilities yet
  poison: { dot: true }, // Poison Tower applies DOT
  'research-center': {}, // Passive building — no combat capabilities
};

/**
 * Analyze a list of towers and return defense metrics
 */
export function analyzeDefense(towers: Tower[], airTargetingUnlocked: boolean): DefenseAnalysis {
  if (towers.length === 0) {
    return createEmptyDefenseAnalysis();
  }

  const towerDistribution = calculateTowerDistribution(towers);
  const capabilities = detectCapabilities(towers, airTargetingUnlocked);
  const totalDPS = calculateTotalDPS(towers);
  const antiAirDPS = calculateAntiAirDPS(towers, airTargetingUnlocked);
  const avgLevel = calculateAvgLevel(towers);
  const towerVariety = calculateTowerVariety(towers);
  const effectiveDPSPerArmor = calculateEffectiveDPSPerArmor(towers, airTargetingUnlocked);

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
    uncoveredPathSegments: [], // Requires path data
    overallVulnerability: 0,
  };

  // Calculate overall vulnerability score
  let vulnScore = 0;
  if (vulnerabilities.airDefenseGap) vulnScore += 0.3;
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
  };

  for (const tower of towers) {
    const typeId = tower.typeConfig.id as TowerTypeId;
    const towerCaps = TOWER_CAPABILITIES[typeId];

    if (canTargetAirEffective(typeId, airTargetingUnlocked)) {
      capabilities.hasAntiAir = true;
    }

    if (towerCaps) {
      if (towerCaps.splash) capabilities.hasSplash = true;
      if (towerCaps.slow) capabilities.hasSlow = true;
      if (towerCaps.dot) capabilities.hasDoT = true;
    }
  }

  return capabilities;
}

/**
 * Calculate total DPS across all towers
 */
function calculateTotalDPS(towers: Tower[]): number {
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
 * Per-armor-class effective DPS (damage-type × armor matrix applied).
 * Returns a split for ground (hits ground enemies) and air (hits air enemies).
 */
function calculateEffectiveDPSPerArmor(
  towers: Tower[],
  airTargetingUnlocked: boolean,
): EffectiveDPSPerArmor {
  const zero = () =>
    ARMOR_TYPES.reduce((acc, a) => {
      acc[a] = 0;
      return acc;
    }, {} as Record<ArmorType, number>);

  const ground = zero();
  const air = zero();

  for (const tower of towers) {
    const typeId = tower.typeConfig.id as TowerTypeId;
    const dps = computeTowerDPS(tower);
    if (dps <= 0) continue;

    const mults = armorMultipliersFor(tower.typeConfig.damageType);
    const canGround = tower.typeConfig.canTargetGround ?? true;
    const canAir = canTargetAirEffective(typeId, airTargetingUnlocked);

    for (const armor of ARMOR_TYPES) {
      const effective = dps * mults[armor];
      if (canGround) ground[armor] += effective;
      if (canAir) air[armor] += effective;
    }
  }

  return { ground, air };
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
    },
    towerDistribution: {},
    effectiveDPSPerArmor: { ground: zeroArmor(), air: zeroArmor() },
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
      const latDiff = (t1.lat - t2.lat) * 111000; // ~111km per degree
      const lonDiff = (t1.lon - t2.lon) * 111000 * Math.cos((t1.lat * Math.PI) / 180);
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
