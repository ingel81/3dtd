import {
  Vector3,
  Color,
  Scene,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Material,
} from 'three';
import { CoordinateSync } from './index';
import { TrailParticleConfig } from '../../configs/projectile-types.config';
import { FloatingTextInstanceManager } from './floating-text/floating-text-instance.manager';
import { ParticlePoolManager } from './particle-pool-manager';
import { AuraRenderer } from './aura-renderer';
import { EnvironmentEffectsRenderer } from './environment-effects-renderer';
import { ParticleEffectsRenderer } from './particle-effects-renderer';
import type { Camera } from 'three';

/**
 * Floating text configuration
 */
export interface FloatingTextConfig {
  /** Text color (CSS format, default: '#FFD700' gold) */
  color?: string;
  /** Font size in pixels (default: 48) */
  fontSize?: number;
  /** Duration in ms (default: 1000) */
  duration?: number;
  /** Float speed - how fast it rises (default: 2) */
  floatSpeed?: number;
  /** Initial scale (default: 1) */
  scale?: number;
  /** Outline color (default: '#000000') */
  outlineColor?: string;
  /** Outline width (default: 3) */
  outlineWidth?: number;
}

/**
 * ThreeEffectsRenderer - Renders particle effects using Three.js
 *
 * Effects:
 * - Blood splatter (on enemy hit)
 * - Fire/smoke (on base damage)
 * - Explosions (on projectile impact)
 *
 * Uses Points with custom shader for GPU-accelerated particles.
 *
 * This class is a thin delegation facade — the heavy lifting lives in
 * dedicated sub-renderers:
 * - ParticlePoolManager: GPU particle pools (free-lists, buffers, atlas)
 * - ParticleEffectsRenderer: combat/environment particle effects + activeEffects
 * - EnvironmentEffectsRenderer: HQ explosion, fire-flash, tower inner-fire
 * - AuraRenderer: orbiting status-effect auras (frost + poison)
 * - FloatingTextInstanceManager: GPU-instanced floating text
 */
export class ThreeEffectsRenderer {
  private scene: Scene;
  private sync: CoordinateSync;

  // GPU particle pools (trail additive/normal + tower fire) — all pool
  // mechanics (free-lists, buffers, materials, atlas) live in this manager.
  private pools: ParticlePoolManager;

  // Combat & environment particle effects + the central activeEffects map
  private particleEffects: ParticleEffectsRenderer;

  // Environmental VFX (HQ explosion, fire-flash, tower inner-fire)
  private environment: EnvironmentEffectsRenderer;

  // GPU-instanced floating text system (1 draw call for all texts)
  private floatingTextManager!: FloatingTextInstanceManager;

  // Orbiting status-effect auras (frost + poison) — particles borrowed from the pools
  private auras: AuraRenderer;

  constructor(scene: Scene, sync: CoordinateSync) {
    this.scene = scene;
    this.sync = sync;

    // GPU-instanced floating text system
    this.floatingTextManager = new FloatingTextInstanceManager(scene, sync);

    // GPU particle pools (creates Points, materials, atlas internally)
    this.pools = new ParticlePoolManager(scene);

    // Orbiting status-effect auras (frost + poison) — borrow from the pools
    this.auras = new AuraRenderer(this.pools);

    // Environmental VFX (HQ explosion, fire-flash, tower inner-fire)
    this.environment = new EnvironmentEffectsRenderer(this.sync, this.pools);

    // Combat & environment particle effects + instanced decal managers
    this.particleEffects = new ParticleEffectsRenderer(this.scene, this.sync, this.pools);
  }

  /**
   * Toggle between PointsMaterial and ShaderMaterial for trail particles.
   * Use this to test shader-based particles with per-particle sizes.
   *
   * @param useShader - true to use ShaderMaterial, false for PointsMaterial
   */
  setUseShaderMaterial(useShader: boolean): void {
    this.pools.setUseShaderMaterial(useShader);
  }

  /**
   * Check if ShaderMaterial is currently active
   */
  isUsingShaderMaterial(): boolean {
    return this.pools.isUsingShaderMaterial();
  }

