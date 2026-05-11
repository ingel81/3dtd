import { calculateDamage } from './damage-calculator';
import {
  DAMAGE_MATRIX,
  EFFECTIVENESS_THRESHOLDS,
  getEffectiveness,
} from '../configs/combat/damage-matrix.config';
import {
  DAMAGE_TYPES,
  ARMOR_TYPES,
  DamageType,
  ArmorType,
} from '../configs/combat/combat.types';

describe('damage-matrix.config', () => {
  describe('DAMAGE_MATRIX completeness', () => {
    it('has an entry for every DamageType × ArmorType combination', () => {
      // Catches the typo case where a new armor or damage type was added but
      // the matrix wasn't updated — TypeScript already enforces this, but a
      // runtime guard catches accidental config edits at test time.
      for (const dmg of DAMAGE_TYPES) {
        for (const armor of ARMOR_TYPES) {
          const value = DAMAGE_MATRIX[dmg][armor];
          expect(typeof value).toBe('number');
          expect(Number.isFinite(value)).toBe(true);
          expect(value).toBeGreaterThan(0);
        }
      }
    });

    it('covers exactly 40 multiplier entries (8 damage × 5 armor)', () => {
      const totalEntries = DAMAGE_TYPES.length * ARMOR_TYPES.length;
      expect(totalEntries).toBe(40);
      let count = 0;
      for (const dmg of DAMAGE_TYPES) {
        for (const armor of ARMOR_TYPES) {
          if (typeof DAMAGE_MATRIX[dmg][armor] === 'number') count++;
        }
      }
      expect(count).toBe(40);
    });

    // Pinning tests for the canonical balance values — guards against silent
    // regressions during balance tuning. Update these when the design changes.
    const expectedMultipliers: Array<[DamageType, ArmorType, number]> = [
      // physical
      ['physical',  'unarmored', 1.0],
      ['physical',  'light',     1.0],
      ['physical',  'heavy',     0.7],
      ['physical',  'fortified', 0.5],
      ['physical',  'ethereal',  0.15],
      // pierce
      ['pierce',    'unarmored', 1.2],
      ['pierce',    'light',     1.3],
      ['pierce',    'heavy',     0.5],
      ['pierce',    'fortified', 0.6],
      ['pierce',    'ethereal',  0.15],
      // siege
      ['siege',     'unarmored', 0.8],
      ['siege',     'light',     0.7],
      ['siege',     'heavy',     1.5],
      ['siege',     'fortified', 1.25],
      ['siege',     'ethereal',  0.75],
      // magic
      ['magic',     'unarmored', 1.0],
      ['magic',     'light',     1.0],
      ['magic',     'heavy',     0.85],
      ['magic',     'fortified', 0.75],
      ['magic',     'ethereal',  1.75],
      // fire
      ['fire',      'unarmored', 1.15],
      ['fire',      'light',     1.0],
      ['fire',      'heavy',     0.9],
      ['fire',      'fortified', 0.6],
      ['fire',      'ethereal',  0.15],
      // ice
      ['ice',       'unarmored', 1.0],
      ['ice',       'light',     1.2],
      ['ice',       'heavy',     1.0],
      ['ice',       'fortified', 0.75],
      ['ice',       'ethereal',  1.5],
      // poison
      ['poison',    'unarmored', 1.1],
      ['poison',    'light',     1.1],
      ['poison',    'heavy',     0.6],
      ['poison',    'fortified', 0.6],
      ['poison',    'ethereal',  0.5],
    ];

    for (const [dmg, armor, expected] of expectedMultipliers) {
      it(`${dmg} vs ${armor} = ${expected}`, () => {
        expect(DAMAGE_MATRIX[dmg][armor]).toBe(expected);
      });
    }
  });

  describe('getEffectiveness() classification', () => {
    it('returns weak when multiplier < weak threshold', () => {
      expect(getEffectiveness(EFFECTIVENESS_THRESHOLDS.weak - 0.01)).toBe('weak');
      expect(getEffectiveness(0.0)).toBe('weak');
      expect(getEffectiveness(0.5)).toBe('weak');
    });

    it('returns normal when weak ≤ multiplier < strong', () => {
      expect(getEffectiveness(EFFECTIVENESS_THRESHOLDS.weak)).toBe('normal');
      expect(getEffectiveness(1.0)).toBe('normal');
      expect(getEffectiveness(EFFECTIVENESS_THRESHOLDS.strong - 0.01)).toBe('normal');
    });

    it('returns strong when strong ≤ multiplier < devastating', () => {
      expect(getEffectiveness(EFFECTIVENESS_THRESHOLDS.strong)).toBe('strong');
      expect(getEffectiveness(1.3)).toBe('strong');
      expect(getEffectiveness(EFFECTIVENESS_THRESHOLDS.devastating - 0.01)).toBe('strong');
    });

    it('returns devastating when multiplier ≥ devastating threshold', () => {
      expect(getEffectiveness(EFFECTIVENESS_THRESHOLDS.devastating)).toBe('devastating');
      expect(getEffectiveness(1.75)).toBe('devastating');
      expect(getEffectiveness(5.0)).toBe('devastating');
    });

    it('threshold boundaries map to the higher tier inclusively', () => {
      // exactly-on-threshold values belong to the upper bucket
      expect(getEffectiveness(0.7)).toBe('normal');
      expect(getEffectiveness(1.2)).toBe('strong');
      expect(getEffectiveness(1.5)).toBe('devastating');
    });
  });
});

