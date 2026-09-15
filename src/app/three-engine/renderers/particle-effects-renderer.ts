import { Vector3, Color, Scene, type IUniform } from 'three';
import { CoordinateSync } from './index';
import { TrailParticleConfig } from '../../configs/projectile-types.config';
import {
  BURST_PALETTES,
  type BurstPalette,
  EXPLOSION_LOOK,
  FIRE_INTENSITY,
  type FireIntensityLevel,
  type MuzzleFlashProfile,
} from '../../configs/visual-effects.config';
import type { ScorchSource } from '../../configs/visual-effects.config';
import type { VfxSettings } from '../vfx-settings';
import type { ScorchGround } from './scorch-marks';
import { GroundDecals, type GooSplash } from './ground-decals';
import { igniteFireParticle, setFireColor } from './fire-particles';
import { ParticlePoolManager, type Particle } from './particle-pool-manager';
import {
  emitColorBurst,
  emitConfigurableTrail,
  emitExplosion,
  emitFlameParticle,
  emitMuzzleFlash,
  emitPortalSparks,
} from './particle-emitters';

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
  /** Fires: radius the particles are lit in, kept for the respawns. */
  radius?: number;
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
 * Split out of three-effects.renderer.ts. Owns the ground marks (GroundDecals)
 * and borrows GPU particles from the ParticlePoolManager (trail additive /
 * normal pools). Handles blood splatter, fire, muzzle flashes, configurable
 * trails, explosions, ice/arcane bursts, and the persistent-fire respawn logic.
 */
export class ParticleEffectsRenderer {
  // Active effects
  private activeEffects = new Map<string, EffectInstance>();
  private effectIdCounter = 0;

  // Blood, ice and scorch marks on the ground (GPU instancing for performance)
  private readonly decals: GroundDecals;

  // Effects the VFX settings switched off are not spawned (setVfxSettings)
  private muzzleFlashes = true;
  private trailParticles = true;
  private impacts = true;
  private groundMarks = true;
  /** No new ground marks while set, the ones lying stay (holdGroundMarks) */
  private groundMarksHeld = false;

  // Spiral angle tracker for railgun effect (uses time-based rotation)
  private spiralAngle = 0;

  // Reusable temp vector for particle updates (avoids GC pressure)
  private readonly tempVelocity = new Vector3();

  constructor(
    scene: Scene,
    private readonly sync: CoordinateSync,
    private readonly pools: ParticlePoolManager,
  ) {
    this.decals = new GroundDecals(scene);
  }

  /**
   * Spawn blood splatter effect at a position. Nothing while impact effects
   * are off (VFX settings).
   *
   * @param lat - Latitude
   * @param lon - Longitude
   * @param height - Height above ground
   * @param count - Number of particles (default 20)
   * @param color - Colour as hex (EnemyTypeConfig.bloodColor), red when unset
   */
  spawnBloodSplatter(lat: number, lon: number, height: number, count = 20, color?: number): string {
    if (!this.impacts) return '';
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
      const shade = 0.7 + Math.random() * 0.3;
      if (color === undefined) particle.color.setRGB(shade, 0, 0);
      else particle.color.setHex(color).multiplyScalar(shade);

      effect.particles.push(particle);
    }

