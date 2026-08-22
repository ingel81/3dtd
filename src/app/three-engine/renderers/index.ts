import { Vector3 } from 'three';

/**
 * Coordinate sync interface for geo to local coordinate transformation
 */
export interface CoordinateSync {
  geoToLocal(lat: number, lon: number, height: number): Vector3;
  geoToLocalSimple(lat: number, lon: number, height: number): Vector3;
  geoToLocalSimpleInto(lat: number, lon: number, height: number, target: Vector3): Vector3;
  localToGeo?(vec: Vector3): { lat: number; lon: number; height: number };
}

export { type EnemyRenderData, type EnemyDebugOverrides } from './instanced-enemy/instanced-enemy.renderer';
export { ThreeTowerRenderer, type TowerRenderData, type TerrainHeightSampler, type TerrainRaycaster, type ColumnSampler, type LineOfSightRaycaster } from './three-tower.renderer';
export { ThreeProjectileRenderer, type ProjectileRenderData } from './three-projectile.renderer';
export { ThreeEffectsRenderer } from './three-effects.renderer';
export { ThreeFlameBeamRenderer } from './three-flame-beam.renderer';
export { ThreeTentacleRenderer } from './three-tentacle.renderer';
export { TrailStreakRenderer } from './trail-streak.renderer';
export { LightningBoltRenderer, type BoltOptions } from './lightning-bolt.renderer';
