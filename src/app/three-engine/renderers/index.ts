import { Vector3 } from 'three';

/**
 * Coordinate sync interface for geo to local coordinate transformation
 */
export interface CoordinateSync {
  geoToLocal(lat: number, lon: number, height: number): Vector3;
  geoToLocalSimple(lat: number, lon: number, height: number): Vector3;
  localToGeo?(vec: Vector3): { lat: number; lon: number; height: number };
}

export { ThreeEnemyRenderer, type EnemyRenderData } from './three-enemy.renderer';
export { ThreeTowerRenderer, type TowerRenderData, type TerrainHeightSampler, type TerrainRaycaster, type LineOfSightRaycaster } from './three-tower.renderer';
export { ThreeProjectileRenderer, type ProjectileRenderData } from './three-projectile.renderer';
export { ThreeEffectsRenderer } from './three-effects.renderer';