    this.activeEffects.set(id, effect);
    return id;
  }

  /**
   * Spawn a persistent blood decal on the ground
   * NOW USES GPU INSTANCING - much better performance!
   * Nothing while ground marks are off (VFX settings).
   *
   * @param lat - Latitude
   * @param lon - Longitude
   * @param height - Height (terrain height)
   * @param size - Diameter of the round decal in meters, ±20 % (default 2.0)
   * @param color - Colour as hex (EnemyTypeConfig.bloodColor), dark red when unset
   * @returns Decal ID
   */
  spawnBloodDecal(lat: number, lon: number, height: number, size = 2.0, color?: number): string {
    if (!this.laysGroundMarks) return '';
    return this.decals.layBlood(this.sync.geoToLocal(lat, lon, height), size, color);
  }

  /**
   * A killed ooze's splash on the ground, in the goo pool
   * (GroundDecals.layGoo). Nothing while ground marks are off or held.
   * @returns Decal ID
   */
  spawnGooDecal(lat: number, lon: number, height: number, splash: Readonly<GooSplash>): string {
    if (!this.laysGroundMarks) return '';
    return this.decals.layGoo(this.sync.geoToLocal(lat, lon, height), splash);
  }

  /**
   * Spawn fire effect at a position
   *
   * @param lat - Latitude
   * @param lon - Longitude
   * @param height - Height above ground
   * @param intensity - Fire intensity (FIRE_INTENSITY)
   */
  spawnFire(
    lat: number,
    lon: number,
    height: number,
    intensity: FireIntensityLevel = 'medium'
  ): string {
    const localPos = this.sync.geoToLocal(lat, lon, height);
    const { count, radius } = FIRE_INTENSITY[intensity];
    return this.startFire(localPos, count, radius, 0);
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
    intensity: FireIntensityLevel = 'medium',
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
    intensity: FireIntensityLevel = 'medium'
  ): string {
    // Get X/Z from geo, but use provided localY directly
    const localXZ = this.sync.geoToLocalSimple(lat, lon, 0);
    const localPos = new Vector3(localXZ.x, localY, localXZ.z);
    const { count, radius } = FIRE_INTENSITY[intensity];
    return this.startFire(localPos, count, radius, 0);
  }

  /**
   * Start a fire at a local position: `count` particles from the additive
   * pool (per-particle colours, shader support), lit within `radius`, each
   * `sizeBonus` bigger than a plain fire's. It burns (duration -1) until
   * stopFire() gives it a duration, relighting its burnt-out particles.
   */
  private startFire(localPos: Vector3, count: number, radius: number, sizeBonus: number): string {
    const id = `fire_${this.effectIdCounter++}`;

    const effect: EffectInstance = {
      id,
      type: 'fire',
      particles: [],
      startTime: performance.now(),
      duration: -1, // All fires are now persistent until stopped
      localPosition: localPos.clone(),
      radius, // For respawning
    };

    for (let i = 0; i < count; i++) {
      const particle = this.pools.getInactiveParticle('trailAdditive');
      if (!particle) break;
      igniteFireParticle(particle, localPos, radius, sizeBonus);
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
    emitFlameParticle(this.pools, position, velocity, color, size, maxLife);
  }

  /**
   * Spawn a brief muzzle flash at a local position: a few bright additive
   * particles (yellow/white), count, size and lifetime from the tower's
   * MUZZLE_FLASH_PROFILES entry. Nothing while muzzle flashes are off (VFX
   * settings).
   *
   * @param localX - Local X coordinate (tower shoot position)
   * @param localY - Local Y coordinate (tower shoot position)
   * @param localZ - Local Z coordinate (tower shoot position)
   * @param profile - The firing tower's muzzle flash profile
   */
  spawnMuzzleFlash(localX: number, localY: number, localZ: number, profile: MuzzleFlashProfile): void {
    if (!this.muzzleFlashes) return;
    emitMuzzleFlash(this.pools, localX, localY, localZ, profile);
  }

  /**
   * Spawn scaled permanent fire (for HP 1-50%)
   * @param scale - 0.0 (small) to 1.0 (maximum inferno)
   */
  spawnScaledFire(lat: number, lon: number, localY: number, scale: number): string {
    const localXZ = this.sync.geoToLocalSimple(lat, lon, 0);
    const localPos = new Vector3(localXZ.x, localY, localXZ.z);

    // Scale parameters: small fire at scale=0, massive inferno at scale=1
    const clampedScale = Math.max(0, Math.min(1, scale));
    const particleCount = Math.floor(30 + clampedScale * 200); // 30-230 particles
    const fireRadius = 1.5 + clampedScale * 10; // 1.5-11.5 meters
    // Bigger particles at higher scale
    return this.startFire(localPos, particleCount, fireRadius, clampedScale * 1.5);
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
    const currentRadius = effect.radius || 5;

    // Increase radius to inferno level
    const infernoRadius = Math.max(currentRadius, 15);
    effect.radius = infernoRadius;

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

      setFireColor(particle);

      effect.particles.push(particle);
    }
  }

  /**
   * Spawn configurable trail particles based on TrailParticleConfig
   * Generic method that uses config values instead of hardcoded parameters
   * Automatically chooses additive or normal blending pool based on config.blending
   * Supports 'spiral' trailType for railgun-style rotating particles
   * Nothing while projectile trails are off (VFX settings).
   */
  spawnConfigurableTrail(
    localX: number,
    localY: number,
    localZ: number,
    config: TrailParticleConfig
  ): void {
    if (!this.trailParticles) return;
    this.spiralAngle = emitConfigurableTrail(this.pools, localX, localY, localZ, config, this.spiralAngle);
  }

  /**
   * Spawn a fire-atlas explosion at a local position, in two stages
   * (EXPLOSION_LOOK): a fireball of additive explosion-atlas sprites, then
   * `smokePuffs` smoke-atlas puffs in the normal pool that show up once the
   * fireball's bright half is over. Speeds and sprite sizes scale with
   * `radius`. Nothing while impact effects are off (VFX settings).
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
    if (!this.impacts) return;
    emitExplosion(this.pools, localX, localY, localZ, count, radius, smokePuffs);
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
   * Spawn an impact spark burst at geo coordinates: the ice burst's motion in
   * the given palette, so the magic, chaos and poison hits do not read as the
   * fire-atlas explosion the other impacts use.
   *
   * @param lat - Latitude
   * @param lon - Longitude
   * @param height - Height above ground
   * @param count - Number of particles
   * @param palette - Burst colours, see BURST_PALETTES
   */
  spawnBurstAtGeo(lat: number, lon: number, height: number, count: number, palette: BurstPalette): void {
    const localPos = this.sync.geoToLocal(lat, lon, height);
    this.spawnColorBurst(localPos.x, localPos.y, localPos.z, count, palette);
  }

  /**
   * Round additive particles bursting outward from a point, coloured from a
   * three-colour palette. Shared by the ice, arcane, chaos and poison impacts.
   * Nothing while impact effects are off (VFX settings).
   */
  private spawnColorBurst(
    localX: number,
    localY: number,
    localZ: number,
    count: number,
    palette: BurstPalette
  ): void {
    if (!this.impacts) return;
    emitColorBurst(this.pools, localX, localY, localZ, count, palette);
  }

  /**
   * Sparks thrown out of a spawn portal's surface when an enemy steps
   * through. The portal plane stands on (x, y, z) in local space, facing
   * (forwardX, forwardZ), the way the enemies walk; the sparks start across
   * the opening and fly out along the facing. Additive pool, palette as for
   * the impact bursts. Nothing while impact effects are off (VFX settings).
   */
  spawnPortalSparks(
    x: number,
    y: number,
    z: number,
    forwardX: number,
    forwardZ: number,
    halfWidth: number,
    height: number,
    count: number,
    palette: BurstPalette
  ): void {
    if (!this.impacts) return;
    emitPortalSparks(this.pools, x, y, z, forwardX, forwardZ, halfWidth, height, count, palette);
  }

  /**
   * Spawn ice decal on ground (frost patch)
   * NOW USES GPU INSTANCING - much better performance!
   * Nothing while ground marks are off (VFX settings).
   *
   * @param lat - Latitude
   * @param lon - Longitude
   * @param height - Terrain height
   * @param size - Diameter of the round decal in meters, ±20 % (default 2.8)
   * @returns Decal ID
   */
  spawnIceDecal(lat: number, lon: number, height: number, size = 2.8): string {
    if (!this.laysGroundMarks) return '';
    return this.decals.layIce(this.sync.geoToLocal(lat, lon, height), size);
  }

  /** Route grid the scorch marks sit on; null (the default) leaves none. */
  setScorchGround(ground: ScorchGround | null): void {
    this.decals.setScorchGround(ground);
  }

  /**
   * Burn a scorch mark on the ground below a local hit point. At most one
   * per route cell: a repeat hit darkens that cell's mark instead. Nothing
   * while ground marks are off (VFX settings).
   */
  markScorch(localX: number, localY: number, localZ: number, source: ScorchSource): void {
    if (!this.laysGroundMarks) return;
    this.decals.markScorch(localX, localY, localZ, source, performance.now());
  }

  /**
   * Switch effects on or off (VFX settings). Off means nothing new is
   * spawned; particles already in the air run out within a second or two.
   * Ground marks lie for up to a minute and a half, so switching them off
   * clears them, and their empty pools leave the render list (DrawGate).
   */
  setVfxSettings(settings: VfxSettings): void {
    this.muzzleFlashes = settings.muzzleFlash;
    this.trailParticles = settings.projectileTrails;
    this.impacts = settings.impactEffects;
    if (this.groundMarks && !settings.groundMarks) {
      this.decals.clear();
    }
    this.groundMarks = settings.groundMarks;
  }

  /** Whether ground marks are laid down; callers skip the terrain raycast for a decal otherwise. */
  get groundMarksEnabled(): boolean {
    return this.laysGroundMarks;
  }

  /**
   * Lay no new ground marks while `held`, whatever the VFX settings say;
   * the marks already lying stay. The wave replay holds them: its impacts
   * would mark the live ground a second time.
   */
  holdGroundMarks(held: boolean): void {
    this.groundMarksHeld = held;
  }

  private get laysGroundMarks(): boolean {
    return this.groundMarks && !this.groundMarksHeld;
  }

  /** Blood moon tint of the ground marks, see GroundDecals.setBloodMoon. */
  setBloodMoon(amount: number, linearOutput: boolean): void {
    this.decals.setBloodMoon(amount, linearOutput);
  }

  /** The ground marks' blood moon tint uniform, for marks drawn outside the decal pools (the orbital beam's embers). */
  get groundMarkTint(): IUniform<Vector3> {
    return this.decals.bloodMoonTint;
  }

  /** Whether impact effects are spawned; callers skip the work that only feeds one otherwise. */
  get impactEffectsEnabled(): boolean {
    return this.impacts;
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
        // Return particles to pool. The effect only holds live ones (dead
        // ones are dropped below), so none of them belongs to anyone else.
        for (const p of effect.particles) {
          p.life = 0;
        }
        this.activeEffects.delete(id);
        continue;
      }

      // Fires burn (duration -1) until stopFire() gives them a duration
      const burning = effect.type === 'fire' && effect.duration < 0;
      const particles = effect.particles;
      for (let i = particles.length - 1; i >= 0; i--) {
        const particle = particles[i];
        if (particle.life <= 0) {
          if (burning) {
            this.respawnFireParticle(particle, effect);
          } else {
            // Out for good. Dropped now, before updateBuffers() frees it: a
            // later spawn may take the slot, and the expiry above used to
            // kill that new owner's particle.
            particles[i] = particles[particles.length - 1];
            particles.pop();
          }
          continue;
        }
        // Blood falls, fire rises on its own velocity
        if (effect.type === 'blood') {
          particle.velocity.y += BLOOD_GRAVITY * dt;
        }
      }
    }

    // Fade out blood, ice and scorch decals (idle until the first fade is due)
    this.decals.updateFades(now);
  }

  /** Light a burnt-out particle of a burning fire again, somewhere in its radius. */
  private respawnFireParticle(particle: Particle, effect: EffectInstance): void {
    // Use stored radius or default to 5; speeds and life as in the spawn
    // methods (FIRE_TEMPO note at the top)
    igniteFireParticle(particle, effect.localPosition, effect.radius ?? 5);
    particle.frameIndex = -1; // Fire uses circular particles
    particle.totalFrames = 0;
  }

  /**
   * Clear all active effects and instanced decals.
   * (Particle-effects part of ThreeEffectsRenderer.clear() — the pool
   * particles themselves are killed by ParticlePoolManager.reset().)
   */
  clear(): void {
    this.activeEffects.clear();

    // Clear instanced decals
    this.decals.clear();
  }

  /**
   * Dispose resources — remove decal managers from the scene and dispose them.
   */
  dispose(): void {
    // Dispose instanced decal managers
    this.decals.dispose();
  }
}
