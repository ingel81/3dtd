import { describe, it, expect } from 'vitest';
import {
  VETERAN_TOOLTIP,
  targetingStrategiesFor,
  towerDps,
  towerStats,
  upgradeHintView,
  upgradeRefusalText,
  upgradeTierLockReason,
  veteranView,
} from './tower-stats';
import { TOWER_TYPES, TowerTypeId } from '../../../configs/tower-types.config';

describe('towerStats', () => {
  it('takes combat values, DPS, kills and sell value from the tower', () => {
    const tower = {
      typeConfig: TOWER_TYPES.archer,
      combat: { damage: 30, fireRate: 1.5, range: 32, kills: 7 },
      getSellValue: () => 90,
    };
    expect(towerStats(tower)).toEqual({ damage: 30, fireRate: 1.5, range: 32, dps: 45, kills: 7, sellValue: 90 });
  });
});

describe('towerDps', () => {
  it('multiplies damage and fire rate of a projectile tower', () => {
    expect(towerDps({ typeConfig: TOWER_TYPES.archer, combat: { damage: 30, fireRate: 1.5 } })).toBe(45);
  });

  it('takes the configured DPS of a beam tower', () => {
    expect(towerDps({ typeConfig: TOWER_TYPES.fire, combat: { damage: 0, fireRate: 0 } })).toBe(35);
  });
});

describe('targetingStrategiesFor', () => {
  const ids = (id: TowerTypeId) => targetingStrategiesFor(TOWER_TYPES[id]).map((s) => s.id);

  it('offers air priority to a tower that hits ground and air', () => {
    expect(ids('archer')).toEqual(['closest', 'lowest-hp', 'highest-hp', 'first', 'last', 'air-priority']);
  });

  it('leaves air priority out for ground-only and air-only towers', () => {
    expect(ids('cannon')).not.toContain('air-priority');
    expect(ids('rocket')).toEqual(['closest', 'lowest-hp', 'highest-hp', 'first', 'last']);
  });
});

describe('upgradeTierLockReason', () => {
  it('is null while the tier is unlocked', () => {
    expect(upgradeTierLockReason(1, 1)).toBeNull();
    expect(upgradeTierLockReason(3, 4)).toBeNull();
  });

  it('names the research a locked tier needs', () => {
    expect(upgradeTierLockReason(2, 1)).toBe('Requires: Advanced Weaponry');
    expect(upgradeTierLockReason(3, 2)).toBe('Requires: Master Engineering');
    expect(upgradeTierLockReason(4, 1)).toBe('Requires: Advanced Engineering');
    expect(upgradeTierLockReason(5, 4)).toBe('Requires: Transcendent Tech');
  });
});

describe('upgradeRefusalText', () => {
  const name = () => 'Damage';

  it('says how many credits the cheapest track lacks', () => {
    expect(upgradeRefusalText({ kind: 'credits', upgradeId: 'damage', cost: 300, missing: 120 }, name))
      .toBe('Need 120 more credits for Damage');
  });

  it('names the research of the missing tier, and says when all is done', () => {
    expect(upgradeRefusalText({ kind: 'tier', tier: 2 }, name)).toBe('Research Advanced Weaponry for the next levels');
    expect(upgradeRefusalText({ kind: 'maxed' }, name)).toBe('Fully upgraded');
  });
});

describe('upgradeHintView', () => {
  const tower = { id: 't1', typeConfig: TOWER_TYPES.archer };

  it('flashes the tile U bought, alternating the class per press', () => {
    const first = upgradeHintView({ towerId: 't1', seq: 1, upgradeId: 'damage', refusal: null }, tower);
    const second = upgradeHintView({ towerId: 't1', seq: 2, upgradeId: 'damage', refusal: null }, tower);
    expect(first).toEqual({ flashId: 'damage', flashAlt: false, refusalText: null });
    expect(second.flashAlt).toBe(true);
  });

  it('turns a refusal into its line with the track name from the config', () => {
    const view = upgradeHintView(
      { towerId: 't1', seq: 3, upgradeId: null, refusal: { kind: 'credits', upgradeId: 'range', cost: 90, missing: 40 } },
      tower,
    );
    expect(view).toEqual({ flashId: null, flashAlt: false, refusalText: 'Need 40 more credits for Range' });
  });

  it('shows nothing of a press on another tower or without one', () => {
    expect(upgradeHintView({ towerId: 't2', seq: 1, upgradeId: 'damage', refusal: null }, tower).flashId).toBeNull();
    expect(upgradeHintView(null, tower).refusalText).toBeNull();
  });
});

describe('veteranView', () => {
  it('shows a new tower as recruit on its way to the first rank', () => {
    expect(veteranView(3)).toEqual({
      level: 0, name: 'Recruit', icon: 'caretU', gold: false, kills: 3, nextAt: 10, progress: 0.3,
    });
  });

  it('measures the way from the current rank to the next', () => {
    expect(veteranView(100)).toMatchObject({ level: 2, name: 'Veteran', icon: 'chevrons2', nextAt: 150 });
    expect(veteranView(100).progress).toBeCloseTo(0.5, 6);
  });

  it('turns gold at Champion and ends at the star', () => {
    expect(veteranView(400)).toMatchObject({ name: 'Champion', icon: 'chevrons3', gold: true, nextAt: 1000, progress: 0 });
    expect(veteranView(5000)).toMatchObject({ name: 'Legend', icon: 'star', gold: true, nextAt: null, progress: 1 });
  });

  it('names every rank with its threshold in the tooltip', () => {
    expect(VETERAN_TOOLTIP).toBe(
      'Rank from killing blows, cosmetic only: Blooded 10 · Veteran 50 · Elite 150 · Champion 400 · Legend 1000',
    );
  });
});
