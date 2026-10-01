import { EntityManager } from './entity-manager';
import { Projectile } from '../entities/projectile.entity';
import { Tower } from '../entities/tower.entity';
import { Enemy } from '../entities/enemy.entity';
import { PROJECTILE_SOUNDS, ProjectileTypeId } from '../configs/projectile-types.config';
import type { TowerTypeId } from '../configs/tower-types.config';
import type { DamageType } from '../configs/combat/combat.types';
import type { GeoPosition } from '../models/game.types';
import { GameEventBus } from '../game-engine/game-event-bus';
import { METERS_PER_DEGREE_LAT, DEG_TO_RAD } from '../utils/geo-utils';
import { DetMath } from '../utils/det-math';
import type { SavedProjectile } from '../simulator/wave-snapshot';
import { assignPlainFields, plainFields } from '../simulator/plain-fields';
import type { SimSink } from '../sim/core/sim-sink';

/**
 * Manages all projectile entities - spawning, updating, and collision
 *
 * Framework-agnostic, event-based:
 * - No @Injectable decorator
 * - No inject() calls
 * - Constructor injection
 * - Emits events instead of callbacks
 */
/** Where a shot's sound plays, a geo position */
interface ShotSound {
  lat: number;
  lon: number;
  height: number;
}

/**
 * Projectiles in flight. Their renderers and trails are the main thread's:
 * created and removed by ops (SimSink), moved from the packet's projectile
 * table.
 *
 * A shot of a manned tower has no sound and no muzzle flash from here: the
 * main thread shows them on `tower:manual-shot` (at the listener for its own
 * player's seat, or at once at the click when it predicted the shot).
 */
export class ProjectileManager extends EntityManager<Projectile> {
  /** Reused per-frame scratch buffers — avoids per-update allocation. */
  private readonly toFinish: Projectile[] = [];

  constructor(
    private eventBus: GameEventBus,
    private readonly sink: SimSink,
  ) {
    super();
  }

  /**
   * Spawn a new projectile from a tower to a target enemy.
   * @param heading Optional turret heading in radians (for fire point offset rotation)
   * @param aimPoint Where the shot flies to instead of the target's position
   *   (a body along the route, see Projectile.aimPoint)
   */
  spawn(tower: Tower, targetEnemy: Enemy, heading?: number, aimPoint?: GeoPosition): Projectile {
    const quiet = tower.manned;
    const start = this.muzzlePosition(tower, heading);
    const projectile = this.launch(
      start.position,
      start.height,
      targetEnemy,
      tower.typeConfig.projectileType,
      tower.combat.damage,
      tower.typeConfig.damageType,
      tower.id,
      tower.typeConfig.id,
      quiet ? null : this.towerSoundPosition(tower),
      aimPoint,
    );

    if (!quiet) this.muzzleFlash(tower);
    return projectile;
  }

  /**
   * A shot of a manned tower that has no enemy on the crosshair
   * (TowerCombatService.updateMannedTower): the tower's projectile, muzzle
   * flash and sound as spawn(), flying to `aimPoint` (where the crosshair
   * points, at the tower's range), where it is gone without a hit.
   * @param heading turret heading, for the fire point as in spawn()
   */
  fireBlank(tower: Tower, aimPoint: GeoPosition, heading: number): Projectile {
    const quiet = tower.manned;
    const start = this.muzzlePosition(tower, heading);
    const projectile = this.launch(
      start.position,
      start.height,
      null,
      tower.typeConfig.projectileType,
      tower.combat.damage,
      tower.typeConfig.damageType,
      tower.id,
      tower.typeConfig.id,
      quiet ? null : this.towerSoundPosition(tower),
      aimPoint,
    );
    if (!quiet) this.muzzleFlash(tower);
    return projectile;
  }

