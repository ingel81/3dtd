import { Vector3, Color, Scene, PlaneGeometry } from 'three';
import { CoordinateSync } from './index';
import { TrailParticleConfig } from '../../configs/projectile-types.config';
import {
  BLOOD_DECAL_CONFIG,
  ICE_DECAL_CONFIG,
} from '../../configs/visual-effects.config';
import { DecalInstanceManager } from './decal-instance.manager';
import { createBloodDecalShader, createIceDecalShader } from './decal-shaders';
import { ParticlePoolManager, type Particle } from './particle-pool-manager';

/**
 * Active effect instance
 */
interface EffectInstance {
  id: string;
  type: 'blood' | 'fire' | 'explosion' | 'smoke';
  particles: Particle[];
  startTime: number;
  duration: number;
  localPosition: Vector3;
}

// Note: Blood and Ice decal instances are now managed by DecalInstanceManager
// See decal-instance.manager.ts for DecalInstance interface

/**
 * ParticleEffectsRenderer — combat & environment particle effects plus the
 * central activeEffects lifecycle map.
 *
 * Split out of three-effects.renderer.ts. Owns the blood/ice decal managers
 * and borrows GPU particles from the ParticlePoolManager (trail additive /
 * normal pools). Handles blood splatter, fire, muzzle flashes, rocket/bullet
 * trails, cannon smoke, configurable trails, explosions, ice explosions, and
 * the persistent-fire respawn logic.
 */
export class ParticleEffectsRenderer {
  // Active effects
  private activeEffects = new Map<string, EffectInstance>();
  private effectIdCounter = 0;

  // Instanced decal managers (GPU instancing for performance)
  private bloodDecalManager: DecalInstanceManager | null = null;
  private iceDecalManager: DecalInstanceManager | null = null;
  private readonly MAX_BLOOD_DECALS = BLOOD_DECAL_CONFIG.maxDecals;
  private readonly DECAL_FADE_DELAY = BLOOD_DECAL_CONFIG.fadeDelay;
  private readonly DECAL_FADE_DURATION = BLOOD_DECAL_CONFIG.fadeDuration;
  private readonly MAX_ICE_DECALS = ICE_DECAL_CONFIG.maxDecals;
  private readonly ICE_DECAL_FADE_DELAY = ICE_DECAL_CONFIG.fadeDelay;
  private readonly ICE_DECAL_FADE_DURATION = ICE_DECAL_CONFIG.fadeDuration;
  private decalIdCounter = 0;

  // Spiral angle tracker for railgun effect (uses time-based rotation)
  private spiralAngle = 0;

  // Reusable temp vector for particle updates (avoids GC pressure)
  private readonly tempVelocity = new Vector3();

  constructor(
    private readonly scene: Scene,
    private readonly sync: CoordinateSync,
    private readonly pools: ParticlePoolManager,
  ) {
    // Initialize instanced decal managers with custom shaders
    this.initDecalManagers();
  }

