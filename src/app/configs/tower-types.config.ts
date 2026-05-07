import { DamageType } from './combat/combat.types';

export type TowerTypeId = 'archer' | 'cannon' | 'magic' | 'dual-gatling' | 'rocket' | 'ice' | 'fire' | 'tentacle' | 'poison' | 'research-center';
export type ProjectileTypeId = 'arrow' | 'cannonball' | 'fireball' | 'ice-shard' | 'bullet' | 'rocket' | 'poison-glob';
export type UpgradeId = 'speed' | 'damage' | 'range' | 'beam-width' | 'research-slots';
export type AttackType = 'projectile' | 'beam' | 'melee' | 'passive';
export type TargetingStrategy = 'closest' | 'lowest-hp' | 'highest-hp' | 'first' | 'air-priority';
export type AirSubStrategy = 'closest' | 'lowest-hp' | 'highest-hp';

export interface TowerUpgrade {
  id: UpgradeId;
  name: string;
  description: string;
  cost: number; // Base cost for level 1
  costScaling?: number; // Cost multiplier per level (default: 1.0 = flat cost)
  maxLevel: number;
  effect: {
    stat: 'fireRate' | 'damage' | 'range' | 'beamWidth' | 'research-slots';
    multiplier: number; // e.g., 2.0 = double
  };
}

/**
 * Calculate the cost of an upgrade at a given level.
 * Formula: baseCost * costScaling^currentLevel
 * Level 0 → baseCost, Level 1 → baseCost * scaling, etc.
 */
export function getUpgradeCost(upgrade: TowerUpgrade, currentLevel: number): number {
  const scaling = upgrade.costScaling ?? 1.0;
  return Math.round(upgrade.cost * Math.pow(scaling, currentLevel));
}

// =====================================================================
// Phase 5.16: Standardized 25-level upgrade tracks for all combat towers.
// Tier-Gating in the UI maps levels to research-tier locks:
//   T1 = L1-5, T2 = L6-10, T3 = L11-15, T4 = L16-20, T5 = L21-25
// Per-level multipliers compound — see UPGRADE_*_MULTIPLIER below.
// Cost scaling 1.40^level keeps late-game tracks deliberately exorbitant
// (L24 ≈ 4000× baseCost). Players will not max everything; that's the point.
// =====================================================================
const UPGRADE_BASE_COST = 50;
const UPGRADE_COST_SCALING = 1.40;
const UPGRADE_MAX_LEVEL = 25;

const UPGRADE_DAMAGE_MULTIPLIER = 1.10; // +10%/level compounding (L25 ≈ 10.8×)
const UPGRADE_SPEED_MULTIPLIER = 1.07;  // +7%/level (L25 ≈ 5.4×)
const UPGRADE_RANGE_MULTIPLIER = 1.04;  // +4%/level (L25 ≈ 2.7×)
const UPGRADE_BEAM_WIDTH_MULTIPLIER = 1.05; // Fire only (L25 ≈ 3.4×)

const STD_DAMAGE_UPGRADE: TowerUpgrade = {
  id: 'damage',
  name: 'Damage',
  description: `Increases damage (+${Math.round((UPGRADE_DAMAGE_MULTIPLIER - 1) * 100)}% per level, compounding).`,
  cost: UPGRADE_BASE_COST,
  costScaling: UPGRADE_COST_SCALING,
  maxLevel: UPGRADE_MAX_LEVEL,
  effect: { stat: 'damage', multiplier: UPGRADE_DAMAGE_MULTIPLIER },
};

const STD_SPEED_UPGRADE: TowerUpgrade = {
  id: 'speed',
  name: 'Fire Rate',
  description: `Increases fire rate (+${Math.round((UPGRADE_SPEED_MULTIPLIER - 1) * 100)}% per level, compounding).`,
  cost: UPGRADE_BASE_COST,
  costScaling: UPGRADE_COST_SCALING,
  maxLevel: UPGRADE_MAX_LEVEL,
  effect: { stat: 'fireRate', multiplier: UPGRADE_SPEED_MULTIPLIER },
};

const STD_RANGE_UPGRADE: TowerUpgrade = {
  id: 'range',
  name: 'Range',
  description: `Increases range (+${Math.round((UPGRADE_RANGE_MULTIPLIER - 1) * 100)}% per level, compounding).`,
  cost: UPGRADE_BASE_COST,
  costScaling: UPGRADE_COST_SCALING,
  maxLevel: UPGRADE_MAX_LEVEL,
  effect: { stat: 'range', multiplier: UPGRADE_RANGE_MULTIPLIER },
};

