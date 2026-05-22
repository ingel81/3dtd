import { Vector3 } from 'three';
import { ParticlePoolManager, Particle } from './particle-pool-manager';

/** One orbiting status-effect aura (frost or poison) tracked per enemy. */
interface AuraInstance {
  particles: Particle[];
  localPosition: Vector3;
  orbitAngle: number;
}

/**
 * AuraRenderer — orbiting status-effect particle auras (frost + poison).
 *
 * Split out of three-effects.renderer.ts. Each aura borrows a few particles
 * from the additive trail pool and orbits them around a tracked enemy until
 * the effect is explicitly stopped. The renderer owns no Three.js resources
 * itself — the particles belong to the ParticlePoolManager.
 */
export class AuraRenderer {
  // Frost aura tracking (orbiting ice particles per enemy)
  private activeFrostAuras = new Map<string, AuraInstance>();
  // Poison aura tracking (orbiting green particles per enemy)
  private activePoisonAuras = new Map<string, AuraInstance>();

  constructor(private readonly pools: ParticlePoolManager) {}

  /**
   * Spawn orbiting cyan ice particles around a slowed enemy.
   */
  spawnFrostAura(enemyId: string, localPosition: Vector3): string {
    if (this.activeFrostAuras.has(enemyId)) return enemyId;

    const particleCount = 3;
    const particles: Particle[] = [];
    const center = localPosition.clone();

    for (let i = 0; i < particleCount; i++) {
      const particle = this.pools.getInactiveParticle('trailAdditive');
      if (!particle) break;

      // Stagger initial angles evenly (120° apart)
      const angle = (i / particleCount) * Math.PI * 2;
      const orbitRadius = 1.8;

      particle.position.set(
        center.x + Math.cos(angle) * orbitRadius,
        center.y + 1.5 + Math.sin(angle * 0.5) * 0.3,
        center.z + Math.sin(angle) * orbitRadius
      );

      // Minimal velocity — position is overridden each frame
      particle.velocity.set(0, 0.3 + Math.random() * 0.2, 0);
      particle.life = 1.0;
      particle.maxLife = 999; // Kept alive until explicitly stopped
      particle.size = 1.2 + Math.random() * 0.6;
      particle.frameIndex = -1;
      particle.totalFrames = 0;

      // Cyan / white ice colors
      const t = Math.random();
      if (t < 0.5) {
        particle.color.setRGB(0.6, 0.9, 1.0); // Cyan
      } else {
        particle.color.setRGB(0.85, 0.95, 1.0); // White-cyan
      }

      particles.push(particle);
    }

    this.activeFrostAuras.set(enemyId, {
      particles,
      localPosition: center,
      orbitAngle: 0,
    });

    return enemyId;
  }

  /**
   * Update frost aura position to follow a moving enemy.
   * Call each frame for enemies with active frost aura.
   */
  updateFrostAuraPosition(enemyId: string, localPosition: Vector3): void {
    const aura = this.activeFrostAuras.get(enemyId);
    if (!aura) return;
    aura.localPosition.copy(localPosition);
  }

  /**
   * Stop frost aura on an enemy (slow expired).
   */
  stopFrostAura(enemyId: string): void {
    const aura = this.activeFrostAuras.get(enemyId);
    if (!aura) return;

    for (const p of aura.particles) {
      p.life = 0;
    }
    this.activeFrostAuras.delete(enemyId);
  }

  /**
   * Check if an enemy has an active frost aura
   */
  hasFrostAura(enemyId: string): boolean {
    return this.activeFrostAuras.has(enemyId);
  }