  /**
   * Initialize instanced decal managers with custom shaders
   * Replaces old per-decal mesh system with GPU instancing (2 draw calls instead of 250!)
   */
  private initDecalManagers(): void {
    // Create shared plane geometry for all decals (rotated to lay flat)
    const decalGeometry = new PlaneGeometry(2, 2);
    decalGeometry.rotateX(-Math.PI / 2); // Rotate to lie flat on ground (XZ plane)

    // Create blood decal manager with custom shader
    const bloodShader = createBloodDecalShader();
    this.bloodDecalManager = new DecalInstanceManager(
      decalGeometry.clone(),
      bloodShader,
      this.MAX_BLOOD_DECALS
    );
    this.scene.add(this.bloodDecalManager.instancedMesh);

    // Create ice decal manager with custom shader
    const iceShader = createIceDecalShader();
    this.iceDecalManager = new DecalInstanceManager(
      decalGeometry.clone(),
      iceShader,
      this.MAX_ICE_DECALS
    );
    this.scene.add(this.iceDecalManager.instancedMesh);

    console.log('[ThreeEffectsRenderer] Instanced decal managers initialized');
    console.log(`  Blood decals: max ${this.MAX_BLOOD_DECALS} instances (1 draw call)`);
    console.log(`  Ice decals: max ${this.MAX_ICE_DECALS} instances (1 draw call)`);
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
    const localPos = this.sync.geoToLocal(lat, lon, height);
    const id = `blood_${this.effectIdCounter++}`;

    const effect: EffectInstance = {
      id,
      type: 'blood',
      particles: [],
      startTime: performance.now(),
      duration: 1500, // 1.5 seconds
      localPosition: localPos.clone(),
    };

    // Spawn particles
    const maxBloodParticles = 100;
    for (let i = 0; i < count && effect.particles.length < maxBloodParticles; i++) {
      const particle = this.pools.getInactiveParticle('trailNormal');
      if (!particle) break;

      particle.position.copy(localPos);
      particle.velocity.set(
        (Math.random() - 0.5) * 5,
        Math.random() * 5,
        (Math.random() - 0.5) * 5
      );
      particle.life = 1.0;
      particle.maxLife = 1.0 + Math.random() * 0.5;
      particle.size = 0.2 + Math.random() * 0.3;

      // Vary blood color slightly
      const r = 0.7 + Math.random() * 0.3;
      particle.color.setRGB(r, 0, 0);

      effect.particles.push(particle);
    }

    this.activeEffects.set(id, effect);
    return id;
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
    if (!this.bloodDecalManager) {
      console.warn('[ThreeEffectsRenderer] Blood decal manager not initialized');
      return '';
    }

    const localPos = this.sync.geoToLocal(lat, lon, height);
    localPos.y += BLOOD_DECAL_CONFIG.heightOffset;

    const id = `blood_decal_${this.decalIdCounter++}`;
    const now = performance.now();

    // Random rotation for variety
    const rotation = Math.random() * Math.PI * 2;

    // Apply size with randomness - ellipse shape for puddle effect
    const baseSize = size * (0.8 + Math.random() * 0.4);

    // Randomize color slightly (dark red variations) - from config
    const colorVariation = Math.random() * BLOOD_DECAL_CONFIG.colorVariation;
    const color = new Color(
      BLOOD_DECAL_CONFIG.baseColor.r + colorVariation,
      BLOOD_DECAL_CONFIG.baseColor.g,
      BLOOD_DECAL_CONFIG.baseColor.b
    );

    // If pool is full, remove oldest decal
    if (this.bloodDecalManager.count >= this.MAX_BLOOD_DECALS) {
      const instances = this.bloodDecalManager.getAllInstances();
      if (instances.length > 0) {
        let oldest = instances[0];
        for (const inst of instances) {
          if (inst.spawnTime < oldest.spawnTime) {
            oldest = inst;
          }
        }
        this.bloodDecalManager.remove(oldest.id);
      }
    }

    // Add new decal instance
    this.bloodDecalManager.add(
      id,
      localPos,
      baseSize,
      rotation,
      color,
      BLOOD_DECAL_CONFIG.baseOpacity,
      now,
      this.DECAL_FADE_DELAY,
      this.DECAL_FADE_DURATION
    );

    return id;
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
    const localPos = this.sync.geoToLocal(lat, lon, height);
    const id = `fire_${this.effectIdCounter++}`;

    // Fire intensity config - all use duration: -1 for persistent fire
    const intensityConfig = {
      tiny: { count: 15, radius: 1.5 },
      small: { count: 40, radius: 2.5 },
      medium: { count: 80, radius: 4 },
      large: { count: 120, radius: 6 },
      inferno: { count: 200, radius: 10 },
    };

    const config = intensityConfig[intensity];

    const effect: EffectInstance = {
      id,
      type: 'fire',
      particles: [],
      startTime: performance.now(),
      duration: -1, // All fires are now persistent until stopped
      localPosition: localPos.clone(),
    };

    // Store radius in effect for respawning
    (effect as EffectInstance & { radius: number }).radius = config.radius;

    // Use trailPoolAdditive for better visuals (per-particle colors, shader support)
    for (let i = 0; i < config.count; i++) {
      const particle = this.pools.getInactiveParticle('trailAdditive');
      if (!particle) break;

      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * config.radius;

      particle.position.copy(localPos);
      particle.position.x += Math.cos(angle) * radius;
      particle.position.z += Math.sin(angle) * radius;

      particle.velocity.set(
        (Math.random() - 0.5) * 2,
        3 + Math.random() * 5, // Upward
        (Math.random() - 0.5) * 2
      );
      particle.life = 1.0;
      particle.maxLife = 0.4 + Math.random() * 0.8;
      particle.size = 1.5 + Math.random() * 2.5; // Bigger particles

      // Fire colors - yellow core, orange mid, red edges
      const t = Math.random();
      if (t < 0.3) {
        particle.color.setRGB(1, 0.9, 0.3); // Yellow core
      } else if (t < 0.7) {
        particle.color.setRGB(1, 0.5, 0.1); // Orange
      } else {
        particle.color.setRGB(1, 0.2, 0.05); // Red edges
      }

      effect.particles.push(particle);
    }

    this.activeEffects.set(id, effect);
    return id;
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
    const localY = getTerrainHeight(lat, lon) ?? 0;
    return this.spawnFireAtLocalY(lat, lon, localY + heightOffset, intensity);
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
    // Get X/Z from geo, but use provided localY directly
    const localXZ = this.sync.geoToLocalSimple(lat, lon, 0);
    const localPos = new Vector3(localXZ.x, localY, localXZ.z);

    const id = `fire_${this.effectIdCounter++}`;

    // Fire intensity config - all use duration: -1 for persistent fire
    const intensityConfig = {
      tiny: { count: 15, radius: 1.5 },
      small: { count: 40, radius: 2.5 },
      medium: { count: 80, radius: 4 },
      large: { count: 120, radius: 6 },
      inferno: { count: 200, radius: 10 },
    };

    const config = intensityConfig[intensity];

    const effect: EffectInstance = {
      id,
      type: 'fire',
      particles: [],
      startTime: performance.now(),
      duration: -1, // All fires are now persistent until stopped
      localPosition: localPos.clone(),
    };

    // Store radius in effect for respawning (using a custom property)
    (effect as EffectInstance & { radius: number }).radius = config.radius;

    // Use trailPoolAdditive for better visuals (per-particle colors, shader support)
    for (let i = 0; i < config.count; i++) {
      const particle = this.pools.getInactiveParticle('trailAdditive');
      if (!particle) break;

      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * config.radius;

      particle.position.copy(localPos);
      particle.position.x += Math.cos(angle) * radius;
      particle.position.z += Math.sin(angle) * radius;

      particle.velocity.set(
        (Math.random() - 0.5) * 2,
        3 + Math.random() * 5, // Upward
        (Math.random() - 0.5) * 2
      );
      particle.life = 1.0;
      particle.maxLife = 0.4 + Math.random() * 0.8;
      particle.size = 1.5 + Math.random() * 2.5; // Bigger particles

      // Fire colors - yellow core, orange mid, red edges
      const t = Math.random();
      if (t < 0.3) {
        particle.color.setRGB(1, 0.9, 0.3); // Yellow core
      } else if (t < 0.7) {
        particle.color.setRGB(1, 0.5, 0.1); // Orange
      } else {
        particle.color.setRGB(1, 0.2, 0.05); // Red edges
      }

      effect.particles.push(particle);
    }

    this.activeEffects.set(id, effect);
    return id;
  }

