import { ARMOR_TYPE_UI, DAMAGE_TYPE_UI } from '../../configs/combat/combat-ui.config';
import { DAMAGE_MATRIX, EFFECTIVENESS_THRESHOLDS } from '../../configs/combat/damage-matrix.config';
import { ARMOR_TYPES, ArmorType, DamageType } from '../../configs/combat/combat.types';
import { ENEMY_TYPES } from '../../configs/enemy-types.config';
import { TowerTypeConfig } from '../../configs/tower-types.config';
import { canTargetAirEffective } from '../../entities/tower-targeting.util';
import type { WaveGroupDisplay } from '../../services/debug/wave-debug.service';
import { TdTooltipData } from '../tooltip/tooltip-data.types';

/**
 * Tooltip-Aufbereitung der Sidebar: Tower-Karten im BUILD-Panel, Gegnergruppen
 * im WAVE-Panel. Reine Funktionen; Research-Zustand kommt als Argument, damit
 * die Komponente ihn aus dem Store liest und OnPush die Abhängigkeit sieht.
 */

/** Research-Zustand, von dem der Tower-Karten-Tooltip abhängt. */
export interface TowerCardTooltipContext {
  researchCenterPlaced: boolean;
  airTargetingUnlocked: boolean;
  /** Number key that picks the card, null or absent past the ninth card */
  hotkey?: string | null;
}

// Armor identity colors per mockup (tmp/td-components.jsx ArmorChip).
// The dot color reflects the ARMOR TYPE, not the effectiveness; the dim
// flag (faded row) communicates "weak matchup" instead.
const ARMOR_DOT_COLOR: Record<string, string> = {
  'unarmored': '#7DBE82',
  'light': '#5BA4D9',
  'heavy': '#C46B3A',
  'fortified': '#5A6258',
  'ethereal': '#9A78C7',
};

// Complete per damage type, so a new type without an accent does not compile.
const DAMAGE_ACCENT: Record<DamageType, NonNullable<TdTooltipData['accent']>> = {
  physical: 'gold',
  pierce: 'gold',
  siege: 'gold',
  magic: 'teal',
  fire: 'fire',
  ice: 'cold',
  poison: 'poison',
  lightning: 'lightning',
  chaos: 'chaos',
};

const ARMOR_ACCENT: Record<ArmorType, TdTooltipData['accent']> = {
  unarmored: 'neutral',
  light: 'teal',
  heavy: 'gold',
  fortified: 'health',
  ethereal: 'poison',
};

/**
 * Structured tooltip payload for the tower-card rich tooltip.
 * Matches the design refinement spec, header, stat triple, vs-armor table.
 */
export function towerCardTooltip(
  tower: TowerTypeConfig,
  ctx: TowerCardTooltipContext,
): TdTooltipData {
  if (tower.id === 'research-center') {
    return {
      title: 'Research Center',
      category: 'STRUCTURE',
      hotkey: ctx.hotkey ?? undefined,
      accent: 'gold',
      flavor: ctx.researchCenterPlaced
        ? 'Already placed.'
        : 'Unlocks new towers and upgrade tiers.',
    };
  }
  const dmgUi = DAMAGE_TYPE_UI[tower.damageType];
  const matrix = DAMAGE_MATRIX[tower.damageType as DamageType];
  const stats = tower.attackType === 'beam'
    ? [
        { label: 'DPS', value: String(tower.damagePerSecond ?? 0) },
        { label: 'TYPE', value: 'BEAM' },
        { label: 'RANGE', value: `${tower.range}m` },
      ]
    : [
        { label: 'DMG', value: String(tower.damage) },
        { label: 'RATE', value: `${tower.fireRate}/s` },
        { label: 'RANGE', value: `${tower.range}m` },
      ];
  const armor = ARMOR_TYPES.map(a => {
    const mul = matrix[a as ArmorType];
    const meta = ARMOR_TYPE_UI[a as ArmorType];
    return {
      label: meta.label,
      multiplier: `${mul.toFixed(2)}×`,
      color: ARMOR_DOT_COLOR[a] ?? 'var(--td-text-muted)',
      dim: mul < EFFECTIVENESS_THRESHOLDS.weak,
    };
  });
  // Targeting capability, resolved via canTargetAirEffective so the banner
  // reflects AA-retrofit research (e.g. dual-gatling after aa-retrofit
  // completes flips from ground-only to air-ground with a "via Research"
  // note). Single source of truth shared with combat + AI bots.
  const effectiveAir = canTargetAirEffective(tower.id, ctx.airTargetingUnlocked);
  const baseAir = tower.canTargetAir === true;
  const ground = tower.canTargetGround !== false;
  const targeting: TdTooltipData['targeting'] =
    effectiveAir && !ground ? { mode: 'air-only' } :
    effectiveAir && ground  ? { mode: 'air-ground', viaResearch: !baseAir } :
                              { mode: 'ground-only' };
  return {
    title: tower.name,
    category: dmgUi.label.toUpperCase(),
    hotkey: ctx.hotkey ?? undefined,
    accent: DAMAGE_ACCENT[tower.damageType],
    stats,
    targeting,
    armorTitle: 'vs Armor',
    armor,
  };
}

