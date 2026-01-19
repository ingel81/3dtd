import { Injectable, inject } from '@angular/core';
import { ThreeTilesEngine } from '../three-engine';
import { GlobalRouteGridService } from './global-route-grid.service';
import { Enemy } from '../entities/enemy.entity';
import { TowerManager } from '../managers/tower.manager';
import { EnemyManager } from '../managers/enemy.manager';
import { ProjectileManager } from '../managers/projectile.manager';

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

  private tilesEngine: ThreeTilesEngine | null = null;

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
    projectileManager: ProjectileManager
  ): void {
    // Fallback: full enemy list (used when spatial optimization isn't available)
    const allEnemies = enemyManager.getAlive();

    for (const tower of towerManager.getAllActive()) {
      // Determine if we can use GlobalRouteGrid optimization
      const hasVisibleCells = tower.visibleCells.length > 0;
      const isPureAirTower =
        (tower.typeConfig.canTargetAir ?? false) &&
        !(tower.typeConfig.canTargetGround ?? true);

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
        // FALLBACK: Full enemy list with runtime LOS check
        candidates = allEnemies;
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
      let target = tower.findTarget(candidates, losCheck);

      if (target) {
        // Always rotate turret towards target
        const heading = this.calculateHeading(tower.position, target.position);
        this.tilesEngine?.towers.updateRotation(tower.id, heading);

        // Only fire if cooldown is ready AND turret is aligned
        const turretAligned = this.tilesEngine?.towers.isTurretAligned(tower.id) ?? true;
        if (tower.combat.canFire(currentTime) && turretAligned) {
          // Periodic LOS recheck (throttled to max ~3/sec per tower)
          const isAirTarget = target.typeConfig.isAirUnit ?? false;
          if (losCheck && !isAirTarget && tower.needsLosRecheck(currentTime)) {
            tower.markLosChecked(currentTime);
            if (!losCheck(target)) {
              // Target no longer visible - find new target
              tower.clearTarget();
              target = tower.findTarget(candidates, losCheck);
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
          projectileManager.spawn(tower, target);
        }
      } else {
        // No target - reset turret to base position
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
}
