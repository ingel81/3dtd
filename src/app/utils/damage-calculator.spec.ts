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

    it('covers exactly 45 multiplier entries (9 damage × 5 armor)', () => {
      const totalEntries = DAMAGE_TYPES.length * ARMOR_TYPES.length;
      expect(totalEntries).toBe(45);
      let count = 0;
      for (const dmg of DAMAGE_TYPES) {
        for (const armor of ARMOR_TYPES) {
          if (typeof DAMAGE_MATRIX[dmg][armor] === 'number') count++;
        }
      }
      expect(count).toBe(45);
    });

    // Pinning tests for the canonical balance values — guards against silent
    // regressions during balance tuning. Update these when the design changes.
    const expectedMultipliers: [DamageType, ArmorType, number][] = [
      // physical
      ['physical',  'unarmored', 1.0],
      ['physical',  'light',     1.0],
      ['physical',  'heavy',     0.5],
      ['physical',  'fortified', 0.3],
      ['physical',  'ethereal',  0.1],
      // pierce
      ['pierce',    'unarmored', 1.25],
      ['pierce',    'light',     1.6],
      ['pierce',    'heavy',     0.35],
      ['pierce',    'fortified', 0.25],
      ['pierce',    'ethereal',  0.1],
      // siege
      ['siege',     'unarmored', 0.5],
      ['siege',     'light',     0.5],
      ['siege',     'heavy',     1.75],
      ['siege',     'fortified', 1.6],
      ['siege',     'ethereal',  0.3],
      // magic
      ['magic',     'unarmored', 0.9],
      ['magic',     'light',     0.5],
      ['magic',     'heavy',     0.9],
      ['magic',     'fortified', 1.3],
      ['magic',     'ethereal',  2.0],
      // fire
      ['fire',      'unarmored', 1.5],
      ['fire',      'light',     1.2],
      ['fire',      'heavy',     0.6],
      ['fire',      'fortified', 0.25],
      ['fire',      'ethereal',  0.1],
      // ice
      ['ice',       'unarmored', 1.0],
      ['ice',       'light',     1.3],
      ['ice',       'heavy',     0.8],
      ['ice',       'fortified', 0.5],
      ['ice',       'ethereal',  1.5],
      // poison
      ['poison',    'unarmored', 1.4],
      ['poison',    'light',     1.2],
      ['poison',    'heavy',     0.4],
      ['poison',    'fortified', 0.3],
      ['poison',    'ethereal',  0.2],
      // lightning
      ['lightning', 'unarmored', 1.0],
      ['lightning', 'light',     1.5],
      ['lightning', 'heavy',     1.2],
      ['lightning', 'fortified', 0.3],
      ['lightning', 'ethereal',  1.5],
      // chaos
      ['chaos',     'unarmored', 1.0],
      ['chaos',     'light',     1.0],
      ['chaos',     'heavy',     1.0],
      ['chaos',     'fortified', 1.0],
      ['chaos',     'ethereal',  1.0],
    ];

    for (const [dmg, armor, expected] of expectedMultipliers) {
      it(`${dmg} vs ${armor} = ${expected}`, () => {
        expect(DAMAGE_MATRIX[dmg][armor]).toBe(expected);
      });
    }
  });

  // Die Regeln hinter der Matrix (BALANCE_PROPOSAL_2026-09 §4.2), damit ein
  // späteres Feintuning sie nicht still bricht.
  describe('DAMAGE_MATRIX design rules', () => {
    it('every damage type has a pairing ≤ 0.5, every type but physical one ≥ 1.3', () => {
      // Chaos is the generalist and deliberately has neither.
      for (const dmg of DAMAGE_TYPES.filter((d) => d !== 'chaos')) {
        const values = ARMOR_TYPES.map((a) => DAMAGE_MATRIX[dmg][a]);
        expect(Math.min(...values), dmg).toBeLessThanOrEqual(0.5);
        if (dmg !== 'physical') expect(Math.max(...values), dmg).toBeGreaterThanOrEqual(1.3);
      }
    });

    it('chaos lands at 1.0 against every armor, below the best counter of each', () => {
      for (const armor of ARMOR_TYPES) {
        expect(DAMAGE_MATRIX.chaos[armor], armor).toBe(1.0);
        const best = Math.max(...DAMAGE_TYPES.map((d) => DAMAGE_MATRIX[d][armor]));
        expect(best, armor).toBeGreaterThan(DAMAGE_MATRIX.chaos[armor]);
      }
    });

    it('every armor type has at least two counters ≥ 1.2', () => {
      for (const armor of ARMOR_TYPES) {
        const counters = DAMAGE_TYPES.filter((d) => DAMAGE_MATRIX[d][armor] >= 1.2);
        expect(counters.length, armor).toBeGreaterThanOrEqual(2);
      }
    });

    it('every pairing ≤ 0.5 reads as weak', () => {
      for (const dmg of DAMAGE_TYPES) {
        for (const armor of ARMOR_TYPES) {
          if (DAMAGE_MATRIX[dmg][armor] <= 0.5) {
            expect(getEffectiveness(DAMAGE_MATRIX[dmg][armor]), `${dmg} vs ${armor}`).toBe('weak');
          }
        }
      }
    });
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
    expect(r.finalDamage).toBeCloseTo(100 * 0.5, 6);
    expect(r.multiplier).toBeCloseTo(0.5, 6);
  });

  it('echoes baseDamage / damageType / armorType unchanged', () => {
    const r = calculateDamage(42, 'fire', 'fortified');
    expect(r.baseDamage).toBe(42);
    expect(r.damageType).toBe('fire');
    expect(r.armorType).toBe('fortified');
  });

  it('applies the bonus multiplier on top of the matrix', () => {
    const r = calculateDamage(100, 'siege', 'heavy', 2.0);
    // siege vs heavy = 1.75, bonus = 2 → 100 * 1.75 * 2 = 350
    expect(r.finalDamage).toBeCloseTo(350, 6);
    expect(r.multiplier).toBeCloseTo(3.5, 6);
  });

  it('defaults bonusMultiplier to 1.0 when omitted', () => {
    const withDefault = calculateDamage(100, 'magic', 'ethereal');
    const withExplicit = calculateDamage(100, 'magic', 'ethereal', 1.0);
    expect(withDefault.finalDamage).toBe(withExplicit.finalDamage);
  });

  it('classifies effectiveness from the combined multiplier (matrix × bonus)', () => {
    // physical vs ethereal = 0.1 → weak
    expect(calculateDamage(100, 'physical', 'ethereal').effectiveness).toBe('weak');
    // physical vs unarmored = 1.0 → normal
    expect(calculateDamage(100, 'physical', 'unarmored').effectiveness).toBe('normal');
    // ice vs light = 1.3 → strong
    expect(calculateDamage(100, 'ice', 'light').effectiveness).toBe('strong');
    // magic vs ethereal = 2.0 → devastating
    expect(calculateDamage(100, 'magic', 'ethereal').effectiveness).toBe('devastating');
  });

  it('a high bonus can promote a weak matchup into a higher tier', () => {
    // physical vs ethereal = 0.1; bonus 15 → 1.5 → devastating
    const r = calculateDamage(100, 'physical', 'ethereal', 15);
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
