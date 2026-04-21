import { Injectable, inject } from '@angular/core';
import { Vector3 } from 'three';
import { ThreeTilesEngine } from '../three-engine';
import { GlobalRouteGridService } from './global-route-grid.service';
import { SpatialGridService } from './spatial-grid.service';
import { CombatEffectService } from './combat-effect.service';
import { ResearchStore } from '../store/research.store';
import { Enemy } from '../entities/enemy.entity';
import { Tower } from '../entities/tower.entity';
import { TowerManager } from '../managers/tower.manager';
import { EnemyManager } from '../managers/enemy.manager';
import { ProjectileManager } from '../managers/projectile.manager';
import { TowerTypeId } from '../configs/tower-types.config';
import { canTargetAirEffective } from '../ai/core/tower-dps.util';

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

  // Throttle blood effects for beam damage (every 200ms per enemy)
  private lastBeamBloodEffect = new Map<string, number>();
  private readonly BEAM_BLOOD_EFFECT_INTERVAL = 200;

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
   * Update tower shooting - find targets and spawn projectiles
   * Uses GlobalRouteGrid for O(cells) instead of O(n) enemy checks
   *
   * Optimization strategy:
   * - Ground towers with visibleCells: Query only enemies in visible cells (LOS implicit)
   * - Air towers: Query all enemies (no LOS needed for air units)
   * - Fallback: Full enemy list with runtime LOS check
   */
  updateTowerShooting(
    currentTime: number,
    towerManager: TowerManager,
    enemyManager: EnemyManager,
    projectileManager: ProjectileManager,
    timescale = 1.0
  ): void {
    // Fallback: full enemy list (used when spatial optimization isn't available)
    const allEnemies = enemyManager.getAlive();
    const airTargetingUnlocked = this.researchStore.airTargetingUnlocked();

    for (const tower of towerManager.getAllActive()) {
      // Skip towers with pending LOS computation (progressive registration not yet complete)
      if (!tower.losReady) continue;

      // Skip non-projectile towers (beam, melee) — they have their own update methods
      if (tower.typeConfig.attackType && tower.typeConfig.attackType !== 'projectile') continue;

      // Quick wake check for sleeping towers (every 500ms)
      // Uses SpatialGrid O(k) query instead of brute-force O(n) over all enemies
      if (tower.isSleeping) {
        if (currentTime - tower.lastSleepCheck < 500) continue;
        tower.lastSleepCheck = currentTime;

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
            tower.typeConfig.range * 1.1 // 10% margin for approaching enemies
          );
        }
        if (!hasNearby) continue;
        tower.isSleeping = false;
      }

      // Determine if we can use GlobalRouteGrid optimization
      const hasVisibleCells = tower.visibleCells.length > 0;
      const towerCanAir = canTargetAirEffective(
        tower.typeConfig.id as TowerTypeId,
        airTargetingUnlocked,
      );
      const isPureAirTower =
        towerCanAir && !(tower.typeConfig.canTargetGround ?? true);

      // Get candidate enemies based on tower type and available data
      let candidates: Enemy[];
      let losCheck: ((enemy: Enemy) => boolean) | undefined;

      if (hasVisibleCells && !isPureAirTower) {
        // FAST PATH: Use GlobalRouteGrid for ground towers with visibleCells
        candidates = this.globalRouteGrid.getEnemiesForTower(tower.visibleCells);

        losCheck = this.tilesEngine
          ? (enemy: Enemy) => {
              const pos = this.tilesEngine!.sync.geoToLocalSimple(
                enemy.position.lat,
                enemy.position.lon,
                enemy.transform.terrainHeight
              );
              const visibility = this.globalRouteGrid.isPositionVisibleFromTower(
                tower.id,
                pos.x,
                pos.z
              );
              if (visibility !== undefined) {
                return visibility;
              }
              return this.tilesEngine!.towers.hasLineOfSight(
                tower.id,
                pos.x,
                pos.y + 1.5,
                pos.z
              );
            }
          : undefined;
      } else if (isPureAirTower) {
        // Air towers target all enemies (air units are always visible)
        candidates = allEnemies;
        losCheck = undefined;
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
            rangeMeters * 1.1 // 10% margin
          );
        } else {
          // Ultimate fallback: geo-distance filter (no engine available)
          const mPerDegLat = 111320;
          const mPerDegLon = 111320 * Math.cos(tower.position.lat * Math.PI / 180);
          const rangeMarginSq = (rangeMeters * 1.1) ** 2;

          candidates = allEnemies.filter(enemy => {
            const dx = (enemy.position.lat - tower.position.lat) * mPerDegLat;
            const dy = (enemy.position.lon - tower.position.lon) * mPerDegLon;
            return dx * dx + dy * dy <= rangeMarginSq;
          });
        }
        losCheck = this.tilesEngine
          ? (enemy: Enemy) => {
              const pos = this.tilesEngine!.sync.geoToLocalSimple(
                enemy.position.lat,
                enemy.position.lon,
                enemy.transform.terrainHeight
              );
              return this.tilesEngine!.towers.hasLineOfSight(
                tower.id,
                pos.x,
                pos.y + 1.5,
                pos.z
              );
            }
          : undefined;
      }

      // Fast path: get cached target or find new one
      let target = tower.findTarget(candidates, airTargetingUnlocked, losCheck);

      if (target) {
        // Target found - update sleep tracking
        tower.lastTargetTime = currentTime;
        tower.isSleeping = false;

        // Always rotate turret towards target
        const heading = this.calculateHeading(tower.position, target.position);
        this.tilesEngine?.towers.updateRotation(tower.id, heading);

        // Only fire if cooldown is ready AND turret is aligned
        const turretAligned = this.tilesEngine?.towers.isTurretAligned(tower.id) ?? true;
        if (tower.combat.canFire(currentTime, timescale) && turretAligned) {
          // Periodic LOS recheck (throttled to max ~3/sec per tower)
          const isAirTarget = target.typeConfig.isAirUnit ?? false;
          if (losCheck && !isAirTarget && tower.needsLosRecheck(currentTime, timescale)) {
            tower.markLosChecked(currentTime);
            if (!losCheck(target)) {
              // Target no longer visible - find new target
              tower.clearTarget();
              target = tower.findTarget(candidates, airTargetingUnlocked, losCheck);
              if (!target) {
                this.tilesEngine?.towers.resetRotation(tower.id);
                continue;
              }
              // Update rotation to new target, don't fire this frame
              const newHeading = this.calculateHeading(tower.position, target.position);
              this.tilesEngine?.towers.updateRotation(tower.id, newHeading);
              continue;
            }
          }

          tower.combat.fire(currentTime);
          projectileManager.spawn(tower, target, heading);
        }
      } else {
        // No target - check if tower should sleep
        if (currentTime - tower.lastTargetTime > Tower.SLEEP_DELAY) {
          tower.isSleeping = true;
        }
        // Reset turret to base position
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
   * Update beam towers - continuous damage in cone area
   *
   * @param deltaTime - Time since last frame in milliseconds
   * @param towerManager - Tower manager
   * @param enemyManager - Enemy manager
   * @param timescale - Game speed multiplier
   */
  updateBeamTowers(
    deltaTime: number,
    towerManager: TowerManager,
    enemyManager: EnemyManager,
    timescale = 1.0
  ): void {
    if (!this.tilesEngine || !this.tilesEngine?.flameBeams) return;

    const now = performance.now();
    const dt = (deltaTime / 1000) * timescale; // Convert to seconds, apply timescale
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
            rangeMeters * 1.2 // 20% margin for beam spread
          );
        } else {
          const mPerDegLat = 111320;
          const mPerDegLon = 111320 * Math.cos(tower.position.lat * Math.PI / 180);
          const rangeMarginSq = (rangeMeters * 1.2) ** 2;

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
        targetLocalPos.y += 1.5; // Target center mass

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
      enemyLocalPos.y += 1.0; // Approximate center

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

    // Stop all flame sounds
    for (const towerId of this.activeFlameSounds.keys()) {
      this.stopFlameSound(towerId);
    }
  }

  // =====================================================
  // MELEE TOWER COMBAT (Tentacle Tower)
  // =====================================================

  /**
   * Update melee towers - single-target direct damage with cooldown
   *
   * @param deltaTime - Time since last frame in milliseconds (unused for melee, kept for API consistency)
   * @param towerManager - Tower manager
   * @param enemyManager - Enemy manager
   * @param timescale - Game speed multiplier
   */
  updateMeleeTowers(
    _deltaTime: number,
    towerManager: TowerManager,
    enemyManager: EnemyManager,
    timescale = 1.0
  ): void {
    if (!this.tilesEngine) return;

    const now = performance.now();
    const allEnemies = enemyManager.getAlive();
    const airTargetingUnlocked = this.researchStore.airTargetingUnlocked();

    for (const tower of towerManager.getAllActive()) {
      // Skip towers with pending LOS computation
      if (!tower.losReady) continue;
      // Skip non-melee towers
      if (tower.typeConfig.attackType !== 'melee') continue;

      // Quick wake check for sleeping towers (every 500ms)
      if (tower.isSleeping) {
        if (now - tower.lastSleepCheck < 500) continue;
        tower.lastSleepCheck = now;

        const towerLocal = this.tilesEngine.sync.geoToLocalSimple(
          tower.position.lat,
          tower.position.lon,
          0
        );
        const hasNearby = this.spatialGrid.hasEnemyInRadius(
          towerLocal.x,
          towerLocal.z,
          tower.typeConfig.range * 1.1
        );
        if (!hasNearby) continue;
        tower.isSleeping = false;
      }

      // Get candidate enemies (same logic as beam towers)
      const hasVisibleCells = tower.visibleCells.length > 0;
      let candidates: Enemy[];

      if (hasVisibleCells) {
        candidates = this.globalRouteGrid.getEnemiesForTower(tower.visibleCells);
      } else {
        const rangeMeters = tower.typeConfig.range;
        const towerLocal = this.tilesEngine.sync.geoToLocalSimple(
          tower.position.lat,
          tower.position.lon,
          0
        );
        candidates = this.globalRouteGrid.getEnemiesInRadius(
          towerLocal.x,
          towerLocal.z,
          rangeMeters * 1.1
        );
      }

      // Find target
      const target = tower.findTarget(candidates, airTargetingUnlocked);

      if (target) {
        // Target found - update sleep tracking
        tower.lastTargetTime = now;
        tower.isSleeping = false;

        // Rotate turret towards target
        const heading = this.calculateHeading(tower.position, target.position);
        this.tilesEngine.towers.updateRotation(tower.id, heading);

        // Fire if cooldown ready
        if (tower.combat.canFire(now, timescale)) {
          tower.combat.fire(now);

          // Apply direct melee damage
          this.combatEffectService.applyMeleeDamage(
            target,
            tower.combat.damage,
            tower.typeConfig.damageType,
            tower.id
          );

          // Start tentacle strike visual
          const targetLocalPos = this.tilesEngine.sync.geoToLocalSimple(
            target.position.lat,
            target.position.lon,
            target.transform.terrainHeight + (target.typeConfig.heightOffset ?? 0)
          );
          targetLocalPos.y += 1.5; // Target center mass
          this.tilesEngine.tentacles?.startStrike(tower.id, targetLocalPos);

          // Play tentacle strike sound at target position
          this.tilesEngine.spatialAudio?.playAt('tentacle-grab', targetLocalPos);
        }
      } else {
        // No target - check if tower should sleep
        if (now - tower.lastTargetTime > Tower.SLEEP_DELAY) {
          tower.isSleeping = true;
        }
        // Reset turret to base position
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
  // FLAME SOUND HELPERS
  // =====================================================

  /**
   * Start flame loop sound for a tower
   */
  private async startFlameSound(towerId: string, position: Vector3): Promise<void> {
    if (!this.tilesEngine?.spatialAudio) return;

    // Don't start if already playing
    if (this.activeFlameSounds.has(towerId)) return;

    // Create loop sound and store handle
    this.tempSoundPos.copy(position);
    const handle = await this.tilesEngine.spatialAudio.createLoop(
      'flame-loop',
      this.tempSoundPos,
      { volumeMultiplier: 1.0 }
    );

    if (handle) {
      this.activeFlameSounds.set(towerId, handle);
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

    this.tilesEngine?.spatialAudio?.stopLoop(handle);
    this.activeFlameSounds.delete(towerId);
  }
}
