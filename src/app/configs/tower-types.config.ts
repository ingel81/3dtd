export type TowerTypeId = 'archer' | 'cannon' | 'magic' | 'sniper' | 'dual-gatling';
export type ProjectileTypeId = 'arrow' | 'cannonball' | 'fireball' | 'ice-shard' | 'bullet';
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
}

// NOTE: Currently only tower_archer.glb exists. Using it for all tower types until more models are created.
const ARCHER_MODEL_URL = '/assets/models/towers/tower_archer.glb';
const WATCHTOWER_MODEL_URL = '/assets/models/towers/WatchTowerWRoof.fbx';
const TURRET_MODEL_URL = '/assets/models/towers/turret_test.glb';

export const TOWER_TYPES: Record<TowerTypeId, TowerTypeConfig> = {
  archer: {
    id: 'archer',
    name: 'Archer Tower',
    modelUrl: WATCHTOWER_MODEL_URL,
    scale: 0.027, // 1/3 of original size
    heightOffset: 0,
    shootHeight: 7, // Shooting position height
    rotationY: 0,
    damage: 25,
    range: 60,
    fireRate: 1, // 1 shot/sec
    projectileType: 'arrow',
    cost: 20,
    sellValue: 12,
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
        id: 'range',
        name: 'Erweiterter Radius',
        description: 'Erhöht die Reichweite um 50%',
        cost: 50,
        maxLevel: 1,
        effect: {
          stat: 'range',
          multiplier: 1.5,
        },
      },
    ],
  },
  cannon: {
    id: 'cannon',
    name: 'Cannon Tower',
    modelUrl: ARCHER_MODEL_URL, // TODO: Replace with tower_cannon.glb when available
    scale: 2.0,
    heightOffset: 2.0,
    shootHeight: 10, // Cannon position
    damage: 75,
    range: 80,
    fireRate: 0.5, // 0.5 shots/sec (slower)
    projectileType: 'cannonball',
    cost: 200,
    sellValue: 120,
    upgrades: [],
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
};

export function getTowerType(id: TowerTypeId): TowerTypeConfig {
  return TOWER_TYPES[id];
}

export function getAllTowerTypes(): TowerTypeConfig[] {
  return Object.values(TOWER_TYPES);
}
