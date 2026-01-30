import { EntityManager } from './entity-manager';
import { Projectile } from '../entities/projectile.entity';
import { Tower } from '../entities/tower.entity';
import { Enemy } from '../entities/enemy.entity';
import { EntityPoolService } from '../services/entity-pool.service';
import { ThreeTilesEngine } from '../three-engine';
import { PROJECTILE_SOUNDS } from '../configs/projectile-types.config';
import { GameEventBus } from '../game-engine';

/**
 * Manages all projectile entities - spawning, updating, and collision
 *
 * Framework-agnostic, event-based:
 * - No @Injectable decorator
 * - No inject() calls
 * - Constructor injection
 * - Emits events instead of callbacks
 */
export class ProjectileManager extends EntityManager<Projectile> {
  private soundsRegistered = false;

  constructor(
    private eventBus: GameEventBus,
    private entityPool: EntityPoolService
  ) {
    super();
  }

  /**
   * Initialize projectile manager with ThreeTilesEngine
   */
  override initialize(tilesEngine: ThreeTilesEngine): void {
    super.initialize(tilesEngine);

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

    // Create trail streak for the projectile
    this.tilesEngine.trailStreaks?.create(
      projectile.id,
      projectile.typeConfig.visualType
    );

    this.add(projectile);

    // Play spatial sound at tower position (fire-and-forget, errors logged)
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
        // Emit projectile:hit event if target is still alive
        if (!projectile.targetLost) {
          this.eventBus.emit({
            type: 'projectile:hit',
            projectile,
            target: projectile.targetEnemy,
            damage: projectile.damage,
          });
        }

        // Emit VFX event for projectile impact (deferred, not critical)
        this.eventBus.emitDeferred({
          type: 'vfx:projectile-impact',
          lat: projectile.position.lat,
          lon: projectile.position.lon,
          height: projectile.flightHeight,
          projectileType: projectile.typeConfig.id,
          targetLost: projectile.targetLost,
        });

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

        // Push position to trail streak (ribbon renderer)
        if (this.tilesEngine) {
          const localPos = this.tilesEngine.sync.geoToLocalSimple(
            projectile.position.lat,
            projectile.position.lon,
            projectile.flightHeight
          );
          this.tilesEngine.trailStreaks?.pushPosition(projectile.id, localPos);
        }
      }
    }

    toRemove.forEach((p) => this.remove(p));
  }

  /**
   * Emit audio event for projectile sound at the tower's position
   * Uses deferred events (processed at frame end)
   */
  private playProjectileSound(tower: Tower, projectileType: string): void {
    // Map projectile types to sound IDs
    const soundId = projectileType in PROJECTILE_SOUNDS ? projectileType : 'arrow'; // Fallback to arrow sound

    const pos = tower.position;
    const height = (pos.height ?? 0) + tower.typeConfig.heightOffset;

    // Emit audio event (deferred, not critical)
    this.eventBus.emitDeferred({
      type: 'audio:play',
      sound: soundId,
      lat: pos.lat,
      lon: pos.lon,
      height,
    });
  }

  /**
   * Remove projectile and cleanup resources
   */
  override remove(entity: Projectile): void {
    this.tilesEngine?.projectiles.remove(entity.id);
    this.tilesEngine?.trailStreaks?.remove(entity.id);
    super.remove(entity);
  }

  /**
   * Clear all projectiles and cleanup resources
   */
  override clear(): void {
    this.tilesEngine?.projectiles.clear();
    this.tilesEngine?.trailStreaks?.clear();
    super.clear();
  }
}
