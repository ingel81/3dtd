import { describe, expect, it } from 'vitest';
import { TOWER_TYPES, TowerTypeId, UpgradeId, requiredUpgradeTier } from '../configs/tower-types.config';
import { getUpgradeCost } from '../configs/tower-types.config';
import {
  canPickTowerCard,
  firstAffordableUpgrade,
  TowerCardContext,
  upgradePlan,
  upgradeRefusal,
  upgradeTimes,
  upgradeTrackRefusal,
} from './player-actions';

/** An archer at the given levels, as the planner reads a tower */
function archerAt(levels: Partial<Record<UpgradeId, number>>) {
  const typeConfig = TOWER_TYPES.archer;
  const level = (id: UpgradeId) => levels[id] ?? 0;
  const track = (id: UpgradeId) => typeConfig.upgrades.find((u) => u.id === id)!;
  return {
    typeConfig,
    getAvailableUpgrades: () => typeConfig.upgrades.filter((u) => level(u.id) < u.maxLevel),
    getNextUpgradeCost: (id: UpgradeId) => (level(id) < track(id).maxLevel ? getUpgradeCost(track(id), level(id)) : 0),
    getUpgradeLevel: level,
  };
}

describe('upgradePlan (TODO E45)', () => {
  const damage = TOWER_TYPES.archer.upgrades.find((u) => u.id === 'damage')!;
  const costOf = (level: number) => getUpgradeCost(damage, level);

  it('buys one track as often as asked while the credits last, each level at its own price', () => {
    const three = costOf(0) + costOf(1) + costOf(2);
    expect(upgradePlan(archerAt({}), three, 99, 5, 'damage')).toEqual(['damage', 'damage', 'damage']);
    expect(upgradePlan(archerAt({}), three - 1, 99, 5, 'damage')).toEqual(['damage', 'damage']);
    expect(upgradePlan(archerAt({}), 1e12, 99, 5, 'damage')).toHaveLength(5);
  });

  it('stops at the end of the track and at a tier not researched', () => {
    expect(upgradePlan(archerAt({ damage: damage.maxLevel - 2 }), 1e12, 99, 10, 'damage')).toHaveLength(2);
    const lastOpen = Array.from({ length: damage.maxLevel }, (_, l) => l).findIndex((l) => requiredUpgradeTier(l) > 1);
    expect(upgradePlan(archerAt({ damage: lastOpen - 1 }), 1e12, 1, 10, 'damage')).toEqual(['damage']);
  });

  it('picks the first affordable track each time without a track, as U does', () => {
    const plan = upgradePlan(archerAt({}), 1e12, 99, 10, null);
    expect(plan).toHaveLength(10);
    expect(plan[0]).toBe(firstAffordableUpgrade(archerAt({}), 1e12, 99));
  });

  it('asks for 10 with Ctrl or Cmd, 5 with Shift, else 1', () => {
    expect(upgradeTimes({ ctrlKey: true, shiftKey: true, metaKey: false })).toBe(10);
    expect(upgradeTimes({ ctrlKey: false, shiftKey: false, metaKey: true })).toBe(10);
    expect(upgradeTimes({ ctrlKey: false, shiftKey: true, metaKey: false })).toBe(5);
    expect(upgradeTimes({ ctrlKey: false, shiftKey: false, metaKey: false })).toBe(1);
  });
});

const ctx = (over: Partial<TowerCardContext> = {}): TowerCardContext => ({
  credits: 10_000,
  gameOver: false,
  placedUnique: new Set(),
  isUnlocked: () => true,
  ...over,
});

describe('canPickTowerCard', () => {
  it('picks an unlocked card the player can pay for', () => {
    expect(canPickTowerCard(TOWER_TYPES.archer, ctx())).toBe(true);
  });

  it('refuses a locked card, a card too expensive, and anything after game over', () => {
    expect(canPickTowerCard(TOWER_TYPES.cannon, ctx({ isUnlocked: (id: TowerTypeId) => id === 'archer' }))).toBe(false);
    expect(canPickTowerCard(TOWER_TYPES.archer, ctx({ credits: TOWER_TYPES.archer.cost - 1 }))).toBe(false);
    expect(canPickTowerCard(TOWER_TYPES.archer, ctx({ gameOver: true }))).toBe(false);
  });

  it('allows a one-per-map building only while none of its type stands', () => {
    expect(TOWER_TYPES['research-center'].unique).toBe(true);
    expect(canPickTowerCard(TOWER_TYPES['research-center'], ctx())).toBe(true);
    expect(canPickTowerCard(TOWER_TYPES['research-center'], ctx({ placedUnique: new Set(['research-center']) }))).toBe(false);
  });

  it('ignores the placed set for a tower that is not one per map', () => {
    expect(canPickTowerCard(TOWER_TYPES.archer, ctx({ placedUnique: new Set(['archer']) }))).toBe(true);
  });
});

