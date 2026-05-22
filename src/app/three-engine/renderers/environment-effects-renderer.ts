import { Vector3 } from 'three';
import { CoordinateSync } from './index';
import { ParticlePoolManager, Particle } from './particle-pool-manager';

/** One tower inner-fire instance — particles borrowed from the towerFire pool. */
interface TowerFireInstance {
  particles: Particle[];
  localPosition: Vector3;
}

/**
 * EnvironmentEffectsRenderer — large-scale environmental VFX: the HQ
 * destruction explosion, the HQ damage fire-flash, and persistent tower
 * inner-fire glows.
 *
 * Split out of three-effects.renderer.ts. Borrows particles from the
 * ParticlePoolManager (the towerFire pool for inner fires, the additive
 * trail pool for explosions/flashes) and owns no Three.js resources itself.
 */
export class EnvironmentEffectsRenderer {
  // Dedicated tower inner fire tracking (particles come from the towerFire pool)
  private activeTowerFires = new Map<string, TowerFireInstance>();

  // Reusable temp vector for particle updates (avoids GC pressure)
  private readonly tempVelocity = new Vector3();

  constructor(
    private readonly sync: CoordinateSync,
    private readonly pools: ParticlePoolManager,
  ) {}

  /**
   * Spawn massive HQ destruction explosion
   * 3x scale - very dramatic final explosion
   */
  spawnHQExplosion(lat: number, lon: number, localY: number): void {
    const localXZ = this.sync.geoToLocalSimple(lat, lon, 0);
    const centerX = localXZ.x;
    const centerY = localY + 8; // Above ground (raised for larger explosion)
    const centerZ = localXZ.z;

    // Count available particles
    let availableParticles = 0;
    for (const p of this.pools.getPool('trailAdditive')) {
      if (p.life <= 0) availableParticles++;
    }

    void availableParticles;

    // Phase 1: Central bright flash - reduced count, larger size to compensate
    for (let i = 0; i < 150; i++) {
      const particle = this.pools.getInactiveParticle('trailAdditive');
      if (!particle) {
        console.warn('[HQ Explosion] Pool exhausted at phase 1, particle', i);
        break;
      }

      particle.position.set(centerX, centerY, centerZ);

      // Spherical outward burst (3x speed and reach)
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const speed = 40 + Math.random() * 60; // 3x faster burst

      particle.velocity.set(
        Math.sin(phi) * Math.cos(theta) * speed,
        Math.cos(phi) * speed * 0.8 + 15, // Strong upward bias
        Math.sin(phi) * Math.sin(theta) * speed
      );

      particle.life = 1.0;
      particle.maxLife = 1.5 + Math.random() * 1.5; // Longer duration
      particle.size = (8.0 + Math.random() * 12.0) * 1.5; // 1.5x larger to compensate for fewer particles

      // Bright yellow/white core
      const t = Math.random();
      if (t < 0.4) {
        particle.color.setRGB(1, 1, 0.9); // White-yellow
      } else if (t < 0.7) {
        particle.color.setRGB(1, 0.95, 0.4); // Yellow
      } else {
        particle.color.setRGB(1, 0.7, 0.2); // Orange
      }
    }

    // Phase 2: Secondary fire/debris ring - reduced count, larger size to compensate
    for (let i = 0; i < 250; i++) {
      const particle = this.pools.getInactiveParticle('trailAdditive');
      if (!particle) {
        console.warn('[HQ Explosion] Pool exhausted at phase 2, particle', i);
        break;
      }

      // Spawn in a ring around center (3x radius)
      const angle = Math.random() * Math.PI * 2;
      const ringRadius = 8 + Math.random() * 18;

      particle.position.set(
        centerX + Math.cos(angle) * ringRadius,
        centerY + Math.random() * 8,
        centerZ + Math.sin(angle) * ringRadius
      );

      // Outward and upward (3x speed)
      const speed = 25 + Math.random() * 50;
      particle.velocity.set(
        Math.cos(angle) * speed * 0.6,
        10 + Math.random() * 25,
        Math.sin(angle) * speed * 0.6
      );

      particle.life = 1.0;
      particle.maxLife = 2.0 + Math.random() * 2.0; // Longer duration
      particle.size = (6.0 + Math.random() * 10.0) * 1.3; // 1.3x larger to compensate for fewer particles

      // Orange/red fire colors
      const t = Math.random();
      if (t < 0.3) {
        particle.color.setRGB(1, 0.8, 0.3);
      } else if (t < 0.7) {
        particle.color.setRGB(1, 0.5, 0.15);
      } else {
        particle.color.setRGB(1, 0.2, 0.05);
      }
    }

    // Phase 3: Rising embers and sparks - reduced count
    for (let i = 0; i < 100; i++) {
      const particle = this.pools.getInactiveParticle('trailAdditive');
      if (!particle) {
        console.warn('[HQ Explosion] Pool exhausted at phase 3, particle', i);
        break;
      }

      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 30; // 3x radius

      particle.position.set(
        centerX + Math.cos(angle) * radius,
        centerY,
        centerZ + Math.sin(angle) * radius
      );

      // Slow rising embers
      particle.velocity.set(
        (Math.random() - 0.5) * 10,
        5 + Math.random() * 12,
        (Math.random() - 0.5) * 10
      );

      particle.life = 1.0;
      particle.maxLife = 2.0 + Math.random() * 2.0; // 2-4 seconds
      particle.size = 1.5 + Math.random() * 2.5;

      // Darker red/orange embers
      const t = Math.random();
      if (t < 0.5) {
        particle.color.setRGB(1, 0.4, 0.1);
      } else {
        particle.color.setRGB(1, 0.2, 0.05);
      }
    }
  }

