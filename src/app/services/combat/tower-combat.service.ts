import { Injectable, inject } from '@angular/core';
import type { LoopHandle } from '../../managers/audio/spatial-audio-loops';
import { Vector3 } from 'three';
import { ThreeTilesEngine } from '../../three-engine';
import { GlobalRouteGridService } from '../world/global-route-grid.service';
import { SpatialGridService } from '../world/spatial-grid.service';
import { CombatEffectService } from './combat-effect.service';
import { ResearchStore } from '../../store/research.store';
import { Enemy } from '../../entities/enemy.entity';
import { Tower } from '../../entities/tower.entity';
import { TowerManager } from '../../managers/tower.manager';
import { METERS_PER_DEGREE_LAT, DEG_TO_RAD, geoHeading } from '../../utils/geo-utils';
import { getEnemyAimOffsetY } from '../../utils/enemy-aim.util';
import { COMBAT_TUNING } from '../../configs/combat-tuning.config';
import { upgradeFactor } from '../../configs/tower-types.config';
import { GAME_BALANCE } from '../../configs/game-balance.config';
import { EnemyManager } from '../../managers/enemy.manager';
import { ProjectileManager } from '../../managers/projectile.manager';
import type { GeoPosition } from '../../models/game.types';
import { ROUTE_BODY_AIM_HEIGHT_M, type RouteBodyContact } from '../../utils/route-body';
import { bodyPointInCone, coneContains, type Cone } from '../../utils/body-cone';
import { BodyAim, type BodyAimPoint } from './body-aim';

/**
 * TowerCombatService - Handles tower targeting, rotation, and shooting
 *
 * Extracted from GameStateManager to reduce god object complexity.
 * Manages:
 * - Tower targeting with GlobalRouteGrid optimization
 * - Turret rotation towards targets
 * - Firing and projectile spawning
 * - Guard heading between waves (turnTowersToGuard)
 */
@Injectable({ providedIn: 'root' })
export class TowerCombatService {
  private readonly globalRouteGrid = inject(GlobalRouteGridService);
  private readonly spatialGrid = inject(SpatialGridService);
  private readonly combatEffectService = inject(CombatEffectService);
  private readonly researchStore = inject(ResearchStore);

  private tilesEngine: ThreeTilesEngine | null = null;

  // Throttle blood effects for beam damage (per-enemy)
  private lastBeamBloodEffect = new Map<string, number>();
  private readonly BEAM_BLOOD_EFFECT_INTERVAL = COMBAT_TUNING.beamBloodEffectIntervalMs;

  // Active flame sound loops per tower (towerId -> soundHandle, FLAME_PENDING while created)
  private activeFlameSounds = new Map<string, LoopHandle>();

  // Reusable vectors for cone collision
  private readonly tempDirection = new Vector3();
  private readonly tempSoundPos = new Vector3();
  private readonly _cone: Cone = { x: 0, y: 0, z: 0, dirX: 0, dirY: 0, dirZ: 1, length: 0, cosHalfAngle: 1 };
  private readonly _coneContact: RouteBodyContact = { station: 0, offset: 0, distance: 0 };
  private readonly groundAt = (x: number, z: number): number | null => this.globalRouteGrid.getGroundLocalYAt(x, z);

  // Reused scratch buffers to avoid per-tower / per-sub-step allocations.
  // Safe to share across the four update*Towers methods: each consumes its
  // candidate list within one tower iteration before the next runs, and
  // nested grid queries (splash/chain damage) allocate their own arrays.
  private readonly _candidateScratch: Enemy[] = [];
  private readonly _coneScratch: Enemy[] = [];
  private readonly _losScratch = new Vector3();
  private readonly _coneEnemyPos = new Vector3();
  // Tower position for the wake check and the fallback radius query. Only
  // read right after it is written, never across a call.
  private readonly _towerLocalScratch = new Vector3();

  // Enemies whose body lies along the route (the ooze): every tower aims at
  // the nearest point of the body it sees, see BodyAim. Started per tower
  // turn by beginBodyAim(); `_aimPoint` is read right after it is written.
  private readonly bodyAim = new BodyAim(this.globalRouteGrid);
  private readonly bodyDistSq = (enemy: Enemy): number => this.bodyAim.distSq(enemy);
  private readonly _aimPoint: BodyAimPoint = { lat: 0, lon: 0, height: 0, x: 0, y: 0, z: 0 };

  /**
   * Initialize with engine reference
   */
  initialize(tilesEngine: ThreeTilesEngine): void {
    this.tilesEngine = tilesEngine;
  }