describe('firstAffordableUpgrade', () => {
  const lockedLevel = Array.from({ length: 40 }, (_, l) => l).find((l) => requiredUpgradeTier(l) > 1)!;

  function tower(tracks: { id: UpgradeId; cost: number; level?: number }[]) {
    return {
      getAvailableUpgrades: () => tracks.map((t) => ({ id: t.id })),
      getNextUpgradeCost: (id: UpgradeId) => tracks.find((t) => t.id === id)!.cost,
      getUpgradeLevel: (id: UpgradeId) => tracks.find((t) => t.id === id)!.level ?? 0,
    };
  }

  it('takes the first track in panel order the player can afford', () => {
    const t = tower([{ id: 'damage', cost: 500 }, { id: 'speed', cost: 30 }, { id: 'range', cost: 20 }]);
    expect(firstAffordableUpgrade(t, 100, 1)).toBe('speed');
    expect(firstAffordableUpgrade(t, 1000, 1)).toBe('damage');
  });

  it('skips a track whose next level needs a tier not yet researched', () => {
    const t = tower([{ id: 'damage', cost: 10, level: lockedLevel }, { id: 'speed', cost: 10 }]);
    expect(firstAffordableUpgrade(t, 100, 1)).toBe('speed');
    expect(firstAffordableUpgrade(t, 100, 5)).toBe('damage');
  });

  it('never tier-gates the Research Center slot track', () => {
    const t = tower([{ id: 'research-slots', cost: 10, level: lockedLevel }]);
    expect(firstAffordableUpgrade(t, 100, 1)).toBe('research-slots');
  });

  it('is null when nothing is affordable', () => {
    expect(firstAffordableUpgrade(tower([{ id: 'damage', cost: 500 }]), 100, 1)).toBeNull();
    expect(firstAffordableUpgrade(tower([]), 100, 1)).toBeNull();
  });

  describe('upgradeRefusal', () => {
    it('is null while firstAffordableUpgrade finds one', () => {
      const t = tower([{ id: 'damage', cost: 500 }, { id: 'speed', cost: 30 }]);
      expect(upgradeRefusal(t, 100, 1)).toBeNull();
    });

    it('names the cheapest track within the unlocked tiers and the credits it lacks', () => {
      const t = tower([{ id: 'damage', cost: 500 }, { id: 'speed', cost: 300 }, { id: 'range', cost: 10, level: lockedLevel }]);
      expect(upgradeRefusal(t, 120, 1)).toEqual({ kind: 'credits', upgradeId: 'speed', cost: 300, missing: 180 });
    });

    it('names the lowest missing tier when every open track is tier-locked', () => {
      const t = tower([{ id: 'damage', cost: 10, level: lockedLevel }, { id: 'speed', cost: 0 }]);
      expect(upgradeRefusal(t, 100, 1)).toEqual({ kind: 'tier', tier: requiredUpgradeTier(lockedLevel) });
    });

    it('says maxed when every track is at its last level or there is none', () => {
      expect(upgradeRefusal(tower([{ id: 'damage', cost: 0 }]), 100, 1)).toEqual({ kind: 'maxed' });
      expect(upgradeRefusal(tower([]), 100, 1)).toEqual({ kind: 'maxed' });
    });

    it('never tier-gates the Research Center slot track', () => {
      const t = tower([{ id: 'research-slots', cost: 200, level: lockedLevel }]);
      expect(upgradeRefusal(t, 50, 1)).toEqual({ kind: 'credits', upgradeId: 'research-slots', cost: 200, missing: 150 });
    });
  });

  describe('upgradeTrackRefusal', () => {
    it('is null for a track the player can buy', () => {
      const t = tower([{ id: 'damage', cost: 500 }, { id: 'speed', cost: 30 }]);
      expect(upgradeTrackRefusal(t, 'speed', 100, 1)).toBeNull();
    });

    it('names the credits that track lacks, not the cheapest track', () => {
      const t = tower([{ id: 'damage', cost: 500 }, { id: 'speed', cost: 300 }]);
      expect(upgradeTrackRefusal(t, 'damage', 120, 1)).toEqual({ kind: 'credits', upgradeId: 'damage', cost: 500, missing: 380 });
    });

    it('names the tier of a tier-locked track, even when the credits are short too', () => {
      const t = tower([{ id: 'damage', cost: 500, level: lockedLevel }]);
      expect(upgradeTrackRefusal(t, 'damage', 10, 1)).toEqual({ kind: 'tier', tier: requiredUpgradeTier(lockedLevel) });
    });

    it('says maxed for a track at its last level', () => {
      const t = tower([{ id: 'damage', cost: 0 }]);
      expect(upgradeTrackRefusal(t, 'damage', 100, 1)).toEqual({ kind: 'maxed' });
      expect(upgradeTrackRefusal(tower([]), 'damage', 100, 1)).toEqual({ kind: 'maxed' });
    });

    it('never tier-gates the Research Center slot track', () => {
      const t = tower([{ id: 'research-slots', cost: 10, level: lockedLevel }]);
      expect(upgradeTrackRefusal(t, 'research-slots', 100, 1)).toBeNull();
    });
  });
});
