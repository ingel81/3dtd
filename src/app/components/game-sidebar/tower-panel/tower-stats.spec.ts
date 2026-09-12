import { describe, it, expect } from 'vitest';
import {
  damageTypeIcon,
  targetingStrategiesFor,
  towerDps,
  towerStats,
  upgradeTierLockReason,
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
    expect(ids('archer')).toEqual(['closest', 'lowest-hp', 'highest-hp', 'first', 'air-priority']);
  });

  it('leaves air priority out for ground-only and air-only towers', () => {
    expect(ids('cannon')).not.toContain('air-priority');
    expect(ids('rocket')).toEqual(['closest', 'lowest-hp', 'highest-hp', 'first']);
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

describe('damageTypeIcon', () => {
  it('maps a damage type to its icon and falls back to the sword', () => {
    expect(damageTypeIcon('fire')).toBe('flame');
    expect(damageTypeIcon('ice')).toBe('splash');
    expect(damageTypeIcon('chaos')).toBe('shuffle');
    expect(damageTypeIcon('lightning')).toBe('sword');
  });
});