describe('calculateDamage()', () => {
  it('applies the matrix multiplier to the base damage', () => {
    const r = calculateDamage(100, 'physical', 'heavy');
    expect(r.finalDamage).toBeCloseTo(100 * 0.7, 6);
    expect(r.multiplier).toBeCloseTo(0.7, 6);
  });

  it('echoes baseDamage / damageType / armorType unchanged', () => {
    const r = calculateDamage(42, 'fire', 'fortified');
    expect(r.baseDamage).toBe(42);
    expect(r.damageType).toBe('fire');
    expect(r.armorType).toBe('fortified');
  });

  it('applies the bonus multiplier on top of the matrix', () => {
    const r = calculateDamage(100, 'siege', 'heavy', 2.0);
    // siege vs heavy = 1.5, bonus = 2 → 100 * 1.5 * 2 = 300
    expect(r.finalDamage).toBeCloseTo(300, 6);
    expect(r.multiplier).toBeCloseTo(3.0, 6);
  });

  it('defaults bonusMultiplier to 1.0 when omitted', () => {
    const withDefault = calculateDamage(100, 'magic', 'ethereal');
    const withExplicit = calculateDamage(100, 'magic', 'ethereal', 1.0);
    expect(withDefault.finalDamage).toBe(withExplicit.finalDamage);
  });

  it('classifies effectiveness from the combined multiplier (matrix × bonus)', () => {
    // physical vs ethereal = 0.15 → weak
    expect(calculateDamage(100, 'physical', 'ethereal').effectiveness).toBe('weak');
    // physical vs unarmored = 1.0 → normal
    expect(calculateDamage(100, 'physical', 'unarmored').effectiveness).toBe('normal');
    // pierce vs light = 1.3 → strong
    expect(calculateDamage(100, 'pierce', 'light').effectiveness).toBe('strong');
    // magic vs ethereal = 1.75 → devastating
    expect(calculateDamage(100, 'magic', 'ethereal').effectiveness).toBe('devastating');
  });

  it('a high bonus can promote a weak matchup into a higher tier', () => {
    // physical vs ethereal = 0.15; bonus 10 → 1.5 → devastating
    const r = calculateDamage(100, 'physical', 'ethereal', 10);
    expect(r.multiplier).toBeCloseTo(1.5, 6);
    expect(r.effectiveness).toBe('devastating');
  });

  it('handles 0 base damage without producing NaN', () => {
    const r = calculateDamage(0, 'fire', 'heavy');
    expect(r.finalDamage).toBe(0);
    expect(Number.isFinite(r.finalDamage)).toBe(true);
  });

  it('handles 0 bonusMultiplier (e.g. fully-mitigated)', () => {
    const r = calculateDamage(100, 'siege', 'fortified', 0);
    expect(r.finalDamage).toBe(0);
    expect(r.multiplier).toBe(0);
  });
});