  /**
   * Stop a fire effect
   */
  stopFire(id: string): void {
    const effect = this.activeEffects.get(id);
    if (effect && effect.type === 'fire') {
      // Set duration to fade out quickly
      effect.duration = 500;
      effect.startTime = performance.now();
    }
  }

  /**
   * Stop all fire effects
   */
  stopAllFires(): void {
    for (const [, effect] of this.activeEffects) {
      if (effect.type === 'fire') {
        effect.duration = 500;
        effect.startTime = performance.now();
      }
    }
  }

  /**
   * Stop a fire effect immediately (no fade)
   */
  stopFireImmediate(id: string): void {
    const effect = this.activeEffects.get(id);
    if (effect && effect.type === 'fire') {
      // Kill all particles immediately
      for (const p of effect.particles) {
        p.life = 0;
      }
      this.activeEffects.delete(id);
    }
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
    const particle = this.pools.getInactiveParticle('trailAdditive');
    if (!particle) return;

    particle.position.copy(position);
    particle.velocity.copy(velocity);
    particle.color.copy(color);
    particle.size = size;
    particle.life = 1.0;
    particle.maxLife = maxLife;
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
    const count = 3 + Math.floor(Math.random() * 3); // 3-5 particles

    for (let i = 0; i < count; i++) {
      const particle = this.pools.getInactiveParticle('trailAdditive');
      if (!particle) break;

      // Spawn at shoot position with tiny random jitter
      particle.position.set(
        localX + (Math.random() - 0.5) * 0.3,
        localY + (Math.random() - 0.5) * 0.3,
        localZ + (Math.random() - 0.5) * 0.3
      );

      // Small outward burst velocity
      particle.velocity.set(
        (Math.random() - 0.5) * 4,
        Math.random() * 3,
        (Math.random() - 0.5) * 4
      );

      particle.life = 1.0;
      particle.maxLife = 0.04 + Math.random() * 0.02; // 40-60ms (~50ms)
      particle.size = 1.5 + Math.random() * 1.5; // 1.5-3.0 — bright and visible

      // Bright yellow/white flash color
      const t = Math.random();
      if (t < 0.5) {
        particle.color.setRGB(1, 1, 0.85); // White-yellow
      } else {
        particle.color.setRGB(1, 0.9, 0.4); // Warm yellow
      }
    }
  }

