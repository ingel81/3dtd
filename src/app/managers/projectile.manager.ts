import { Vector3 } from 'three';
import { EntityManager } from './entity-manager';
import { Projectile } from '../entities/projectile.entity';
import { Tower } from '../entities/tower.entity';
import { Enemy } from '../entities/enemy.entity';
import { ThreeTilesEngine } from '../three-engine';
import { PROJECTILE_SOUNDS, ProjectileTypeId } from '../configs/projectile-types.config';
import type { TowerTypeId } from '../configs/tower-types.config';
import type { DamageType } from '../configs/combat/combat.types';
import type { GeoPosition } from '../models/game.types';
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
   * @param aimPoint Where the shot flies to instead of the target's position
   *   (a body along the route, see Projectile.aimPoint)
   */
  spawn(tower: Tower, targetEnemy: Enemy, heading?: number, aimPoint?: GeoPosition): Projectile {
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

    const projectile = this.launch(
      { lat: spawnLat, lon: spawnLon, height: tower.position.height },
      spawnHeight,
      targetEnemy,
      tower.typeConfig.projectileType,
      tower.combat.damage,
      tower.typeConfig.damageType,
      tower.id,
      tower.typeConfig.id,
      // Sound at the tower's position, on its model
      { lat: tower.position.lat, lon: tower.position.lon, height: (tower.position.height ?? 0) + tower.typeConfig.heightOffset },
      aimPoint,
    );

    // Muzzle flash VFX (deferred, handled by VFXService)
    this.eventBus.emitDeferred({
      type: 'vfx:muzzle-flash',
      towerId: tower.id,
      towerTypeId: tower.typeConfig.id,
    });

    return projectile;
  }

  /**
   * Fire a shot no tower fires: the hero's (HeroManager). The same flight,
   * hit path, trail and sound as a tower's projectile of that type, with the
   * sound where the shot starts; no muzzle flash, which is per tower model.
   *
   * @param origin      where the shot starts, on the ground
   * @param originHeight geo height of the muzzle
   * @param sourceId    id the damage path credits, HERO_SOURCE_ID for the hero
   */
  spawnShot(
    origin: GeoPosition,
    originHeight: number,
    targetEnemy: Enemy,
    typeId: ProjectileTypeId,
    damage: number,
    damageType: DamageType,
    sourceId: string,
  ): Projectile {
    return this.launch(
      origin, originHeight, targetEnemy, typeId, damage, damageType, sourceId, null,
      { lat: origin.lat, lon: origin.lon, height: originHeight },
    );
  }

  /** Create the projectile, its instance and trail streak, and play its sound. */
  private launch(
    start: GeoPosition,
    startHeight: number,
    targetEnemy: Enemy,
    typeId: ProjectileTypeId,
    damage: number,
    damageType: DamageType,
    sourceId: string,
    sourceTowerType: TowerTypeId | null,
    sound: { lat: number; lon: number; height: number },
    aimPoint?: GeoPosition,
  ): Projectile {
    if (!this.tilesEngine) {
      throw new Error('ProjectileManager not initialized');
    }

    const projectile = new Projectile(
      start,
      targetEnemy,
      typeId,
      damage,
      startHeight,
      sourceId,
      sourceTowerType,
      damageType,
      aimPoint,
    );

    this.tilesEngine.projectiles.create(
      projectile.id,
      projectile.typeConfig.id,
      start.lat,
      start.lon,
      startHeight,
      projectile.direction
    );

    // Create trail streak for the projectile
    this.tilesEngine.trailStreaks?.create(
      projectile.id,
      projectile.typeConfig.visualType
    );

    this.add(projectile);

    // Play spatial sound (fire-and-forget, errors logged)
    this.playProjectileSound(projectile.typeConfig.id, sound.lat, sound.lon, sound.height);

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
        // Emit projectile:hit when the target is still alive, OR when the
        // projectile carries splash — splash must still detonate at the impact
        // point even if the primary target died mid-flight (otherwise AoE
        // towers silently lose their whole area effect in dense packs, exactly
        // where it matters most). The handler skips direct damage on a dead
        // target and only applies the splash. Non-splash projectiles keep the
        // old behaviour (no hit event once the target is gone).
        const splashRadius = projectile.typeConfig.splashRadius ?? 0;
        if (!projectile.targetLost || splashRadius > 0) {
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

      engine.sync.geoToLocalSimpleInto(
        projectile.position.lat,
        projectile.position.lon,
        projectile.flightHeight,
        this.trailPos
      );
      const dir = projectile.direction;
      const tailOffset = projectile.typeConfig.tailOffset ?? 0;
      if (tailOffset > 0) {
        // Trails start at the tail (rocket nozzle), not the mesh centre
        this.trailPos.x -= dir.dx * tailOffset;
        this.trailPos.y -= dir.dy * tailOffset;
        this.trailPos.z -= dir.dz * tailOffset;
      }

      // Distance-based trail spawn: drain the distance accumulated on the
      // sub-steps so trails stay visually uniform across framerates /
      // projectile speeds. The per-config spawnChance still applies on each
      // gate hit. The frame's spawns are laid back along the flight
      // direction, one gate apart, instead of all landing on the current
      // position: a rocket covers 2 m per frame at 60 FPS, and the stacked
      // spawns read as blobs rather than a trail.
      const trailConfig = projectile.typeConfig.trailParticles;
      if (trailConfig?.enabled) {
        let back = 0;
        while (projectile.trailDistanceAcc >= TRAIL_SPAWN_DISTANCE_M) {
          projectile.trailDistanceAcc -= TRAIL_SPAWN_DISTANCE_M;
          engine.effects.spawnConfigurableTrail(
            this.trailPos.x - dir.dx * back,
            this.trailPos.y - dir.dy * back,
            this.trailPos.z - dir.dz * back,
            trailConfig
          );
          back += TRAIL_SPAWN_DISTANCE_M;
        }
      }

      // Push position to trail streak (ribbon renderer). pushPosition copies
      // the vector into its ring buffer, so the scratch buffer is safe to reuse.
      engine.trailStreaks?.pushPosition(projectile.id, this.trailPos);
    }
  }

  /**
   * Emit audio event for projectile sound at the given position
   * Uses deferred events (processed at frame end)
   */
  private playProjectileSound(projectileType: string, lat: number, lon: number, height: number): void {
    // Map projectile types to sound IDs
    const soundId = projectileType in PROJECTILE_SOUNDS ? projectileType : 'arrow'; // Fallback to arrow sound

    // Emit audio event (deferred, not critical)
    this.eventBus.emitDeferred({
      type: 'audio:play',
      sound: soundId,
      lat,
      lon,
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
