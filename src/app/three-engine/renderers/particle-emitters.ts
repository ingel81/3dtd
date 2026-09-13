import type { Color, Vector3 } from 'three';
import type { TrailParticleConfig } from '../../configs/projectile-types.config';
import { EXPLOSION_LOOK, type BurstPalette, type MuzzleFlashProfile } from '../../configs/visual-effects.config';
import type { ParticlePoolManager } from './particle-pool-manager';

/**
 * One-shot particle emitters: each takes particles from the pools, sets them
 * going and forgets them; the pool pass in ParticleEffectsRenderer.update()
 * moves and ages them. The renderer gates them by the VFX settings and
 * converts geo positions; these only know local coordinates.
 */

/**
 * Emit a single flame particle for beam effects.
 * Used by FlameBeamRenderer for flamethrower streams.
 */
export function emitFlameParticle(
  pools: ParticlePoolManager,
  position: Vector3,
  velocity: Vector3,
  color: Color,
  size: number,
  maxLife: number
): void {
  const particle = pools.getInactiveParticle('trailAdditive');
  if (!particle) return;

  particle.position.copy(position);
  particle.velocity.copy(velocity);
  particle.color.copy(color);
  particle.size = size;
  particle.life = 1.0;
  particle.maxLife = maxLife;
}

/**
 * A brief muzzle flash at a local position: a few bright additive
 * particles (yellow/white), count, size and lifetime from the tower's
 * MUZZLE_FLASH_PROFILES entry.
 */
export function emitMuzzleFlash(
  pools: ParticlePoolManager,
  localX: number,
  localY: number,
  localZ: number,
  profile: MuzzleFlashProfile
): void {
  const count = profile.countMin + Math.floor(Math.random() * (profile.countMax - profile.countMin + 1));

  for (let i = 0; i < count; i++) {
    const particle = pools.getInactiveParticle('trailAdditive');
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
 * Configurable trail particles based on TrailParticleConfig. Chooses the
 * additive or normal blending pool from config.blending. The 'spiral'
 * trailType places railgun-style particles around the path at
 * `spiralAngle`.
 *
 * @returns The spiral angle for the next trail: advanced after a spiral, unchanged otherwise
 */
export function emitConfigurableTrail(
  pools: ParticlePoolManager,
  localX: number,
  localY: number,
  localZ: number,
  config: TrailParticleConfig,
  spiralAngle: number
): number {
  // Check spawn chance
  if (Math.random() > config.spawnChance) return spiralAngle;

  // Choose pool based on blending mode (default: additive for backwards compatibility)
  const poolKey = config.blending === 'normal' ? 'trailNormal' as const : 'trailAdditive' as const;

  // Spiral trail type: railgun-style rotating particles
  if (config.trailType === 'spiral') {
    const radius = config.spiralRadius ?? 1.0;
    const speed = config.spiralSpeed ?? 3.0;
    const angleStep = (Math.PI * 2) / Math.max(config.countPerSpawn, 1);

    for (let i = 0; i < config.countPerSpawn; i++) {
      const particle = pools.getInactiveParticle(poolKey);
      if (!particle) break;

      // Calculate spiral position around the projectile path
      const angle = spiralAngle + i * angleStep;
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
    return spiralAngle + speed * 0.016; // Assuming ~60fps
  }

  // Default trail type: random dispersion
  for (let i = 0; i < config.countPerSpawn; i++) {
    const particle = pools.getInactiveParticle(poolKey);
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
  return spiralAngle;
}

/**
 * A fire-atlas explosion at a local position, in two stages
 * (EXPLOSION_LOOK): a fireball of additive explosion-atlas sprites, then
 * `smokePuffs` smoke-atlas puffs in the normal pool that show up once the
 * fireball's bright half is over. Speeds and sprite sizes scale with
 * `radius`.
 *
 * @param count - Fireball particles
 * @param radius - Blast radius in meters
 * @param smokePuffs - Smoke puffs after the fireball
 */
export function emitExplosion(
  pools: ParticlePoolManager,
  localX: number,
  localY: number,
  localZ: number,
  count: number,
  radius: number,
  smokePuffs: number
): void {
  const totalAtlasFrames = pools.ATLAS_COLS * pools.ATLAS_ROWS; // 16 frames
  const scale = radius / EXPLOSION_LOOK.referenceRadius;
  const fire = EXPLOSION_LOOK.fire;

  for (let i = 0; i < count; i++) {
    const particle = pools.getInactiveParticle('trailAdditive');
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

  emitExplosionSmoke(pools, localX, localY, localZ, smokePuffs, radius, totalAtlasFrames);
}

/**
 * Smoke stage of emitExplosion: dark smoke-atlas puffs in the normal
 * pool. Each waits EXPLOSION_LOOK.smoke.delay* before it shows (its life
 * starts above 1, see atlasSpriteSize), then rises and billows out while
 * the atlas fades it to nothing.
 */
function emitExplosionSmoke(
  pools: ParticlePoolManager,
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
    const particle = pools.getInactiveParticle('trailNormal');
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
 * Round additive particles bursting outward from a point, coloured from a
 * three-colour palette. Shared by the ice, arcane, chaos and poison impacts.
 */
export function emitColorBurst(
  pools: ParticlePoolManager,
  localX: number,
  localY: number,
  localZ: number,
  count: number,
  palette: BurstPalette
): void {
  for (let i = 0; i < count; i++) {
    const particle = pools.getInactiveParticle('trailAdditive');
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
 * Sparks thrown out of a spawn portal's surface when an enemy steps
 * through. The portal plane stands on (x, y, z) in local space, facing
 * (forwardX, forwardZ), the way the enemies walk; the sparks start across
 * the opening and fly out along the facing. Additive pool, palette as for
 * the impact bursts.
 */
export function emitPortalSparks(
  pools: ParticlePoolManager,
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
  // Across the opening
  const rightX = forwardZ;
  const rightZ = -forwardX;
  for (let i = 0; i < count; i++) {
    const particle = pools.getInactiveParticle('trailAdditive');
    if (!particle) break;

    const across = (Math.random() * 2 - 1) * halfWidth * 0.9;
    particle.position.set(
      x + rightX * across,
      y + (0.1 + Math.random() * 0.8) * height,
      z + rightZ * across
    );

    const speed = 4 + Math.random() * 8;
    const drift = (Math.random() * 2 - 1) * 2;
    particle.velocity.set(
      forwardX * speed + rightX * drift,
      (Math.random() * 2 - 1) * 1.5 + 1,
      forwardZ * speed + rightZ * drift
    );

    particle.life = 1.0;
    particle.maxLife = 0.35 + Math.random() * 0.45;
    particle.size = 0.8 + Math.random() * 1.2;

    const t = Math.random();
    const c = t < 0.4 ? palette[0] : t < 0.7 ? palette[1] : palette[2];
    particle.color.setRGB(c.r, c.g, c.b);
  }
}