  /**
   * Spawn a brief fire flash that fades away
   * Used for damage indication when HP > 50%
   */
  spawnFireFlash(lat: number, lon: number, localY: number): void {
    const localXZ = this.sync.geoToLocalSimple(lat, lon, 0);
    const localPos = new Vector3(localXZ.x, localY, localXZ.z);

    // Spawn 30 particles that fade quickly
    for (let i = 0; i < 30; i++) {
      const particle = this.pools.getInactiveParticle('trailAdditive');
      if (!particle) break;

      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 2;

      particle.position.copy(localPos);
      particle.position.x += Math.cos(angle) * radius;
      particle.position.z += Math.sin(angle) * radius;

      particle.velocity.set(
        (Math.random() - 0.5) * 3,
        4 + Math.random() * 6,
        (Math.random() - 0.5) * 3
      );
      particle.life = 1.0;
      particle.maxLife = 0.8 + Math.random() * 0.6; // 0.8-1.4 seconds
      particle.size = 1.5 + Math.random() * 2.0;

      // Fire colors
      const t = Math.random();
      if (t < 0.3) {
        particle.color.setRGB(1, 0.9, 0.3);
      } else if (t < 0.7) {
        particle.color.setRGB(1, 0.5, 0.1);
      } else {
        particle.color.setRGB(1, 0.2, 0.05);
      }
    }
    // No effect tracking - particles just fade naturally
  }

