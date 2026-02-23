import { InstancedMesh } from 'three';
import { GameObject } from '../core/game-object';
import { ComponentType } from '../core/component';
import {
  TransformComponent,
  CombatComponent,
  RenderComponent,
} from '../game-components';
import { GeoPosition } from '../models/game.types';
import { TowerTypeId, getTowerType, TowerTypeConfig, UpgradeId, TowerUpgrade, getUpgradeCost, TargetingStrategy, AirSubStrategy } from '../configs/tower-types.config';
import { TIMING } from '../configs/timing.config';
import { Enemy } from './enemy.entity';
import { RouteCell } from '../utils/global-route-grid';

/**
 * Tower entity - combines Transform, Combat, and Render components
 */
export class Tower extends GameObject {
  readonly typeConfig: TowerTypeConfig;

  private _transform!: TransformComponent;
  private _combat!: CombatComponent;
  private _render!: RenderComponent;

  /** Track upgrade levels for each upgrade type */
  private upgradeLevels = new Map<UpgradeId, number>();

  /** Current targeting strategy (can be changed per tower by player) */
  targetingStrategy: TargetingStrategy;

  /** Sub-strategy for air-priority pool selection (closest/weakest/strongest) */
  airSubStrategy: AirSubStrategy;

  selected = false;

  /** Whether this tower is sleeping (no enemies in range) */
  isSleeping = false;

  /** Timestamp when tower last had a target */
  lastTargetTime = 0;

  /** Timestamp of last sleep wake-check */
  lastSleepCheck = 0;

  /** Pre-computed range² in geo-degrees for quick sleep checks */
  rangeSquaredGeo = 0;

  /** How long (ms) without a target before sleeping */
  static readonly SLEEP_DELAY = 2000; // 2 seconds

  /** Custom rotation set by user during placement (radians) */
  customRotation = 0;

  /** Index for alternating fire points (dual-barrel etc.) */
  private _nextFirePointIndex = 0;

  /** References to visible cells from GlobalRouteGrid (for targeting) */
  visibleCells: RouteCell[] = [];

  /** LOS visualization mesh (shown when tower is selected) */
  losVisualization: InstancedMesh | null = null;

  /** Cached current target - avoid re-searching every frame */
  private _currentTarget: Enemy | null = null;

  /** Last time LOS was verified for current target */
  private _lastLosCheckTime = 0;

  /** Minimum interval between LOS rechecks (ms) */
  private readonly LOS_RECHECK_INTERVAL = TIMING.losRecheckInterval;

  constructor(position: GeoPosition, typeId: TowerTypeId, customRotation = 0) {
    super('tower');
    this.typeConfig = getTowerType(typeId);
    this.customRotation = customRotation;
    this.targetingStrategy = this.typeConfig.defaultTargeting ?? 'closest';
    this.airSubStrategy = this.typeConfig.defaultAirSubStrategy ?? 'closest';

    // Add components
    this._transform = this.addComponent(
      new TransformComponent(this),
      ComponentType.TRANSFORM
    );
    this._combat = this.addComponent(
      new CombatComponent(this, {
        damage: this.typeConfig.damage,
        range: this.typeConfig.range,
        fireRate: this.typeConfig.fireRate,
      }),
      ComponentType.COMBAT
    );
    this._render = this.addComponent(
      new RenderComponent(this),
      ComponentType.RENDER
    );

    this._transform.setPosition(position.lat, position.lon, position.height);

    // Pre-compute range² in geo-degrees for quick sleep wake-checks
    const metersPerDegreeLat = 111320;
    const metersPerDegreeLon = 111320 * Math.cos(position.lat * 0.0174533);
    // Use average of lat/lon scale for approximation
    const avgMetersPerDegree = (metersPerDegreeLat + metersPerDegreeLon) / 2;
    const rangeInDegrees = this.typeConfig.range / avgMetersPerDegree;
    this.rangeSquaredGeo = rangeInDegrees * rangeInDegrees;
  }

  get transform(): TransformComponent {
    return this._transform;
  }
  get combat(): CombatComponent {
    return this._combat;
  }
  get render(): RenderComponent {
    return this._render;
  }

  get position(): GeoPosition {
    return this.transform.position;
  }

  /**
   * Get the next fire point offset (alternating for multi-barrel towers).
   * Returns null if no fire points are configured.
   */
  getNextFirePoint(): { x: number; z: number } | null {
    const points = this.typeConfig.firePoints;
    if (!points || points.length === 0) return null;
    const point = points[this._nextFirePointIndex % points.length];
    this._nextFirePointIndex++;
    return point;
  }

  /**
   * Get current target (for rotation tracking)
   */
  get currentTarget(): Enemy | null {
    return this._currentTarget;
  }

  /**
   * Clear current target (call when target dies or leaves range)
   */
  clearTarget(): void {
    this._currentTarget = null;
    this._lastLosCheckTime = 0;
  }