  /**
   * Where a tower's next shot starts: its position at muzzle height (terrain
   * height + model offset + shooting position), moved to its next fire
   * point turned by `heading` (dual barrels take turns).
   */
  private muzzlePosition(tower: Tower, heading?: number): { position: GeoPosition; height: number } {
    const terrainHeight = tower.position.height ?? 0;
    const height = terrainHeight + tower.typeConfig.heightOffset + tower.typeConfig.shootHeight;
    let lat = tower.position.lat;
    let lon = tower.position.lon;
    const firePoint = tower.getNextFirePoint();
    if (firePoint && heading !== undefined) {
      const metersPerDegreeLon = METERS_PER_DEGREE_LAT * DetMath.cos(tower.position.lat * DEG_TO_RAD);
      const cosH = DetMath.cos(heading);
      const sinH = DetMath.sin(heading);
      // Rotate fire point offset by heading (x=lateral, z=forward)
      lat += (-firePoint.x * sinH + firePoint.z * cosH) / METERS_PER_DEGREE_LAT;
      lon += (firePoint.x * cosH + firePoint.z * sinH) / metersPerDegreeLon;
    }
    return { position: { lat, lon, height: tower.position.height }, height };
  }

  /** A tower's shot sounds at its position, on its model. */
  private towerSoundPosition(tower: Tower): ShotSound {
    return {
      lat: tower.position.lat,
      lon: tower.position.lon,
      height: (tower.position.height ?? 0) + tower.typeConfig.heightOffset,
    };
  }

  /** Muzzle flash VFX (deferred, handled by VFXService) */
  private muzzleFlash(tower: Tower): void {
    this.eventBus.emitDeferred({
      type: 'vfx:muzzle-flash',
      towerId: tower.id,
      towerTypeId: tower.typeConfig.id,
    });
  }

  /**
   * Fire a shot no tower fires: the hero's (HeroManager). The same flight,
   * hit path, trail and sound as a tower's projectile of that type, with the
   * sound where the shot starts; no muzzle flash, which is per tower model.
   *
   * @param origin      where the shot starts, on the ground
   * @param originHeight geo height of the muzzle
   * @param sourceId    id the damage path credits, HERO_SOURCE_ID for the hero
   * @param aimPoint    where the shot flies instead of the target's position
   *   (a body along the route, see Projectile.aimPoint)
   */
  spawnShot(
    origin: GeoPosition,
    originHeight: number,
    targetEnemy: Enemy,
    typeId: ProjectileTypeId,
    damage: number,
    damageType: DamageType,
    sourceId: string,
    aimPoint?: GeoPosition,
  ): Projectile {
    return this.launch(
      origin, originHeight, targetEnemy, typeId, damage, damageType, sourceId, null,
      { lat: origin.lat, lon: origin.lon, height: originHeight },
      aimPoint,
    );
  }

  /** Create the projectile, its instance and trail streak, and play its sound. */
  private launch(
    start: GeoPosition,
    startHeight: number,
    targetEnemy: Enemy | null,
    typeId: ProjectileTypeId,
    damage: number,
    damageType: DamageType,
    sourceId: string,
    sourceTowerType: TowerTypeId | null,
    sound: ShotSound | null,
    aimPoint?: GeoPosition,
  ): Projectile {
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

    this.showCreated(projectile, start.lat, start.lon, startHeight);

    this.add(projectile);

    // Play spatial sound (fire-and-forget, errors logged); none for a shot shown already
    if (sound) this.playProjectileSound(projectile.typeConfig.id, sound);

    return projectile;
  }

  /**
   * Update all projectiles — movement and collision detection. Called once
   * per gameplay sub-step (~16ms game-time). Pure simulation: the renderer
   * push lives in {@link presentFrame}, once per render frame.
   */
  override update(deltaTime: number): void {
    this.toFinish.length = 0;

    for (const projectile of this.getAllActive()) {
      const hit = projectile.updateTowardsTarget(deltaTime);
      const target = projectile.targetEnemy;

      if (hit && !target) {
        // A free shot (a manned tower's miss) ends where it was aimed: no
        // hit, no splash, no impact
        this.toFinish.push(projectile);
      } else if (hit && target) {
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
            target,
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

        this.toFinish.push(projectile);
      }
    }

    for (const p of this.toFinish) this.finish(p);
  }

  /**
   * Gone from the simulation; on the main thread it flies the rest of the
   * way to where it ended, then goes with its trail streak.
   */
  private finish(entity: Projectile): void {
    this.sink.projectiles.finish(entity.id, entity.position.lat, entity.position.lon, entity.flightHeight);
    super.remove(entity);
  }

