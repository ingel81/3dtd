export type TowerTypeId = 'archer' | 'cannon' | 'magic' | 'dual-gatling' | 'rocket' | 'ice' | 'fire';
export type ProjectileTypeId = 'arrow' | 'cannonball' | 'fireball' | 'ice-shard' | 'bullet' | 'rocket';
export type UpgradeId = 'speed' | 'damage' | 'range';
export type AttackType = 'projectile' | 'beam';
export type TargetingStrategy = 'closest' | 'lowest-hp' | 'highest-hp' | 'first' | 'air-priority';

export interface TowerUpgrade {
  id: UpgradeId;
  name: string;
  description: string;
  cost: number; // Base cost for level 1
  costScaling?: number; // Cost multiplier per level (default: 1.0 = flat cost)
  maxLevel: number;
  effect: {
    stat: 'fireRate' | 'damage' | 'range';
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
}

// Tower model URLs
const ARCHER_MODEL_URL = '/assets/models/towers/archer.glb';
const TURRET_MODEL_URL = '/assets/models/towers/gatling.glb';
const ROCKET_MODEL_URL = '/assets/models/towers/rocket.glb';
const CANNON_MODEL_URL = '/assets/models/towers/cannon.glb';
const ICE_MODEL_URL = '/assets/models/towers/ice.glb';
const MAGIC_MODEL_URL = '/assets/models/towers/magic.glb';
const FIRE_MODEL_URL = '/assets/models/towers/fire.glb';

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
    damage: 25,
    range: 60,
    fireRate: 1, // 1 shot/sec
    projectileType: 'arrow',
    cost: 45, // Rebalanced: was 20 (Cost/DPS 0.80 -> 1.80)
    sellValue: 27, // 60% of cost
    hasAnimations: true, // archer_tower.glb has base animation
    animationPingPong: true, // Smooth loop: forward then backward
    upgrades: [
      {
        id: 'speed',
        name: 'Rapid Fire',
        description: 'Doubles the fire rate',
        cost: 40,
        maxLevel: 1,
        effect: {
          stat: 'fireRate',
          multiplier: 2.0,
        },
      },
    ],
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
    damage: 10,
    range: 50,
    fireRate: 5.0, // 5 shots/sec - rapid fire
    projectileType: 'bullet',
    cost: 90,
    sellValue: 60,
    upgrades: [
      {
        id: 'speed',
        name: 'Rapid Fire',
        description: 'Doubles the fire rate',
        cost: 90,
        costScaling: 2.0,
        maxLevel: 4,
        effect: {
          stat: 'fireRate',
          multiplier: 2.0,
        },
      },
    ],
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
    damage: 75,
    range: 80,
    fireRate: 0.5, // 0.5 shots/sec (slower)
    projectileType: 'cannonball',
    cost: 140, // Rebalanced: was 175 (Cost/DPS 4.67 -> 3.73)
    sellValue: 84, // 60% of cost
    upgrades: [
      {
        id: 'speed',
        name: 'Rapid Fire',
        description: 'Increases fire rate by 50%',
        cost: 150,
        costScaling: 1.8,
        maxLevel: 2,
        effect: {
          stat: 'fireRate',
          multiplier: 1.5,
        },
      },
      {
        id: 'damage',
        name: 'Reinforced Charge',
        description: 'Increases damage by 50%',
        cost: 175,
        costScaling: 1.8,
        maxLevel: 3,
        effect: {
          stat: 'damage',
          multiplier: 1.5,
        },
      },
    ],
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
    damage: 40,
    range: 70,
    fireRate: 1.5, // 1.5 shots/sec
    projectileType: 'fireball',
    cost: 120, // Rebalanced: was 150 (more attractive)
    sellValue: 72, // 60% of cost
    upgrades: [
      {
        id: 'damage',
        name: 'Arcane Power',
        description: 'Increases magical damage by 50%',
        cost: 120,
        costScaling: 1.7,
        maxLevel: 3,
        effect: {
          stat: 'damage',
          multiplier: 1.5,
        },
      },
    ],
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
    damage: 40,
    range: 100,
    fireRate: 0.5,
    projectileType: 'rocket',
    cost: 100,
    sellValue: 60, // Fixed: was 120 (bug: > cost!)
    canTargetAir: true, // Can only target air units
    canTargetGround: false, // Cannot target ground units
    upgrades: [
      {
        id: 'speed',
        name: 'Rapid Fire',
        description: 'Doubles the fire rate',
        cost: 130,
        costScaling: 1.8,
        maxLevel: 2,
        effect: {
          stat: 'fireRate',
          multiplier: 2.0,
        },
      },
    ],
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
    damage: 2, // Minimal damage - utility tower for slow effect
    range: 60,
    fireRate: 0.33, // 1 shot every 3s (matches slow duration, no stacking)
    projectileType: 'ice-shard',
    cost: 90, // Rebalanced: was 120 (utility cheaper)
    sellValue: 54, // 60% of cost
    canTargetAir: true,
    canTargetGround: true,
    upgrades: [],
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
    upgrades: [
      {
        id: 'damage',
        name: 'Inferno',
        description: 'Increases fire damage by 50%',
        cost: 100,
        costScaling: 1.8,
        maxLevel: 3,
        effect: {
          stat: 'damage',
          multiplier: 1.5, // Applied to damagePerSecond
        },
      },
      {
        id: 'range',
        name: 'Wide Burn',
        description: 'Increases flame cone width by 30%',
        cost: 80,
        costScaling: 1.6,
        maxLevel: 2,
        effect: {
          stat: 'range',
          multiplier: 1.3, // Applied to beamWidth
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

export const TARGETING_STRATEGIES: TargetingStrategyConfig[] = [
  { id: 'closest', label: 'Closest', icon: 'near_me', tooltip: 'Attacks the nearest enemy' },
  { id: 'lowest-hp', label: 'Weakest', icon: 'heart_broken', tooltip: 'Attacks the weakest enemy' },
  { id: 'highest-hp', label: 'Strongest', icon: 'shield', tooltip: 'Attacks the strongest enemy' },
  { id: 'first', label: 'First', icon: 'flag', tooltip: 'Attacks the enemy closest to the base' },
  { id: 'air-priority', label: 'Air', icon: 'flight', tooltip: 'Prioritizes flying enemies' },
];

export function getTowerType(id: TowerTypeId): TowerTypeConfig {
  return TOWER_TYPES[id];
}

export function getAllTowerTypes(): TowerTypeConfig[] {
  return Object.values(TOWER_TYPES);
}