  /**
   * Check if LOS recheck is needed (time-based throttling)
   * @param currentTime Current timestamp in ms
   * @param timescale Game speed multiplier (1.0 = normal, 8.0 = 8x faster)
   * @returns true if LOS should be rechecked
   */
  needsLosRecheck(currentTime: number, timescale = 1.0): boolean {
    const interval = this.LOS_RECHECK_INTERVAL / timescale;
    return currentTime - this._lastLosCheckTime >= interval;
  }

  /**
   * Mark that LOS was just checked
   * @param currentTime Current timestamp in ms
   */
  markLosChecked(currentTime: number): void {
    this._lastLosCheckTime = currentTime;
  }

  /**
   * Find target enemy within range using the tower's targeting strategy.
   * OPTIMIZED: Caches target to avoid expensive LOS checks every frame.
   * @param enemies List of potential targets
   * @param losCheck Optional line-of-sight check function (only called on target change)
   * @returns Best enemy based on targeting strategy that is in range and visible, or null
   */
  findTarget(enemies: Enemy[], losCheck?: (enemy: Enemy) => boolean): Enemy | null {
    // Fast path: Check if current target is still valid (no LOS check needed)
    if (this._currentTarget) {
      if (this._currentTarget.alive) {
        // Verify target type is still compatible (air/ground)
        const isAirEnemy = this._currentTarget.typeConfig.isAirUnit ?? false;
        const canTargetAir = this.typeConfig.canTargetAir ?? false;
        const canTargetGround = this.typeConfig.canTargetGround ?? true;
        const typeValid = (isAirEnemy && canTargetAir) || (!isAirEnemy && canTargetGround);

        if (typeValid) {
          const dist = this.calculateDistanceFast(this.position, this._currentTarget.position);
          if (dist <= this.combat.range) {
            // Target still valid - keep it without expensive LOS recheck
            return this._currentTarget;
          }
        }
      }
      // Target invalid - clear and search for new one
      this._currentTarget = null;
    }

    // Slow path: Search for new target (with LOS checks)
    // Build list of valid candidates first
    const candidates: Enemy[] = [];

    // Get targeting capabilities (defaults: canTargetGround=true, canTargetAir=false)
    const canTargetAir = this.typeConfig.canTargetAir ?? false;
    const canTargetGround = this.typeConfig.canTargetGround ?? true;

    for (const enemy of enemies) {
      if (!enemy.alive) continue;

      // Air/Ground targeting filter
      const isAirEnemy = enemy.typeConfig.isAirUnit ?? false;
      if (isAirEnemy && !canTargetAir) continue;
      if (!isAirEnemy && !canTargetGround) continue;

      const dist = this.calculateDistanceFast(this.position, enemy.position);
      if (dist > this.combat.range) continue;

      // LOS check only when selecting NEW target
      // Skip LOS for air enemies - they fly high enough to always be visible
      if (losCheck && !isAirEnemy && !losCheck(enemy)) continue;

      candidates.push(enemy);
    }

    if (candidates.length === 0) {
      this._currentTarget = null;
      return null;
    }

    // Select best target based on strategy
    const bestTarget = this.selectByStrategy(candidates);

    // Cache the new target
    this._currentTarget = bestTarget;
    return bestTarget;
  }

  /**
   * Select the best target from valid candidates based on the current targeting strategy.
   */
  private selectByStrategy(candidates: Enemy[]): Enemy | null {
    switch (this.targetingStrategy) {
      case 'closest': {
        let best: Enemy | null = null;
        let bestDist = Infinity;
        for (const enemy of candidates) {
          const dist = this.calculateDistanceFast(this.position, enemy.position);
          if (dist < bestDist) {
            bestDist = dist;
            best = enemy;
          }
        }
        return best;
      }

      case 'lowest-hp': {
        let best: Enemy | null = null;
        let lowestHp = Infinity;
        for (const enemy of candidates) {
          if (enemy.health.hp < lowestHp) {
            lowestHp = enemy.health.hp;
            best = enemy;
          }
        }
        return best;
      }

      case 'highest-hp': {
        let best: Enemy | null = null;
        let highestHp = -Infinity;
        for (const enemy of candidates) {
          if (enemy.health.hp > highestHp) {
            highestHp = enemy.health.hp;
            best = enemy;
          }
        }
        return best;
      }

      case 'first': {
        // Pick the enemy furthest along its path (closest to reaching the end)
        let best: Enemy | null = null;
        let highestProgress = -Infinity;
        for (const enemy of candidates) {
          const progress = enemy.movement.getPathProgress();
          if (progress > highestProgress) {
            highestProgress = progress;
            best = enemy;
          }
        }
        return best;
      }

      case 'air-priority': {
        // Separate air and ground enemies
        const airEnemies: Enemy[] = [];
        const groundEnemies: Enemy[] = [];
        for (const enemy of candidates) {
          if (enemy.typeConfig.isAirUnit) {
            airEnemies.push(enemy);
          } else {
            groundEnemies.push(enemy);
          }
        }
        // Pick from air pool first (using sub-strategy), then ground fallback
        const pool = airEnemies.length > 0 ? airEnemies : groundEnemies;
        return this.selectFromPool(pool, this.airSubStrategy);
      }

      default:
        return candidates[0] ?? null;
    }
  }