const STD_BEAM_WIDTH_UPGRADE: TowerUpgrade = {
  id: 'beam-width',
  name: 'Beam Width',
  description: `Increases flame cone width (+${Math.round((UPGRADE_BEAM_WIDTH_MULTIPLIER - 1) * 100)}% per level, compounding).`,
  cost: UPGRADE_BASE_COST,
  costScaling: UPGRADE_COST_SCALING,
  maxLevel: UPGRADE_MAX_LEVEL,
  effect: { stat: 'beamWidth', multiplier: UPGRADE_BEAM_WIDTH_MULTIPLIER },
};

export interface TowerTypeConfig {
  id: TowerTypeId;
  name: string;
  modelUrl: string;
  scale: number;
  previewScale?: number; // Optional separate scale for UI preview (defaults to scale * 0.4)
  heightOffset: number; // Vertical offset to place model above ground
  shootHeight: number; // Height above base where projectiles originate (for LoS calculations)
  rotationY?: number; // Initial Y rotation in radians for visual alignment (default: 0)
  turretBarrelOffset?: number; // Turret barrel orientation in model space (default: 0 = barrels point -Z/North)

  damageType: DamageType; // Damage type for the damage matrix
  damage: number;
  range: number;
  fireRate: number; // Shots per second
  projectileType: ProjectileTypeId;

  cost: number;
  sellValue: number; // Credits returned when selling
  upgrades: TowerUpgrade[]; // Available upgrades for this tower type

  // Targeting capabilities
  canTargetAir?: boolean; // Can target air units (default: false)
  canTargetGround?: boolean; // Can target ground units (default: true)

  // Animation settings
  hasAnimations?: boolean; // Whether this tower has GLTF animations (default: false)
  animationPingPong?: boolean; // Play animation forward then backward (smooth loop, default: false)

  // Beam attack settings (for flamethrower-type towers)
  attackType?: AttackType; // 'projectile' (default) or 'beam' for continuous damage
  damagePerSecond?: number; // DPS for beam towers (used instead of damage + fireRate)
  beamRange?: number; // Length of the beam/cone in meters
  beamWidth?: number; // Width of the cone at the end in meters

  defaultTargeting?: TargetingStrategy; // Default targeting for this tower type (default: 'closest')
  defaultAirSubStrategy?: AirSubStrategy; // Sub-strategy for air-priority pool selection (default: 'closest')

  /** Fire point offsets in turret-local space (x=lateral meters, z=forward meters). Alternates per shot. */
  firePoints?: { x: number; z: number }[];

  // Melee attack settings (for tentacle-type towers)
  meleeStrikeDuration?: number; // Strike animation duration in ms (default: 250)
}

// Tower model URLs
const ARCHER_MODEL_URL = '/assets/models/towers/archer.glb';
const TURRET_MODEL_URL = '/assets/models/towers/gatling.glb';
const ROCKET_MODEL_URL = '/assets/models/towers/rocket.glb';
const CANNON_MODEL_URL = '/assets/models/towers/cannon.glb';
const ICE_MODEL_URL = '/assets/models/towers/ice.glb';
const MAGIC_MODEL_URL = '/assets/models/towers/magic.glb';
const FIRE_MODEL_URL = '/assets/models/towers/fire.glb';
const POISON_MODEL_URL = '/assets/models/towers/poison_tower.glb';

