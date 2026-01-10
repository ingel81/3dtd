export type TowerTypeId = 'archer' | 'cannon' | 'magic' | 'sniper';
export type ProjectileTypeId = 'arrow' | 'cannonball' | 'fireball' | 'ice-shard';
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
  heightOffset: number; // Vertical offset to place model above ground
  shootHeight: number; // Height above base where projectiles originate (for LoS calculations)

  damage: number;
  range: number;
  fireRate: number; // Shots per second
  projectileType: ProjectileTypeId;

  cost: number;
  sellValue: number; // Credits returned when selling
  upgrades: TowerUpgrade[]; // Available upgrades for this tower type
}

// NOTE: Currently only tower_archer.glb exists. Using it for all tower types until more models are created.
const ARCHER_MODEL_URL = '/assets/models/tower_archer.glb';

export const TOWER_TYPES: Record<TowerTypeId, TowerTypeConfig> = {
  archer: {
    id: 'archer',
    name: 'Archer Tower',
    modelUrl: ARCHER_MODEL_URL,
    scale: 1.8,
    heightOffset: 2.0,
    shootHeight: 12, // Window level where archers shoot from
    damage: 25,
    range: 60,
    fireRate: 1, // 1 shot/sec
    projectileType: 'arrow',
    cost: 50,
    sellValue: 30,
    upgrades: [
      {
        id: 'speed',
        name: 'Schnellfeuer',
        description: 'Verdoppelt die Feuerrate',
        cost: 50,
        maxLevel: 1,
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
