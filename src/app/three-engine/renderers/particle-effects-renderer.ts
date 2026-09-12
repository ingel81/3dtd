import { Vector3, Color, Scene, PlaneGeometry } from 'three';
import { CoordinateSync } from './index';
import { TrailParticleConfig } from '../../configs/projectile-types.config';
import {
  BLOOD_DECAL_CONFIG,
  BURST_PALETTES,
  type BurstPalette,
  EXPLOSION_LOOK,
  ICE_DECAL_CONFIG,
  type MuzzleFlashProfile,
} from '../../configs/visual-effects.config';
import type { ScorchSource } from '../../configs/visual-effects.config';
import { DecalInstanceManager } from './decal-instance.manager';
import { createBloodDecalShader, createIceDecalShader } from './decal-shaders';
import { ScorchMarks, type ScorchGround } from './scorch-marks';
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
 * Gravity on blood splatter particles, m/s².
 *
 * Until 2026-09-12 update() moved and aged the particles an effect tracks
 * (blood splatter, fires) twice per frame. The splatter therefore flew at
 * twice its velocity for half its maxLife, under gravity applied once per
 * frame to a doubled step. Twice the speed, half the life and twice the
 * gravity with a single update draw the same arc, so the numbers now say
 * what the splatter always looked like.
 *
 * FIRE_TEMPO: the fire particles' speeds are doubled and their lifetimes
 * halved for the same reason, so flames rise and flicker at the old pace.
 * What does change is that a burning fire keeps all its particles: the
 * double aging let about half of them die for good every cycle, and a fire
 * was down to nothing within seconds.
 */
const BLOOD_GRAVITY = -19.6;