  /**
   * Spawn blood splatter effect at a position
   *
   * @param lat - Latitude
   * @param lon - Longitude
   * @param height - Height above ground
   * @param count - Number of particles (default 20)
   */
  spawnBloodSplatter(lat: number, lon: number, height: number, count = 20): string {
    return this.particleEffects.spawnBloodSplatter(lat, lon, height, count);
  }

  /**
   * Spawn a persistent blood decal on the ground
   * NOW USES GPU INSTANCING - much better performance!
   *
   * @param lat - Latitude
   * @param lon - Longitude
   * @param height - Height (terrain height)
   * @param size - Size of the decal (0.5-3.0 meters, default 1.0)
   * @returns Decal ID
   */
  spawnBloodDecal(lat: number, lon: number, height: number, size = 1.0): string {
    return this.particleEffects.spawnBloodDecal(lat, lon, height, size);
  }

  /**
   * Spawn fire effect at a position
   *
   * @param lat - Latitude
   * @param lon - Longitude
   * @param height - Height above ground
   * @param intensity - Fire intensity ('tiny' | 'small' | 'medium' | 'large' | 'inferno')
   */
  spawnFire(
    lat: number,
    lon: number,
    height: number,
    intensity: 'tiny' | 'small' | 'medium' | 'large' | 'inferno' = 'medium'
  ): string {
    return this.particleEffects.spawnFire(lat, lon, height, intensity);
  }

  /**
   * Spawn fire effect ON TERRAIN at given geo coordinates
   * Automatically raycasts to find terrain/roof height - no manual height calculation needed!
   *
   * @param lat - Latitude
   * @param lon - Longitude
   * @param getTerrainHeight - Function to get terrain height (engine.getTerrainHeightAtGeo)
   * @param intensity - Fire intensity
   * @param heightOffset - Optional offset above terrain (default: 0)
   */
  spawnFireOnTerrain(
    lat: number,
    lon: number,
    getTerrainHeight: (lat: number, lon: number) => number | null,
    intensity: 'tiny' | 'small' | 'medium' | 'large' | 'inferno' = 'medium',
    heightOffset = 0
  ): string {
    return this.particleEffects.spawnFireOnTerrain(lat, lon, getTerrainHeight, intensity, heightOffset);
  }

  /**
   * Spawn fire effect using local Y coordinate directly
   * Use this when you have a local terrain Y from getTerrainHeightAtGeo()
   *
   * @param lat - Latitude (for X/Z positioning)
   * @param lon - Longitude (for X/Z positioning)
   * @param localY - Local Y coordinate (from getTerrainHeightAtGeo)
   * @param intensity - Fire intensity
   */
  spawnFireAtLocalY(
    lat: number,
    lon: number,
    localY: number,
    intensity: 'tiny' | 'small' | 'medium' | 'large' | 'inferno' = 'medium'
  ): string {
    return this.particleEffects.spawnFireAtLocalY(lat, lon, localY, intensity);
  }

  /**
   * Stop a fire effect
   */
  stopFire(id: string): void {
    this.particleEffects.stopFire(id);
  }

  /**
   * Stop all fire effects
   */
  stopAllFires(): void {
    this.particleEffects.stopAllFires();
  }

  /**
   * Stop a fire effect immediately (no fade)
   */
  stopFireImmediate(id: string): void {
    this.particleEffects.stopFireImmediate(id);
  }

  // =====================================================
  // TOWER INNER FIRE - Dedicated pool for Fire Tower
  // =====================================================

  /** Spawn persistent inner fire for a Fire Tower (dedicated pool). */
  spawnTowerInnerFire(
    towerId: string,
    localPosition: Vector3,
    fireHeight = 3.0,
    intensity = 0.5
  ): string {
    return this.environment.spawnTowerInnerFire(towerId, localPosition, fireHeight, intensity);
  }

  /** Stop tower inner fire immediately. */
  stopTowerInnerFire(towerId: string): void {
    this.environment.stopTowerInnerFire(towerId);
  }

  /** Stop all tower inner fires. */
  stopAllTowerFires(): void {
    this.environment.stopAllTowerFires();
  }

  /** Check if tower has active inner fire. */
  hasTowerFire(towerId: string): boolean {
    return this.environment.hasTowerFire(towerId);
  }

  // =====================================================
  // FROST AURA - Orbiting ice particles for slowed enemies
  // =====================================================