  /**
   * Build a per-enemy LoS predicate for a tower. Air enemies resolve against
   * air-LoS (skyline + clearance), ground enemies against ground-LoS — picked
   * up from cell.airVisibility / cell.towerVisibility pre-compute, with a
   * runtime raycast fallback for both.
   *
   * `useGridLookup=true` enables the pre-computed cell-visibility fast path
   * (only safe when the tower's visibleCells set is populated). When false,
   * we go straight to raycast — used by the radius-query fallback.
   */
  private buildLosCheck(
    tower: Tower,
    useGridLookup: boolean,
  ): ((enemy: Enemy) => boolean) | undefined {
    const engine = this.tilesEngine;
    if (!engine) return undefined;
    // Shared reusable vector — avoids both a per-enemy AND a per-predicate
    // Vector3 allocation. Safe because predicates are built and consumed
    // sequentially per tower (never retained across tower iterations).
    // Capturing `engine` also removes the non-null assertion on the field.
    const pos = this._losScratch;
    return (enemy: Enemy) => {
      // A body along the route: its aim point is one the tower sees
      if (enemy.body) return this.bodyAim.distSq(enemy) < Infinity;
      engine.sync.geoToLocalSimpleInto(
        enemy.position.lat,
        enemy.position.lon,
        enemy.transform.terrainHeight,
        pos,
      );
      const isAir = enemy.typeConfig.isAirUnit ?? false;
      if (useGridLookup) {
        const visibility = isAir
          ? this.globalRouteGrid.isAirPositionVisibleFromTower(tower.id, pos.x, pos.z)
          : this.globalRouteGrid.isPositionVisibleFromTower(tower.id, pos.x, pos.z);
        if (visibility !== undefined) {
          return visibility;
        }
      }
      // Raycast fallback. Air targets aim at the visual air altitude
      // (terrainHeight already lifted to skyline + clearance for air enemies),
      // ground targets at eye height.
      const targetLocalY = isAir
        ? pos.y + enemy.heightOffset
        : pos.y + 1.5;
      return engine.towers.hasLineOfSight(
        tower.id,
        pos.x,
        targetLocalY,
        pos.z,
      );
    };
  }

  /**
   * Wake check for a sleeping tower, at most once per
   * towerSleepCheckIntervalMs game-time. Uses the SpatialGrid O(k) query
   * instead of brute-force O(n) over all enemies. Returns true once an enemy
   * is near and the tower is awake again; false means skip it this sub-step.
   */
  private tryWakeTower(tower: Tower, gameTimeMs: number): boolean {
    if (gameTimeMs - tower.lastSleepCheck < COMBAT_TUNING.towerSleepCheckIntervalMs) return false;
    tower.lastSleepCheck = gameTimeMs;

    const engine = this.tilesEngine;
    if (!engine) return false;
    const towerLocal = engine.sync.geoToLocalSimpleInto(
      tower.position.lat,
      tower.position.lon,
      0,
      this._towerLocalScratch,
    );
    const radius = tower.combat.range * COMBAT_TUNING.rangeMargin.standard;
    // A body along the route is in the route grid's body list, not the spatial grid
    const hasNearby =
      this.spatialGrid.hasEnemyInRadius(towerLocal.x, towerLocal.z, radius) ||
      this.globalRouteGrid.hasBodyWithin(towerLocal.x, towerLocal.z, radius);
    if (!hasNearby) return false;
    tower.isSleeping = false;
    return true;
  }

  /**
   * Candidate enemies for one tower, written into `_candidateScratch`.
   * findTarget does the exact range check afterwards, so `radiusMeters`
   * only has to cover it; it is ignored on the fast path.
   *
   * FAST PATH: towers with visibleCells read the enemies of those cells from
   * the GlobalRouteGrid. Works for ground, air-only and dual-targeting towers:
   * visibleCells is the union of ground + air visible cells, so a "blue-only"
   * cell still produces candidates and buildLosCheck filters them per enemy.
   *
   * FALLBACK: GlobalRouteGrid radius query, O(cells_in_radius). Without an
   * engine, a geo-distance filter over all alive enemies.
   *
   * Enemies whose body lies along the route are in no cell: the fast path
   * adds each living one, the radius query takes those that reach into it.
   * findTarget measures them at the tower's aim point (BodyAim).
   */
  private collectCandidates(
    tower: Tower,
    radiusMeters: number,
    enemyManager: EnemyManager,
  ): Enemy[] {
    if (tower.visibleCells.length > 0) {
      const out = this.globalRouteGrid.getEnemiesForTower(tower.visibleCells, this._candidateScratch);
      for (const enemy of this.globalRouteGrid.getBodyEnemies()) {
        if (enemy.alive) out.push(enemy);
      }
      return out;
    }

    const engine = this.tilesEngine;
    if (engine) {
      const towerLocal = engine.sync.geoToLocalSimpleInto(
        tower.position.lat,
        tower.position.lon,
        0,
        this._towerLocalScratch,
      );
      return this.globalRouteGrid.getEnemiesInRadius(
        towerLocal.x,
        towerLocal.z,
        radiusMeters,
        undefined,
        this._candidateScratch,
      );
    }

    // Ultimate fallback: geo-distance filter (no engine available).
    // getAlive() is only touched here: it re-filters the whole enemy list
    // whenever its cache was invalidated, which while a wave is spawning is
    // every sub-step.
    const mPerDegLat = METERS_PER_DEGREE_LAT;
    const mPerDegLon = METERS_PER_DEGREE_LAT * Math.cos(tower.position.lat * DEG_TO_RAD);
    const radiusSq = radiusMeters ** 2;
    const out = this._candidateScratch;
    out.length = 0;
    for (const enemy of enemyManager.getAlive()) {
      const dx = (enemy.position.lat - tower.position.lat) * mPerDegLat;
      const dy = (enemy.position.lon - tower.position.lon) * mPerDegLon;
      if (dx * dx + dy * dy <= radiusSq) out.push(enemy);
    }
    return out;
  }

