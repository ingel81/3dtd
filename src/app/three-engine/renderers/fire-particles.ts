import type { Vector3 } from 'three';
import type { Particle } from './particle-pool-manager';

/**
 * The one way a fire particle is lit, shared by the fire spawns of
 * ParticleEffectsRenderer and the respawn that keeps a burning fire going.
 * Speeds and lifetimes follow the FIRE_TEMPO note in
 * particle-effects-renderer.ts.
 */

/**
 * Light `particle` somewhere within `radius` of `center`: rising, short
 * lived, in a fire colour. `sizeBonus` is added to its size; scaled fires
 * burn with bigger particles.
 */
export function igniteFireParticle(particle: Particle, center: Vector3, radius: number, sizeBonus = 0): void {
  const angle = Math.random() * Math.PI * 2;
  const distance = Math.random() * radius;

  particle.position.copy(center);
  particle.position.x += Math.cos(angle) * distance;
  particle.position.z += Math.sin(angle) * distance;

  particle.velocity.set(
    (Math.random() - 0.5) * 4,
    6 + Math.random() * 10, // Upward
    (Math.random() - 0.5) * 4
  );
  particle.life = 1.0;
  particle.maxLife = 0.2 + Math.random() * 0.4;
  particle.size = 1.5 + Math.random() * 2.5 + sizeBonus;

  setFireColor(particle);
}

/** Fire colors - yellow core, orange mid, red edges */
export function setFireColor(particle: Particle): void {
  const t = Math.random();
  if (t < 0.3) {
    particle.color.setRGB(1, 0.9, 0.3); // Yellow core
  } else if (t < 0.7) {
    particle.color.setRGB(1, 0.5, 0.1); // Orange
  } else {
    particle.color.setRGB(1, 0.2, 0.05); // Red edges
  }
}