  /**
   * Spawn frost aura around a slowed enemy.
   * Creates 3 orbiting cyan/white particles from the additive trail pool.
   *
   * @param enemyId - Unique enemy ID
   * @param localPosition - Current local position of the enemy
   * @returns Enemy ID (same as input)
   */
  // ── Status-effect auras (frost + poison) — delegated to AuraRenderer ──

  /** Spawn orbiting cyan ice particles around a slowed enemy. */
  spawnFrostAura(enemyId: string, localPosition: Vector3): string {
    return this.auras.spawnFrostAura(enemyId, localPosition);
  }

  /** Update frost aura position to follow a moving enemy. */
  updateFrostAuraPosition(enemyId: string, localPosition: Vector3): void {
    this.auras.updateFrostAuraPosition(enemyId, localPosition);
  }

  /** Stop frost aura on an enemy (slow expired). */
  stopFrostAura(enemyId: string): void {
    this.auras.stopFrostAura(enemyId);
  }

  /** Check if an enemy has an active frost aura. */
  hasFrostAura(enemyId: string): boolean {
    return this.auras.hasFrostAura(enemyId);
  }

  /** Spawn orbiting green poison particles around a poisoned enemy. */
  spawnPoisonAura(enemyId: string, localPosition: Vector3): string {
    return this.auras.spawnPoisonAura(enemyId, localPosition);
  }

  /** Update poison aura position to follow a moving enemy. */
  updatePoisonAuraPosition(enemyId: string, localPosition: Vector3): void {
    this.auras.updatePoisonAuraPosition(enemyId, localPosition);
  }

  /** Stop poison aura on an enemy (poison expired). */
  stopPoisonAura(enemyId: string): void {
    this.auras.stopPoisonAura(enemyId);
  }

  /** Check if an enemy has an active poison aura. */
  hasPoisonAura(enemyId: string): boolean {
    return this.auras.hasPoisonAura(enemyId);
  }

  /**
   * Spawn a single flame particle for beam effects.
   * Used by FlameBeamRenderer for flamethrower streams.
   */
  spawnFlameParticle(
    position: Vector3,
    velocity: Vector3,
    color: Color,
    size: number,
    maxLife: number
  ): void {
    this.particleEffects.spawnFlameParticle(position, velocity, color, size, maxLife);
  }

  /**
   * Spawn a brief muzzle flash at a local position.
   * 3-5 bright additive particles (yellow/white) lasting ~50ms.
   * Used when projectile towers fire.
   *
   * @param localX - Local X coordinate (tower shoot position)
   * @param localY - Local Y coordinate (tower shoot position)
   * @param localZ - Local Z coordinate (tower shoot position)
   */
  spawnMuzzleFlash(localX: number, localY: number, localZ: number): void {
    this.particleEffects.spawnMuzzleFlash(localX, localY, localZ);
  }

  /** Spawn a brief fire flash that fades away (HQ damage indicator, HP > 50%). */
  spawnFireFlash(lat: number, lon: number, localY: number): void {
    this.environment.spawnFireFlash(lat, lon, localY);
  }

  /**
   * Spawn scaled permanent fire (for HP 1-50%)
   * @param scale - 0.0 (small) to 1.0 (maximum inferno)
   */
  spawnScaledFire(lat: number, lon: number, localY: number, scale: number): string {
    return this.particleEffects.spawnScaledFire(lat, lon, localY, scale);
  }

  /**
   * Scale up an existing fire to inferno level
   * Adds more particles to the existing fire effect
   */
  scaleFireToInferno(fireId: string): void {
    this.particleEffects.scaleFireToInferno(fireId);
  }

  /** Spawn the massive HQ destruction explosion (dramatic final explosion). */
  spawnHQExplosion(lat: number, lon: number, localY: number): void {
    this.environment.spawnHQExplosion(lat, lon, localY);
  }

  /**
   * Spawn rocket trail particles at a local position
   * Call this each frame for each active rocket to create a continuous trail
   * Uses ADDITIVE blending (fire/glow effect)
   *
   * @param localX - Local X coordinate
   * @param localY - Local Y coordinate (height)
   * @param localZ - Local Z coordinate
   * @param count - Number of particles to spawn (default 3)
   */
  spawnRocketTrail(localX: number, localY: number, localZ: number, count = 3): void {
    this.particleEffects.spawnRocketTrail(localX, localY, localZ, count);
  }