/**
 * ParticleEffectsRenderer — combat & environment particle effects plus the
 * central activeEffects lifecycle map.
 *
 * Split out of three-effects.renderer.ts. Owns the blood/ice decal managers
 * and borrows GPU particles from the ParticlePoolManager (trail additive /
 * normal pools). Handles blood splatter, fire, muzzle flashes, bullet
 * tracers, cannon smoke, configurable trails, explosions, ice/arcane bursts,
 * and the persistent-fire respawn logic.
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

  // Scorch marks on the route grid (combat heatmap layer 1)
  private scorchMarks: ScorchMarks | null = null;

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

    // Scorch marks, at most one per route cell (SCORCH_DECAL_CONFIG)
    this.scorchMarks = new ScorchMarks(decalGeometry.clone());
    this.scene.add(this.scorchMarks.decals.instancedMesh);

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
      // Twice the speed and half the life of the numbers this used to read,
      // see BLOOD_GRAVITY
      particle.velocity.set(
        (Math.random() - 0.5) * 10,
        Math.random() * 10,
        (Math.random() - 0.5) * 10
      );
      particle.life = 1.0;
      particle.maxLife = 0.5 + Math.random() * 0.25;
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
      this.bloodDecalManager.removeOldest();
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
        (Math.random() - 0.5) * 4,
        6 + Math.random() * 10, // Upward (FIRE_TEMPO note at the top)
        (Math.random() - 0.5) * 4
      );
      particle.life = 1.0;
      particle.maxLife = 0.2 + Math.random() * 0.4;
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
        (Math.random() - 0.5) * 4,
        6 + Math.random() * 10, // Upward (FIRE_TEMPO note at the top)
        (Math.random() - 0.5) * 4
      );
      particle.life = 1.0;
      particle.maxLife = 0.2 + Math.random() * 0.4;
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
   * Spawn a brief muzzle flash at a local position: a few bright additive
   * particles (yellow/white), count, size and lifetime from the tower's
   * MUZZLE_FLASH_PROFILES entry.
   *
   * @param localX - Local X coordinate (tower shoot position)
   * @param localY - Local Y coordinate (tower shoot position)
   * @param localZ - Local Z coordinate (tower shoot position)
   * @param profile - The firing tower's muzzle flash profile
   */
  spawnMuzzleFlash(localX: number, localY: number, localZ: number, profile: MuzzleFlashProfile): void {
    const count = profile.countMin + Math.floor(Math.random() * (profile.countMax - profile.countMin + 1));

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
      particle.maxLife = profile.lifeMin + Math.random() * (profile.lifeMax - profile.lifeMin);
      particle.size = profile.sizeMin + Math.random() * (profile.sizeMax - profile.sizeMin);

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
        (Math.random() - 0.5) * 4,
        6 + Math.random() * 10, // FIRE_TEMPO note at the top
        (Math.random() - 0.5) * 4
      );
      particle.life = 1.0;
      particle.maxLife = 0.2 + Math.random() * 0.4;
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
        (Math.random() - 0.5) * 6,
        8 + Math.random() * 16, // FIRE_TEMPO note at the top
        (Math.random() - 0.5) * 6
      );
      particle.life = 1.0;
      particle.maxLife = 0.25 + Math.random() * 0.5;
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
   * Spawn bullet tracer effect at local position
   * Tiny and fast-fading
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
   * Spawn a fire-atlas explosion at a local position, in two stages
   * (EXPLOSION_LOOK): a fireball of additive explosion-atlas sprites, then
   * `smokePuffs` smoke-atlas puffs in the normal pool that show up once the
   * fireball's bright half is over. Speeds and sprite sizes scale with
   * `radius`.
   *
   * @param localX - Local X coordinate
   * @param localY - Local Y coordinate (height)
   * @param localZ - Local Z coordinate
   * @param count - Fireball particles (default 25)
   * @param radius - Blast radius in meters (default EXPLOSION_LOOK.referenceRadius)
   * @param smokePuffs - Smoke puffs after the fireball (default 0)
   */
  spawnExplosion(
    localX: number,
    localY: number,
    localZ: number,
    count = 25,
    radius: number = EXPLOSION_LOOK.referenceRadius,
    smokePuffs = 0
  ): void {
    const totalAtlasFrames = this.pools.ATLAS_COLS * this.pools.ATLAS_ROWS; // 16 frames
    const scale = radius / EXPLOSION_LOOK.referenceRadius;
    const fire = EXPLOSION_LOOK.fire;

    for (let i = 0; i < count; i++) {
      const particle = this.pools.getInactiveParticle('trailAdditive');
      if (!particle) break;

      // Spawn at impact position
      particle.position.set(localX, localY, localZ);

      // Random direction outward (spherical distribution)
      const theta = Math.random() * Math.PI * 2; // Horizontal angle
      const phi = Math.random() * Math.PI; // Vertical angle
      const speed = (fire.speedMin + Math.random() * (fire.speedMax - fire.speedMin)) * scale;

      particle.velocity.set(
        Math.sin(phi) * Math.cos(theta) * speed,
        Math.cos(phi) * speed * 0.5 + 2, // Bias upward slightly
        Math.sin(phi) * Math.sin(theta) * speed
      );

      particle.life = 1.0;
      particle.maxLife = fire.lifeMin + Math.random() * (fire.lifeMax - fire.lifeMin);
      particle.size = (fire.sizeMin + Math.random() * (fire.sizeMax - fire.sizeMin)) * scale;
      particle.sizeStart = fire.sizeStart;
      particle.sizeEnd = fire.sizeEnd;

      // Sprite-sheet animation: the pool derives the frame from the life
      // (atlasSpriteFrame), flash → fireball → dissipating → wisps
      particle.frameIndex = 0;
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

    this.spawnExplosionSmoke(localX, localY, localZ, smokePuffs, radius, totalAtlasFrames);
  }

  /**
   * Smoke stage of spawnExplosion: dark smoke-atlas puffs in the normal
   * pool. Each waits EXPLOSION_LOOK.smoke.delay* before it shows (its life
   * starts above 1, see atlasSpriteSize), then rises and billows out while
   * the atlas fades it to nothing.
   */
  private spawnExplosionSmoke(
    localX: number,
    localY: number,
    localZ: number,
    count: number,
    radius: number,
    totalAtlasFrames: number
  ): void {
    const smoke = EXPLOSION_LOOK.smoke;
    const scale = radius / EXPLOSION_LOOK.referenceRadius;

    for (let i = 0; i < count; i++) {
      const particle = this.pools.getInactiveParticle('trailNormal');
      if (!particle) break;

      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * smoke.spread * radius;
      particle.position.set(localX + Math.cos(angle) * dist, localY, localZ + Math.sin(angle) * dist);
      particle.velocity.set(
        (Math.random() - 0.5) * 2 * smoke.drift,
        smoke.riseMin + Math.random() * (smoke.riseMax - smoke.riseMin),
        (Math.random() - 0.5) * 2 * smoke.drift
      );

      particle.maxLife = smoke.lifeMin + Math.random() * (smoke.lifeMax - smoke.lifeMin);
      const delay = smoke.delayMin + Math.random() * (smoke.delayMax - smoke.delayMin);
      particle.life = 1 + delay / particle.maxLife;
      particle.size = (smoke.sizeMin + Math.random() * (smoke.sizeMax - smoke.sizeMin)) * scale;
      particle.sizeStart = smoke.sizeStart;
      particle.sizeEnd = smoke.sizeEnd;
      particle.frameIndex = 0;
      particle.totalFrames = totalAtlasFrames;

      const grey = smoke.greyMin + Math.random() * (smoke.greyMax - smoke.greyMin);
      particle.color.setRGB(grey, grey, grey * 0.95);
    }
  }

  /**
   * Spawn explosion at geo coordinates
   * Convenience method that converts geo to local coordinates
   *
   * @param lat - Latitude
   * @param lon - Longitude
   * @param height - Height above ground
   * @param count - Fireball particles (default 25)
   * @param radius - Blast radius in meters (default EXPLOSION_LOOK.referenceRadius)
   * @param smokePuffs - Smoke puffs after the fireball (default 0)
   */
  spawnExplosionAtGeo(
    lat: number,
    lon: number,
    height: number,
    count = 25,
    radius: number = EXPLOSION_LOOK.referenceRadius,
    smokePuffs = 0
  ): void {
    const localPos = this.sync.geoToLocal(lat, lon, height);
    this.spawnExplosion(localPos.x, localPos.y, localPos.z, count, radius, smokePuffs);
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
    this.spawnColorBurst(localX, localY, localZ, count, BURST_PALETTES.ice);
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
   * Spawn the arcane orb impact at geo coordinates: the ice burst's motion
   * in violet/cyan, so the Magic Tower's hit reads as a spell, not as the
   * fire-atlas explosion the other impacts use.
   *
   * @param lat - Latitude
   * @param lon - Longitude
   * @param height - Height above ground
   * @param count - Number of particles
   */
  spawnArcaneBurstAtGeo(lat: number, lon: number, height: number, count: number): void {
    const localPos = this.sync.geoToLocal(lat, lon, height);
    this.spawnColorBurst(localPos.x, localPos.y, localPos.z, count, BURST_PALETTES.arcane);
  }

  /**
   * Spawn the poison glob impact at geo coordinates: the ice burst's motion
   * in greens instead of the fire-atlas explosion.
   *
   * @param lat - Latitude
   * @param lon - Longitude
   * @param height - Height above ground
   * @param count - Number of particles
   */
  spawnPoisonBurstAtGeo(lat: number, lon: number, height: number, count: number): void {
    const localPos = this.sync.geoToLocal(lat, lon, height);
    this.spawnColorBurst(localPos.x, localPos.y, localPos.z, count, BURST_PALETTES.poison);
  }

  /**
   * Round additive particles bursting outward from a point, coloured from a
   * three-colour palette. Shared by the ice and arcane impacts.
   */
  private spawnColorBurst(
    localX: number,
    localY: number,
    localZ: number,
    count: number,
    palette: BurstPalette
  ): void {
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

      const t = Math.random();
      const c = t < 0.4 ? palette[0] : t < 0.7 ? palette[1] : palette[2];
      particle.color.setRGB(c.r, c.g, c.b);
    }
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
      this.iceDecalManager.removeOldest();
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

  /** Route grid the scorch marks sit on; null (the default) leaves none. */
  setScorchGround(ground: ScorchGround | null): void {
    this.scorchMarks?.setGround(ground);
  }

  /**
   * Burn a scorch mark on the ground below a local hit point. At most one
   * per route cell: a repeat hit darkens that cell's mark instead.
   */
  markScorch(localX: number, localY: number, localZ: number, source: ScorchSource): void {
    this.scorchMarks?.mark(localX, localY, localZ, source, performance.now());
  }

  /**
   * Update trail particle pools, active effects and decals.
   *
   * The pool pass moves and ages every live particle once, the ones an
   * effect tracks included. The effect pass after it only adds what an
   * effect needs on top: gravity for blood, respawn for burning fires,
   * expiry. Until 2026-09-12 the effect pass moved and aged its particles a
   * second time (see BLOOD_GRAVITY).
   *
   * @param dt - Delta time in seconds
   * @param now - Current timestamp from performance.now()
   */
  update(dt: number, now: number): void {
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

    // Effect rules and expiry. After the pool pass, so a fire particle that
    // just burnt out is lit again before updateBuffers() frees it: it used to
    // die in the second aging, go back to the pool, and the fire thinned out.
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

      // Fires burn (duration -1) until stopFire() gives them a duration
      const burning = effect.type === 'fire' && effect.duration < 0;
      for (const particle of effect.particles) {
        if (particle.life <= 0) {
          if (burning) this.respawnFireParticle(particle, effect);
          continue;
        }
        // Blood falls, fire rises on its own velocity
        if (effect.type === 'blood') {
          particle.velocity.y += BLOOD_GRAVITY * dt;
        }
      }
    }

    // Fade out blood, ice and scorch decals (idle until the first fade is due)
    this.bloodDecalManager?.updateFades(now);
    this.iceDecalManager?.updateFades(now);
    this.scorchMarks?.updateFades(now);
  }

  /** Light a burnt-out particle of a burning fire again, somewhere in its radius. */
  private respawnFireParticle(particle: Particle, effect: EffectInstance): void {
    // Use stored radius or default to 5
    const fireRadius = (effect as EffectInstance & { radius?: number }).radius ?? 5;
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * fireRadius;

    particle.position.copy(effect.localPosition);
    particle.position.x += Math.cos(angle) * radius;
    particle.position.z += Math.sin(angle) * radius;

    // Speeds and life as in the spawn methods (FIRE_TEMPO note at the top)
    particle.velocity.set(
      (Math.random() - 0.5) * 4,
      6 + Math.random() * 10,
      (Math.random() - 0.5) * 4
    );
    particle.life = 1.0;
    particle.maxLife = 0.2 + Math.random() * 0.4;
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
    this.scorchMarks?.clear();
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
    if (this.scorchMarks) {
      this.scene.remove(this.scorchMarks.decals.instancedMesh);
      this.scorchMarks.dispose();
    }
  }
}
