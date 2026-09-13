import { describe, it, expect } from 'vitest';
import { bestDamageTypesAgainst } from '../../configs/combat/damage-matrix.config';
import { ARMOR_TYPES, ArmorType } from '../../configs/combat/combat.types';
import { weakToLabel } from './sidebar-tooltips';

/** The hand-written texts in ARMOR_TYPE_UI that the matrix now supplies */
const FORMER_WEAK_TO: Record<ArmorType, string> = {
  unarmored: 'Fire, Poison, Pierce',
  light: 'Pierce, Lightning, Ice',
  heavy: 'Siege, Lightning',
  fortified: 'Siege, Magic',
  ethereal: 'Magic, Ice, Lightning',
};

describe('weakToLabel', () => {
  it('reads the former weak-to texts off the damage matrix', () => {
    for (const armor of ARMOR_TYPES) {
      expect(weakToLabel([[armor, 1]]), armor).toBe(FORMER_WEAK_TO[armor]);
    }
  });
});

describe('bestDamageTypesAgainst', () => {
  it('lets the armor with most of the weight decide', () => {
    expect(bestDamageTypesAgainst([['heavy', 9], ['unarmored', 1]])[0]).toBe('siege');
    expect(bestDamageTypesAgainst([['heavy', 1], ['unarmored', 9]])[0]).toBe('fire');
  });

  it('falls back to the best two above neutral when nothing is strong against the mix', () => {
    // Half heavy, half unarmored: siege 1.125, lightning 1.1, fire 1.05, chaos 1.0
    expect(bestDamageTypesAgainst([['heavy', 1], ['unarmored', 1]])).toEqual(['siege', 'lightning']);
  });

  it('respects the limit', () => {
    expect(bestDamageTypesAgainst([['light', 1]], 1)).toEqual(['pierce']);
  });

  it('returns nothing without weight', () => {
    expect(bestDamageTypesAgainst([])).toEqual([]);
    expect(bestDamageTypesAgainst([['heavy', 0]])).toEqual([]);
  });
});