  /**
   * Spawn rocket trail at geo coordinates
   * Convenience method that converts geo to local coordinates
   *
   * @param lat - Latitude
   * @param lon - Longitude
   * @param height - Height above ground
   * @param count - Number of particles (default 3)
   */
  spawnRocketTrailAtGeo(lat: number, lon: number, height: number, count = 3): void {
    this.particleEffects.spawnRocketTrailAtGeo(lat, lon, height, count);
  }

  /**
   * Spawn bullet tracer effect at local position
   * Much smaller and faster-fading than rocket trails
   * Uses ADDITIVE blending (bright tracer effect)
   */
  spawnBulletTracer(localX: number, localY: number, localZ: number, count = 1): void {
    this.particleEffects.spawnBulletTracer(localX, localY, localZ, count);
  }

  /**
   * Spawn bullet tracer at geo coordinates
   */
  spawnBulletTracerAtGeo(lat: number, lon: number, height: number, count = 1): void {
    this.particleEffects.spawnBulletTracerAtGeo(lat, lon, height, count);
  }

  /**
   * Spawn subtle cannon smoke at local position
   * Very subtle black/dark grey particles for cannonball trails
   * Uses NORMAL blending (opaque smoke effect)
   */
  spawnCannonSmoke(localX: number, localY: number, localZ: number, count = 1): void {
    this.particleEffects.spawnCannonSmoke(localX, localY, localZ, count);
  }

  /**
   * Spawn cannon smoke at geo coordinates
   */
  spawnCannonSmokeAtGeo(lat: number, lon: number, height: number, count = 1): void {
    this.particleEffects.spawnCannonSmokeAtGeo(lat, lon, height, count);
  }

  /**
   * Spawn configurable trail particles based on TrailParticleConfig
   * Generic method that uses config values instead of hardcoded parameters
   * Automatically chooses additive or normal blending pool based on config.blending
   * Supports 'spiral' trailType for railgun-style rotating particles
   */
  spawnConfigurableTrail(
    localX: number,
    localY: number,
    localZ: number,
    config: TrailParticleConfig
  ): void {
    this.particleEffects.spawnConfigurableTrail(localX, localY, localZ, config);
  }

  /**
   * Spawn configurable trail particles at geo coordinates
   */
  spawnConfigurableTrailAtGeo(
    lat: number,
    lon: number,
    height: number,
    config: TrailParticleConfig
  ): void {
    this.particleEffects.spawnConfigurableTrailAtGeo(lat, lon, height, config);
  }

  /**
   * Spawn explosion effect at local position
   * Used for rocket impacts and other explosions
   * Uses ADDITIVE blending (fire/glow effect)
   *
   * @param localX - Local X coordinate
   * @param localY - Local Y coordinate (height)
   * @param localZ - Local Z coordinate
   * @param count - Number of particles (default 25)
   * @param radius - Explosion radius in meters (default 5)
   */
  spawnExplosion(localX: number, localY: number, localZ: number, count = 25, _radius = 5): void {
    this.particleEffects.spawnExplosion(localX, localY, localZ, count, _radius);
  }

  /**
   * Spawn explosion at geo coordinates
   * Convenience method that converts geo to local coordinates
   *
   * @param lat - Latitude
   * @param lon - Longitude
   * @param height - Height above ground
   * @param count - Number of particles (default 25)
   */
  spawnExplosionAtGeo(lat: number, lon: number, height: number, count = 25): void {
    this.particleEffects.spawnExplosionAtGeo(lat, lon, height, count);
  }

  /**
   * Spawn ice explosion effect at local position
   * Used for ice tower impacts - cyan/blue particles
   *
   * @param localX - Local X coordinate
   * @param localY - Local Y coordinate (height)
   * @param localZ - Local Z coordinate
   * @param count - Number of particles (default 20)
   */
  spawnIceExplosion(localX: number, localY: number, localZ: number, count = 20): void {
    this.particleEffects.spawnIceExplosion(localX, localY, localZ, count);
  }

  /**
   * Spawn ice explosion at geo coordinates
   *
   * @param lat - Latitude
   * @param lon - Longitude
   * @param height - Height above ground
   * @param count - Number of particles (default 20)
   */
  spawnIceExplosionAtGeo(lat: number, lon: number, height: number, count = 20): void {
    this.particleEffects.spawnIceExplosionAtGeo(lat, lon, height, count);
  }