  /**
   * Spawn scaled permanent fire (for HP 1-50%)
   * @param scale - 0.0 (small) to 1.0 (maximum inferno)
   */
  spawnScaledFire(lat: number, lon: number, localY: number, scale: number): string {
    const localXZ = this.sync.geoToLocalSimple(lat, lon, 0);
    const localPos = new Vector3(localXZ.x, localY, localXZ.z);

    const id = `fire_${this.effectIdCounter++}`;

    // Scale parameters: small fire at scale=0, massive inferno at scale=1
    const clampedScale = Math.max(0, Math.min(1, scale));
    const particleCount = Math.floor(30 + clampedScale * 200); // 30-230 particles
    const fireRadius = 1.5 + clampedScale * 10; // 1.5-11.5 meters

    const effect: EffectInstance = {
      id,
      type: 'fire',
      particles: [],
      startTime: performance.now(),
      duration: -1, // Persistent
      localPosition: localPos.clone(),
    };

    (effect as EffectInstance & { radius: number }).radius = fireRadius;

    for (let i = 0; i < particleCount; i++) {
      const particle = this.pools.getInactiveParticle('trailAdditive');
      if (!particle) break;

      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * fireRadius;

      particle.position.copy(localPos);
      particle.position.x += Math.cos(angle) * radius;
      particle.position.z += Math.sin(angle) * radius;

      particle.velocity.set(
        (Math.random() - 0.5) * 2,
        3 + Math.random() * 5,
        (Math.random() - 0.5) * 2
      );
      particle.life = 1.0;
      particle.maxLife = 0.4 + Math.random() * 0.8;
      particle.size = 1.5 + Math.random() * 2.5 + clampedScale * 1.5; // Bigger at higher scale

      // Fire colors
      const t = Math.random();
      if (t < 0.3) {
        particle.color.setRGB(1, 0.9, 0.3);
      } else if (t < 0.7) {
        particle.color.setRGB(1, 0.5, 0.1);
      } else {
        particle.color.setRGB(1, 0.2, 0.05);
      }

      effect.particles.push(particle);
    }

    this.activeEffects.set(id, effect);
    return id;
  }

  /**
   * Scale up an existing fire to inferno level
   * Adds more particles to the existing fire effect
   */
  scaleFireToInferno(fireId: string): void {
    const effect = this.activeEffects.get(fireId);
    if (!effect || effect.type !== 'fire') {
      console.warn('[Effects] Cannot scale fire - not found:', fireId);
      return;
    }

    const localPos = effect.localPosition;
    const currentRadius = (effect as EffectInstance & { radius: number }).radius || 5;

    // Increase radius to inferno level
    const infernoRadius = Math.max(currentRadius, 15);
    (effect as EffectInstance & { radius: number }).radius = infernoRadius;

    // Add more particles to reach inferno level (~300 total)
    const currentCount = effect.particles.length;
    const targetCount = 300;
    const toAdd = Math.max(0, targetCount - currentCount);

    for (let i = 0; i < toAdd; i++) {
      const particle = this.pools.getInactiveParticle('trailAdditive');
      if (!particle) break;

      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * infernoRadius;

      particle.position.copy(localPos);
      particle.position.x += Math.cos(angle) * radius;
      particle.position.z += Math.sin(angle) * radius;

      particle.velocity.set(
        (Math.random() - 0.5) * 3,
        4 + Math.random() * 8,
        (Math.random() - 0.5) * 3
      );
      particle.life = 1.0;
      particle.maxLife = 0.5 + Math.random() * 1.0;
      particle.size = 2.5 + Math.random() * 4.0;

      const t = Math.random();
      if (t < 0.3) {
        particle.color.setRGB(1, 0.9, 0.3);
      } else if (t < 0.7) {
        particle.color.setRGB(1, 0.5, 0.1);
      } else {
        particle.color.setRGB(1, 0.2, 0.05);
      }

      effect.particles.push(particle);
    }

    console.log('[Effects] Scaled fire to inferno:', fireId, '| Particles:', effect.particles.length);
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
    for (let i = 0; i < count; i++) {
      const particle = this.pools.getInactiveParticle('trailAdditive');
      if (!particle) break;

      // Spawn at rocket position with small random offset
      particle.position.set(
        localX + (Math.random() - 0.5) * 0.5,
        localY + (Math.random() - 0.5) * 0.5,
        localZ + (Math.random() - 0.5) * 0.5
      );

      // Small random velocity (mostly stays in place, drifts slightly)
      particle.velocity.set(
        (Math.random() - 0.5) * 2,
        (Math.random() - 0.5) * 2 - 1, // Slight downward drift
        (Math.random() - 0.5) * 2
      );

      particle.life = 1.0;
      particle.maxLife = 0.3 + Math.random() * 0.3; // 0.3-0.6 seconds
      particle.size = 1.0 + Math.random() * 1.0; // 1-2 size

      // Orange/yellow color with variation
      const t = Math.random();
      particle.color.setRGB(1, 0.4 + t * 0.4, t * 0.2);
    }
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
    const localPos = this.sync.geoToLocal(lat, lon, height);
    this.spawnRocketTrail(localPos.x, localPos.y, localPos.z, count);
  }

