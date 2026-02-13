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
  private _trailFrameCount = 0;

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
   * Spawn a new projectile from a tower to a target enemy.
   * @param heading Optional turret heading in radians (for fire point offset rotation)
   */
  spawn(tower: Tower, targetEnemy: Enemy, heading?: number): Projectile {
    if (!this.tilesEngine) {
      throw new Error('ProjectileManager not initialized');
    }

    // Calculate spawn height: tower terrain height + tower model offset + shooting position
    const terrainHeight = tower.position.height ?? 0;
    const spawnHeight = terrainHeight + tower.typeConfig.heightOffset + tower.typeConfig.shootHeight;

    // Calculate spawn position with optional fire point offset
    let spawnLat = tower.position.lat;
    let spawnLon = tower.position.lon;

    const firePoint = tower.getNextFirePoint();
    if (firePoint && heading !== undefined) {
      const metersPerDegreeLat = 111320;
      const metersPerDegreeLon = 111320 * Math.cos(tower.position.lat * 0.0174533);
      const cosH = Math.cos(heading);
      const sinH = Math.sin(heading);
      // Rotate fire point offset by heading (x=lateral, z=forward)
      spawnLat += (-firePoint.x * sinH + firePoint.z * cosH) / metersPerDegreeLat;
      spawnLon += (firePoint.x * cosH + firePoint.z * sinH) / metersPerDegreeLon;
    }

    const spawnPosition = { lat: spawnLat, lon: spawnLon, height: tower.position.height };

    const projectile = new Projectile(
      spawnPosition,
      targetEnemy,
      tower.typeConfig.projectileType,
      tower.combat.damage,
      spawnHeight,
      tower.id
    );

    this.tilesEngine.projectiles.create(
      projectile.id,
      projectile.typeConfig.id,
      spawnLat,
      spawnLon,
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

    // Muzzle flash VFX (deferred — handled by VFXService)
    this.eventBus.emitDeferred({
      type: 'vfx:muzzle-flash',
      towerId: tower.id,
      towerTypeId: tower.typeConfig.id,
    });

    return projectile;
  }

  /**
   * Update all projectiles - movement and collision detection
   */
  override update(deltaTime: number): void {
    this._trailFrameCount++;
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

        // Spawn trail particles if configured (throttle to every 2nd frame)
        const trailConfig = projectile.typeConfig.trailParticles;
        if (trailConfig?.enabled && this.tilesEngine && (this._trailFrameCount & 1) === 0) {
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