  /**
   * Spawn a persistent inner-fire glow inside a tower.
   *
   * @param towerId - Unique tower ID
   * @param localPosition - Local position of tower base
   * @param fireHeight - Height offset for fire center (inside tower)
   * @param intensity - Fire intensity 0.0-1.0 (default 0.5)
   * @returns Tower fire ID (same as towerId)
   */
  spawnTowerInnerFire(
    towerId: string,
    localPosition: Vector3,
    fireHeight = 3.0,
    intensity = 0.5
  ): string {
    // Check if already exists
    if (this.activeTowerFires.has(towerId)) {
      console.warn('[Effects] Tower fire already exists:', towerId);
      return towerId;
    }

    const clampedIntensity = Math.max(0.1, Math.min(1.0, intensity));
    const particleCount = Math.floor(30 + clampedIntensity * 80); // 30-110 particles
    const fireRadius = 0.8 + clampedIntensity * 1.2; // 0.8-2.0 meters

    // Fire center position (inside hollow tower)
    const fireCenter = localPosition.clone();
    fireCenter.y += fireHeight;

    const particles: Particle[] = [];

    for (let i = 0; i < particleCount; i++) {
      const particle = this.pools.getInactiveParticle('towerFire');
      if (!particle) {
        console.warn('[Effects] Tower fire pool exhausted at', i, 'particles');
        break;
      }

      // Spawn in cylinder around center
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * fireRadius;

      particle.position.copy(fireCenter);
      particle.position.x += Math.cos(angle) * radius;
      particle.position.z += Math.sin(angle) * radius;
      particle.position.y += (Math.random() - 0.3) * 2; // Slight vertical spread

      // Upward velocity with turbulence
      particle.velocity.set(
        (Math.random() - 0.5) * 1.5,
        2 + Math.random() * 4, // Upward
        (Math.random() - 0.5) * 1.5
      );

      particle.life = Math.random(); // Stagger initial life for natural look
      particle.maxLife = 0.4 + Math.random() * 0.6;
      particle.size = 1.0 + Math.random() * 1.5 + clampedIntensity;

      // Fire colors - yellow core, orange mid, red edges
      const t = Math.random();
      if (t < 0.35) {
        particle.color.setRGB(1, 0.9, 0.3); // Yellow core
      } else if (t < 0.75) {
        particle.color.setRGB(1, 0.5, 0.1); // Orange
      } else {
        particle.color.setRGB(1, 0.25, 0.05); // Red edges
      }

      particles.push(particle);
    }

    this.activeTowerFires.set(towerId, {
      particles,
      localPosition: fireCenter.clone(),
    });

    console.log('[Effects] Tower inner fire spawned:', towerId, '| Particles:', particles.length);
    return towerId;
  }

  /**
   * Stop tower inner fire immediately
   */
  stopTowerInnerFire(towerId: string): void {
    const fire = this.activeTowerFires.get(towerId);
    if (!fire) return;

    // Kill all particles
    for (const p of fire.particles) {
      p.life = 0;
    }

    this.activeTowerFires.delete(towerId);
    console.log('[Effects] Tower inner fire stopped:', towerId);
  }

  /**
   * Stop all tower inner fires
   */
  stopAllTowerFires(): void {
    for (const [towerId] of this.activeTowerFires) {
      this.stopTowerInnerFire(towerId);
    }
  }

  /**
   * Check if tower has active inner fire
   */
  hasTowerFire(towerId: string): boolean {
    return this.activeTowerFires.has(towerId);
  }

  /**
   * Per-frame update for tower inner fires — particles are persistent and
   * respawn in place when they die.
   * @param dt delta time in seconds
   */
  update(dt: number): void {
    // Update tower inner fire particles (persistent, respawn when dead)
    for (const [, fire] of this.activeTowerFires) {
      const fireRadius = 1.5; // Fixed radius for inner fire
      const fireCenter = fire.localPosition;

      for (const particle of fire.particles) {
        if (particle.life > 0) {
          // Update position
          particle.position.add(this.tempVelocity.copy(particle.velocity).multiplyScalar(dt));
          // Decay life
          particle.life -= dt / particle.maxLife;
        } else {
          // Respawn dead particle
          const angle = Math.random() * Math.PI * 2;
          const radius = Math.random() * fireRadius;

          particle.position.copy(fireCenter);
          particle.position.x += Math.cos(angle) * radius;
          particle.position.z += Math.sin(angle) * radius;
          particle.position.y += (Math.random() - 0.3) * 2;

          particle.velocity.set(
            (Math.random() - 0.5) * 1.5,
            2 + Math.random() * 4,
            (Math.random() - 0.5) * 1.5
          );

          particle.life = 1.0;
          particle.maxLife = 0.4 + Math.random() * 0.6;
          particle.size = 1.0 + Math.random() * 2.0;

          // Fire colors on respawn
          const t = Math.random();
          if (t < 0.35) {
            particle.color.setRGB(1, 0.9, 0.3);
          } else if (t < 0.75) {
            particle.color.setRGB(1, 0.5, 0.1);
          } else {
            particle.color.setRGB(1, 0.25, 0.05);
          }
        }
      }
    }
  }

  /**
   * Drop all tower-fire tracking.
   * (Tower-fire part of ThreeEffectsRenderer.clear() — the pool particles
   * themselves are killed by ParticlePoolManager.reset().)
   */
  clear(): void {
    this.activeTowerFires.clear();
  }
}