  /**
   * Start `tower`'s turn in BodyAim while an enemy with a body along the
   * route is on the map. Its distance and aim point depend on the tower.
   */
  private beginBodyAim(tower: Tower): void {
    const engine = this.tilesEngine;
    if (!engine || this.globalRouteGrid.getBodyEnemies().length === 0) {
      this.bodyAim.endTurn();
      return;
    }
    const local = engine.sync.geoToLocalSimpleInto(
      tower.position.lat,
      tower.position.lon,
      0,
      this._towerLocalScratch,
    );
    // The raycasts run against the tiles, which lodVersion follows
    this.bodyAim.beginTower(tower, local.x, local.z, engine.towers, engine.terrain.lodVersion);
  }

  /**
   * What the tower turns to: the target's position, or for a body along the
   * route its aim point (BodyAim). The aim point is a shared scratch: read
   * it right away.
   */
  private targetPoint(target: Enemy): GeoPosition {
    if (target.body && this.bodyAim.aim(target, this._aimPoint)) return this._aimPoint;
    return target.position;
  }

  /**
   * Where a beam, a strike or a bolt meets `target`, local: a body's aim
   * point (BodyAim, which also puts the body's hit there) or the model's
   * visual centre.
   */
  private aimLocalPosition(target: Enemy): Vector3 {
    const engine = this.tilesEngine!;
    if (target.body && this.bodyAim.aim(target, this._aimPoint)) {
      const p = this._aimPoint;
      return engine.sync.geoToLocalSimple(p.lat, p.lon, p.height + ROUTE_BODY_AIM_HEIGHT_M);
    }
    const pos = engine.sync.geoToLocalSimple(
      target.position.lat,
      target.position.lon,
      target.transform.terrainHeight + target.heightOffset,
    );
    pos.y += getEnemyAimOffsetY(target); // aim at the model's visual centre
    return pos;
  }

  /** Where a shot at a body along the route flies to (its aim point); undefined for any other target. */
  private projectileAim(target: Enemy): GeoPosition | undefined {
    if (!target.body || !this.bodyAim.aim(target, this._aimPoint)) return undefined;
    const p = this._aimPoint;
    return { lat: p.lat, lon: p.lon, height: p.height + ROUTE_BODY_AIM_HEIGHT_M };
  }

  /**
   * Turn every tower to its guard heading, where the route enters its range
   * (`Tower.guardHeading`). Called once a wave is over: during the wave a
   * tower that loses its target keeps its heading instead. Towers without a
   * guard heading keep theirs as well.
   */
  turnTowersToGuard(towerManager: TowerManager): void {
    for (const tower of towerManager.getAllActive()) {
      this.turnToGuardHeading(tower);
    }
  }

  /** turnTowersToGuard for a single tower. */
  turnToGuardHeading(tower: Tower): void {
    if (tower.guardHeading === null) return;
    this.tilesEngine?.towers.setIdleHeading(tower.id, tower.guardHeading);
  }