  /** Its instance and trail streak on the main thread */
  private showCreated(projectile: Projectile, lat: number, lon: number, height: number): void {
    const d = projectile.direction;
    this.sink.projectiles.create(projectile.id, projectile.typeConfig.id, lat, lon, height, { dx: d.dx, dy: d.dy, dz: d.dz });
    this.sink.trailStreaks.create(projectile.id, projectile.typeConfig.visualType);
  }

  /**
   * Emit audio event for projectile sound at the given position
   * Uses deferred events (processed at frame end)
   */
  private playProjectileSound(projectileType: string, sound: ShotSound): void {
    const soundId = projectileSoundId(projectileType);

    // Emit audio event (deferred, not critical)
    this.eventBus.emitDeferred({
      type: 'audio:play',
      sound: soundId,
      lat: sound.lat,
      lon: sound.lon,
      height: sound.height,
    });
  }

  /**
   * Remove projectile and cleanup resources
   */
  override remove(entity: Projectile): void {
    this.sink.projectiles.remove(entity.id);
    this.sink.trailStreaks.remove(entity.id);
    super.remove(entity);
  }

  /**
   * Clear all projectiles and cleanup resources
   */
  /** Every projectile in flight as plain data, for the wave snapshot (wave-snapshot.ts) */
  captureWaveState(): SavedProjectile[] {
    return this.getAll().map((p) => {
      const internal = p as unknown as { _direction: object; _lastTargetPosition: object | null };
      return {
        id: p.id,
        typeId: p.typeConfig.id as ProjectileTypeId,
        targetId: p.targetEnemy?.id ?? null,
        sourceTowerId: p.sourceTowerId,
        sourceTowerType: p.sourceTowerType,
        damageType: p.damageType,
        aimPoint: p.aimPoint ? plainFields(p.aimPoint) : null,
        entity: plainFields(p, ['id', 'type']),
        position: plainFields(p.position),
        direction: plainFields(internal._direction),
        lastTargetPosition: internal._lastTargetPosition ? plainFields(internal._lastTargetPosition) : null,
        transform: plainFields(p.transform),
        combat: plainFields(p.combat),
        movement: plainFields(p.movement),
      };
    });
  }

  /**
   * Put the projectiles of captureWaveState() back, with their instances and
   * trails; `enemy` finds each target, `beforeEach` sets the id counter.
   */
  restoreWaveState(saved: readonly SavedProjectile[], enemy: (id: string) => Enemy | null, beforeEach: (id: string) => void): void {
    for (const s of saved) {
      beforeEach(s.id);
      const target = s.targetId === null ? null : enemy(s.targetId);
      if (s.targetId !== null && !target) throw new Error(`Projectile ${s.id}: target ${s.targetId} missing`);
      const aim = s.aimPoint ? ({} as GeoPosition) : undefined;
      if (aim && s.aimPoint) assignPlainFields(aim, s.aimPoint);
      const start = { lat: 0, lon: 0, height: 0 };
      assignPlainFields(start, s.position);
      const p = new Projectile(start, target, s.typeId, 0, 0, s.sourceTowerId, s.sourceTowerType, s.damageType, aim);
      if (p.id !== s.id) throw new Error(`Projectile ${s.id} came back as ${p.id}`);
      const internal = p as unknown as { _direction: object; _lastTargetPosition: object | null };
      assignPlainFields(p, s.entity);
      assignPlainFields(p.position, s.position);
      internal._direction = { dx: 0, dy: 0, dz: 0 };
      assignPlainFields(internal._direction, s.direction);
      if (s.lastTargetPosition) {
        internal._lastTargetPosition = { lat: 0, lon: 0 };
        assignPlainFields(internal._lastTargetPosition, s.lastTargetPosition);
      } else {
        internal._lastTargetPosition = null;
      }
      assignPlainFields(p.transform, s.transform);
      assignPlainFields(p.combat, s.combat);
      assignPlainFields(p.movement, s.movement);
      this.showCreated(p, p.position.lat, p.position.lon, p.flightHeight);
      this.add(p);
    }
  }

  override clear(): void {
    this.sink.projectiles.clear();
    this.sink.trailStreaks.clear();
    super.clear();
  }
}

/** The sound a projectile type makes as it leaves, the arrow's for one without its own */
export function projectileSoundId(projectileType: string): string {
  return projectileType in PROJECTILE_SOUNDS ? projectileType : 'arrow';
}
