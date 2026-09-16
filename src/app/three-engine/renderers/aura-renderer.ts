import { Vector3 } from 'three';
import { ParticlePoolManager, Particle } from './particle-pool-manager';

/**
 * Ice crystals on at most this many frozen enemies at once (4 particles each
 * from the additive trail pool); the ones past it show the iced tint only.
 */
export const ICE_CRYSTAL_CAP = 48;

/** Crystals around a frozen enemy: angle (rad), distance and height (m), size, whiteness 0-1 */
const ICE_CRYSTALS = [
  { angle: 0.4, distance: 1.1, height: 0.5, size: 2.2, white: 1 },
  { angle: 2.2, distance: 1.3, height: 1.5, size: 1.7, white: 0.4 },
  { angle: 3.9, distance: 1.0, height: 0.9, size: 2.0, white: 0.7 },
  { angle: 5.3, distance: 1.2, height: 2.2, size: 1.5, white: 0.2 },
] as const;

/** One orbiting status-effect aura (frost or poison) tracked per enemy. */
interface AuraInstance {
  particles: Particle[];
  localPosition: Vector3;
  orbitAngle: number;
}

/**
 * AuraRenderer: status-effect particle auras, orbiting frost and poison
 * and the still ice crystals of a frozen enemy.
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
  // Ice crystals of frozen enemies (still particles, see ICE_CRYSTALS)
  private activeIceCrystals = new Map<string, AuraInstance>();

  /** VFX setting freezeTint; while off the frost auras are tracked without particles. */
  private frostShown = true;

  constructor(private readonly pools: ParticlePoolManager) {}

  /**
   * Spawn orbiting cyan ice particles around a slowed enemy. While frost
   * auras are hidden the aura only follows the enemy, with no particles.
   */
  spawnFrostAura(enemyId: string, localPosition: Vector3): string {
    if (this.activeFrostAuras.has(enemyId)) return enemyId;

    const center = localPosition.clone();
    this.activeFrostAuras.set(enemyId, {
      particles: this.frostShown ? this.takeFrostParticles(center) : [],
      localPosition: center,
      orbitAngle: 0,
    });

    return enemyId;
  }

  /** Three ice particles from the additive pool, 120° apart around `center`. */
  private takeFrostParticles(center: Vector3): Particle[] {
    const particleCount = 3;
    const particles: Particle[] = [];

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

    return particles;
  }

  /**
   * Show or hide the frost auras (VFX setting freezeTint). Hidden auras
   * give their particles back and keep following their enemy, so switching
   * back on shows the aura on every enemy that is slowed right now.
   */
  setFrostEnabled(enabled: boolean): void {
    if (enabled === this.frostShown) return;
    this.frostShown = enabled;
    for (const aura of this.activeFrostAuras.values()) {
      if (enabled) {
        aura.particles = this.takeFrostParticles(aura.localPosition);
      } else {
        for (const p of aura.particles) p.life = 0;
        aura.particles = [];
      }
    }
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
   * Ice crystals around a frozen enemy: still, white to pale cyan. Past
   * ICE_CRYSTAL_CAP frozen enemies nothing is spawned; the enemy shows the
   * iced tint only, and the update and stop calls for it do nothing.
   */
  spawnIceCrystals(enemyId: string, localPosition: Vector3): void {
    if (this.activeIceCrystals.has(enemyId) || this.activeIceCrystals.size >= ICE_CRYSTAL_CAP) return;

    const particles: Particle[] = [];
    for (const crystal of ICE_CRYSTALS) {
      const particle = this.pools.getInactiveParticle('trailAdditive');
      if (!particle) break;
      particle.velocity.set(0, 0, 0);
      particle.life = 1.0;
      particle.maxLife = 999; // Kept alive until explicitly stopped
      particle.size = crystal.size;
      particle.frameIndex = -1;
      particle.totalFrames = 0;
      particle.color.setRGB(0.55 + 0.4 * crystal.white, 0.85 + 0.12 * crystal.white, 1.0);
      particles.push(particle);
    }
    const aura: AuraInstance = { particles, localPosition: localPosition.clone(), orbitAngle: 0 };
    this.placeIceCrystals(aura);
    this.activeIceCrystals.set(enemyId, aura);
  }

  /** Move the crystals with their enemy (an air unit settles, the ground height eases). */
  updateIceCrystalsPosition(enemyId: string, localPosition: Vector3): void {
    const aura = this.activeIceCrystals.get(enemyId);
    if (!aura) return;
    aura.localPosition.copy(localPosition);
  }

  /** The enemy thawed or is gone. */
  stopIceCrystals(enemyId: string): void {
    const aura = this.activeIceCrystals.get(enemyId);
    if (!aura) return;
    for (const p of aura.particles) {
      p.life = 0;
    }
    this.activeIceCrystals.delete(enemyId);
  }

  hasIceCrystals(enemyId: string): boolean {
    return this.activeIceCrystals.has(enemyId);
  }

  /** Crystals at their fixed places around the enemy, alive for another frame. */
  private placeIceCrystals(aura: AuraInstance): void {
    const center = aura.localPosition;
    for (let i = 0; i < aura.particles.length; i++) {
      const p = aura.particles[i];
      if (p.life <= 0) continue;
      const crystal = ICE_CRYSTALS[i];
      p.position.set(
        center.x + Math.cos(crystal.angle) * crystal.distance,
        center.y + crystal.height,
        center.z + Math.sin(crystal.angle) * crystal.distance,
      );
      p.life = 1.0;
    }
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
   * Per-frame orbit update for all active frost + poison auras; the ice
   * crystals stay where they are.
   * @param dt delta time in seconds
   */
  update(dt: number): void {
    for (const aura of this.activeIceCrystals.values()) {
      this.placeIceCrystals(aura);
    }

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

    for (const aura of this.activeIceCrystals.values()) {
      for (const p of aura.particles) {
        p.life = 0;
      }
    }
    this.activeIceCrystals.clear();
  }
}