  /**
   * Update tower shooting — find targets and spawn projectiles.
   * Called once per gameplay sub-step (~16ms game-time) from GameStateManager.
   *
   * `gameTimeMs` is the engine's monotonic game-clock; sleep / LOS / target
   * timestamps all live in this clock. No timescale compensation is needed
   * because the sub-step loop already discretises wall-clock × timescale into
   * fixed game-time chunks.
   */
  updateTowerShooting(
    gameTimeMs: number,
    deltaTime: number,
    towerManager: TowerManager,
    enemyManager: EnemyManager,
    projectileManager: ProjectileManager,
  ): void {
    const airTargetingUnlocked = this.researchStore.airTargetingUnlocked();

    for (const tower of towerManager.getAllActive()) {
      // Skip non-projectile towers (beam, melee, chain) — they have their
      // own update methods. MUST happen before combat.update so the cooldown
      // is only ticked once per sub-step (by the matching method) — otherwise
      // each tower gets its cooldown drained N× per sub-step, with N = number
      // of update*Towers methods, which inflates the effective fire rate.
      if (tower.typeConfig.attackType && tower.typeConfig.attackType !== 'projectile') continue;

      // Advance per-tower fire cooldown in game-time
      tower.combat.update(deltaTime);

      // Skip towers with pending LOS computation (progressive registration not yet complete)
      if (!tower.losReady) continue;

      if (tower.isSleeping && !this.tryWakeTower(tower, gameTimeMs)) continue;

      // losCheck dispatches per-enemy on isAirUnit so air targets resolve
      // against air-LoS (skyline + clearance) and ground targets against
      // ground-LoS, picked up from cell.airVisibility / cell.towerVisibility
      // pre-compute, with a runtime raycast fallback for both.
      const candidates = this.collectCandidates(
        tower,
        tower.combat.range * COMBAT_TUNING.rangeMargin.standard,
        enemyManager,
      );
      this.beginBodyAim(tower);
      const losCheck = this.buildLosCheck(tower, tower.visibleCells.length > 0);

      // Fast path: get cached target or find new one
      let target = tower.findTarget(candidates, airTargetingUnlocked, losCheck, this.bodyDistSq);

      if (target) {
        // Target found - update sleep tracking (game-time)
        tower.lastTargetTime = gameTimeMs;
        tower.isSleeping = false;

        // Always rotate turret towards target (rotation advances per sub-step)
        const heading = this.calculateHeading(tower.position, this.targetPoint(target));
        this.tilesEngine?.towers.updateRotation(tower.id, heading);

        // Fire if cooldown is ready AND turret is aligned
        const turretAligned = this.tilesEngine?.towers.isTurretAligned(tower.id) ?? true;
        if (tower.combat.canFire() && turretAligned) {
          // Periodic LOS recheck (throttled to max ~3/sec per tower) — runs
          // for air targets too now that tall buildings can break air LOS.
          if (losCheck && tower.needsLosRecheck(gameTimeMs)) {
            tower.markLosChecked(gameTimeMs);
            if (!losCheck(target)) {
              // Target no longer visible - find new target
              tower.clearTarget();
              target = tower.findTarget(candidates, airTargetingUnlocked, losCheck, this.bodyDistSq);
              if (!target) {
                this.tilesEngine?.towers.releaseTarget(tower.id);
                continue;
              }
              // Update rotation to new target, don't fire this sub-step
              const newHeading = this.calculateHeading(tower.position, this.targetPoint(target));
              this.tilesEngine?.towers.updateRotation(tower.id, newHeading);
              continue;
            }
          }

          // Single fire per sub-step — sub-step is small enough (≤16.67ms game-time)
          // that a tower with fireRate up to 60/sec produces at most 1 shot per step.
          tower.combat.fire();
          projectileManager.spawn(tower, target, heading, this.projectileAim(target));
        }
      } else {
        // No target - check if tower should sleep (game-time)
        if (gameTimeMs - tower.lastTargetTime > Tower.SLEEP_DELAY) {
          tower.isSleeping = true;
        }
        // Keep the heading. The next enemy mostly comes from the same side,
        // and a turret that swung back to a rest pose had to turn round again
        // (up to 1 s) before it was aligned and allowed to fire. The turn to
        // the guard heading waits for the end of the wave.
        this.tilesEngine?.towers.releaseTarget(tower.id);
      }
    }
  }

  /**
   * Calculate heading angle from one geo position to another
   */
  calculateHeading(
    from: { lat: number; lon: number },
    to: { lat: number; lon: number }
  ): number {
    return geoHeading(from, to);
  }

  // =====================================================
  // BEAM TOWER COMBAT (Fire Tower Flamethrower)
  // =====================================================

