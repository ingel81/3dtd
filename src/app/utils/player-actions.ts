import { TowerTypeConfig, TowerTypeId, UpgradeId, requiredUpgradeTier } from '../configs/tower-types.config';

/**
 * Rules for what the player may do right now, shared by the sidebar buttons
 * and the hotkeys, so a key can do nothing a click could not.
 */

/** What decides whether a build card can be picked, read from the stores by the caller. */
export interface TowerCardContext {
  credits: number;
  gameOver: boolean;
  researchCenterPlaced: boolean;
  isUnlocked: (id: TowerTypeId) => boolean;
}

/** A build card can be picked: unlocked, affordable, and at most one Research Center. */
export function canPickTowerCard(tower: TowerTypeConfig, ctx: TowerCardContext): boolean {
  if (ctx.gameOver || !ctx.isUnlocked(tower.id)) return false;
  if (ctx.credits < tower.cost) return false;
  return !(tower.id === 'research-center' && ctx.researchCenterPlaced);
}

/** The parts of a tower that upgrade picking reads (the entity, or a stub in tests). */
export interface UpgradableTower {
  getAvailableUpgrades(): readonly { id: UpgradeId }[];
  getNextUpgradeCost(upgradeId: UpgradeId): number;
  getUpgradeLevel(upgradeId: UpgradeId): number;
}

/**
 * First upgrade in panel order the player could click right now: affordable
 * and, except the Research Center's slot track, within the unlocked upgrade
 * tier. The same rules as the upgrade tiles and `command:upgrade-tower`.
 */
export function firstAffordableUpgrade(
  tower: UpgradableTower,
  credits: number,
  maxUpgradeTier: number,
): UpgradeId | null {
  for (const upgrade of tower.getAvailableUpgrades()) {
    const cost = tower.getNextUpgradeCost(upgrade.id);
    if (cost <= 0 || credits < cost) continue;
    if (upgrade.id !== 'research-slots'
      && maxUpgradeTier < requiredUpgradeTier(tower.getUpgradeLevel(upgrade.id))) continue;
    return upgrade.id;
  }
  return null;
}
