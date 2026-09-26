import {
  TowerTypeConfig,
  TowerTypeId,
  UpgradeId,
  getUpgradeCost,
  requiredUpgradeTier,
  type TowerUpgrade,
} from '../configs/tower-types.config';

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

/** Upgrades bought several at once (TODO E45): Shift+U or a Shift-click, Ctrl+U or a Ctrl-click */
export const UPGRADE_MANY = { shift: 5, ctrl: 10 } as const;

/** How many upgrades a key or a click asks for: Ctrl (Cmd) 10, Shift 5, else 1 */
export function upgradeTimes(e: Pick<MouseEvent, 'shiftKey' | 'ctrlKey' | 'metaKey'>): number {
  if (e.ctrlKey || e.metaKey) return UPGRADE_MANY.ctrl;
  return e.shiftKey ? UPGRADE_MANY.shift : 1;
}

/**
 * Up to `times` upgrades in a row the credits pay for now (TODO E45): the
 * track `upgradeId` again and again, or with null the first affordable one
 * each time, as U picks it. Each step reads the level the steps before it
 * bought and stops at the first that could not be bought: short of credits,
 * the track at its end, a tier not researched.
 */
export function upgradePlan(
  tower: UpgradableTower & { typeConfig?: { upgrades: readonly TowerUpgrade[] } },
  credits: number,
  maxUpgradeTier: number,
  times: number,
  upgradeId: UpgradeId | null,
): UpgradeId[] {
  const bought = new Map<UpgradeId, number>();
  const level = (id: UpgradeId) => tower.getUpgradeLevel(id) + (bought.get(id) ?? 0);
  const track = (id: UpgradeId) => tower.typeConfig?.upgrades.find((u) => u.id === id);
  // The tower as it stands after the steps planned so far: a track not
  // planned yet answers as the tower does, a planned one from its config
  const ahead: UpgradableTower = {
    getAvailableUpgrades: () => tower.getAvailableUpgrades().filter((u) => {
      const upgrade = track(u.id);
      return !bought.has(u.id) || (upgrade !== undefined && level(u.id) < upgrade.maxLevel);
    }),
    getNextUpgradeCost: (id) => {
      if (!bought.has(id)) return tower.getNextUpgradeCost(id);
      const upgrade = track(id);
      return upgrade && level(id) < upgrade.maxLevel ? getUpgradeCost(upgrade, level(id)) : 0;
    },
    getUpgradeLevel: level,
  };
  const plan: UpgradeId[] = [];
  let left = credits;
  for (let i = 0; i < times; i++) {
    const id = upgradeId ?? firstAffordableUpgrade(ahead, left, maxUpgradeTier);
    if (!id || upgradeTrackRefusal(ahead, id, left, maxUpgradeTier)) break;
    left -= ahead.getNextUpgradeCost(id);
    bought.set(id, (bought.get(id) ?? 0) + 1);
    plan.push(id);
  }
  return plan;
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