  /**
   * Update beam towers — continuous damage in a cone area.
   * Called once per gameplay sub-step (~16ms game-time).
   */
  updateBeamTowers(
    deltaTime: number,
    towerManager: TowerManager,
    enemyManager: EnemyManager,
    gameTimeMs: number,
  ): void {
    if (!this.tilesEngine || !this.tilesEngine?.flameBeams) return;

    // Wall-clock used only for the beam-blood-splatter throttle (visual).
    const now = performance.now();
    // deltaTime is sub-step game-time ms — convert to seconds for DPS math.
    const dt = deltaTime / 1000;
    const airTargetingUnlocked = this.researchStore.airTargetingUnlocked();

    for (const tower of towerManager.getAllActive()) {
      // Skip towers with pending LOS computation
      if (!tower.losReady) continue;
      // Skip non-beam towers
      if (tower.typeConfig.attackType !== 'beam') continue;

      // The flame is exactly as long as the tower's range, upgrades included,
      // so findTarget only acquires what the cone reaches. Detection used to
      // be 25 m against a 20 m flame: the tower aimed at enemies it could not
      // burn, and range upgrades widened that ring instead of the flame.
      // The beam margin covers the cone's hit tolerance past its length.
      const beamLength = tower.combat.range;
      const candidates = this.collectCandidates(
        tower,
        beamLength * COMBAT_TUNING.rangeMargin.beam,
        enemyManager,
      );

      // Find primary target (closest/lowest HP in range). Same LOS predicate
      // as the projectile/melee/chain paths — beam towers must not acquire
      // targets behind buildings either.
      this.beginBodyAim(tower);
      const losCheck = this.buildLosCheck(tower, tower.visibleCells.length > 0);
      let target = tower.findTarget(candidates, airTargetingUnlocked, losCheck, this.bodyDistSq);

      // Periodic LOS recheck (throttled, same interval as the projectile
      // path). A beam HOLDS its target: findTarget's fast path keeps the
      // cached target without a LOS check, and unlike projectile towers
      // there is no canFire gate where the recheck would naturally run —
      // without this, a target drifting behind a building kept burning.
      if (target && losCheck && tower.needsLosRecheck(gameTimeMs)) {
        tower.markLosChecked(gameTimeMs);
        if (!losCheck(target)) {
          tower.clearTarget();
          target = tower.findTarget(candidates, airTargetingUnlocked, losCheck, this.bodyDistSq);
        }
      }

      if (target) {
        // Rotate turret towards target
        const heading = this.calculateHeading(tower.position, this.targetPoint(target));
        this.tilesEngine.towers.updateRotation(tower.id, heading);

        // Get local positions
        const terrainHeight = tower.position.height ?? 0;
        const towerLocalPos = this.tilesEngine.sync.geoToLocalSimple(
          tower.position.lat,
          tower.position.lon,
          terrainHeight
        );
        const shootHeight = tower.typeConfig.shootHeight ?? 4.0;
        towerLocalPos.y += tower.typeConfig.heightOffset + shootHeight;

        const targetLocalPos = this.aimLocalPosition(target);

        // Start/update flame beam visual
        const beamWidth = this.getEffectiveBeamWidth(tower);
        this.tilesEngine?.flameBeams.startBeam(
          tower.id,
          towerLocalPos,
          targetLocalPos,
          beamLength,
          beamWidth
        );

        // Start flame sound if not already playing
        if (!this.activeFlameSounds.has(tower.id)) {
          this.startFlameSound(tower.id, towerLocalPos);
        } else {
          // Update sound position
          this.updateFlameSoundPosition(tower.id, towerLocalPos);
        }

        // Apply DPS to all enemies in cone. A share of it is dealt as burn
        // instead of directly: in the cone the total stays the tower's DPS,
        // and an enemy that leaves it keeps burning for the burn duration.
        const dps = this.getEffectiveDPS(tower);
        const burnDps = dps * GAME_BALANCE.effects.burn.beamDpsShare;
        const damageThisFrame = (dps - burnDps) * dt;

        const enemiesInCone = this.getEnemiesInCone(
          towerLocalPos,
          targetLocalPos,
          beamLength,
          beamWidth,
          candidates
        );

        for (const enemy of enemiesInCone) {
          // Throttle blood effects per enemy
          const lastBlood = this.lastBeamBloodEffect.get(enemy.id) ?? 0;
          const showBlood = now - lastBlood > this.BEAM_BLOOD_EFFECT_INTERVAL;
          if (showBlood) {
            this.lastBeamBloodEffect.set(enemy.id, now);
          }

          this.combatEffectService.applyBeamDamage(
            enemy,
            damageThisFrame,
            tower.typeConfig.damageType,
            tower.id,
            showBlood
          );
          // The throttle is keyed per enemy: drop the entry once the beam has
          // killed it instead of carrying it until wave end.
          if (!enemy.alive) {
            this.lastBeamBloodEffect.delete(enemy.id);
            continue;
          }
          this.combatEffectService.applyBurn(enemy, burnDps, tower.id);
        }
      } else {
        // No target - stop beam and sound, the turret keeps its heading
        this.tilesEngine?.flameBeams.stopBeam(tower.id);
        this.stopFlameSound(tower.id);
        this.tilesEngine.towers.releaseTarget(tower.id);
      }
    }

    // Flame-beam shader animation is NOT advanced here. `ThreeTilesEngine`
    // already ticks it once per render frame; doing it again per sub-step
    // advanced the effect by the sub-step count on top, so the flames ran
    // several times too fast whenever the frame rate dropped.
  }

  /**
   * Get effective DPS for a beam tower (with upgrades applied)
   */
  private getEffectiveDPS(tower: Tower): number {
    const dps = tower.typeConfig.damagePerSecond ?? 30;

    // 'damage' upgrades multiply damagePerSecond for beam towers
    const damageUpgrade = tower.typeConfig.upgrades.find(u => u.id === 'damage');
    if (!damageUpgrade) return dps;
    return dps * upgradeFactor(damageUpgrade, tower.getUpgradeLevel('damage'));
  }

  /**
   * Get effective beam width for a tower (with upgrades applied)
   */
  private getEffectiveBeamWidth(tower: Tower): number {
    const width = tower.typeConfig.beamWidth ?? 8;

    const beamWidthUpgrade = tower.typeConfig.upgrades.find(u => u.effect.stat === 'beamWidth');
    if (!beamWidthUpgrade) return width;
    return width * upgradeFactor(beamWidthUpgrade, tower.getUpgradeLevel(beamWidthUpgrade.id));
  }