  /**
   * Spawn ice decal on ground (frost patch)
   * NOW USES GPU INSTANCING - much better performance!
   *
   * @param lat - Latitude
   * @param lon - Longitude
   * @param height - Terrain height
   * @param size - Size of the decal (1.0-4.0 meters, default 2.0)
   * @returns Decal ID
   */
  spawnIceDecal(lat: number, lon: number, height: number, size = 2.0): string {
    return this.particleEffects.spawnIceDecal(lat, lon, height, size);
  }

  /**
   * Spawn floating text at a position (e.g., for rewards, damage numbers, status messages)
   *
   * @param text - The text to display
   * @param lat - Latitude
   * @param lon - Longitude
   * @param height - Height above ground
   * @param config - Optional configuration
   * @returns Floating text ID
   */
  spawnFloatingText(
    text: string,
    lat: number,
    lon: number,
    height: number,
    config: FloatingTextConfig = {}
  ): void {
    this.floatingTextManager.spawn(text, lat, lon, height, config);
  }

  /**
   * Update floating text billboard uniforms and reclaim expired instances.
   * Must be called with the active camera for correct billboard orientation.
   */
  updateFloatingTexts(camera: Camera): void {
    this.floatingTextManager.update(camera);
  }

  /**
   * Update all active effects
   *
   * @param deltaTime - Time since last frame in milliseconds
   */
  update(deltaTime: number): void {
    const now = performance.now();
    const dt = deltaTime / 1000; // Convert to seconds

    // (1-5) Combat/environment particle effects: activeEffects loop, blood +
    // ice decal fading, and both trail particle pool update loops.
    this.particleEffects.update(dt, now);

    // (6) Update tower inner fires (HQ/environment VFX)
    this.environment.update(dt);

    // (7) Update orbiting status-effect auras (frost + poison)
    this.auras.update(dt);

    // (8) Update GPU buffers (free-list rebuild + GPU upload, skips idle pools)
    this.pools.updateBuffers();
  }

  // Debug spheres for visualization
  private debugSpheres: Mesh[] = [];

  /**
   * Spawn a debug sphere at a position (for debugging fire placement etc.)
   * Uses localY directly (not geo height)
   */
  spawnDebugSphere(
    lat: number,
    lon: number,
    localY: number,
    radius = 2,
    color = 0x00ff00
  ): void {
    const localXZ = this.sync.geoToLocalSimple(lat, lon, 0);

    const geometry = new SphereGeometry(radius, 16, 16);
    const material = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.8,
      depthTest: true,
    });
    const sphere = new Mesh(geometry, material);
    sphere.position.set(localXZ.x, localY, localXZ.z);
    sphere.renderOrder = 100;

    this.scene.add(sphere);
    this.debugSpheres.push(sphere);
  }

  /**
   * Set visibility of all debug spheres
   */
  setDebugSpheresVisible(visible: boolean): void {
    for (const sphere of this.debugSpheres) {
      sphere.visible = visible;
    }
  }

  /**
   * Clear all debug spheres
   */
  clearDebugSpheres(): void {
    for (const sphere of this.debugSpheres) {
      this.scene.remove(sphere);
      sphere.geometry.dispose();
      (sphere.material as Material).dispose();
    }
    this.debugSpheres = [];
  }

  /**
   * Clear all effects
   */
  clear(): void {
    // Reset all GPU particle pools (kills particles, rebuilds free-lists + cursors)
    this.pools.reset();

    // Clear combat/environment particle effects + instanced decals
    this.particleEffects.clear();

    // Clear tower-fire tracking + status-effect auras
    this.environment.clear();
    this.auras.clear();

    // Clear GPU-instanced floating texts
    this.floatingTextManager.clear();

    // Clear debug spheres
    this.clearDebugSpheres();
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.clear();

    // Dispose GPU particle pools (Points, geometries, materials, atlas textures)
    this.pools.dispose();

    // Dispose instanced decal managers (removes them from the scene)
    this.particleEffects.dispose();

    // Dispose GPU-instanced floating texts
    this.floatingTextManager.dispose();
  }
}
