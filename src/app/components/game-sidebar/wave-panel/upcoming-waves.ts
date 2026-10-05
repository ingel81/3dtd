import { ARMOR_TYPE_UI, DAMAGE_TYPE_UI } from '../../../configs/combat/combat-ui.config';
import type { ArmorType, DamageType } from '../../../configs/combat/combat.types';
import { bestDamageTypesAgainst } from '../../../configs/combat/damage-matrix.config';
import { EnemyTypeId, ENEMY_TYPES, leakDamageOf, lineageLeakDamage } from '../../../configs/enemy-types.config';
import { waveMutator, waveRules } from '../../../director/wave-rules';
import { BLOOD_MOON_INTERVAL, isBloodMoonWave } from '../../../configs/blood-moon.config';
import type { WavePeekFacts } from '../../../director/wave-source';
import { damageTypeIcon } from '../../icon/damage-type-icon';
import type { TdTooltipBanner, TdTooltipData, TdTooltipSection, TdTooltipStat } from '../../tooltip/tooltip-data.types';
import { ARMOR_DOT_COLOR, enemyTraitLabel, weakToLabel } from '../sidebar-tooltips';

/**
 * NEXT in the WAVE panel: the coming waves as the player reads them.
 *
 * The facts come from whichever wave source the run plays
 * (`WaveDirector.peek`); this module only turns them into labels, icons and
 * tooltips (docs/WAVE_SOURCE_PLAN.md, section 9).
 */

/** Tooltip sentence of a blood moon wave's look; what the wave does is its mutator's (mutatorNote) */
export const BLOOD_MOON_NOTE =
  `Blood moon (every ${BLOOD_MOON_INTERVAL}th wave): red night, glowing enemies, searchlights on the towers.`;

/** Tooltip sentence of a wave's mutator: "Swift: Enemies move 25 % faster ..." */
export function mutatorNote(mutator: { name: string; description: string }): string {
  return `${mutator.name}: ${mutator.description}`;
}

/** Marks on the NEXT timeline of the WAVE panel. */
export const NEXT_WAVE_MARKS = 5;

/** One wave on the NEXT timeline of the WAVE panel. */
export interface WavePeek {
  wave: number;
  name: string;
  /** The source knows this wave. */
  known: boolean;
  boss: boolean;
  /** The enemy count as text; null when the source does not know */
  count: string | null;
  /** Armor types in the wave, in the order the wave sends them */
  armors: string[];
  /** The first armor and "+N" for the others: "Unarmored +2"; "" when unknown */
  armorLabel: string;
  /** Air units in the wave */
  air: boolean;
  /** A blood moon wave (its look), false while the display option is off */
  bloodMoon: boolean;
  /** Name of the wave's mutator, "Swift"; null for none. Shown whatever the look */
  mutator: string | null;
  /** Best damage types against the wave's HP, none when unknown */
  weakToTypes: DamageType[];
  /** The same as text, "Fire, Poison, Pierce"; "" when unknown */
  weakTo: string;
  /** What the source adds about the wave, as a badge on the mark */
  note: string;
  tooltip: TdTooltipData;
}

/**
 * The facts of the coming waves as marks on the timeline.
 *
 * `bloodMoon`: the blood moon look is on (display option), so its waves get
 * their mark. The moon falls on any kind of wave, a boss wave included.
 */
export function peekUpcomingWaves(facts: readonly WavePeekFacts[], bloodMoon = true): WavePeek[] {
  return facts.map((fact) => {
    const peek = toPeek(fact);
    if (bloodMoon && isBloodMoonWave(fact.wave)) {
      peek.bloodMoon = true;
      peek.tooltip = { ...peek.tooltip, banners: [...(peek.tooltip.banners ?? []), { icon: 'moon', text: BLOOD_MOON_NOTE, tone: 'danger' }] };
    }
    return peek;
  });
}

/**
 * The wave the detail line of the timeline shows: the one under the pointer
 * or keyboard focus, else the one clicked last while it is still ahead,
 * else the next wave.
 */
export function shownPeek(peeks: readonly WavePeek[], hovered: number | null, picked: number | null): WavePeek | null {
  return peeks.find((p) => p.wave === hovered) ?? peeks.find((p) => p.wave === picked) ?? peeks[0] ?? null;
}

/**
 * Size in px of the icons above a mark (boss, air, blood moon), 2 px apart
 * (wave-timeline.component.scss). Up to two fit the 28 px mark at 10 px;
 * three at 10 px would be 34 px and reach into the next mark, so three are
 * 8 px, 28 px together.
 */
