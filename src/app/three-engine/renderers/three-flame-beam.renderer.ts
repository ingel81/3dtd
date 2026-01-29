import { Vector3, Color } from 'three';
import { ThreeEffectsRenderer } from './three-effects.renderer';

/**
 * Active beam state
 */
interface ActiveBeam {
  towerId: string;
  sourcePosition: Vector3;
  targetPosition: Vector3;
  beamWidth: number;
  lastSpawnTime: number;
}

/**
 * ThreeFlameBeamRenderer - Renders flame beams as particle streams
 *
 * Instead of a shader cone, this spawns a continuous stream of fire particles
 * from the tower to the target, creating an organic flamethrower effect.
 */
export class ThreeFlameBeamRenderer {
  private effectsRenderer: ThreeEffectsRenderer | null = null;

  // Active beams per tower
  private activeBeams: Map<string, ActiveBeam> = new Map();

  // Particle spawn configuration
  private readonly PARTICLES_PER_SECOND = 120; // How many particles to spawn per second
  private readonly PARTICLE_SPEED = 45; // Meters per second toward target
  private readonly PARTICLE_SPREAD = 0.8; // Random spread perpendicular to beam
  private readonly PARTICLE_LIFE_MIN = 0.15; // Minimum lifetime in seconds
  private readonly PARTICLE_LIFE_MAX = 0.35; // Maximum lifetime in seconds
  private readonly PARTICLE_SIZE_MIN = 1.5;
  private readonly PARTICLE_SIZE_MAX = 3.5;

  // Fire colors (yellow core to red edges)
  private readonly fireColors: Color[] = [
    new Color(1.0, 0.95, 0.5),   // Bright yellow
    new Color(1.0, 0.8, 0.3),    // Yellow-orange
    new Color(1.0, 0.6, 0.15),   // Orange
    new Color(1.0, 0.4, 0.08),   // Deep orange
    new Color(1.0, 0.25, 0.05),  // Orange-red
    new Color(0.95, 0.15, 0.02), // Red
  ];

  // Reusable vectors
  private readonly tempDirection = new Vector3();
  private readonly tempPerpendicular = new Vector3();
  private readonly tempSpawnPos = new Vector3();
  private readonly tempVelocity = new Vector3();

  constructor() {
    console.log('[FlameBeamRenderer] Initialized (particle-based)');
  }

  /**
   * Set the effects renderer reference (called after construction)
   */
  setEffectsRenderer(renderer: ThreeEffectsRenderer): void {
    this.effectsRenderer = renderer;
  }

  /**
   * Start or update a flame beam from tower to target
   */
  startBeam(
    towerId: string,
    sourcePos: Vector3,
    targetPos: Vector3,
    _beamLength: number,
    beamWidth: number
  ): void {
    let beam = this.activeBeams.get(towerId);

    if (!beam) {
      beam = {
        towerId,
        sourcePosition: sourcePos.clone(),
        targetPosition: targetPos.clone(),
        beamWidth,
        lastSpawnTime: performance.now(),
      };
      this.activeBeams.set(towerId, beam);
    } else {
      beam.sourcePosition.copy(sourcePos);
      beam.targetPosition.copy(targetPos);
      beam.beamWidth = beamWidth;
    }
  }

  /**
   * Stop and remove a beam
   */
  stopBeam(towerId: string): void {
    this.activeBeams.delete(towerId);
  }

  /**
   * Check if tower has an active beam
   */
  hasBeam(towerId: string): boolean {
    return this.activeBeams.has(towerId);
  }

  /**
   * Update - spawn particles for all active beams
   */
  update(deltaTime: number): void {
    if (!this.effectsRenderer) return;

    const now = performance.now();
    const dt = deltaTime / 1000; // Convert to seconds

    for (const beam of this.activeBeams.values()) {
      this.spawnBeamParticles(beam, now, dt);
    }
  }

  /**
   * Spawn particles along the beam
   * Particles start small/concentrated at tower and expand toward target
   */
  private spawnBeamParticles(beam: ActiveBeam, now: number, dt: number): void {
    if (!this.effectsRenderer) return;

    // Calculate how many particles to spawn this frame
    const timeSinceLastSpawn = (now - beam.lastSpawnTime) / 1000;
    const particlesToSpawn = Math.floor(timeSinceLastSpawn * this.PARTICLES_PER_SECOND);

    if (particlesToSpawn <= 0) return;

    beam.lastSpawnTime = now;

    // Calculate beam direction
    this.tempDirection.subVectors(beam.targetPosition, beam.sourcePosition);
    const beamLength = this.tempDirection.length();
    this.tempDirection.normalize();

    // Spawn particles along the ENTIRE beam length
    for (let i = 0; i < particlesToSpawn; i++) {
      // Random position along the beam (0 = tower, 1 = target)
      const t = Math.random();
      this.tempSpawnPos.copy(beam.sourcePosition);
      this.tempSpawnPos.addScaledVector(this.tempDirection, t * beamLength);

      // Spread increases with distance from tower (cone expands)
      // At tower (t=0): minimal spread, at target (t=1): full spread
      const spreadFactor = t * t; // Quadratic expansion for more dramatic cone
      const baseSpread = 0.3; // Minimum spread at source
      const maxSpread = beam.beamWidth * 0.5;
      const currentSpread = baseSpread + spreadFactor * maxSpread;

      // Add random perpendicular spread
      const spreadAngle = Math.random() * Math.PI * 2;
      const spreadAmount = (Math.random() - 0.5) * 2 * currentSpread;
      this.tempSpawnPos.x += Math.cos(spreadAngle) * spreadAmount;
      this.tempSpawnPos.z += Math.sin(spreadAngle) * spreadAmount;
      this.tempSpawnPos.y += (Math.random() - 0.5) * currentSpread * 0.6;

      // Velocity: toward target with turbulence that increases with distance
      const speedVariation = 0.8 + Math.random() * 0.4; // 80-120% speed
      this.tempVelocity.copy(this.tempDirection).multiplyScalar(this.PARTICLE_SPEED * speedVariation);

      // More turbulence further from source
      const turbulence = 4 + t * 8;
      this.tempVelocity.x += (Math.random() - 0.5) * turbulence;
      this.tempVelocity.y += (Math.random() - 0.5) * turbulence + 1.5; // Slight upward
      this.tempVelocity.z += (Math.random() - 0.5) * turbulence;

      // Color: hotter (yellow) near source, cooler (red) near target
      // t=0 -> yellow, t=1 -> red
      const colorT = t + (Math.random() - 0.5) * 0.3; // Add some randomness
      const colorIndex = Math.floor(Math.max(0, Math.min(1, colorT)) * (this.fireColors.length - 1));
      const color = this.fireColors[colorIndex];

      // Size increases with distance (small at source, large at target)
      const sizeT = t;
      const minSize = this.PARTICLE_SIZE_MIN * 0.6; // Smaller at source
      const maxSize = this.PARTICLE_SIZE_MAX * 1.3; // Larger at target
      const size = minSize + sizeT * (maxSize - minSize) + (Math.random() - 0.5) * 1.0;

      // Life is shorter for particles spawned further along (they're already "old")
      const life = this.PARTICLE_LIFE_MIN + (1 - t * 0.5) * (this.PARTICLE_LIFE_MAX - this.PARTICLE_LIFE_MIN);

      // Spawn the particle
      this.effectsRenderer.spawnFlameParticle(
        this.tempSpawnPos,
        this.tempVelocity,
        color,
        size,
        life
      );
    }
  }

  /**
   * Clear all beams
   */
  clear(): void {
    this.activeBeams.clear();
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.clear();
  }
}