  /**
   * Get all enemies within a cone from source to target
   *
   * @param source - Cone origin (tower shoot position)
   * @param target - Cone direction target
   * @param maxLength - Maximum cone length
   * @param endWidth - Cone diameter at the end
   * @param candidates - Enemy candidates to check
   */
  private getEnemiesInCone(
    source: Vector3,
    target: Vector3,
    maxLength: number,
    endWidth: number,
    candidates: Enemy[]
  ): Enemy[] {
    if (!this.tilesEngine) return [];

    // Cone from the source toward the target. Half-angle: endWidth is the
    // diameter, tan(angle) = (endWidth/2) / coneLength
    const dir = this.tempDirection.subVectors(target, source).normalize();
    const cone = this._cone;
    cone.x = source.x;
    cone.y = source.y;
    cone.z = source.z;
    cone.dirX = dir.x;
    cone.dirY = dir.y;
    cone.dirZ = dir.z;
    cone.length = Math.min(source.distanceTo(target), maxLength);
    cone.cosHalfAngle = Math.cos(Math.atan2(endWidth / 2, cone.length));

    const result = this._coneScratch;
    result.length = 0;

    for (const enemy of candidates) {
      // Skip air units for fire tower (ground only)
      if (enemy.typeConfig.isAirUnit) continue;

      // Get enemy local position (reuse scratch — runs per candidate per beam)
      let p: Vector3;
      if (enemy.body) {
        // A body along the route: the point this tower aims at on it, where
        // its hit then lands
        if (!this.bodyAim.aim(enemy, this._aimPoint)) continue;
        p = this.tilesEngine.sync.geoToLocalSimpleInto(
          this._aimPoint.lat,
          this._aimPoint.lon,
          this._aimPoint.height + ROUTE_BODY_AIM_HEIGHT_M,
          this._coneEnemyPos
        );
        if (coneContains(cone, p.x, p.y, p.z)) {
          result.push(enemy);
          continue;
        }
        // The flame is on another target and may still cross the body
        const body = enemy.body;
        const groundY = bodyPointInCone(
          body,
          cone,
          this.groundAt,
          enemy.transform.terrainHeight - body.stations.originHeight,
          ROUTE_BODY_AIM_HEIGHT_M,
          this._coneContact,
        );
        if (groundY !== null) {
          body.setHit(this._coneContact.station, this._coneContact.offset, groundY);
          result.push(enemy);
        }
        continue;
      }

      p = this.tilesEngine.sync.geoToLocalSimpleInto(
        enemy.position.lat,
        enemy.position.lon,
        enemy.transform.terrainHeight + enemy.heightOffset,
        this._coneEnemyPos
      );
      p.y += getEnemyAimOffsetY(enemy); // model's visual centre
      if (coneContains(cone, p.x, p.y, p.z)) result.push(enemy);
    }

    return result;
  }

  /**
   * Stop a specific tower's flame beam and sound (called when fire tower is sold)
   */
  stopTowerBeam(towerId: string): void {
    this.tilesEngine?.flameBeams?.stopBeam(towerId);
    this.stopFlameSound(towerId);
  }

  /**
   * Stop all active beams (called on wave end)
   */
  stopAllBeams(): void {
    this.tilesEngine?.flameBeams?.clear();
    this.lastBeamBloodEffect.clear();

    // Stop all flame sounds. Snapshot keys before iterating because
    // stopFlameSound mutates the map.
    for (const towerId of [...this.activeFlameSounds.keys()]) {
      this.stopFlameSound(towerId);
    }
  }

  // =====================================================
  // MELEE TOWER COMBAT (Tentacle Tower)
  // =====================================================

  /**
   * Update melee towers — single-target direct damage with cooldown.
   * Called once per gameplay sub-step (game-time).
   */
  updateMeleeTowers(
    deltaTime: number,
    towerManager: TowerManager,
    enemyManager: EnemyManager,
    gameTimeMs: number,
  ): void {
    if (!this.tilesEngine) return;

    const airTargetingUnlocked = this.researchStore.airTargetingUnlocked();

    for (const tower of towerManager.getAllActive()) {
      // Type-filter MUST be before combat.update — see comment in
      // updateTowerShooting for the cooldown-double-tick bug.
      if (tower.typeConfig.attackType !== 'melee') continue;

      tower.combat.update(deltaTime);

      if (!tower.losReady) continue;

      // Wake check (game-time, no timescale compensation needed thanks to sub-stepping)
      if (tower.isSleeping && !this.tryWakeTower(tower, gameTimeMs)) continue;

      const candidates = this.collectCandidates(
        tower,
        tower.combat.range * COMBAT_TUNING.rangeMargin.standard,
        enemyManager,
      );
      this.beginBodyAim(tower);
      const losCheck = this.buildLosCheck(tower, tower.visibleCells.length > 0);
      const target = tower.findTarget(candidates, airTargetingUnlocked, losCheck, this.bodyDistSq);

      if (target) {
        tower.lastTargetTime = gameTimeMs;
        tower.isSleeping = false;

        const heading = this.calculateHeading(tower.position, this.targetPoint(target));
        this.tilesEngine.towers.updateRotation(tower.id, heading);

        if (tower.combat.canFire()) {
          tower.combat.fire();

          // Before the damage: on a body it also puts the hit where the strike lands
          const targetLocalPos = this.aimLocalPosition(target);
          this.combatEffectService.applyMeleeDamage(
            target,
            tower.combat.damage,
            tower.typeConfig.damageType,
            tower.id,
          );

          this.tilesEngine.tentacles?.startStrike(tower.id, targetLocalPos);
          this.tilesEngine.spatialAudio?.playAt('tentacle-grab', targetLocalPos);
        }
      } else {
        if (gameTimeMs - tower.lastTargetTime > Tower.SLEEP_DELAY) {
          tower.isSleeping = true;
        }
        this.tilesEngine.towers.releaseTarget(tower.id);
      }
    }
  }

