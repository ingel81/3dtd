export type TowerTypeId = 'archer' | 'cannon' | 'magic' | 'sniper' | 'dual-gatling' | 'rocket' | 'ice';
export type ProjectileTypeId = 'arrow' | 'cannonball' | 'fireball' | 'ice-shard' | 'bullet' | 'rocket';
export type UpgradeId = 'speed' | 'damage' | 'range';

export interface TowerUpgrade {
  id: UpgradeId;
  name: string;
  description: string;
  cost: number;
  maxLevel: number;
  effect: {
    stat: 'fireRate' | 'damage' | 'range';
    multiplier: number; // e.g., 2.0 = double
  };
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

// NOTE: Currently only tower_archer.glb exists. Using it for all tower types until more models are created.
const ARCHER_MODEL_URL = '/assets/models/towers/archer_tower.glb';
const WATCHTOWER_MODEL_URL = '/assets/models/towers/WatchTowerWRoof.fbx';
const TURRET_MODEL_URL = '/assets/models/towers/turret_test.glb';
const ROCKET_MODEL_URL = '/assets/models/towers/rocket_tower.glb';
const CANNON_MODEL_URL = '/assets/models/towers/cannon_tower.glb';
const ICE_MODEL_URL = '/assets/models/towers/turret_ice1.glb';

export const TOWER_TYPES: Record<TowerTypeId, TowerTypeConfig> = {
  archer: {
    id: 'archer',
    name: 'Archer Tower',
    modelUrl: ARCHER_MODEL_URL,
    scale: 15.0,
    previewScale: 14.0,
    heightOffset: 7,
    shootHeight: 1.0, // Shooting position height
    rotationY: 0,
    damage: 25,
    range: 60,
    fireRate: 1, // 1 shot/sec
    projectileType: 'arrow',
    cost: 20,
    sellValue: 12,
    hasAnimations: true, // archer_tower.glb has base animation
    animationPingPong: true, // Smooth loop: forward then backward
    upgrades: [
      {
        id: 'speed',
        name: 'Schnellfeuer',
        description: 'Verdoppelt die Feuerrate',
        cost: 25,
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
    scale: 2.5, // World scale
    previewScale: 4.0, // Larger preview in UI
    heightOffset: 2.5, // Ground level
    shootHeight: 2.5, // Barrel height at scale 2.5
    rotationY: -Math.PI / 2, // -90° to align turret with aim direction
    damage: 10,
    range: 50,
    fireRate: 5.0, // 5 shots/sec - rapid fire
    projectileType: 'bullet',
    cost: 100,
    sellValue: 60,
    upgrades: [
      {
        id: 'speed',
        name: 'Schnellfeuer',
        description: 'Verdoppelt die Feuerrate',
        cost: 50,
        maxLevel: 10,
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
    scale: 3.0,
    previewScale: 7.0,
    heightOffset: 2.5,
    shootHeight: 3, // Cannon barrel height
    rotationY: 0,
    damage: 75,
    range: 80,
    fireRate: 0.5, // 0.5 shots/sec (slower)
    projectileType: 'cannonball',
    cost: 200,
    sellValue: 120,
    upgrades: [
      {
        id: 'speed',
        name: 'Schnellfeuer',
        description: 'Erhöht die Feuerrate um 50%',
        cost: 100,
        maxLevel: 2,
        effect: {
          stat: 'fireRate',
          multiplier: 1.5,
        },
      },
      {
        id: 'damage',
        name: 'Verstärkte Ladung',
        description: 'Erhöht den Schaden um 50%',
        cost: 120,
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
    modelUrl: ARCHER_MODEL_URL, // TODO: Replace with tower_magic.glb when available
    scale: 1.5,
    heightOffset: 2.0,
    shootHeight: 10, // Magic orb position
    damage: 40,
    range: 70,
    fireRate: 1.5, // 1.5 shots/sec (faster)
    projectileType: 'fireball',
    cost: 150,
    sellValue: 90,
    upgrades: [],
  },
  sniper: {
    id: 'sniper',
    name: 'Sniper Tower',
    modelUrl: ARCHER_MODEL_URL, // TODO: Replace with tower_sniper.glb when available
    scale: 1.6,
    heightOffset: 2.0,
    shootHeight: 14, // Top platform for sniper
    damage: 150,
    range: 120,
    fireRate: 0.3, // Very slow but powerful
    projectileType: 'arrow',
    cost: 300,
    sellValue: 180,
    upgrades: [],
  },
  rocket: {
    id: 'rocket',
    name: 'Rocket Tower',
    modelUrl: ROCKET_MODEL_URL,
    scale: 2.5,
    previewScale: 4.0,
    heightOffset: 2.5,
    shootHeight: 1.0,
    rotationY: 0,
    damage: 40,
    range: 100,
    fireRate: 0.5,
    projectileType: 'rocket',
    cost: 200,
    sellValue: 120,
    canTargetAir: true, // Can only target air units
    canTargetGround: false, // Cannot target ground units
    upgrades: [
      {
        id: 'speed',
        name: 'Schnellfeuer',
        description: 'Verdoppelt die Feuerrate',
        cost: 100,
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
    scale: 8.0,
    previewScale: 24.0,
    heightOffset: 1,
    shootHeight: 2.5,
    rotationY: Math.PI / 2,
    damage: 15, // Low damage - mainly for slow effect
    range: 60,
    fireRate: 0.8,
    projectileType: 'ice-shard',
    cost: 120,
    sellValue: 72,
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
