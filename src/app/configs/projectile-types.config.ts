import { ProjectileTypeId } from './tower-types.config';

// Re-export ProjectileTypeId for convenience
export type { ProjectileTypeId } from './tower-types.config';

export type ProjectileVisualType = 'arrow' | 'cannonball' | 'magic' | 'bullet' | 'rocket';

export interface ProjectileTypeConfig {
  id: ProjectileTypeId;
  speed: number; // m/s
  visualType: ProjectileVisualType;
  scale: number;
}

export const PROJECTILE_TYPES: Record<ProjectileTypeId, ProjectileTypeConfig> = {
  arrow: {
    id: 'arrow',
    speed: 80,
    visualType: 'arrow',
    scale: 8, // Model is tiny (~0.8m), scale up significantly
  },
  cannonball: {
    id: 'cannonball',
    speed: 50,
    visualType: 'cannonball',
    scale: 0.5,
  },
  fireball: {
    id: 'fireball',
    speed: 100,
    visualType: 'magic',
    scale: 0.4,
  },
  'ice-shard': {
    id: 'ice-shard',
    speed: 90,
    visualType: 'magic',
    scale: 0.4,
  },
  bullet: {
    id: 'bullet',
    speed: 150, // Very fast - bullet speed
    visualType: 'bullet',
    scale: 0.15, // Small projectile
  },
  rocket: {
    id: 'rocket',
    speed: 120, // Fast homing missile
    visualType: 'rocket',
    scale: 1.0,
  },
};

export function getProjectileType(id: ProjectileTypeId): ProjectileTypeConfig {
  return PROJECTILE_TYPES[id];
}

export function getAllProjectileTypes(): ProjectileTypeConfig[] {
  return Object.values(PROJECTILE_TYPES);
}
