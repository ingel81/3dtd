import { TowerTypeConfig, TowerTypeId, UpgradeId, requiredUpgradeTier } from '../configs/tower-types.config';

/**
 * Rules for what the player may do right now, shared by the sidebar buttons
 * and the hotkeys, so a key can do nothing a click could not.
 */

/** What decides whether a build card can be picked, read from the stores by the caller. */
export interface TowerCardContext {
  credits: number;
  gameOver: boolean;
  /** The one-per-map buildings standing on the map (GameStore.placedUniqueTypes) */
  placedUnique: ReadonlySet<TowerTypeId>;
  isUnlocked: (id: TowerTypeId) => boolean;
}

/** A build card can be picked: unlocked, affordable, and a one-per-map building only while none stands. */
export function canPickTowerCard(tower: TowerTypeConfig, ctx: TowerCardContext): boolean {
  if (ctx.gameOver || !ctx.isUnlocked(tower.id)) return false;
  if (ctx.credits < tower.cost) return false;
  return !isPlacedUnique(tower, ctx.placedUnique);
}

/** A one-per-map building (TowerTypeConfig.unique) of this type stands already. */
export function isPlacedUnique(tower: TowerTypeConfig, placedUnique: ReadonlySet<TowerTypeId>): boolean {
  return tower.unique === true && placedUnique.has(tower.id);
}

/** The parts of a tower that upgrade picking reads (the entity, or a stub in tests). */
export interface UpgradableTower {
  getAvailableUpgrades(): readonly { id: UpgradeId }[];
  getNextUpgradeCost(upgradeId: UpgradeId): number;
  getUpgradeLevel(upgradeId: UpgradeId): number;
}

/** Why an upgrade cannot be bought, see upgradeTrackRefusal() and upgradeRefusal(). */
export type UpgradeRefusal =
  /** The track (for upgradeRefusal() every track) is at its last level */
  | { kind: 'maxed' }
  /** The track (the cheapest within the unlocked tiers) costs more than the credits */
  | { kind: 'credits'; upgradeId: UpgradeId; cost: number; missing: number }
  /** The track's next level (of all that are left, the lowest) needs an upgrade tier not researched yet */
  | { kind: 'tier'; tier: number };

/**
 * Why this track cannot be bought right now, null when it can: its last
 * level is reached, its next level needs an upgrade tier not researched yet
 * (the Research Center's slot track has no tiers), or the credits are
 * short. A tier-locked track names the tier even when the credits are short
 * as well, credits alone would not buy it. The same rules as the upgrade
 * tiles and `command:upgrade-tower`.
 */
export function upgradeTrackRefusal(
  tower: UpgradableTower,
  upgradeId: UpgradeId,
  credits: number,
  maxUpgradeTier: number,
): UpgradeRefusal | null {
  if (!tower.getAvailableUpgrades().some((u) => u.id === upgradeId)) return { kind: 'maxed' };
  const cost = tower.getNextUpgradeCost(upgradeId);
  if (cost <= 0) return { kind: 'maxed' };
  const tier = upgradeId === 'research-slots' ? 0 : requiredUpgradeTier(tower.getUpgradeLevel(upgradeId));
  if (maxUpgradeTier < tier) return { kind: 'tier', tier };
  if (credits < cost) return { kind: 'credits', upgradeId, cost, missing: cost - credits };
  return null;
}

/** First upgrade in panel order the player could buy right now, see upgradeTrackRefusal(). */
export function firstAffordableUpgrade(
  tower: UpgradableTower,
  credits: number,
  maxUpgradeTier: number,
): UpgradeId | null {
  const upgrade = tower.getAvailableUpgrades()
    .find((u) => upgradeTrackRefusal(tower, u.id, credits, maxUpgradeTier) === null);
  return upgrade?.id ?? null;
}

/**
 * Why firstAffordableUpgrade() finds nothing for this tower, null when it
 * finds one. Short credits come before a missing tier: the upgrade the
 * player can reach soonest is the one worth naming.
 */
export function upgradeRefusal(
  tower: UpgradableTower,
  credits: number,
  maxUpgradeTier: number,
): UpgradeRefusal | null {
  let cheapest: Extract<UpgradeRefusal, { kind: 'credits' }> | null = null;
  let lowestLockedTier = Infinity;
  for (const upgrade of tower.getAvailableUpgrades()) {
    const refusal = upgradeTrackRefusal(tower, upgrade.id, credits, maxUpgradeTier);
    if (!refusal) return null;
    if (refusal.kind === 'tier') {
      lowestLockedTier = Math.min(lowestLockedTier, refusal.tier);
    } else if (refusal.kind === 'credits' && (!cheapest || refusal.cost < cheapest.cost)) {
      cheapest = refusal;
    }
  }
  if (cheapest) return cheapest;
  if (lowestLockedTier !== Infinity) return { kind: 'tier', tier: lowestLockedTier };
  return { kind: 'maxed' };
}
