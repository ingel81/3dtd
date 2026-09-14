import { describe, expect, it } from 'vitest';
import { TOWER_TYPES, TowerTypeId, UpgradeId, requiredUpgradeTier } from '../configs/tower-types.config';
import { canPickTowerCard, firstAffordableUpgrade, TowerCardContext, upgradeRefusal } from './player-actions';

const ctx = (over: Partial<TowerCardContext> = {}): TowerCardContext => ({
  credits: 10_000,
  gameOver: false,
  researchCenterPlaced: false,
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

  it('allows one Research Center only', () => {
    expect(canPickTowerCard(TOWER_TYPES['research-center'], ctx())).toBe(true);
    expect(canPickTowerCard(TOWER_TYPES['research-center'], ctx({ researchCenterPlaced: true }))).toBe(false);
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
});