  /**
   * Select best enemy from a pool using the given sub-strategy.
   */
  private selectFromPool(pool: Enemy[], strategy: AirSubStrategy): Enemy | null {
    if (pool.length === 0) return null;

    switch (strategy) {
      case 'closest': {
        let best: Enemy | null = null;
        let bestDist = Infinity;
        for (const enemy of pool) {
          const dist = this.calculateDistanceFast(this.position, enemy.position);
          if (dist < bestDist) {
            bestDist = dist;
            best = enemy;
          }
        }
        return best;
      }
      case 'lowest-hp': {
        let best: Enemy | null = null;
        let lowestHp = Infinity;
        for (const enemy of pool) {
          if (enemy.health.hp < lowestHp) {
            lowestHp = enemy.health.hp;
            best = enemy;
          }
        }
        return best;
      }
      case 'highest-hp': {
        let best: Enemy | null = null;
        let highestHp = -Infinity;
        for (const enemy of pool) {
          if (enemy.health.hp > highestHp) {
            highestHp = enemy.health.hp;
            best = enemy;
          }
        }
        return best;
      }
    }
  }

  /**
   * Select this tower
   */
  select(): void {
    this.selected = true;
  }

  /**
   * Deselect this tower
   */
  deselect(): void {
    this.selected = false;
  }

  /**
   * Get available upgrades that haven't reached max level
   */
  getAvailableUpgrades(): TowerUpgrade[] {
    return this.typeConfig.upgrades.filter(upgrade => {
      const currentLevel = this.upgradeLevels.get(upgrade.id) ?? 0;
      return currentLevel < upgrade.maxLevel;
    });
  }

  /**
   * Get the current level of a specific upgrade
   */
  getUpgradeLevel(upgradeId: UpgradeId): number {
    return this.upgradeLevels.get(upgradeId) ?? 0;
  }

  /**
   * Check if an upgrade can be applied (not at max level)
   */
  canUpgrade(upgradeId: UpgradeId): boolean {
    const upgrade = this.typeConfig.upgrades.find(u => u.id === upgradeId);
    if (!upgrade) return false;
    const currentLevel = this.upgradeLevels.get(upgradeId) ?? 0;
    return currentLevel < upgrade.maxLevel;
  }

  /**
   * Apply an upgrade to this tower
   * @returns true if upgrade was applied successfully
   */
  applyUpgrade(upgradeId: UpgradeId): boolean {
    const upgrade = this.typeConfig.upgrades.find(u => u.id === upgradeId);
    if (!upgrade) return false;

    const currentLevel = this.upgradeLevels.get(upgradeId) ?? 0;
    if (currentLevel >= upgrade.maxLevel) return false;

    // Apply the effect
    switch (upgrade.effect.stat) {
      case 'fireRate':
        this._combat.fireRate *= upgrade.effect.multiplier;
        break;
      case 'damage':
        this._combat.damage *= upgrade.effect.multiplier;
        break;
      case 'range':
        this._combat.range *= upgrade.effect.multiplier;
        break;
      case 'beamWidth':
        // Beam width is computed dynamically via getEffectiveBeamWidth()
        break;
    }

    // Increment the level
    this.upgradeLevels.set(upgradeId, currentLevel + 1);
    return true;
  }

  /**
   * Get the current cost for the next level of a specific upgrade
   */
  getNextUpgradeCost(upgradeId: UpgradeId): number {
    const upgrade = this.typeConfig.upgrades.find(u => u.id === upgradeId);
    if (!upgrade) return 0;
    const currentLevel = this.upgradeLevels.get(upgradeId) ?? 0;
    return getUpgradeCost(upgrade, currentLevel);
  }

  /**
   * Get total credits invested in upgrades
   */
  getTotalUpgradeCost(): number {
    let total = 0;
    for (const upgrade of this.typeConfig.upgrades) {
      const maxLevel = this.upgradeLevels.get(upgrade.id) ?? 0;
      for (let i = 0; i < maxLevel; i++) {
        total += getUpgradeCost(upgrade, i);
      }
    }
    return total;
  }

  /**
   * Fast distance calculation using flat-earth approximation
   * Accurate enough for tower range checks (< 200m)
   */
  private calculateDistanceFast(pos1: GeoPosition, pos2: GeoPosition): number {
    const dLat = pos2.lat - pos1.lat;
    const dLon = pos2.lon - pos1.lon;
    // Approximate meters per degree at mid-latitudes
    const metersPerDegreeLat = 111320;
    const metersPerDegreeLon = 111320 * Math.cos(pos1.lat * 0.0174533); // 0.0174533 = PI/180
    const dx = dLon * metersPerDegreeLon;
    const dy = dLat * metersPerDegreeLat;
    return Math.sqrt(dx * dx + dy * dy);
  }
}