export const TOWER_TYPES: Record<TowerTypeId, TowerTypeConfig> = {
  archer: {
    id: 'archer',
    name: 'Archer Tower',
    defaultTargeting: 'first',
    modelUrl: ARCHER_MODEL_URL,
    scale: 10.1,
    previewScale: 12,
    heightOffset: 4.5,
    shootHeight: 1.05,
    rotationY: 0,
    damageType: 'physical',
    damage: 25,
    range: 60,
    fireRate: 1, // 1 shot/sec
    canTargetAir: true,
    projectileType: 'arrow',
    cost: 45, // Rebalanced: was 20 (Cost/DPS 0.80 -> 1.80)
    sellValue: 27, // 60% of cost
    hasAnimations: true, // archer_tower.glb has base animation
    animationPingPong: true, // Smooth loop: forward then backward
    upgrades: [STD_DAMAGE_UPGRADE, STD_SPEED_UPGRADE, STD_RANGE_UPGRADE],
  },
  'dual-gatling': {
    id: 'dual-gatling',
    name: 'Dual-Gatling Tower',
    modelUrl: TURRET_MODEL_URL,
    scale: 2.5,
    previewScale: 5.5,
    heightOffset: 2.4,
    shootHeight: 2.1,
    rotationY: -1.5708, // -90° visual alignment (barrels face North in idle)
    turretBarrelOffset: -1.5708, // Barrels point +X in model space (-90° from -Z)
    firePoints: [
      { x: -0.9, z: 0 }, // Left barrel cluster
      { x: 0.9, z: 0 },  // Right barrel cluster
    ],
    damageType: 'pierce',
    damage: 10,
    range: 50,
    fireRate: 5.0, // 5 shots/sec - rapid fire
    projectileType: 'bullet',
    cost: 90,
    sellValue: 60,
    upgrades: [STD_DAMAGE_UPGRADE, STD_SPEED_UPGRADE, STD_RANGE_UPGRADE],
  },
  cannon: {
    id: 'cannon',
    name: 'Cannon Tower',
    defaultTargeting: 'highest-hp',
    modelUrl: CANNON_MODEL_URL,
    scale: 3,
    previewScale: 5.5,
    heightOffset: 2.3,
    shootHeight: 1.95,
    rotationY: 3.1416, // 180°
    damageType: 'siege',
    damage: 55,
    range: 80,
    fireRate: 0.5, // 0.5 shots/sec (slower)
    projectileType: 'cannonball',
    cost: 150, // Phase 5.16: heavy specialist (cannon vs fortified) — small premium
    sellValue: 90, // 60% of cost
    upgrades: [STD_DAMAGE_UPGRADE, STD_SPEED_UPGRADE, STD_RANGE_UPGRADE],
  },
  magic: {
    id: 'magic',
    name: 'Magic Tower',
    modelUrl: MAGIC_MODEL_URL,
    scale: 11,
    previewScale: 14,
    heightOffset: 0,
    shootHeight: 8.85,
    rotationY: 3.1416, // 180°
    damageType: 'magic',
    damage: 40,
    range: 70,
    fireRate: 1.5, // 1.5 shots/sec
    projectileType: 'fireball',
    cost: 140, // Phase 5.16: ethereal specialist — strong vs ghost/wraith, small premium
    sellValue: 84, // 60% of cost
    upgrades: [STD_DAMAGE_UPGRADE, STD_SPEED_UPGRADE, STD_RANGE_UPGRADE],
  },
  rocket: {
    id: 'rocket',
    name: 'Rocket Tower',
    defaultTargeting: 'highest-hp',
    modelUrl: ROCKET_MODEL_URL,
    scale: 3.4,
    previewScale: 5.5,
    heightOffset: 2.6,
    shootHeight: 1.7,
    rotationY: 3.1416, // 180°
    damageType: 'siege',
    damage: 40,
    range: 100,
    fireRate: 0.5,
    projectileType: 'rocket',
    cost: 120, // Phase 5.16: air specialist — large range premium
    sellValue: 72, // 60% of cost
    canTargetAir: true, // Can only target air units
    canTargetGround: false, // Cannot target ground units
    upgrades: [STD_DAMAGE_UPGRADE, STD_SPEED_UPGRADE, STD_RANGE_UPGRADE],
  },
  ice: {
    id: 'ice',
    name: 'Ice Tower',
    defaultTargeting: 'first',
    modelUrl: ICE_MODEL_URL,
    scale: 11.4,
    previewScale: 32,
    heightOffset: 0.1,
    shootHeight: 3.4,
    rotationY: 3.1416, // 180°
    turretBarrelOffset: 1.047, // Barrels point ~60° from -Z in model space
    damageType: 'ice',
    damage: 5, // Phase 5.16: small damage so Ice isn't pure utility
    range: 60,
    fireRate: 0.33, // 1 shot every 3s (matches slow duration, no stacking)
    projectileType: 'ice-shard',
    cost: 90, // Rebalanced: was 120 (utility cheaper)
    sellValue: 54, // 60% of cost
    canTargetAir: true,
    canTargetGround: true,
    upgrades: [STD_DAMAGE_UPGRADE, STD_SPEED_UPGRADE, STD_RANGE_UPGRADE],
  },
  fire: {
    id: 'fire',
    name: 'Fire Tower',
    modelUrl: FIRE_MODEL_URL,
    scale: 8,
    previewScale: 9.8,
    heightOffset: 3.8,
    shootHeight: 1.25,
    rotationY: 3.0892, // ~177°
    turretBarrelOffset: 0.436, // ~25° correction for barrel orientation in model space

    // Beam attack - continuous flame damage
    attackType: 'beam',
    damageType: 'fire',
    damage: 0, // Not used for beam towers
    damagePerSecond: 35, // 35 DPS to all enemies in cone
    range: 25, // Detection range (short - flamethrower)
    beamRange: 20, // Flame stream length
    beamWidth: 5, // Stream width
    fireRate: 0, // Not used for beam towers
    projectileType: 'fireball', // Fallback visual type

    cost: 110,
    sellValue: 66, // 60% of cost
    canTargetAir: false, // Ground only - flames don't reach flyers
    canTargetGround: true,
    // Fire uses damage + range (detection) + beam-width — no fireRate (beam-based).
    upgrades: [STD_DAMAGE_UPGRADE, STD_RANGE_UPGRADE, STD_BEAM_WIDTH_UPGRADE],
  },
  tentacle: {
    id: 'tentacle',
    name: 'Tentacle Tower',
    defaultTargeting: 'closest',
    modelUrl: '/assets/models/towers/tentacle.glb',
    scale: 9.8,
    previewScale: 12,
    heightOffset: 2,
    shootHeight: -2,
    rotationY: 0,

    // Melee attack — direct hit, no projectile
    attackType: 'melee',
    damageType: 'physical',
    damage: 30,
    range: 25, // Short range like Fire Tower
    fireRate: 1.5, // 1.5 hits/sec
    projectileType: 'arrow', // Fallback, not used
    meleeStrikeDuration: 250, // 250ms strike animation

    cost: 80,
    sellValue: 48, // 60% of cost
    upgrades: [STD_DAMAGE_UPGRADE, STD_SPEED_UPGRADE, STD_RANGE_UPGRADE],
  },
  poison: {
    id: 'poison',
    name: 'Poison Tower',
    defaultTargeting: 'first',
    modelUrl: POISON_MODEL_URL,
    scale: 7.6,
    previewScale: 12,
    heightOffset: 2.8,
    shootHeight: 1.4,
    rotationY: 3.1416, // 180°
    damageType: 'poison',
    damage: 5,
    range: 55,
    fireRate: 1, // 1 shot/sec
    projectileType: 'poison-glob',
    cost: 100,
    sellValue: 60, // 60% of cost
    canTargetAir: false,
    upgrades: [STD_DAMAGE_UPGRADE, STD_SPEED_UPGRADE, STD_RANGE_UPGRADE],
  },
  'research-center': {
    id: 'research-center',
    name: 'Research Center',
    modelUrl: '/assets/models/buildings/research_building.glb',
    scale: 17.9,
    previewScale: 10,
    heightOffset: 5.1,
    shootHeight: 4.65,
    rotationY: -3.1416,

    attackType: 'passive',
    damageType: 'physical', // Unused — passive building
    damage: 0,
    range: 0,
    fireRate: 0,
    projectileType: 'arrow', // Fallback, unused

    cost: 75,
    sellValue: 45, // 60% of cost — research progress is preserved on re-place
    upgrades: [
      {
        id: 'research-slots' as UpgradeId,
        name: 'Research Wing',
        description: 'Adds an additional research slot',
        cost: 120,
        costScaling: 1.8,
        maxLevel: 2, // Level 1→2 slots, Level 2→3 slots
        effect: {
          stat: 'research-slots',
          multiplier: 1,
        },
      },
    ],
  },
};

