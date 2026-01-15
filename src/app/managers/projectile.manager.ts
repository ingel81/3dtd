import { Injectable, inject } from '@angular/core';
import { EntityManager } from './entity-manager';
import { Projectile } from '../entities/projectile.entity';
import { Tower } from '../entities/tower.entity';
import { Enemy } from '../entities/enemy.entity';
import { EntityPoolService } from '../services/entity-pool.service';
import { ThreeTilesEngine } from '../three-engine';

// Sound configuration for projectiles
const PROJECTILE_SOUNDS = {
  arrow: {
    url: '/assets/sounds/arrow_01.mp3',
    refDistance: 50, // Full volume at 50m
    rolloffFactor: 1,
    volume: 0.5,
  },
  bullet: {
    url: '/assets/sounds/gatling_0.mp3',
    refDistance: 40, // Shorter range for rapid fire
    rolloffFactor: 1.2,
    volume: 0.25, // Lower volume due to high fire rate (5/sec)
  },
  rocket: {
    url: '/assets/sounds/rocket_launch.mp3',
    refDistance: 60, // Rockets are loud
    rolloffFactor: 1,
    volume: 0.7,
  },
  cannonball: {
    url: '/assets/sounds/cannon_01.mp3',
    refDistance: 70, // Cannons are loud
    rolloffFactor: 1,
    volume: 0.6,
  },
} as const;

/**
 * Manages all projectile entities - spawning, updating, and collision
 */
@Injectable()
export class ProjectileManager extends EntityManager<Projectile> {
  private entityPool = inject(EntityPoolService);
  private onProjectileHit?: (projectile: Projectile, enemy: Enemy) => void;
  private soundsRegistered = false;

  /**
   * Initialize projectile manager with ThreeTilesEngine and callbacks
   */
  override initialize(
    tilesEngine: ThreeTilesEngine,
    onProjectileHit?: (projectile: Projectile, enemy: Enemy) => void
  ): void {
    super.initialize(tilesEngine);
    this.onProjectileHit = onProjectileHit;

    // Register projectile sounds with spatial audio
    if (!this.soundsRegistered && tilesEngine.spatialAudio) {
      for (const [id, config] of Object.entries(PROJECTILE_SOUNDS)) {
        tilesEngine.spatialAudio.registerSound(id, config.url, {
          refDistance: config.refDistance,
          rolloffFactor: config.rolloffFactor,
          volume: config.volume,
        });
      }
      this.soundsRegistered = true;
    }
  }

  /**
   * Spawn a new projectile from a tower to a target enemy
   */
  spawn(tower: Tower, targetEnemy: Enemy): Projectile {
    if (!this.tilesEngine) {
      throw new Error('ProjectileManager not initialized');
    }

    // Calculate spawn height: tower terrain height + tower model offset + shooting position
    const terrainHeight = tower.position.height ?? 0;
    const spawnHeight = terrainHeight + tower.typeConfig.heightOffset + tower.typeConfig.shootHeight;

    const projectile = new Projectile(
      tower.position,
      targetEnemy,
      tower.typeConfig.projectileType,
      tower.combat.damage,
      spawnHeight,
      tower.id
    );

    this.tilesEngine.projectiles.create(
      projectile.id,
      projectile.typeConfig.id,
      tower.position.lat,
      tower.position.lon,
      spawnHeight,
      projectile.direction
    );

    this.add(projectile);

    // Play spatial sound at tower position
    this.playProjectileSound(tower, projectile.typeConfig.id);

    return projectile;
  }