  /**
   * Spawn orbiting green poison particles around a poisoned enemy.
   */
  spawnPoisonAura(enemyId: string, localPosition: Vector3): string {
    if (this.activePoisonAuras.has(enemyId)) return enemyId;

    const particleCount = 3;
    const particles: Particle[] = [];
    const center = localPosition.clone();

    for (let i = 0; i < particleCount; i++) {
      const particle = this.pools.getInactiveParticle('trailAdditive');
      if (!particle) break;

      const angle = (i / particleCount) * Math.PI * 2;
      const orbitRadius = 1.8;

      particle.position.set(
        center.x + Math.cos(angle) * orbitRadius,
        center.y + 1.5 + Math.sin(angle * 0.5) * 0.3,
        center.z + Math.sin(angle) * orbitRadius
      );

      particle.velocity.set(0, 0.3 + Math.random() * 0.2, 0);
      particle.life = 1.0;
      particle.maxLife = 999;
      particle.size = 1.2 + Math.random() * 0.6;
      particle.frameIndex = -1;
      particle.totalFrames = 0;

      // Green poison colors
      const t = Math.random();
      if (t < 0.5) {
        particle.color.setRGB(0.2, 0.8, 0.1); // Green
      } else {
        particle.color.setRGB(0.5, 1.0, 0.2); // Yellow-green
      }

      particles.push(particle);
    }

    this.activePoisonAuras.set(enemyId, {
      particles,
      localPosition: center,
      orbitAngle: 0,
    });

    return enemyId;
  }

  /**
   * Update poison aura position to follow a moving enemy.
   */
  updatePoisonAuraPosition(enemyId: string, localPosition: Vector3): void {
    const aura = this.activePoisonAuras.get(enemyId);
    if (!aura) return;
    aura.localPosition.copy(localPosition);
  }

  /**
   * Stop poison aura on an enemy (poison expired).
   */
  stopPoisonAura(enemyId: string): void {
    const aura = this.activePoisonAuras.get(enemyId);
    if (!aura) return;

    for (const p of aura.particles) {
      p.life = 0;
    }
    this.activePoisonAuras.delete(enemyId);
  }

  /**
   * Check if an enemy has an active poison aura
   */
  hasPoisonAura(enemyId: string): boolean {
    return this.activePoisonAuras.has(enemyId);
  }

  /**
   * Per-frame orbit update for all active frost + poison auras.
   * @param dt delta time in seconds
   */
  update(dt: number): void {
    // Update frost aura particles (orbiting around slowed enemies)
    for (const [, aura] of this.activeFrostAuras) {
      aura.orbitAngle += dt * 3.0; // ~3 rad/s orbit speed
      const orbitRadius = 1.8;
      const center = aura.localPosition;
      const count = aura.particles.length;

      for (let i = 0; i < count; i++) {
        const p = aura.particles[i];
        if (p.life <= 0) continue;

        const angle = aura.orbitAngle + (i / count) * Math.PI * 2;
        p.position.set(
          center.x + Math.cos(angle) * orbitRadius,
          center.y + 1.5 + Math.sin(angle * 2) * 0.4, // gentle vertical bob
          center.z + Math.sin(angle) * orbitRadius
        );

        // Keep alive indefinitely (reset life)
        p.life = 1.0;

        // Subtle size pulse
        p.size = 1.0 + 0.4 * Math.sin(angle * 1.5);
      }
    }

    // Update poison aura particles (orbiting around poisoned enemies)
    for (const [, aura] of this.activePoisonAuras) {
      aura.orbitAngle += dt * 2.5; // Slightly slower than frost (2.5 vs 3.0 rad/s)
      const orbitRadius = 1.8;
      const center = aura.localPosition;
      const count = aura.particles.length;

      for (let i = 0; i < count; i++) {
        const p = aura.particles[i];
        if (p.life <= 0) continue;

        const angle = aura.orbitAngle + (i / count) * Math.PI * 2;
        p.position.set(
          center.x + Math.cos(angle) * orbitRadius,
          center.y + 1.5 + Math.sin(angle * 2) * 0.4,
          center.z + Math.sin(angle) * orbitRadius
        );

        p.life = 1.0;
        p.size = 1.0 + 0.4 * Math.sin(angle * 1.5);
      }
    }
  }

  /**
   * Kill all aura particles and drop tracking.
   * (Aura part of ThreeEffectsRenderer.clear().)
   */
  clear(): void {
    for (const [, aura] of this.activeFrostAuras) {
      for (const p of aura.particles) {
        p.life = 0;
      }
    }
    this.activeFrostAuras.clear();

    for (const [, aura] of this.activePoisonAuras) {
      for (const p of aura.particles) {
        p.life = 0;
      }
    }
    this.activePoisonAuras.clear();
  }
}
