export type TowerTypeId = 'archer' | 'cannon' | 'magic' | 'dual-gatling' | 'rocket' | 'ice';
export type ProjectileTypeId = 'arrow' | 'cannonball' | 'fireball' | 'ice-shard' | 'bullet' | 'rocket';
export type UpgradeId = 'speed' | 'damage' | 'range';

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
  rotationY?: number; // Initial Y rotation in radians (default: 0)

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
}

// Tower model URLs
const ARCHER_MODEL_URL = '/assets/models/towers/archer.glb';
const TURRET_MODEL_URL = '/assets/models/towers/gatling.glb';
const ROCKET_MODEL_URL = '/assets/models/towers/rocket.glb';
const CANNON_MODEL_URL = '/assets/models/towers/cannon.glb';
const ICE_MODEL_URL = '/assets/models/towers/ice.glb';
const MAGIC_MODEL_URL = '/assets/models/towers/magic.glb';

export const TOWER_TYPES: Record<TowerTypeId, TowerTypeConfig> = {
  archer: {
    id: 'archer',
    name: 'Archer Tower',
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
    rotationY: -1.5708, // -90° to align turret with aim direction
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
    modelUrl: ICE_MODEL_URL,
    scale: 11.4,
    previewScale: 32,
    heightOffset: 0.1,
    shootHeight: 3.4,
    rotationY: 3.1416, // 180°
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
};

export function getTowerType(id: TowerTypeId): TowerTypeConfig {
  return TOWER_TYPES[id];
}

export function getAllTowerTypes(): TowerTypeConfig[] {
  return Object.values(TOWER_TYPES);
}
