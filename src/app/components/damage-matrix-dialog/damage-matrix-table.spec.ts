import { describe, it, expect } from 'vitest';
import {
  buildDamageMatrixColumns,
  buildDamageMatrixRows,
  buildEffectivenessLegend,
  formatMultiplier,
  matrixTierColor,
  LOCKED_TOWER_NAME,
  MATRIX_NORMAL_COLOR,
} from './damage-matrix-table';
import { ARMOR_TYPES, DAMAGE_TYPES, ArmorType, DamageMatrix, DamageType } from '../../configs/combat/combat.types';
import {
  DAMAGE_MATRIX,
  EFFECTIVENESS_COLORS,
  EFFECTIVENESS_THRESHOLDS,
} from '../../configs/combat/damage-matrix.config';
import { ARMOR_TYPE_UI, DAMAGE_TYPE_UI } from '../../configs/combat/combat-ui.config';
import { TOWER_TYPES } from '../../configs/tower-types.config';
import { ENEMY_TYPES } from '../../configs/enemy-types.config';

/** Matrix mit 1.0 überall, einzelne Felder überschrieben. */
function flatMatrix(overrides: Partial<Record<DamageType, Partial<Record<ArmorType, number>>>>): DamageMatrix {
  const matrix = {} as Record<DamageType, Record<ArmorType, number>>;
  for (const dt of DAMAGE_TYPES) {
    matrix[dt] = {} as Record<ArmorType, number>;
    for (const at of ARMOR_TYPES) matrix[dt][at] = overrides[dt]?.[at] ?? 1.0;
  }
  return matrix;
}

describe('matrixTierColor', () => {
  it('keeps normal neutral instead of the red of the damage numbers', () => {
    expect(matrixTierColor('normal')).toBe(MATRIX_NORMAL_COLOR);
    expect(matrixTierColor('normal')).not.toBe(EFFECTIVENESS_COLORS.normal);
  });

  it('uses the damage-number colours for the other tiers', () => {
    for (const tier of ['weak', 'strong', 'devastating'] as const) {
      expect(matrixTierColor(tier)).toBe(EFFECTIVENESS_COLORS[tier]);
    }
  });
});

describe('buildDamageMatrixRows', () => {
  const rows = buildDamageMatrixRows();

  it('lists every tower of the build menu in config order, without the research center', () => {
    const expected = Object.keys(TOWER_TYPES).filter((id) => id !== 'research-center');
    expect(rows.map((r) => r.towerId)).toEqual(expected);
  });

  it('labels each row with the tower name and its damage type', () => {
    for (const row of rows) {
      const tower = TOWER_TYPES[row.towerId];
      expect(row.locked).toBe(false);
      expect(row.name).toBe(tower.name);
      expect(row.damageLabel).toBe(DAMAGE_TYPE_UI[tower.damageType].label);
    }
  });

  it('has one cell per armor type, in ARMOR_TYPES order', () => {
    for (const row of rows) {
      expect(row.cells.map((c) => c.armor)).toEqual([...ARMOR_TYPES]);
    }
  });

  it('takes every multiplier straight from DAMAGE_MATRIX', () => {
    for (const row of rows) {
      const damageType = TOWER_TYPES[row.towerId].damageType;
      for (const cell of row.cells) {
        expect(cell.multiplier).toBe(DAMAGE_MATRIX[damageType][cell.armor]);
        expect(cell.text).toBe(formatMultiplier(cell.multiplier));
      }
    }
  });

  it('sorts every cell into the tier the damage numbers use', () => {
    const t = EFFECTIVENESS_THRESHOLDS;
    for (const cell of rows.flatMap((r) => r.cells)) {
      const m = cell.multiplier;
      const expected =
        m >= t.devastating ? 'devastating' :
        m >= t.strong ? 'strong' :
        m < t.weak ? 'weak' : 'normal';
      expect(cell.effectiveness).toBe(expected);
      expect(cell.color).toBe(matrixTierColor(expected));
    }
  });

  it('follows a rebalanced matrix without code changes', () => {
    const t = EFFECTIVENESS_THRESHOLDS;
    const matrix = flatMatrix({
      physical: { unarmored: t.devastating, light: t.strong, heavy: 1.0, fortified: t.weak - 0.01, ethereal: t.weak },
    });
    const archer = buildDamageMatrixRows(() => true, [TOWER_TYPES.archer], matrix)[0];
    expect(archer.cells.map((c) => c.effectiveness)).toEqual(['devastating', 'strong', 'normal', 'weak', 'normal']);
    expect(archer.cells[0].text).toBe(formatMultiplier(t.devastating));
    expect(archer.cells[0].tierLabel).toBe('Devastating');
    expect(archer.cells[0].color).toBe(EFFECTIVENESS_COLORS.devastating);
    expect(archer.cells[2].color).toBe(MATRIX_NORMAL_COLOR);
    expect(archer.cells[3].color).toBe(EFFECTIVENESS_COLORS.weak);
  });

  it('hides the name of locked towers like the build menu, but keeps type and values', () => {
    const lockedRows = buildDamageMatrixRows((id) => id === 'archer');
    for (const row of lockedRows) {
      const tower = TOWER_TYPES[row.towerId];
      const isArcher = row.towerId === 'archer';
      expect(row.locked).toBe(!isArcher);
      expect(row.name).toBe(isArcher ? tower.name : LOCKED_TOWER_NAME);
      expect(row.damageLabel).toBe(DAMAGE_TYPE_UI[tower.damageType].label);
      expect(row.cells.map((c) => c.multiplier)).toEqual(
        ARMOR_TYPES.map((a) => DAMAGE_MATRIX[tower.damageType][a]),
      );
    }
  });

  it('formats multipliers like the tower tooltips', () => {
    expect(formatMultiplier(1.5)).toBe('1.50×');
    expect(formatMultiplier(0.15)).toBe('0.15×');
  });
});

describe('buildDamageMatrixColumns', () => {
  const columns = buildDamageMatrixColumns();

  it('has one column per armor type with its UI label', () => {
    expect(columns.map((c) => c.armor)).toEqual([...ARMOR_TYPES]);
    for (const col of columns) expect(col.label).toBe(ARMOR_TYPE_UI[col.armor].label);
  });

  it('lists every enemy exactly once, under its own armor type', () => {
    const enemies = Object.values(ENEMY_TYPES);
    expect(columns.flatMap((c) => c.examples)).toHaveLength(enemies.length);
    for (const col of columns) {
      const expected = enemies.filter((e) => e.armorType === col.armor).map((e) => e.name);
      expect(col.examples).toEqual(expected);
    }
  });
});

describe('buildEffectivenessLegend', () => {
  it('lists the four tiers with the configured thresholds and the table colours', () => {
    const legend = buildEffectivenessLegend();
    const t = EFFECTIVENESS_THRESHOLDS;
    expect(legend.map((e) => e.effectiveness)).toEqual(['weak', 'normal', 'strong', 'devastating']);
    expect(legend.map((e) => e.range)).toEqual([
      `< ${formatMultiplier(t.weak)}`,
      '',
      `≥ ${formatMultiplier(t.strong)}`,
      `≥ ${formatMultiplier(t.devastating)}`,
    ]);
    for (const entry of legend) expect(entry.color).toBe(matrixTierColor(entry.effectiveness));
  });
});