  /**
   * Update all projectiles - movement and collision detection
   */
  override update(deltaTime: number): void {
    const toRemove: Projectile[] = [];

    for (const projectile of this.getAllActive()) {
      const hit = projectile.updateTowardsTarget(deltaTime);

      if (hit) {
        this.onProjectileHit?.(projectile, projectile.targetEnemy);

        // Spawn explosion effect for rockets
        if (projectile.isHoming) {
          this.tilesEngine?.effects.spawnExplosionAtGeo(
            projectile.position.lat,
            projectile.position.lon,
            projectile.flightHeight,
            50 // 50 particles for bigger explosion
          );
        } else if (projectile.typeConfig.id === 'bullet') {
          // Minimal impact effect for bullets - just 2 tiny particles
          this.tilesEngine?.effects.spawnExplosionAtGeo(
            projectile.position.lat,
            projectile.position.lon,
            projectile.flightHeight,
            2 // 2 particles for minimal bullet impact
          );
        } else if (projectile.typeConfig.id !== 'arrow') {
          // Spawn smaller impact effect for other non-arrow, non-rocket projectiles
          this.tilesEngine?.effects.spawnExplosionAtGeo(
            projectile.position.lat,
            projectile.position.lon,
            projectile.flightHeight,
            8 // 8 particles for small impact effect
          );
        }

        toRemove.push(projectile);
      } else if (!projectile.targetEnemy.alive) {
        // Target died, remove projectile
        toRemove.push(projectile);
      } else {
        // Update visual position
        if (projectile.isHoming || projectile.hasArcTrajectory) {
          // Homing and arc projectiles update rotation continuously
          this.tilesEngine?.projectiles.updateWithRotation(
            projectile.id,
            projectile.position.lat,
            projectile.position.lon,
            projectile.flightHeight,
            projectile.direction
          );

          // Spawn rocket trail particles
          if (projectile.isHoming) {
            this.tilesEngine?.effects.spawnRocketTrailAtGeo(
              projectile.position.lat,
              projectile.position.lon,
              projectile.flightHeight,
              2 // 2 particles per frame
            );
          }

          // Spawn subtle smoke trail for cannonballs - very sparse
          if (projectile.typeConfig.id === 'cannonball' && Math.random() < 0.3) {
            this.tilesEngine?.effects.spawnCannonSmokeAtGeo(
              projectile.position.lat,
              projectile.position.lon,
              projectile.flightHeight,
              1 // 1 particle, only 30% of frames
            );
          }
        } else {
          // Regular projectiles keep fixed rotation
          this.tilesEngine?.projectiles.update(
            projectile.id,
            projectile.position.lat,
            projectile.position.lon,
            projectile.flightHeight
          );

          // Spawn tracer trail for bullets (Dual Gatling) - subtle effect
          if (projectile.typeConfig.id === 'bullet') {
            this.tilesEngine?.effects.spawnBulletTracerAtGeo(
              projectile.position.lat,
              projectile.position.lon,
              projectile.flightHeight,
              1 // 1 small particle per frame for subtle tracer
            );
          }
        }
      }
    }

    toRemove.forEach((p) => this.remove(p));
  }

  /**
   * Play spatial sound for a projectile at the tower's position
   */
  private playProjectileSound(tower: Tower, projectileType: string): void {
    if (!this.tilesEngine?.spatialAudio) return;

    // Map projectile types to sound IDs
    const soundId = projectileType in PROJECTILE_SOUNDS
      ? projectileType
      : 'arrow'; // Fallback to arrow sound

    const pos = tower.position;
    const height = (pos.height ?? 0) + tower.typeConfig.heightOffset;

    this.tilesEngine.spatialAudio.playAtGeo(soundId, pos.lat, pos.lon, height);
  }

  /**
   * Calculate heading angle from one position to another
   */
  private calculateHeading(
    from: { lat: number; lon: number },
    to: { lat: number; lon: number }
  ): number {
    const dLon = to.lon - from.lon;
    const dLat = to.lat - from.lat;
    return Math.atan2(dLon, dLat);
  }

  /**
   * Remove projectile and cleanup resources
   */
  override remove(entity: Projectile): void {
    this.tilesEngine?.projectiles.remove(entity.id);
    super.remove(entity);
  }

  /**
   * Clear all projectiles and cleanup resources
   */
  override clear(): void {
    this.tilesEngine?.projectiles.clear();
    super.clear();
  }
}