export function markIconSize(peek: Pick<WavePeek, 'boss' | 'air' | 'bloodMoon'>): number {
  const icons = Number(peek.boss) + Number(peek.air) + Number(peek.bloodMoon);
  return icons > 2 ? 8 : 10;
}

function toPeek(fact: WavePeekFacts): WavePeek {
  const weights = fact.hpByArmor as [ArmorType, number][];
  const armors = weights.map(([armor]) => ARMOR_TYPE_UI[armor].label);
  const weakTo = weakToLabel(weights);

  return {
    wave: fact.wave,
    name: fact.name,
    known: fact.known,
    boss: fact.boss,
    count: countLabel(fact),
    armors,
    armorLabel: armors.length > 1 ? `${armors[0]} +${armors.length - 1}` : (armors[0] ?? ''),
    air: fact.air,
    bloodMoon: false,
    mutator: waveMutator(fact.wave)?.name ?? null,
    weakToTypes: bestDamageTypesAgainst(weights),
    weakTo,
    note: fact.note,
    tooltip: tooltip(fact, weights),
  };
}

function countLabel(fact: WavePeekFacts): string | null {
  return fact.count === null ? null : `${fact.count}`;
}

/**
 * The detail line's tooltip as a card: name and wave, how many come and what
 * all of them cost the HQ, the mutator, who comes (each type with its armor,
 * what it costs the HQ and what it does beyond walking), what hurts each
 * armor, the source's description last.
 */
function tooltip(fact: WavePeekFacts, weights: [ArmorType, number][]): TdTooltipData {
  const known = fact.enemies.filter(([id]) => ENEMY_TYPES[id as EnemyTypeId]);
  const scale = (id: string) => waveRules().leakScale(fact.wave, id);

  const stats: TdTooltipStat[] = [];
  if (fact.count) stats.push({ label: 'ENEMIES', value: `${fact.count}` });
  // What all of them cost the HQ, every split child (TODO E49)
  const shares = known.reduce((sum, [, share]) => sum + share, 0);
  if (fact.count && shares > 0) {
    const perEnemy = known.reduce((sum, [id, share]) => sum + share * lineageLeakDamage(id as EnemyTypeId) * scale(id), 0) / shares;
    stats.push({ label: 'HQ MAX', value: `−${Math.round(fact.count * perEnemy)}` });
  }

  const mutator = waveMutator(fact.wave);
  const banners: TdTooltipBanner[] = mutator ? [{ icon: 'bolt', text: mutatorNote(mutator), tone: 'danger' }] : [];

  const sections: TdTooltipSection[] = [];
  // Two kinds under one name (the zombies) are one row
  const byName = new Map<string, { id: EnemyTypeId; share: number }>();
  for (const [id, share] of known) {
    const name = ENEMY_TYPES[id as EnemyTypeId].name;
    const row = byName.get(name);
    if (row) row.share += share;
    else byName.set(name, { id: id as EnemyTypeId, share });
  }
  if (byName.size > 0) {
    sections.push({
      title: 'Enemies',
      aside: 'HQ each',
      rows: [...byName].map(([name, { id, share }]) => {
        const cfg = ENEMY_TYPES[id];
        const armor = cfg.armorType as ArmorType;
        const many = fact.count && shares > 0 ? Math.round((fact.count * share) / shares) : null;
        return {
          label: many ? `${many}× ${name}` : name,
          detail: [ARMOR_TYPE_UI[armor].label, ...(cfg.isAirUnit ? ['air'] : [])].join(' · '),
          color: ARMOR_DOT_COLOR[armor],
          value: `−${Math.round(leakDamageOf(id) * scale(id) * 10) / 10}`,
          note: enemyTraitLabel(id) ?? undefined,
        };
      }),
    });
  }

  // The line shows the counters as icons only; the card names them, per armor
  if (weights.length > 0) {
    sections.push({
      title: 'Weak to',
      rows: weights.map(([armor]) => ({
        label: ARMOR_TYPE_UI[armor].label,
        color: ARMOR_DOT_COLOR[armor],
        chips: bestDamageTypesAgainst([[armor, 1]]).map((type) => ({
          icon: damageTypeIcon(type),
          label: DAMAGE_TYPE_UI[type].label,
          color: DAMAGE_TYPE_UI[type].color,
        })),
      })),
    });
  }

  return {
    title: fact.name,
    category: `Wave ${fact.wave}`,
    accent: fact.boss ? 'gold' : 'neutral',
    stats,
    banners,
    sections,
    flavor: fact.known ? fact.description : [fact.description, fact.note].filter(Boolean).join(' '),
  };
}