export interface TargetingStrategyConfig {
  id: TargetingStrategy;
  label: string;
  icon: string;
  tooltip: string;
}

export interface AirSubStrategyConfig {
  id: AirSubStrategy;
  label: string;
  icon: string;
  tooltip: string;
}

export const TARGETING_STRATEGIES: TargetingStrategyConfig[] = [
  { id: 'closest', label: 'Closest', icon: 'near_me', tooltip: 'Attacks the nearest enemy' },
  { id: 'lowest-hp', label: 'Weakest', icon: 'heart_broken', tooltip: 'Attacks the weakest enemy' },
  { id: 'highest-hp', label: 'Strongest', icon: 'shield', tooltip: 'Attacks the strongest enemy' },
  { id: 'first', label: 'First', icon: 'flag', tooltip: 'Attacks the enemy closest to the base' },
  { id: 'air-priority', label: 'Air', icon: 'flight', tooltip: 'Prioritizes flying enemies' },
];

export const AIR_SUB_STRATEGIES: AirSubStrategyConfig[] = [
  { id: 'closest', label: 'Closest', icon: 'near_me', tooltip: 'Targets the nearest air enemy' },
  { id: 'lowest-hp', label: 'Weakest', icon: 'heart_broken', tooltip: 'Targets the weakest air enemy' },
  { id: 'highest-hp', label: 'Strongest', icon: 'shield', tooltip: 'Targets the strongest air enemy' },
];

export function getTowerType(id: TowerTypeId): TowerTypeConfig {
  return TOWER_TYPES[id];
}

export function getAllTowerTypes(): TowerTypeConfig[] {
  return Object.values(TOWER_TYPES);
}
