import { Injectable, inject } from '@angular/core';
import { EntityManager } from './entity-manager';
import { Projectile } from '../entities/projectile.entity';
import { Tower } from '../entities/tower.entity';
import { Enemy } from '../entities/enemy.entity';
import { EntityPoolService } from '../services/entity-pool.service';
import { ThreeTilesEngine } from '../three-engine';
import { PROJECTILE_SOUNDS } from '../configs/projectile-types.config';
import { EXPLOSION_PRESETS } from '../configs/visual-effects.config';

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
        // Only call hit handler if target is still alive (not for ground impacts)
        if (!projectile.targetLost) {
          this.onProjectileHit?.(projectile, projectile.targetEnemy);
        }

        // Spawn explosion effects based on projectile type (always, even on ground impact)
        const projectileId = projectile.typeConfig.id;
        if (projectile.isHoming) {
          // Rocket explosion - large fire effect
          this.tilesEngine?.effects.spawnExplosionAtGeo(
            projectile.position.lat,
            projectile.position.lon,
            projectile.flightHeight,
            EXPLOSION_PRESETS.rocket.particles
          );
        } else if (projectileId === 'cannonball') {
          // Cannonball explosion - medium fire effect
          this.tilesEngine?.effects.spawnExplosionAtGeo(
            projectile.position.lat,
            projectile.position.lon,
            projectile.flightHeight,
            EXPLOSION_PRESETS.cannon.particles
          );
        } else if (projectileId === 'bullet') {
          // Minimal impact effect for bullets
          this.tilesEngine?.effects.spawnExplosionAtGeo(
            projectile.position.lat,
            projectile.position.lon,
            projectile.flightHeight,
            EXPLOSION_PRESETS.bullet.particles
          );
        } else if (projectileId !== 'arrow') {
          // Small impact effect for other projectiles (ice, etc.)
          this.tilesEngine?.effects.spawnExplosionAtGeo(
            projectile.position.lat,
            projectile.position.lon,
            projectile.flightHeight,
            EXPLOSION_PRESETS.small.particles
          );
        }

        toRemove.push(projectile);
      } else {
        // Projectile still in flight (including when target died - continues to last position)
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
        } else {
          // Regular projectiles keep fixed rotation
          this.tilesEngine?.projectiles.update(
            projectile.id,
            projectile.position.lat,
            projectile.position.lon,
            projectile.flightHeight
          );
        }

        // Spawn trail particles if configured
        const trailConfig = projectile.typeConfig.trailParticles;
        if (trailConfig?.enabled && this.tilesEngine) {
          this.tilesEngine.effects.spawnConfigurableTrailAtGeo(
            projectile.position.lat,
            projectile.position.lon,
            projectile.flightHeight,
            trailConfig
          );
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