  /**
   * Spawn bullet tracer effect at local position
   * Much smaller and faster-fading than rocket trails
   * Uses ADDITIVE blending (bright tracer effect)
   */
  spawnBulletTracer(localX: number, localY: number, localZ: number, count = 1): void {
    for (let i = 0; i < count; i++) {
      const particle = this.pools.getInactiveParticle('trailAdditive');
      if (!particle) break;

      // Spawn at bullet position with tiny random offset
      particle.position.set(
        localX + (Math.random() - 0.5) * 0.1,
        localY + (Math.random() - 0.5) * 0.1,
        localZ + (Math.random() - 0.5) * 0.1
      );

      // Minimal velocity - tracer stays mostly in place
      particle.velocity.set(
        (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 0.5
      );

      particle.life = 1.0;
      particle.maxLife = 0.01 + Math.random() * 0.01; // 0.01-0.02 seconds (instant fade)
      particle.size = 0.03 + Math.random() * 0.02; // 0.03-0.05 size (barely visible)

      // Bright yellow/white tracer color
      particle.color.setRGB(1, 0.95, 0.6);
    }
  }

  /**
   * Spawn bullet tracer at geo coordinates
   */
  spawnBulletTracerAtGeo(lat: number, lon: number, height: number, count = 1): void {
    const localPos = this.sync.geoToLocal(lat, lon, height);
    this.spawnBulletTracer(localPos.x, localPos.y, localPos.z, count);
  }

  /**
   * Spawn subtle cannon smoke at local position
   * Very subtle black/dark grey particles for cannonball trails
   * Uses NORMAL blending (opaque smoke effect)
   */
  spawnCannonSmoke(localX: number, localY: number, localZ: number, count = 1): void {
    for (let i = 0; i < count; i++) {
      const particle = this.pools.getInactiveParticle('trailNormal');
      if (!particle) break;

      // Spawn at cannonball position with small random offset
      particle.position.set(
        localX + (Math.random() - 0.5) * 0.3,
        localY + (Math.random() - 0.5) * 0.3,
        localZ + (Math.random() - 0.5) * 0.3
      );

      // Slow drift upward and outward
      particle.velocity.set(
        (Math.random() - 0.5) * 1.5,
        0.5 + Math.random() * 1.0, // Drift upward
        (Math.random() - 0.5) * 1.5
      );

      particle.life = 1.0;
      particle.maxLife = 0.3 + Math.random() * 0.4; // 0.3-0.7 seconds
      particle.size = 0.4 + Math.random() * 0.4; // Small particles

      // Dark grey/black smoke color
      const grey = 0.1 + Math.random() * 0.15; // 0.1-0.25 (very dark)
      particle.color.setRGB(grey, grey, grey);
    }
  }

  /**
   * Spawn cannon smoke at geo coordinates
   */
  spawnCannonSmokeAtGeo(lat: number, lon: number, height: number, count = 1): void {
    const localPos = this.sync.geoToLocal(lat, lon, height);
    this.spawnCannonSmoke(localPos.x, localPos.y, localPos.z, count);
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
    // Check spawn chance
    if (Math.random() > config.spawnChance) return;

    // Choose pool based on blending mode (default: additive for backwards compatibility)
    const poolKey = config.blending === 'normal' ? 'trailNormal' as const : 'trailAdditive' as const;

    // Spiral trail type: railgun-style rotating particles
    if (config.trailType === 'spiral') {
      const radius = config.spiralRadius ?? 1.0;
      const speed = config.spiralSpeed ?? 3.0;
      const angleStep = (Math.PI * 2) / Math.max(config.countPerSpawn, 1);

      for (let i = 0; i < config.countPerSpawn; i++) {
        const particle = this.pools.getInactiveParticle(poolKey);
        if (!particle) break;

        // Calculate spiral position around the projectile path
        const angle = this.spiralAngle + i * angleStep;
        const offsetX = Math.cos(angle) * radius;
        const offsetY = Math.sin(angle) * radius;

        particle.position.set(
          localX + offsetX,
          localY + offsetY,
          localZ
        );

        // Outward velocity from center (creates expanding spiral)
        const outwardSpeed = 2.0;
        particle.velocity.set(
          Math.cos(angle) * outwardSpeed,
          Math.sin(angle) * outwardSpeed,
          0
        );

        particle.life = 1.0;
        particle.maxLife =
          config.lifetimeMin + Math.random() * (config.lifetimeMax - config.lifetimeMin);
        particle.size = config.sizeMin + Math.random() * (config.sizeMax - config.sizeMin);

        // Interpolate between min and max color
        const t = Math.random();
        particle.color.setRGB(
          config.colorMin.r + t * (config.colorMax.r - config.colorMin.r),
          config.colorMin.g + t * (config.colorMax.g - config.colorMin.g),
          config.colorMin.b + t * (config.colorMax.b - config.colorMin.b)
        );
      }

      // Advance spiral angle for next frame
      this.spiralAngle += speed * 0.016; // Assuming ~60fps
      return;
    }

    // Default trail type: random dispersion
    for (let i = 0; i < config.countPerSpawn; i++) {
      const particle = this.pools.getInactiveParticle(poolKey);
      if (!particle) break;

      // Spawn at position with configurable offset
      particle.position.set(
        localX + (Math.random() - 0.5) * config.spawnOffset,
        localY + (Math.random() - 0.5) * config.spawnOffset,
        localZ + (Math.random() - 0.5) * config.spawnOffset
      );

      // Configurable velocity
      particle.velocity.set(
        config.velocityX.min + Math.random() * (config.velocityX.max - config.velocityX.min),
        config.velocityY.min + Math.random() * (config.velocityY.max - config.velocityY.min),
        config.velocityZ.min + Math.random() * (config.velocityZ.max - config.velocityZ.min)
      );

      particle.life = 1.0;
      particle.maxLife =
        config.lifetimeMin + Math.random() * (config.lifetimeMax - config.lifetimeMin);
      particle.size = config.sizeMin + Math.random() * (config.sizeMax - config.sizeMin);

      // Interpolate between min and max color
      const t = Math.random();
      particle.color.setRGB(
        config.colorMin.r + t * (config.colorMax.r - config.colorMin.r),
        config.colorMin.g + t * (config.colorMax.g - config.colorMin.g),
        config.colorMin.b + t * (config.colorMax.b - config.colorMin.b)
      );
    }
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
    const localPos = this.sync.geoToLocal(lat, lon, height);
    this.spawnConfigurableTrail(localPos.x, localPos.y, localPos.z, config);
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
    const totalAtlasFrames = this.pools.ATLAS_COLS * this.pools.ATLAS_ROWS; // 16 frames

    for (let i = 0; i < count; i++) {
      const particle = this.pools.getInactiveParticle('trailAdditive');
      if (!particle) break;

      // Spawn at impact position
      particle.position.set(localX, localY, localZ);

      // Random direction outward (spherical distribution)
      const theta = Math.random() * Math.PI * 2; // Horizontal angle
      const phi = Math.random() * Math.PI; // Vertical angle
      const speed = 5 + Math.random() * 15; // 5-20 m/s outward

      particle.velocity.set(
        Math.sin(phi) * Math.cos(theta) * speed,
        Math.cos(phi) * speed * 0.5 + 2, // Bias upward slightly
        Math.sin(phi) * Math.sin(theta) * speed
      );

      particle.life = 1.0;
      particle.maxLife = 0.3 + Math.random() * 0.4; // 0.3-0.7 seconds (slightly longer for animation)
      particle.size = 2.5 + Math.random() * 3.0; // Bigger to show atlas detail (2.5-5.5)

      // Sprite-sheet animation: each particle starts at a random early frame
      // so the explosion looks varied (not all particles on same frame)
      particle.frameIndex = Math.floor(Math.random() * 3); // Start at frame 0-2
      particle.totalFrames = totalAtlasFrames;

      // Tint color (white = use atlas color as-is, slight variation adds richness)
      const t = Math.random();
      if (t < 0.4) {
        particle.color.setRGB(1, 1, 1); // Pure atlas color
      } else if (t < 0.7) {
        particle.color.setRGB(1, 0.9, 0.7); // Warm tint
      } else {
        particle.color.setRGB(1, 0.7, 0.5); // Orange tint
      }
    }
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
    const localPos = this.sync.geoToLocal(lat, lon, height);
    this.spawnExplosion(localPos.x, localPos.y, localPos.z, count);
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
    for (let i = 0; i < count; i++) {
      const particle = this.pools.getInactiveParticle('trailAdditive');
      if (!particle) break;

      // Spawn at impact position
      particle.position.set(localX, localY, localZ);

      // Random direction outward (spherical distribution)
      const theta = Math.random() * Math.PI * 2; // Horizontal angle
      const phi = Math.random() * Math.PI; // Vertical angle
      const speed = 5 + Math.random() * 15;

      particle.velocity.set(
        Math.sin(phi) * Math.cos(theta) * speed,
        Math.cos(phi) * speed * 0.5 + 2, // Bias upward
        Math.sin(phi) * Math.sin(theta) * speed
      );

      particle.life = 1.0;
      particle.maxLife = 0.4 + Math.random() * 0.5; // 0.4-0.9 seconds (longer visible)
      particle.size = 1.5 + Math.random() * 2.0; // Larger particles

      // Very bright ice colors (more white/cyan)
      const t = Math.random();
      if (t < 0.4) {
        // Pure white core
        particle.color.setRGB(1.0, 1.0, 1.0);
      } else if (t < 0.7) {
        // Very light cyan
        particle.color.setRGB(0.9, 0.98, 1.0);
      } else {
        // Light ice blue
        particle.color.setRGB(0.8, 0.95, 1.0);
      }
    }
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
    const localPos = this.sync.geoToLocal(lat, lon, height);
    this.spawnIceExplosion(localPos.x, localPos.y, localPos.z, count);
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
    if (!this.iceDecalManager) {
      console.warn('[ThreeEffectsRenderer] Ice decal manager not initialized');
      return '';
    }

    const localPos = this.sync.geoToLocal(lat, lon, height);
    localPos.y += ICE_DECAL_CONFIG.heightOffset;

    const id = `ice_decal_${this.decalIdCounter++}`;
    const now = performance.now();

    // Random rotation for variety
    const rotation = Math.random() * Math.PI * 2;

    // Apply size with randomness
    const baseSize = size * (0.8 + Math.random() * 0.4);

    // Randomize color slightly (very light cyan/white variations) - from config
    const colorVariation = Math.random() * ICE_DECAL_CONFIG.colorVariation;
    const color = new Color(
      ICE_DECAL_CONFIG.baseColor.r + colorVariation,
      ICE_DECAL_CONFIG.baseColor.g + colorVariation * 0.5,
      ICE_DECAL_CONFIG.baseColor.b
    );

    // If pool is full, remove oldest decal
    if (this.iceDecalManager.count >= this.MAX_ICE_DECALS) {
      const instances = this.iceDecalManager.getAllInstances();
      if (instances.length > 0) {
        let oldest = instances[0];
        for (const inst of instances) {
          if (inst.spawnTime < oldest.spawnTime) {
            oldest = inst;
          }
        }
        this.iceDecalManager.remove(oldest.id);
      }
    }

    // Add new decal instance
    this.iceDecalManager.add(
      id,
      localPos,
      baseSize,
      rotation,
      color,
      ICE_DECAL_CONFIG.baseOpacity,
      now,
      this.ICE_DECAL_FADE_DELAY,
      this.ICE_DECAL_FADE_DURATION
    );

    return id;
  }

  /**
   * Update all active effects, decals, and trail particle pools.
   *
   * Covers steps 1-5 of the original update() pipeline: activeEffects loop,
   * blood decal fading, ice decal fading, and both trail-pool update loops.
   *
   * @param dt - Delta time in seconds
   * @param now - Current timestamp from performance.now()
   */
  update(dt: number, now: number): void {
    const gravity = -9.8;

    // Update effects and remove expired ones
    for (const [id, effect] of this.activeEffects) {
      const elapsed = now - effect.startTime;

      // Check if effect expired
      if (effect.duration > 0 && elapsed > effect.duration) {
        // Return particles to pool
        for (const p of effect.particles) {
          p.life = 0;
        }
        this.activeEffects.delete(id);
        continue;
      }

      // Update particles
      for (const particle of effect.particles) {
        if (particle.life <= 0) continue;

        // Update position (reuse temp vector to avoid GC)
        particle.position.add(this.tempVelocity.copy(particle.velocity).multiplyScalar(dt));

        // Apply gravity (blood falls, fire rises)
        if (effect.type === 'blood') {
          particle.velocity.y += gravity * dt;
        }

        // Decay life
        particle.life -= dt / particle.maxLife;

        // Respawn fire particles (all fires are now persistent with duration: -1)
        if (effect.type === 'fire' && particle.life <= 0 && effect.duration < 0) {
          // Use stored radius or default to 5
          const fireRadius = (effect as EffectInstance & { radius?: number }).radius ?? 5;
          const angle = Math.random() * Math.PI * 2;
          const radius = Math.random() * fireRadius;

          particle.position.copy(effect.localPosition);
          particle.position.x += Math.cos(angle) * radius;
          particle.position.z += Math.sin(angle) * radius;

          particle.velocity.set(
            (Math.random() - 0.5) * 2,
            3 + Math.random() * 5,
            (Math.random() - 0.5) * 2
          );
          particle.life = 1.0;
          particle.maxLife = 0.4 + Math.random() * 0.8;
          particle.size = 1.5 + Math.random() * 2.5;
          particle.frameIndex = -1; // Fire uses circular particles
          particle.totalFrames = 0;

          // Fire colors on respawn
          const t = Math.random();
          if (t < 0.3) {
            particle.color.setRGB(1, 0.9, 0.3);
          } else if (t < 0.7) {
            particle.color.setRGB(1, 0.5, 0.1);
          } else {
            particle.color.setRGB(1, 0.2, 0.05);
          }
        }
      }
    }

    // Update blood decals (fading) - INSTANCED
    if (this.bloodDecalManager) {
      const instances = this.bloodDecalManager.getAllInstances();
      for (const instance of instances) {
        if (!instance.active) continue;

        const elapsed = now - instance.fadeStartTime;

        if (elapsed > 0) {
          // Calculate fade progress (0-1)
          const fadeProgress = Math.min(elapsed / instance.fadeDuration, 1);
          const opacity = BLOOD_DECAL_CONFIG.baseOpacity * (1 - fadeProgress);

          this.bloodDecalManager.updateOpacity(instance.id, opacity);

          // Remove when fully faded
          if (fadeProgress >= 1) {
            this.bloodDecalManager.remove(instance.id);
          }
        }
      }
    }

    // Update ice decals (faster fading) - INSTANCED
    if (this.iceDecalManager) {
      const instances = this.iceDecalManager.getAllInstances();
      for (const instance of instances) {
        if (!instance.active) continue;

        const elapsed = now - instance.fadeStartTime;

        if (elapsed > 0) {
          // Calculate fade progress (0-1)
          const fadeProgress = Math.min(elapsed / instance.fadeDuration, 1);
          const opacity = ICE_DECAL_CONFIG.baseOpacity * (1 - fadeProgress);

          this.iceDecalManager.updateOpacity(instance.id, opacity);

          // Remove when fully faded
          if (fadeProgress >= 1) {
            this.iceDecalManager.remove(instance.id);
          }
        }
      }
    }

    // Update trail particles - ADDITIVE pool (skip when idle)
    if (this.pools.isPoolActive('trailAdditive')) {
      for (const particle of this.pools.getPool('trailAdditive')) {
        if (particle.life <= 0) continue;
        particle.position.add(this.tempVelocity.copy(particle.velocity).multiplyScalar(dt));
        particle.life -= dt / particle.maxLife;
      }
    }

    // Update trail particles - NORMAL pool (skip when idle)
    if (this.pools.isPoolActive('trailNormal')) {
      for (const particle of this.pools.getPool('trailNormal')) {
        if (particle.life <= 0) continue;
        particle.position.add(this.tempVelocity.copy(particle.velocity).multiplyScalar(dt));
        particle.life -= dt / particle.maxLife;
      }
    }
  }

  /**
   * Clear all active effects and instanced decals.
   * (Particle-effects part of ThreeEffectsRenderer.clear() — the pool
   * particles themselves are killed by ParticlePoolManager.reset().)
   */
  clear(): void {
    this.activeEffects.clear();

    // Clear instanced decals
    if (this.bloodDecalManager) {
      this.bloodDecalManager.clear();
    }
    if (this.iceDecalManager) {
      this.iceDecalManager.clear();
    }
  }

  /**
   * Dispose resources — remove decal managers from the scene and dispose them.
   */
  dispose(): void {
    // Dispose instanced decal managers
    if (this.bloodDecalManager) {
      this.scene.remove(this.bloodDecalManager.instancedMesh);
      this.bloodDecalManager.dispose();
    }
    if (this.iceDecalManager) {
      this.scene.remove(this.iceDecalManager.instancedMesh);
      this.iceDecalManager.dispose();
    }
  }
}
