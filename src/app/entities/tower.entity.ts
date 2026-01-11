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
  private upgradeLevels: Map<UpgradeId, number> = new Map();

  selected = false;

  constructor(position: GeoPosition, typeId: TowerTypeId) {
    super('tower');
    this.typeConfig = getTowerType(typeId);

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
   * Find target enemy within range using "lowest HP" strategy
   * @param enemies List of potential targets
   * @param losCheck Optional line-of-sight check function
   * @returns Enemy with lowest HP that is in range and visible, or null
   */
  findTarget(enemies: Enemy[], losCheck?: (enemy: Enemy) => boolean): Enemy | null {
    let bestTarget: Enemy | null = null;
    let lowestHp = Infinity;

    for (const enemy of enemies) {
      if (!enemy.alive) continue;

      const dist = this.calculateDistance(this.position, enemy.position);
      if (dist > this.combat.range) continue;

      // Optional LOS check - skip enemies we can't see
      if (losCheck && !losCheck(enemy)) continue;

      // Find enemy with lowest HP
      if (enemy.health.hp < lowestHp) {
        lowestHp = enemy.health.hp;
        bestTarget = enemy;
      }
    }

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
   * Calculate distance between two positions
   */
  private calculateDistance(pos1: GeoPosition, pos2: GeoPosition): number {
    const R = 6371000; // Earth radius in meters
    const dLat = ((pos2.lat - pos1.lat) * Math.PI) / 180;
    const dLon = ((pos2.lon - pos1.lon) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((pos1.lat * Math.PI) / 180) *
        Math.cos((pos2.lat * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
}