  /**
   * Stop all active melee visuals (called on wave end)
   * Resets tentacles to idle — they stay visible as part of the tower
   */
  stopAllMelee(): void {
    this.tilesEngine?.tentacles?.resetAllToIdle();
  }

  // =====================================================
  // CHAIN TOWER COMBAT (Lightning Tower)
  // =====================================================

  /**
   * Update chain-attack towers — hitscan primary + N jumps with damage falloff.
   * Called once per gameplay sub-step (game-time).
   */
  updateChainTowers(
    deltaTime: number,
    towerManager: TowerManager,
    enemyManager: EnemyManager,
    gameTimeMs: number,
  ): void {
    if (!this.tilesEngine) return;

    const airTargetingUnlocked = this.researchStore.airTargetingUnlocked();

    for (const tower of towerManager.getAllActive()) {
      // Type-filter MUST be before combat.update — see comment in
      // updateTowerShooting for the cooldown-double-tick bug.
      if (tower.typeConfig.attackType !== 'chain') continue;

      tower.combat.update(deltaTime);

      if (!tower.losReady) continue;

      // Wake check
      if (tower.isSleeping && !this.tryWakeTower(tower, gameTimeMs)) continue;

      const candidates = this.collectCandidates(
        tower,
        tower.combat.range * COMBAT_TUNING.rangeMargin.standard,
        enemyManager,
      );
      this.beginBodyAim(tower);
      const losCheck = this.buildLosCheck(tower, tower.visibleCells.length > 0);
      const target = tower.findTarget(candidates, airTargetingUnlocked, losCheck, this.bodyDistSq);

      if (!target) {
        if (gameTimeMs - tower.lastTargetTime > Tower.SLEEP_DELAY) {
          tower.isSleeping = true;
        }
        continue;
      }

      tower.lastTargetTime = gameTimeMs;
      tower.isSleeping = false;

      if (!tower.combat.canFire()) continue;
      tower.combat.fire();

      // Build chain hit list: primary + up to maxJumps additional unique targets
      const maxJumps = tower.typeConfig.maxJumps ?? 0;
      const jumpRange = tower.typeConfig.jumpRange ?? 15;
      const hits: Enemy[] = [target];
      const hitIds = new Set<string>([target.id]);
      // Where the bolt is: a body's aim point, so a jump off it starts there
      const first = this.targetPoint(target);
      const at = { lat: first.lat, lon: first.lon };

      for (let i = 0; i < maxJumps; i++) {
        const next = this.findNearestUnhit(at, candidates, hitIds, jumpRange);
        if (!next) break;
        hits.push(next);
        hitIds.add(next.id);
        const p = this.targetPoint(next);
        at.lat = p.lat;
        at.lon = p.lon;
      }

      // Apply damage with falloff per jump
      const falloff = tower.typeConfig.chainFalloff ?? 1.0;
      const baseDamage = tower.combat.damage;
      const damageType = tower.typeConfig.damageType;
      for (let i = 0; i < hits.length; i++) {
        const dmg = baseDamage * Math.pow(falloff, i);
        // A body's hit goes on the aim point the bolt strikes
        if (hits[i].body) this.bodyAim.aim(hits[i], this._aimPoint);
        this.combatEffectService.applyChainDamage(hits[i], dmg, damageType, tower.id);
      }

      // Phase 3 hook — emit VFX event with bolt endpoints
      this.emitChainFireEvent(tower, hits);
    }
  }

