import { ARMOR_TYPE_UI } from '../../../configs/combat/combat-ui.config';
import type { ArmorType, DamageType } from '../../../configs/combat/combat.types';
import { bestDamageTypesAgainst } from '../../../configs/combat/damage-matrix.config';
import { EnemyTypeId, ENEMY_TYPES } from '../../../configs/enemy-types.config';
import { BLOOD_MOON_INTERVAL, isBloodMoonWave } from '../../../configs/blood-moon.config';
import type { WavePeekFacts } from '../../../director/wave-source';
import { splitTraitLabel, weakToLabel } from '../sidebar-tooltips';

/**
 * NEXT in the WAVE panel: the coming waves as the player reads them.
 *
 * The facts come from whichever wave source the run plays
 * (`WaveDirector.peek`); this module only turns them into labels, icons and
 * tooltips. It used to derive them itself from the templates and the campaign,
 * which meant the panel knew how the adaptive director sizes a wave and could
 * only say "unknown" past the campaign for waves another source knows exactly
 * (docs/WAVE_SOURCE_PLAN.md, section 9).
 */

/** Tooltip sentence of a blood moon wave */
export const BLOOD_MOON_NOTE =
  `Blood moon (every ${BLOOD_MOON_INTERVAL}th wave): red night, glowing enemies, searchlights on the towers. Looks only, the wave is the same.`;

/**
 * Marks on the NEXT timeline of the WAVE panel. Five consecutive waves hold
 * a boss wave past the campaign (every fifth), so the next one is always
 * on the line.
 */
export const NEXT_WAVE_MARKS = 5;

/** One wave on the NEXT timeline of the WAVE panel. */
export interface WavePeek {
  wave: number;
  name: string;
  /** The source knows this wave. Past the campaign the adaptive one does not. */
  known: boolean;
  boss: boolean;
  /** "20–218": the count the wave can hold; null when the source does not know */
  count: string | null;
  /** Armor types in the wave, in the order the wave sends them */
  armors: string[];
  /** The first armor and "+N" for the others: "Unarmored +2"; "" when unknown */
  armorLabel: string;
  /** Air units in the wave */
  air: boolean;
  /** A blood moon wave (look only), false while the display option is off */
  bloodMoon: boolean;
  /** Best damage types against the wave's HP, none when unknown */
  weakToTypes: DamageType[];
  /** The same as text, "Fire, Poison, Pierce"; "" when unknown */
  weakTo: string;
  /** What the source adds about the wave, as a badge on the mark */
  note: string;
  tooltip: string;
}

/**
 * The facts of the coming waves as marks on the timeline.
 *
 * `bloodMoon`: the blood moon look is on (display option), so its waves get
 * their mark. The moon falls on any kind of wave, a boss variant's included.
 */
export function peekUpcomingWaves(facts: readonly WavePeekFacts[], bloodMoon = true): WavePeek[] {
  return facts.map((fact) => {
    const peek = toPeek(fact);
    if (bloodMoon && isBloodMoonWave(fact.wave)) {
      peek.bloodMoon = true;
      peek.tooltip = `${peek.tooltip} ${BLOOD_MOON_NOTE}`;
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
    weakToTypes: bestDamageTypesAgainst(weights),
    weakTo,
    note: fact.note,
    tooltip: tooltip(fact, weights, weakTo),
  };
}

/** "20–218", or "20" when the defense already opens the whole range. */
function countLabel(fact: WavePeekFacts): string | null {
  if (!fact.count) return null;
  const { lo, hi } = fact.count;
  return hi > lo ? `${lo}–${hi}` : `${lo}`;
}

function tooltip(fact: WavePeekFacts, weights: [ArmorType, number][], weakTo: string): string {
  const parts = [fact.description];

  // What a type does beyond dying, e.g. a splitter
  for (const [enemyId] of fact.enemies) {
    const cfg = ENEMY_TYPES[enemyId as EnemyTypeId];
    const split = cfg ? splitTraitLabel(enemyId) : null;
    if (split) parts.push(`${cfg!.name}: ${split}.`);
  }

  if (fact.count) {
    const { lo, hi, max } = fact.count;
    parts.push(hi < max
      ? `Up to ${hi} enemies with your tower DPS now, the wave allows ${max}. A weak defense can get fewer than ${lo}.`
      : `Up to ${hi} enemies. A weak defense can get fewer than ${lo}.`);
  }

  // The line shows the counters as icons only; the tooltip names them
  if (weakTo) parts.push(`Weak to ${weakTo}.`);
  if (weights.length > 1) {
    for (const [armor] of weights) {
      parts.push(`${ARMOR_TYPE_UI[armor].label}: ${weakToLabel([[armor, 1]])}.`);
    }
  }
  return parts.join(' ');
}
