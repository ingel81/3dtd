import { GameObject } from '../core/game-object';
import { ComponentType } from '../core/component';
import {
  TransformComponent,
  CombatComponent,
  RenderComponent,
} from '../game-components';
import { GeoPosition } from '../models/game.types';
import { TowerTypeId, getTowerType, TowerTypeConfig, UpgradeId, TowerUpgrade } from '../configs/tower-types.config';
import { Enemy } from './enemy.entity';

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

  selected = false;

  /** Custom rotation set by user during placement (radians) */
  customRotation = 0;

  /** Cached current target - avoid re-searching every frame */
  private _currentTarget: Enemy | null = null;

  /** Last time LOS was verified for current target */
  private _lastLosCheckTime = 0;

  /** Minimum interval between LOS rechecks (ms) */
  private readonly LOS_RECHECK_INTERVAL = 300;

  constructor(position: GeoPosition, typeId: TowerTypeId, customRotation = 0) {
    super('tower');
    this.typeConfig = getTowerType(typeId);
    this.customRotation = customRotation;

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
   * @returns true if LOS should be rechecked
   */
  needsLosRecheck(currentTime: number): boolean {
    return currentTime - this._lastLosCheckTime >= this.LOS_RECHECK_INTERVAL;
  }

  /**
   * Mark that LOS was just checked
   * @param currentTime Current timestamp in ms
   */
  markLosChecked(currentTime: number): void {
    this._lastLosCheckTime = currentTime;
  }

  /**
   * Find target enemy within range using "lowest HP" strategy
   * OPTIMIZED: Caches target to avoid expensive LOS checks every frame
   * @param enemies List of potential targets
   * @param losCheck Optional line-of-sight check function (only called on target change)
   * @returns Enemy with lowest HP that is in range and visible, or null
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
    let bestTarget: Enemy | null = null;
    let lowestHp = Infinity;

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

      // Find enemy with lowest HP
      if (enemy.health.hp < lowestHp) {
        lowestHp = enemy.health.hp;
        bestTarget = enemy;
      }
    }

    // Cache the new target
    this._currentTarget = bestTarget;
    return bestTarget;
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
    }

    // Increment the level
    this.upgradeLevels.set(upgradeId, currentLevel + 1);
    return true;
  }

  /**
   * Get total credits invested in upgrades
   */
  getTotalUpgradeCost(): number {
    let total = 0;
    for (const upgrade of this.typeConfig.upgrades) {
      const level = this.upgradeLevels.get(upgrade.id) ?? 0;
      total += upgrade.cost * level;
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