  /**
   * Find the nearest enemy (in flat-earth meters) to `from` that has not been
   * hit yet by the current chain and is within `maxDist` meters. A body along
   * the route counts at the tower's aim point on it. Returns null if no
   * candidate qualifies.
   */
  private findNearestUnhit(
    from: { lat: number; lon: number },
    candidates: Enemy[],
    hitIds: Set<string>,
    maxDist: number,
  ): Enemy | null {
    const mPerDegLat = METERS_PER_DEGREE_LAT;
    const mPerDegLon = METERS_PER_DEGREE_LAT * Math.cos(from.lat * DEG_TO_RAD);
    let best: Enemy | null = null;
    let bestSq = maxDist * maxDist;
    for (const e of candidates) {
      if (hitIds.has(e.id) || !e.alive) continue;
      // A body the tower has no point of in range and sight is not jumped to
      let p: { lat: number; lon: number } = e.position;
      if (e.body) {
        if (!this.bodyAim.aim(e, this._aimPoint)) continue;
        p = this._aimPoint;
      }
      const dx = (p.lat - from.lat) * mPerDegLat;
      const dy = (p.lon - from.lon) * mPerDegLon;
      const dSq = dx * dx + dy * dy;
      if (dSq < bestSq) {
        bestSq = dSq;
        best = e;
      }
    }
    return best;
  }

  /**
   * Emit a 'vfx:chain-lightning' event with the local-space points of the
   * chain (tower tip → primary → jump1 → ...). One bolt mesh spawns per
   * consecutive pair in the VFX handler. Also plays the chain-fire sound
   * spatialised at the tower tip.
   */
  private emitChainFireEvent(tower: Tower, hits: Enemy[]): void {
    if (!this.tilesEngine || hits.length === 0) return;

    const towerData = this.tilesEngine.towers.get(tower.id);
    if (!towerData) return;

    const points: { x: number; y: number; z: number }[] = [];

    // Tower tip in local space
    const tipLocal = this.tilesEngine.sync.geoToLocalSimple(
      tower.position.lat,
      tower.position.lon,
      towerData.height,
    );
    const tipY = towerData.tipY;
    points.push({ x: tipLocal.x, y: tipY, z: tipLocal.z });

    // Hits, center-of-mass (a body: the aim point)
    for (const e of hits) {
      const p = this.aimLocalPosition(e);
      points.push({ x: p.x, y: p.y, z: p.z });
    }

    this.combatEffectService.emitChainLightningVfx(points, tower.id);

    // Chain sound from the tower tip (spatialised so distant towers feel quieter)
    this.tempSoundPos.set(tipLocal.x, tipY, tipLocal.z);
    this.tilesEngine.spatialAudio?.playAt('lightning-chain', this.tempSoundPos);
  }

  // =====================================================
  // FLAME SOUND HELPERS
  // =====================================================

  /**
   * Start flame loop sound for a tower.
   *
   * createLoop is async, so without a synchronous reservation a
   * stopFlameSound / stopAllBeams that fires *between* the await and the
   * handle-storing line would silently leak the loop — the loop's handle
   * gets stored after the cancel ran, so nobody can stop it later. This
   * was the "fire sound keeps playing after wave end / kill all" bug.
   *
   * Fix: reserve the slot with a PENDING sentinel before awaiting. After
   * await, only commit the real handle if the sentinel is still there.
   * If the entry is gone (= we got cancelled mid-await), stop the freshly
   * created loop immediately.
   */
  private static readonly FLAME_PENDING: LoopHandle = -1; // real handles count up from 1
  private async startFlameSound(towerId: string, position: Vector3): Promise<void> {
    if (!this.tilesEngine?.spatialAudio) return;

    // Don't start if already playing or in flight
    if (this.activeFlameSounds.has(towerId)) return;

    this.activeFlameSounds.set(towerId, TowerCombatService.FLAME_PENDING);

    this.tempSoundPos.copy(position);
    const handle = await this.tilesEngine.spatialAudio.createLoop(
      'flame-loop',
      this.tempSoundPos,
      { volumeMultiplier: 1.0 }
    );

    const current = this.activeFlameSounds.get(towerId);
    if (current === TowerCombatService.FLAME_PENDING && handle !== null) {
      this.activeFlameSounds.set(towerId, handle);
    } else if (handle !== null) {
      // We were cancelled mid-await. The loop is already playing into
      // the void — stop it now or it leaks forever.
      this.tilesEngine.spatialAudio.stopLoop(handle);
    }
  }

  /**
   * Update flame sound position (for moving camera / distance-based pause)
   */
  private updateFlameSoundPosition(towerId: string, position: Vector3): void {
    const handle = this.activeFlameSounds.get(towerId);
    if (handle === undefined || handle === TowerCombatService.FLAME_PENDING || !this.tilesEngine?.spatialAudio) return;

    this.tempSoundPos.copy(position);
    this.tilesEngine.spatialAudio.updateLoopPosition(handle, this.tempSoundPos);
  }

  /**
   * Stop flame sound for a tower
   */
  private stopFlameSound(towerId: string): void {
    const handle = this.activeFlameSounds.get(towerId);
    if (handle === undefined) return;

    // Pending: clear the slot so the in-flight startFlameSound knows
    // to stop the loop itself once the await resolves.
    this.activeFlameSounds.delete(towerId);
    if (handle === TowerCombatService.FLAME_PENDING) return;

    this.tilesEngine?.spatialAudio?.stopLoop(handle);
  }
}