/**
 * What a kill splits this enemy type into, for the wave panel and its
 * tooltips: "Splits into 2 minions on death". Null for a type that does not
 * split (EnemyTypeConfig.splitOnDeath).
 */
export function splitTraitLabel(enemyType: string): string | null {
  const split = ENEMY_TYPES[enemyType]?.splitOnDeath;
  if (!split) return null;
  return `Splits into ${split.count} ${split.count === 1 ? 'minion' : 'minions'} on death`;
}

/**
 * Structured tooltip payload for the enemy-group rich tooltip.
 * Mirrors the tower-card tooltip layout, header (name + armor category),
 * 3-column stats (HP / SPEED / COUNT), and a "vs Damage" table sorted by
 * effectiveness against this enemy's armor. Reuses the armor-row structure
 * for the damage rows so both tooltips share the same visual language.
 */
export function enemyGroupTooltip(group: WaveGroupDisplay): TdTooltipData | null {
  const enemyConfig = ENEMY_TYPES[group.enemyType];
  if (!enemyConfig) return null;

  const armor = enemyConfig.armorType as ArmorType;
  const armorMeta = ARMOR_TYPE_UI[armor];

  const stats = [
    { label: 'HP', value: String(group.actualHp) },
    { label: 'SPEED', value: `${group.actualSpeed.toFixed(1)}m/s` },
    { label: 'COUNT', value: `×${group.count}` },
  ];

  const damageRows = (Object.keys(DAMAGE_MATRIX) as DamageType[])
    .map((dt) => ({ ui: DAMAGE_TYPE_UI[dt], mul: DAMAGE_MATRIX[dt][armor] }))
    .sort((a, b) => b.mul - a.mul)
    .map((row) => ({
      label: row.ui.label,
      multiplier: `${row.mul.toFixed(2)}×`,
      color: row.ui.color,
      dim: row.mul < EFFECTIVENESS_THRESHOLDS.weak,
    }));

  // Surface wave-scaling multipliers as flavor when they differ from 1,
  // so the player can see why HP/speed look inflated mid-run. A split
  // comes first: it changes what the count means.
  const flavorParts: string[] = [];
  if (group.healthMultiplier !== 1) flavorParts.push(`HP ×${group.healthMultiplier.toFixed(1)}`);
  if (group.speedMultiplier !== 1) flavorParts.push(`Speed ×${group.speedMultiplier.toFixed(2)}`);
  const scaled = flavorParts.length > 0 ? `Scaled: ${flavorParts.join(' · ')}` : null;
  const lines = [splitTraitLabel(group.enemyType), scaled].filter((line): line is string => line !== null);
  const flavor = lines.length > 0 ? lines.join('. ') : undefined;

  return {
    title: group.name,
    category: armorMeta.label.toUpperCase(),
    accent: ARMOR_ACCENT[armor] ?? 'neutral',
    stats,
    armorTitle: 'vs Damage',
    armor: damageRows,
    flavor,
  };
}
