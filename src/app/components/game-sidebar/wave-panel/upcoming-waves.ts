import { dpsScaledCountMax, type Template } from '../../../ai/core/templates';
import { ARMOR_TYPE_UI } from '../../../configs/combat/combat-ui.config';
import type { ArmorType, DamageType } from '../../../configs/combat/combat.types';
import { bestDamageTypesAgainst } from '../../../configs/combat/damage-matrix.config';
import { EnemyTypeId, ENEMY_TYPES } from '../../../configs/enemy-types.config';
import {
  BOSS_WAVE_INTERVAL_AFTER_CURRICULUM,
  CURRICULUM_FORCED_THROUGH_WAVE,
  isBossWave,
  templateObjectForWave,
} from '../../../configs/wave-curriculum.config';
import { splitTraitLabel, weakToLabel } from '../sidebar-tooltips';

/**
 * Marks on the NEXT timeline of the WAVE panel. Five consecutive waves hold
 * a boss wave past the curriculum (every fifth), so the next one is always
 * on the line.
 */
export const NEXT_WAVE_MARKS = 5;

/** One wave on the NEXT timeline of the WAVE panel. */
export interface WavePeek {
  wave: number;
  name: string;
  /** The curriculum pins the template. Past it the director picks at wave start. */
  known: boolean;
  boss: boolean;
  /** "20–218": template minimum to the most the director sends at the given DPS; null when unknown */
  count: string | null;
  /** Armor types in the wave, in template order */
  armors: string[];
  /** The first armor and "+N" for the others: "Unarmored +2"; "" when unknown */
  armorLabel: string;
  /** Air units in the wave */
  air: boolean;
  /** Best damage types against the wave's HP, none when unknown */
  weakToTypes: DamageType[];
  /** The same as text, "Fire, Poison, Pierce"; "" when unknown */
  weakTo: string;
  /** Unknown wave: what is known instead */
  note: string;
  tooltip: string;
}

/**
 * NEXT: the `count` waves after `currentWave`, so the player can prepare
 * (anti-air before W7 bat_swarm, siege before a heavy wave). `towerDps` is
 * the defense the director would size the wave by now.
 */
export function peekUpcomingWaves(currentWave: number, towerDps: number, count: number): WavePeek[] {
  const peeks: WavePeek[] = [];
  for (let wave = currentWave + 1; wave <= currentWave + count; wave++) {
    const template = templateObjectForWave(wave);
    peeks.push(template ? knownPeek(wave, template, towerDps) : unknownPeek(wave));
  }
  return peeks;
}

/**
 * The wave the detail line of the timeline shows: the one under the pointer
 * or keyboard focus, else the one clicked last while it is still ahead,
 * else the next wave.
 */
export function shownPeek(peeks: readonly WavePeek[], hovered: number | null, picked: number | null): WavePeek | null {
  return peeks.find((p) => p.wave === hovered) ?? peeks.find((p) => p.wave === picked) ?? peeks[0] ?? null;
}

function knownPeek(wave: number, template: Template, towerDps: number): WavePeek {
  // HP each armor brings, so "weak to" answers what kills most of the wave
  const hpByArmor = new Map<ArmorType, number>();
  const traits: string[] = [];
  let air = false;
  for (const [enemyId, share] of template.enemies) {
    const cfg = ENEMY_TYPES[enemyId as EnemyTypeId];
    if (!cfg) continue;
    hpByArmor.set(cfg.armorType, (hpByArmor.get(cfg.armorType) ?? 0) + share * cfg.baseHp);
    if (cfg.isAirUnit) air = true;
    const split = splitTraitLabel(enemyId);
    if (split) traits.push(`${cfg.name}: ${split}.`);
  }
  const weights = [...hpByArmor];
  const armors = weights.map(([armor]) => ARMOR_TYPE_UI[armor].label);
  const weakTo = weakToLabel(weights);

  const [lo, full] = template.countRange;
  const hi = Math.round(dpsScaledCountMax(template.countRange, towerDps));
  const countNote = hi < full
    ? `Up to ${hi} enemies with your tower DPS now, the template allows ${full}. A weak defense can get fewer than ${lo}.`
    : `Up to ${hi} enemies. A weak defense can get fewer than ${lo}.`;
  // The line shows the counters as icons only; the tooltip names them
  const weakNote = weakTo ? [`Weak to ${weakTo}.`] : [];
  const perArmor = weights.length > 1
    ? weights.map(([armor]) => `${ARMOR_TYPE_UI[armor].label}: ${weakToLabel([[armor, 1]])}.`)
    : [];

  return {
    wave,
    name: template.name,
    known: true,
    boss: template.bossOnly,
    count: hi > lo ? `${lo}–${hi}` : `${lo}`,
    armors,
    armorLabel: armors.length > 1 ? `${armors[0]} +${armors.length - 1}` : (armors[0] ?? ''),
    air,
    weakToTypes: bestDamageTypesAgainst(weights),
    weakTo,
    note: '',
    tooltip: [template.description, ...traits, countNote, ...weakNote, ...perArmor].join(' '),
  };
}

/** Past the curriculum: whether it is a boss wave; the tooltip names the next one. */
function unknownPeek(wave: number): WavePeek {
  const boss = isBossWave(wave);
  const nextBoss = nextBossWave(wave);
  return {
    wave,
    name: boss ? 'Boss wave' : "Director's pick",
    known: false,
    boss,
    count: null,
    armors: [],
    armorLabel: '',
    air: false,
    weakToTypes: [],
    weakTo: '',
    note: 'Template picked at wave start',
    tooltip: boss
      ? `From W${CURRICULUM_FORCED_THROUGH_WAVE + 1} every ${BOSS_WAVE_INTERVAL_AFTER_CURRICULUM}th wave is a boss wave. The director picks which boss when the wave starts.`
      : `Past W${CURRICULUM_FORCED_THROUGH_WAVE} the director picks the template when the wave starts, so its enemies are not known yet. Next boss wave: W${nextBoss}.`,
  };
}

function nextBossWave(after: number): number {
  let wave = after + 1;
  while (!isBossWave(wave)) wave++;
  return wave;
}
