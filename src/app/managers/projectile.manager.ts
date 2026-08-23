import { Vector3 } from 'three';
import { EntityManager } from './entity-manager';
import { Projectile } from '../entities/projectile.entity';
import { Tower } from '../entities/tower.entity';
import { Enemy } from '../entities/enemy.entity';
import { ThreeTilesEngine } from '../three-engine';
import { PROJECTILE_SOUNDS } from '../configs/projectile-types.config';
import { GameEventBus } from '../game-engine';
import { METERS_PER_DEGREE_LAT, DEG_TO_RAD } from '../utils/geo-utils';

/**
 * Manages all projectile entities - spawning, updating, and collision
 *
 * Framework-agnostic, event-based:
 * - No @Injectable decorator
 * - No inject() calls
 * - Constructor injection
 * - Emits events instead of callbacks
 */
/**
 * Spawn one trail-particle burst per this many meters travelled.
 * Distance-based gating gives uniform trails at any framerate / speed.
 */
const TRAIL_SPAWN_DISTANCE_M = 0.5;

export class ProjectileManager extends EntityManager<Projectile> {
  private soundsRegistered = false;

  /** Reused per-frame scratch buffers — avoids per-update allocation. */
  private readonly toRemove: Projectile[] = [];
  private readonly trailPos = new Vector3();

  constructor(
    private eventBus: GameEventBus
  ) {
    super();
  }

  /**
   * Initialize projectile manager with ThreeTilesEngine
   */
  override initialize(tilesEngine: ThreeTilesEngine): void {
    super.initialize(tilesEngine);

    // Register projectile sounds with spatial audio.
    // Override the duration-based heuristic — projectile samples can run
    // ~1 s, which would put them in the medium bucket (4 polyphony, ~50 ms
    // anti-flood). At 8 max-upgraded towers in continuous fire that caps
    // out instantly. Combat sounds need loose throttling regardless of
    // sample length.
    if (!this.soundsRegistered && tilesEngine.spatialAudio) {
      for (const [id, config] of Object.entries(PROJECTILE_SOUNDS)) {
        tilesEngine.spatialAudio.registerSound(id, config.url, {
          refDistance: config.refDistance,
          rolloffFactor: config.rolloffFactor,
          volume: config.volume,
          minIntervalMs: 10,
          maxInstances: 12,
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
      const metersPerDegreeLon = METERS_PER_DEGREE_LAT * Math.cos(tower.position.lat * DEG_TO_RAD);
      const cosH = Math.cos(heading);
      const sinH = Math.sin(heading);
      // Rotate fire point offset by heading (x=lateral, z=forward)
      spawnLat += (-firePoint.x * sinH + firePoint.z * cosH) / METERS_PER_DEGREE_LAT;
      spawnLon += (firePoint.x * cosH + firePoint.z * sinH) / metersPerDegreeLon;
    }

    const spawnPosition = { lat: spawnLat, lon: spawnLon, height: tower.position.height };

    const projectile = new Projectile(
      spawnPosition,
      targetEnemy,
      tower.typeConfig.projectileType,
      tower.combat.damage,
      spawnHeight,
      tower.id,
      tower.typeConfig.damageType
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
   * Update all projectiles — movement and collision detection. Called once
   * per gameplay sub-step (~16ms game-time). Pure simulation: the renderer
   * push lives in {@link presentFrame}, once per render frame.
   */
  override update(deltaTime: number): void {
    this.toRemove.length = 0;

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
            damageType: projectile.damageType,
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

        this.toRemove.push(projectile);
      } else if (projectile.typeConfig.trailParticles?.enabled) {
        // Accumulate travel distance on the sub-step so the trail-particle
        // density stays framerate-independent; the spawns themselves are
        // visual and happen in presentFrame.
        projectile.trailDistanceAcc += projectile.distanceThisFrame;
      }
    }

    this.toRemove.forEach((p) => this.remove(p));
  }

  /**
   * Push projectile state to the renderer. Call once per render frame, after
   * the sub-step loop, and only when at least one sub-step actually ran —
   * same contract as `EnemyManager.presentFrame`.
   *
   * This work used to sit inside the per-sub-step loop, where instance
   * positions, trail particles and streak points were re-pushed for every
   * step even though `commitToGPU` runs once per frame and only the last
   * push is ever seen. Headless training (rendering off, high timescale)
   * paid for all of it per sub-step; now it is skipped entirely there.
   */
  presentFrame(): void {
    const engine = this.tilesEngine;
    if (!engine) return;

    for (const projectile of this.getAllActive()) {
      // Update visual position (projectiles whose target died keep flying
      // to the last known position and stay visible until impact).
      if (projectile.isHoming || projectile.hasArcTrajectory) {
        // Homing and arc projectiles update rotation continuously
        engine.projectiles.updateWithRotation(
          projectile.id,
          projectile.position.lat,
          projectile.position.lon,
          projectile.flightHeight,
          projectile.direction
        );
      } else {
        // Regular projectiles keep fixed rotation
        engine.projectiles.update(
          projectile.id,
          projectile.position.lat,
          projectile.position.lon,
          projectile.flightHeight
        );
      }

      // Distance-based trail spawn: drain the distance accumulated on the
      // sub-steps so trails stay visually uniform across framerates /
      // projectile speeds. The per-config spawnChance still applies on each
      // gate hit. Spawns collapse onto the current frame position — below
      // 60 FPS the intermediate sub-step positions are no longer sampled,
      // same trade-off the enemy present split made.
      const trailConfig = projectile.typeConfig.trailParticles;
      if (trailConfig?.enabled) {
        while (projectile.trailDistanceAcc >= TRAIL_SPAWN_DISTANCE_M) {
          projectile.trailDistanceAcc -= TRAIL_SPAWN_DISTANCE_M;
          engine.effects.spawnConfigurableTrailAtGeo(
            projectile.position.lat,
            projectile.position.lon,
            projectile.flightHeight,
            trailConfig
          );
        }
      }

      // Push position to trail streak (ribbon renderer). pushPosition copies
      // the vector into its ring buffer, so the scratch buffer is safe to reuse.
      engine.sync.geoToLocalSimpleInto(
        projectile.position.lat,
        projectile.position.lon,
        projectile.flightHeight,
        this.trailPos
      );
      engine.trailStreaks?.pushPosition(projectile.id, this.trailPos);
    }
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
