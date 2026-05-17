import { Injectable, inject } from '@angular/core';
import { Vector3 } from 'three';
import { ThreeTilesEngine } from '../../three-engine';
import { GlobalRouteGridService } from '../world/global-route-grid.service';
import { SpatialGridService } from '../world/spatial-grid.service';
import { CombatEffectService } from './combat-effect.service';
import { ResearchStore } from '../../store/research.store';
import { Enemy } from '../../entities/enemy.entity';
import { Tower } from '../../entities/tower.entity';
import { TowerManager } from '../../managers/tower.manager';
import { METERS_PER_DEGREE_LAT, DEG_TO_RAD } from '../../utils/geo-utils';
import { getEnemyAimOffsetY } from '../../utils/enemy-aim.util';
import { COMBAT_TUNING } from '../../configs/combat-tuning.config';
import { EnemyManager } from '../../managers/enemy.manager';
import { ProjectileManager } from '../../managers/projectile.manager';

/**
 * TowerCombatService - Handles tower targeting, rotation, and shooting
 *
 * Extracted from GameStateManager to reduce god object complexity.
 * Manages:
 * - Tower targeting with GlobalRouteGrid optimization
 * - Turret rotation towards targets
 * - Firing and projectile spawning
 * - Idle rotation when no targets
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

  // Active flame sound loops per tower (towerId -> soundHandle)
  private activeFlameSounds = new Map<string, string>();

  // Reusable vectors for cone collision
  private readonly tempDirection = new Vector3();
  private readonly tempToEnemy = new Vector3();
  private readonly tempSoundPos = new Vector3();

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
    // One reusable vector per predicate — avoids a per-enemy Vector3 allocation
    // while the LoS check sweeps the candidate list. Capturing `engine` also
    // removes the non-null assertion on the (nullable) tilesEngine field.
    const pos = new Vector3();
    return (enemy: Enemy) => {
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
        ? pos.y + (enemy.typeConfig.heightOffset ?? 0)
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
   * Update tower idle rotations - smooth return to base position
   * Call this when NOT in wave phase
   */
  updateTowerIdleRotations(towerManager: TowerManager): void {
    for (const tower of towerManager.getAllActive()) {
      if (tower.typeConfig.attackType === 'passive') continue;
      this.tilesEngine?.towers.resetRotation(tower.id);
    }
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
    // Fallback: full enemy list (used when spatial optimization isn't available)
    const allEnemies = enemyManager.getAlive();
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

      // Quick wake check for sleeping towers (every 500ms game-time).
      // Uses SpatialGrid O(k) query instead of brute-force O(n) over all enemies.
      if (tower.isSleeping) {
        if (gameTimeMs - tower.lastSleepCheck < COMBAT_TUNING.towerSleepCheckIntervalMs) continue;
        tower.lastSleepCheck = gameTimeMs;

        // Use spatial grid for fast proximity check (local coordinates, meters)
        let hasNearby = false;
        if (this.tilesEngine) {
          const towerLocal = this.tilesEngine.sync.geoToLocalSimple(
            tower.position.lat,
            tower.position.lon,
            0
          );
          hasNearby = this.spatialGrid.hasEnemyInRadius(
            towerLocal.x,
            towerLocal.z,
            tower.typeConfig.range * COMBAT_TUNING.rangeMargin.standard
          );
        }
        if (!hasNearby) continue;
        tower.isSleeping = false;
      }

      // Determine if we can use GlobalRouteGrid optimization
      const hasVisibleCells = tower.visibleCells.length > 0;

      // Get candidate enemies based on tower type and available data.
      // losCheck dispatches per-enemy on isAirUnit so air targets resolve
      // against air-LoS (skyline + clearance) and ground targets against
      // ground-LoS — picked up from cell.airVisibility / cell.towerVisibility
      // pre-compute, with a runtime raycast fallback for both.
      let candidates: Enemy[];
      let losCheck: ((enemy: Enemy) => boolean) | undefined;

      if (hasVisibleCells) {
        // FAST PATH: Use GlobalRouteGrid for towers with visibleCells.
        // Works for ground, air-only and dual-targeting towers — visibleCells
        // is the union of ground + air visible cells, so a "blue-only" cell
        // would still produce candidates; buildLosCheck filters those per-enemy.
        candidates = this.globalRouteGrid.getEnemiesForTower(tower.visibleCells);
        losCheck = this.buildLosCheck(tower, true);
      } else {
        // FALLBACK: Use GlobalRouteGrid radius query for O(cells_in_radius) pre-filtering
        // Returns Enemy[] directly — no ID resolution needed
        const rangeMeters = tower.typeConfig.range;
        if (this.tilesEngine) {
          const towerLocal = this.tilesEngine.sync.geoToLocalSimple(
            tower.position.lat,
            tower.position.lon,
            0
          );
          candidates = this.globalRouteGrid.getEnemiesInRadius(
            towerLocal.x,
            towerLocal.z,
            rangeMeters * COMBAT_TUNING.rangeMargin.standard
          );
        } else {
          // Ultimate fallback: geo-distance filter (no engine available)
          const mPerDegLat = METERS_PER_DEGREE_LAT;
          const mPerDegLon = METERS_PER_DEGREE_LAT * Math.cos(tower.position.lat * DEG_TO_RAD);
          const rangeMarginSq = (rangeMeters * COMBAT_TUNING.rangeMargin.standard) ** 2;

          candidates = allEnemies.filter(enemy => {
            const dx = (enemy.position.lat - tower.position.lat) * mPerDegLat;
            const dy = (enemy.position.lon - tower.position.lon) * mPerDegLon;
            return dx * dx + dy * dy <= rangeMarginSq;
          });
        }
        losCheck = this.buildLosCheck(tower, false);
      }

      // Fast path: get cached target or find new one
      let target = tower.findTarget(candidates, airTargetingUnlocked, losCheck);

      if (target) {
        // Target found - update sleep tracking (game-time)
        tower.lastTargetTime = gameTimeMs;
        tower.isSleeping = false;

        // Always rotate turret towards target (rotation advances per sub-step)
        const heading = this.calculateHeading(tower.position, target.position);
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
              target = tower.findTarget(candidates, airTargetingUnlocked, losCheck);
              if (!target) {
                this.tilesEngine?.towers.resetRotation(tower.id);
                continue;
              }
              // Update rotation to new target, don't fire this sub-step
              const newHeading = this.calculateHeading(tower.position, target.position);
              this.tilesEngine?.towers.updateRotation(tower.id, newHeading);
              continue;
            }
          }

          // Single fire per sub-step — sub-step is small enough (≤16.67ms game-time)
          // that a tower with fireRate up to 60/sec produces at most 1 shot per step.
          tower.combat.fire();
          projectileManager.spawn(tower, target, heading);
        }
      } else {
        // No target - check if tower should sleep (game-time)
        if (gameTimeMs - tower.lastTargetTime > Tower.SLEEP_DELAY) {
          tower.isSleeping = true;
        }
        this.tilesEngine?.towers.resetRotation(tower.id);
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
    const dLon = to.lon - from.lon;
    const dLat = to.lat - from.lat;
    return Math.atan2(dLon, dLat);
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
  ): void {
    if (!this.tilesEngine || !this.tilesEngine?.flameBeams) return;

    // Wall-clock used only for the beam-blood-splatter throttle (visual).
    const now = performance.now();
    // deltaTime is sub-step game-time ms — convert to seconds for DPS math.
    const dt = deltaTime / 1000;
    const allEnemies = enemyManager.getAlive();
    const airTargetingUnlocked = this.researchStore.airTargetingUnlocked();

    for (const tower of towerManager.getAllActive()) {
      // Skip towers with pending LOS computation
      if (!tower.losReady) continue;
      // Skip non-beam towers
      if (tower.typeConfig.attackType !== 'beam') continue;

      // Get candidate enemies (same logic as projectile towers)
      const hasVisibleCells = tower.visibleCells.length > 0;
      let candidates: Enemy[];

      if (hasVisibleCells) {
        candidates = this.globalRouteGrid.getEnemiesForTower(tower.visibleCells);
      } else {
        // FALLBACK: Use GlobalRouteGrid radius query for O(cells_in_radius) pre-filtering
        // Returns Enemy[] directly — no ID resolution needed
        const rangeMeters = tower.typeConfig.beamRange ?? 35;
        if (this.tilesEngine) {
          const towerLocal = this.tilesEngine.sync.geoToLocalSimple(
            tower.position.lat,
            tower.position.lon,
            0
          );
          candidates = this.globalRouteGrid.getEnemiesInRadius(
            towerLocal.x,
            towerLocal.z,
            rangeMeters * COMBAT_TUNING.rangeMargin.beam
          );
        } else {
          const mPerDegLat = METERS_PER_DEGREE_LAT;
          const mPerDegLon = METERS_PER_DEGREE_LAT * Math.cos(tower.position.lat * DEG_TO_RAD);
          const rangeMarginSq = (rangeMeters * COMBAT_TUNING.rangeMargin.beam) ** 2;

          candidates = allEnemies.filter(enemy => {
            const dx = (enemy.position.lat - tower.position.lat) * mPerDegLat;
            const dy = (enemy.position.lon - tower.position.lon) * mPerDegLon;
            return dx * dx + dy * dy <= rangeMarginSq;
          });
        }
      }

      // Find primary target (closest/lowest HP in range)
      const target = tower.findTarget(candidates, airTargetingUnlocked);

      if (target) {
        // Rotate turret towards target
        const heading = this.calculateHeading(tower.position, target.position);
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

        const targetLocalPos = this.tilesEngine.sync.geoToLocalSimple(
          target.position.lat,
          target.position.lon,
          target.transform.terrainHeight + (target.typeConfig.heightOffset ?? 0)
        );
        targetLocalPos.y += getEnemyAimOffsetY(target); // aim at the model's visual centre

        // Start/update flame beam visual
        const beamLength = tower.typeConfig.beamRange ?? 35;
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

        // Apply DPS to all enemies in cone
        const dps = this.getEffectiveDPS(tower);
        const damageThisFrame = dps * dt;

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
        }
      } else {
        // No target - stop beam, sound, and reset turret
        this.tilesEngine?.flameBeams.stopBeam(tower.id);
        this.stopFlameSound(tower.id);
        this.tilesEngine.towers.resetRotation(tower.id);
      }
    }

    // Update flame beam shader animations
    this.tilesEngine?.flameBeams.update(deltaTime);
  }

  /**
   * Get effective DPS for a beam tower (with upgrades applied)
   */
  private getEffectiveDPS(tower: Tower): number {
    let dps = tower.typeConfig.damagePerSecond ?? 30;

    // Apply damage upgrade multiplier
    // Note: 'damage' upgrades multiply damagePerSecond for beam towers
    const damageUpgrade = tower.typeConfig.upgrades.find(u => u.id === 'damage');
    if (damageUpgrade) {
      const level = tower.getUpgradeLevel('damage');
      if (level > 0) {
        dps *= Math.pow(damageUpgrade.effect.multiplier, level);
      }
    }

    return dps;
  }

  /**
   * Get effective beam width for a tower (with upgrades applied)
   */
  private getEffectiveBeamWidth(tower: Tower): number {
    let width = tower.typeConfig.beamWidth ?? 8;

    // Apply beamWidth upgrade (e.g. Fire Tower "Wide Burn")
    const beamWidthUpgrade = tower.typeConfig.upgrades.find(u => u.effect.stat === 'beamWidth');
    if (beamWidthUpgrade) {
      const level = tower.getUpgradeLevel(beamWidthUpgrade.id);
      if (level > 0) {
        width *= Math.pow(beamWidthUpgrade.effect.multiplier, level);
      }
    }

    return width;
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

    // Calculate cone direction
    this.tempDirection.subVectors(target, source).normalize();
    const coneLength = Math.min(source.distanceTo(target), maxLength);

    // Half-angle of cone (endWidth is diameter, so radius = endWidth/2)
    // tan(angle) = (endWidth/2) / coneLength
    const halfAngle = Math.atan2(endWidth / 2, coneLength);
    const cosHalfAngle = Math.cos(halfAngle);

    const result: Enemy[] = [];

    for (const enemy of candidates) {
      // Skip air units for fire tower (ground only)
      if (enemy.typeConfig.isAirUnit) continue;

      // Get enemy local position
      const enemyLocalPos = this.tilesEngine.sync.geoToLocalSimple(
        enemy.position.lat,
        enemy.position.lon,
        enemy.transform.terrainHeight + (enemy.typeConfig.heightOffset ?? 0)
      );
      enemyLocalPos.y += getEnemyAimOffsetY(enemy); // model's visual centre

      // Vector from source to enemy
      this.tempToEnemy.subVectors(enemyLocalPos, source);
      const distToEnemy = this.tempToEnemy.length();

      // Check if within cone length
      if (distToEnemy > coneLength + 2) continue; // +2m margin for enemy size

      // Check if within cone angle
      this.tempToEnemy.normalize();
      const dot = this.tempDirection.dot(this.tempToEnemy);

      if (dot >= cosHalfAngle) {
        result.push(enemy);
      }
    }

    return result;
  }

  /**
   * Stop a specific tower's flame beam and sound (called when fire tower is sold)
   */
  stopTowerBeam(towerId: string): void {
    this.tilesEngine?.flameBeams?.stopBeam(towerId);
    this.stopFlameSound(towerId);
    this.lastBeamBloodEffect.delete(towerId);
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
      if (tower.isSleeping) {
        if (gameTimeMs - tower.lastSleepCheck < COMBAT_TUNING.towerSleepCheckIntervalMs) continue;
        tower.lastSleepCheck = gameTimeMs;

        const towerLocal = this.tilesEngine.sync.geoToLocalSimple(
          tower.position.lat,
          tower.position.lon,
          0,
        );
        const hasNearby = this.spatialGrid.hasEnemyInRadius(
          towerLocal.x,
          towerLocal.z,
          tower.typeConfig.range * 1.1,
        );
        if (!hasNearby) continue;
        tower.isSleeping = false;
      }

      const hasVisibleCells = tower.visibleCells.length > 0;
      let candidates: Enemy[];

      if (hasVisibleCells) {
        candidates = this.globalRouteGrid.getEnemiesForTower(tower.visibleCells);
      } else {
        const rangeMeters = tower.typeConfig.range;
        const towerLocal = this.tilesEngine.sync.geoToLocalSimple(
          tower.position.lat,
          tower.position.lon,
          0,
        );
        candidates = this.globalRouteGrid.getEnemiesInRadius(
          towerLocal.x,
          towerLocal.z,
          rangeMeters * COMBAT_TUNING.rangeMargin.standard,
        );
      }

      const losCheck = this.buildLosCheck(tower, hasVisibleCells);
      const target = tower.findTarget(candidates, airTargetingUnlocked, losCheck);

      if (target) {
        tower.lastTargetTime = gameTimeMs;
        tower.isSleeping = false;

        const heading = this.calculateHeading(tower.position, target.position);
        this.tilesEngine.towers.updateRotation(tower.id, heading);

        if (tower.combat.canFire()) {
          tower.combat.fire();

          this.combatEffectService.applyMeleeDamage(
            target,
            tower.combat.damage,
            tower.typeConfig.damageType,
            tower.id,
          );

          const targetLocalPos = this.tilesEngine.sync.geoToLocalSimple(
            target.position.lat,
            target.position.lon,
            target.transform.terrainHeight + (target.typeConfig.heightOffset ?? 0),
          );
          targetLocalPos.y += getEnemyAimOffsetY(target); // model's visual centre
          this.tilesEngine.tentacles?.startStrike(tower.id, targetLocalPos);
          this.tilesEngine.spatialAudio?.playAt('tentacle-grab', targetLocalPos);
        }
      } else {
        if (gameTimeMs - tower.lastTargetTime > Tower.SLEEP_DELAY) {
          tower.isSleeping = true;
        }
        this.tilesEngine.towers.resetRotation(tower.id);
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
      if (tower.isSleeping) {
        if (gameTimeMs - tower.lastSleepCheck < COMBAT_TUNING.towerSleepCheckIntervalMs) continue;
        tower.lastSleepCheck = gameTimeMs;

        const towerLocal = this.tilesEngine.sync.geoToLocalSimple(
          tower.position.lat,
          tower.position.lon,
          0,
        );
        const hasNearby = this.spatialGrid.hasEnemyInRadius(
          towerLocal.x,
          towerLocal.z,
          tower.typeConfig.range * COMBAT_TUNING.rangeMargin.standard,
        );
        if (!hasNearby) continue;
        tower.isSleeping = false;
      }

      const hasVisibleCells = tower.visibleCells.length > 0;
      let candidates: Enemy[];

      if (hasVisibleCells) {
        candidates = this.globalRouteGrid.getEnemiesForTower(tower.visibleCells);
      } else {
        const rangeMeters = tower.typeConfig.range;
        const towerLocal = this.tilesEngine.sync.geoToLocalSimple(
          tower.position.lat,
          tower.position.lon,
          0,
        );
        candidates = this.globalRouteGrid.getEnemiesInRadius(
          towerLocal.x,
          towerLocal.z,
          rangeMeters * COMBAT_TUNING.rangeMargin.standard,
        );
      }

      const losCheck = this.buildLosCheck(tower, hasVisibleCells);
      const target = tower.findTarget(candidates, airTargetingUnlocked, losCheck);

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
      let lastEnemy: Enemy = target;

      for (let i = 0; i < maxJumps; i++) {
        const next = this.findNearestUnhit(lastEnemy, candidates, hitIds, jumpRange);
        if (!next) break;
        hits.push(next);
        hitIds.add(next.id);
        lastEnemy = next;
      }

      // Apply damage with falloff per jump
      const falloff = tower.typeConfig.chainFalloff ?? 1.0;
      const baseDamage = tower.combat.damage;
      const damageType = tower.typeConfig.damageType;
      for (let i = 0; i < hits.length; i++) {
        const dmg = baseDamage * Math.pow(falloff, i);
        this.combatEffectService.applyChainDamage(hits[i], dmg, damageType, tower.id);
      }

      // Phase 3 hook — emit VFX event with bolt endpoints
      this.emitChainFireEvent(tower, hits);
    }
  }

  /**
   * Find the nearest enemy (in flat-earth meters) to `from` that has not been
   * hit yet by the current chain and is within `maxDist` meters. Returns null
   * if no candidate qualifies.
   */
  private findNearestUnhit(
    from: Enemy,
    candidates: Enemy[],
    hitIds: Set<string>,
    maxDist: number,
  ): Enemy | null {
    const mPerDegLat = METERS_PER_DEGREE_LAT;
    const mPerDegLon = METERS_PER_DEGREE_LAT * Math.cos(from.position.lat * DEG_TO_RAD);
    let best: Enemy | null = null;
    let bestSq = maxDist * maxDist;
    for (const e of candidates) {
      if (hitIds.has(e.id) || !e.alive) continue;
      const dx = (e.position.lat - from.position.lat) * mPerDegLat;
      const dy = (e.position.lon - from.position.lon) * mPerDegLon;
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

    // Hits, center-of-mass
    for (const e of hits) {
      const p = this.tilesEngine.sync.geoToLocalSimple(
        e.position.lat,
        e.position.lon,
        e.transform.terrainHeight + (e.typeConfig.heightOffset ?? 0),
      );
      points.push({ x: p.x, y: p.y + getEnemyAimOffsetY(e), z: p.z });
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
  private static readonly FLAME_PENDING = '<pending>';
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
    if (current === TowerCombatService.FLAME_PENDING && handle) {
      this.activeFlameSounds.set(towerId, handle);
    } else if (handle) {
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
    if (!handle || !this.tilesEngine?.spatialAudio) return;

    this.tempSoundPos.copy(position);
    this.tilesEngine.spatialAudio.updateLoopPosition(handle, this.tempSoundPos);
  }

  /**
   * Stop flame sound for a tower
   */
  private stopFlameSound(towerId: string): void {
    const handle = this.activeFlameSounds.get(towerId);
    if (!handle) return;

    // Pending: clear the slot so the in-flight startFlameSound knows
    // to stop the loop itself once the await resolves.
    this.activeFlameSounds.delete(towerId);
    if (handle === TowerCombatService.FLAME_PENDING) return;

    this.tilesEngine?.spatialAudio?.stopLoop(handle);
  }
}
