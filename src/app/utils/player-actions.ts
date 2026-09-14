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

/** Why firstAffordableUpgrade() found nothing, see upgradeRefusal(). */
export type UpgradeRefusal =
  /** Every track is at its last level */
  | { kind: 'maxed' }
  /** The cheapest track within the unlocked tiers costs more than the credits */
  | { kind: 'credits'; upgradeId: UpgradeId; cost: number; missing: number }
  /** What is left needs an upgrade tier not researched yet, the lowest of them */
  | { kind: 'tier'; tier: number };

/**
 * Why firstAffordableUpgrade() finds nothing for this tower, null when it
 * finds one. Short credits come before a missing tier: the upgrade the
 * player can reach soonest is the one worth naming. Same rules as
 * firstAffordableUpgrade().
 */
export function upgradeRefusal(
  tower: UpgradableTower,
  credits: number,
  maxUpgradeTier: number,
): UpgradeRefusal | null {
  let cheapest: { upgradeId: UpgradeId; cost: number } | null = null;
  let lowestLockedTier = Infinity;
  for (const upgrade of tower.getAvailableUpgrades()) {
    const cost = tower.getNextUpgradeCost(upgrade.id);
    if (cost <= 0) continue;
    const tier = upgrade.id === 'research-slots' ? 0 : requiredUpgradeTier(tower.getUpgradeLevel(upgrade.id));
    if (maxUpgradeTier < tier) {
      lowestLockedTier = Math.min(lowestLockedTier, tier);
      continue;
    }
    if (credits >= cost) return null;
    if (!cheapest || cost < cheapest.cost) cheapest = { upgradeId: upgrade.id, cost };
  }
  if (cheapest) return { kind: 'credits', ...cheapest, missing: cheapest.cost - credits };
  if (lowestLockedTier !== Infinity) return { kind: 'tier', tier: lowestLockedTier };
  return { kind: 'maxed' };
}
