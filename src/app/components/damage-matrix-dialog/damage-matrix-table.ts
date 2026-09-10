import {
  ARMOR_TYPES,
  ArmorType,
  DamageEffectiveness,
  DamageMatrix,
} from '../../configs/combat/combat.types';
import {
  DAMAGE_MATRIX,
  EFFECTIVENESS_COLORS,
  EFFECTIVENESS_THRESHOLDS,
  getEffectiveness,
} from '../../configs/combat/damage-matrix.config';
import { ARMOR_TYPE_UI, DAMAGE_TYPE_UI } from '../../configs/combat/combat-ui.config';
import { getAllTowerTypes, TowerTypeConfig, TowerTypeId } from '../../configs/tower-types.config';
import { EnemyTypeConfig, getAllEnemyTypes } from '../../configs/enemy-types.config';

/**
 * Datenaufbereitung für die globale Damage-vs-Armor-Tabelle.
 *
 * Liest ausschließlich die Configs (Matrix, Schwellen, Farben, Tower, Enemies),
 * damit die Tabelle jedem Rebalancing ohne Codeänderung folgt.
 */

export interface DamageMatrixColumn {
  armor: ArmorType;
  label: string;
  /** Namen aller Enemies mit dieser Rüstung, in Config-Reihenfolge. */
  examples: string[];
}

export interface DamageMatrixCell {
  armor: ArmorType;
  multiplier: number;
  /** Anzeige wie in den Tooltips, z. B. "1.50×". */
  text: string;
  effectiveness: DamageEffectiveness;
  /** Zellfarbe, siehe matrixTierColor. */
  color: string;
  /** Stufe als Wort, für Screenreader. */
  tierLabel: string;
}

export interface DamageMatrixRow {
  towerId: TowerTypeId;
  /** Tower-Name, bei gesperrten Towern LOCKED_TOWER_NAME. */
  name: string;
  locked: boolean;
  damageLabel: string;
  cells: DamageMatrixCell[];
}

export interface EffectivenessLegendEntry {
  effectiveness: DamageEffectiveness;
  label: string;
  /** Schwelle aus EFFECTIVENESS_THRESHOLDS, leer für "Normal". */
  range: string;
  color: string;
}

export const EFFECTIVENESS_LABELS: Readonly<Record<DamageEffectiveness, string>> = {
  weak: 'Weak',
  normal: 'Normal',
  strong: 'Strong',
  devastating: 'Devastating',
};

/** Platzhalter wie auf der gesperrten Karte im Baumenü. */
export const LOCKED_TOWER_NAME = '???';

/** Neutraler Text für die Stufe "normal", wie die Multiplikatoren im Tooltip. */
export const MATRIX_NORMAL_COLOR = 'var(--td-text-primary)';

/**
 * Weak, Strong und Devastating in den Farben der Schadenszahlen. Normal bleibt
 * neutral: das Rot der Schadenszahlen liest sich in einer Matrix als "schlecht".
 */
export function matrixTierColor(effectiveness: DamageEffectiveness): string {
  return effectiveness === 'normal' ? MATRIX_NORMAL_COLOR : EFFECTIVENESS_COLORS[effectiveness];
}

export function formatMultiplier(multiplier: number): string {
  return `${multiplier.toFixed(2)}×`;
}

/**
 * Das Research Center ist ein passives Gebäude, sein `damageType` ist nur
 * Platzhalter. Alle anderen Tower stehen im Baumenü, gesperrt oder nicht.
 */
function isCombatTower(tower: TowerTypeConfig): boolean {
  return tower.attackType !== 'passive';
}

/**
 * Zeilen: ein Eintrag pro baubarem Tower, in Baumenü-Reihenfolge.
 * `isUnlocked` ist dieselbe Prüfung wie im Baumenü (ResearchStore.isTowerUnlocked):
 * gesperrte Tower verlieren nur den Namen, Schadensart und Werte bleiben.
 */
export function buildDamageMatrixRows(
  isUnlocked: (id: TowerTypeId) => boolean = () => true,
  towers: readonly TowerTypeConfig[] = getAllTowerTypes(),
  matrix: DamageMatrix = DAMAGE_MATRIX,
): DamageMatrixRow[] {
  return towers.filter(isCombatTower).map((tower) => {
    const locked = !isUnlocked(tower.id);
    return {
      towerId: tower.id,
      name: locked ? LOCKED_TOWER_NAME : tower.name,
      locked,
      damageLabel: DAMAGE_TYPE_UI[tower.damageType].label,
      cells: ARMOR_TYPES.map((armor) => {
        const multiplier = matrix[tower.damageType][armor];
        const effectiveness = getEffectiveness(multiplier);
        return {
          armor,
          multiplier,
          text: formatMultiplier(multiplier),
          effectiveness,
          color: matrixTierColor(effectiveness),
          tierLabel: EFFECTIVENESS_LABELS[effectiveness],
        };
      }),
    };
  });
}

/** Spalten: eine pro Rüstungstyp, mit den Enemies dieser Rüstung als Beispiele. */
export function buildDamageMatrixColumns(
  enemies: readonly EnemyTypeConfig[] = getAllEnemyTypes(),
): DamageMatrixColumn[] {
  return ARMOR_TYPES.map((armor) => ({
    armor,
    label: ARMOR_TYPE_UI[armor].label,
    examples: enemies.filter((e) => e.armorType === armor).map((e) => e.name),
  }));
}

/** Legende der vier Stufen, Schwellen direkt aus EFFECTIVENESS_THRESHOLDS. */
export function buildEffectivenessLegend(): EffectivenessLegendEntry[] {
  const t = EFFECTIVENESS_THRESHOLDS;
  const entry = (effectiveness: DamageEffectiveness, range: string): EffectivenessLegendEntry => ({
    effectiveness,
    label: EFFECTIVENESS_LABELS[effectiveness],
    range,
    color: matrixTierColor(effectiveness),
  });
  return [
    entry('weak', `< ${formatMultiplier(t.weak)}`),
    entry('normal', ''),
    entry('strong', `≥ ${formatMultiplier(t.strong)}`),
    entry('devastating', `≥ ${formatMultiplier(t.devastating)}`),
  ];
}
