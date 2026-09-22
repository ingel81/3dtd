/**
 * Wave Context — what the director's factors will be applied to.
 *
 * The four factors are values in [0,1]. On their own they are meaningless:
 * `countFactor = 0.5` is ~1000 enemies for `zombie_horde` and ~50 for
 * `mech_army`. This module derives the context once, so the candidate list,
 * the ranges and the survivability cap all describe the same wave.
 */

import { TEMPLATES, candidateTemplates, type NumberRange, type Template, type CandidateReason } from '../../templates';
import { survivableCount } from './wave-sizing';
import { templateForWave, isBossWave, enemyBaseDamageForWave } from '../../../configs/campaign.config';
import {
  ENEMY_TYPES, lineageHp, splitBodyCount, splitLeafCount, type EnemyTypeId,
} from '../../../configs/enemy-types.config';
import { GameStateSnapshot } from '../../models/game-state-snapshot';

export interface WaveContext {
  /** Template indices the director may pick this wave, ascending. */
  candidates: number[];
  /** Why the list looks the way it does (campaign pin, boss rule, requirements). */
  candidateReason: CandidateReason;
  /**
   * Ranges of the template that will actually run. Inside the campaign that
   * is a single template; past it, the average across everything still legal —
   * a "what is on the menu" signal rather than a promise.
   */
  countRange: NumberRange;
  hpMultRange: NumberRange;
  spawnDelayRange: NumberRange;
  /**
   * Where the fairness gate will clamp, on the same 0..1 scale as
   * `count_factor`. 1.0 means nothing gets clamped.
   */
  fairnessHeadroom: number;
  /** Absolute enemy cap the gate will impose, or null when it does not bind. */
  survivableCount: number | null;
  /**
   * Je Kandidat, wie viel Luft der Deckel ihm lässt, auf derselben 0..1-Skala
   * wie `fairnessHeadroom`.
   *
   * Klein heißt: Die Verteidigung steht gegen dieses Template schlecht, der
   * Deckel würde die Welle stark zusammenstreichen. Groß heißt: Sie räumt es
   * ab. Der Director nutzt das, um den Gleichstand zwischen gleich alten
   * Kandidaten aufzulösen, statt zu würfeln (docs/DRAMA_CONTROLLER_PLAN.md,
   * Runde 12).
   */
  headroomByTemplate: ReadonlyMap<number, number>;
}

function averageRange(templates: Template[], pick: (t: Template) => NumberRange): NumberRange {
  if (templates.length === 0) return [0, 0];
  let lo = 0;
  let hi = 0;
  for (const t of templates) {
    const r = pick(t);
    lo += r[0];
    hi += r[1];
  }
  return [lo / templates.length, hi / templates.length];
}

/** Capabilities as the decoder derives them, preferring the analysed values. */
export function deriveCapabilities(state: GameStateSnapshot): {
  hasAntiAir: boolean;
  hasAntiEthereal: boolean;
} {
  const research = state.research;
  const caps = state.defense?.capabilities;
  return {
    hasAntiAir: caps?.hasAntiAir ?? !!(
      research?.towerUnlocked?.['archer']
      || research?.towerUnlocked?.['ice']
      || research?.towerUnlocked?.['rocket']
      || research?.towerUnlocked?.['lightning']
      || research?.towerUnlocked?.['chaos']
      || research?.airTargetingUnlocked
    ),
    hasAntiEthereal: caps?.hasAntiEthereal ?? !!(
      research?.towerUnlocked?.['magic']
      || research?.towerUnlocked?.['ice']
      || research?.towerUnlocked?.['lightning']
      || research?.towerUnlocked?.['chaos']
    ),
  };
}

/**
 * Build the wave context for the wave that comes *after* the snapshot's
 * current one — the wave the model is about to decide.
 *
 * `recentTemplateIndices` drives the reuse cooldown; pass the director's
 * history when available. It only affects free choice past the campaign.
 *
 * `wave` is the wave being planned. It defaults to `state.waveNumber + 1`,
 * which is what every caller meant before the wave source contract made the
 * planning moment configurable (docs/WAVE_SOURCE_PLAN.md, section 3).
 */
export function buildWaveContext(
  state: GameStateSnapshot,
  recentTemplateIndices: readonly number[] = [],
  wave = (state.waveNumber ?? 0) + 1,
): WaveContext {
  const upcomingWave = wave;
  const { hasAntiAir, hasAntiEthereal } = deriveCapabilities(state);

  const { indices: candidates, reason: candidateReason } = candidateTemplates(
    upcomingWave,
    hasAntiAir,
    hasAntiEthereal,
    recentTemplateIndices,
    templateForWave(upcomingWave),
    isBossWave(upcomingWave),
  );

  const allowed: Template[] = candidates.map((i) => TEMPLATES[i]);

  const countRange = averageRange(allowed, (t) => t.countRange);
  const hpMultRange = averageRange(allowed, (t) => t.hpMultRange);
  const spawnDelayRange = averageRange(allowed, (t) => t.spawnDelayRange);

  // Evaluate the gate against a representative wave: the midpoint of the HP and
  // delay ranges. The exact factors are not known yet — they are what the model
  // is about to emit — so this is a signal about the ceiling, not a prediction.
  //
  // Für jeden Kandidaten, nicht nur den ersten: Die Zahl je Template ist das,
  // woran der Director erkennt, gegen welche der erlaubten Wellen die
  // Verteidigung schlecht steht.
  const capFor = (template: Template): number | null => survivableCount(
    template,
    (template.hpMultRange[0] + template.hpMultRange[1]) / 2,
    (template.spawnDelayRange[0] + template.spawnDelayRange[1]) / 2,
    state.defense?.gateDpsPerArmor,
    state.defense?.killThroughput,
    (id) => ENEMY_TYPES[id as EnemyTypeId]?.armorType ?? 'unarmored',
    (id) => ENEMY_TYPES[id as EnemyTypeId]?.isAirUnit === true,
    (id) => lineageHp(id as EnemyTypeId),
    (id) => ENEMY_TYPES[id as EnemyTypeId]?.baseSpeed ?? 5,
    (id) => splitBodyCount(id as EnemyTypeId),
    (id) => splitLeafCount(id as EnemyTypeId),
    state.player?.lives ?? 100,
    enemyBaseDamageForWave(upcomingWave),
  );

  const headroomOf = (template: Template, cap: number | null): number => {
    // Kein Deckel heißt: Die Verteidigung räumt das Template ab, volle Luft.
    if (cap === null) return 1;
    const span = template.countRange[1] - template.countRange[0];
    if (span <= 0) return 1;
    return Math.max(0, Math.min(1, (cap - template.countRange[0]) / span));
  };

  const headroomByTemplate = new Map<number, number>();
  for (let i = 0; i < candidates.length; i++) {
    const template = allowed[i];
    headroomByTemplate.set(candidates[i], headroomOf(template, capFor(template)));
  }

  let cap: number | null = null;
  let headroom = 1;
  if (allowed.length > 0) {
    const midHp = (hpMultRange[0] + hpMultRange[1]) / 2;
    const midDelay = (spawnDelayRange[0] + spawnDelayRange[1]) / 2;
    cap = survivableCount(
      allowed[0],
      midHp,
      midDelay,
      state.defense?.gateDpsPerArmor,
      state.defense?.killThroughput,
      (id) => ENEMY_TYPES[id as EnemyTypeId]?.armorType ?? 'unarmored',
      (id) => ENEMY_TYPES[id as EnemyTypeId]?.isAirUnit === true,
      (id) => lineageHp(id as EnemyTypeId),
      (id) => ENEMY_TYPES[id as EnemyTypeId]?.baseSpeed ?? 5,
      (id) => splitBodyCount(id as EnemyTypeId),
      (id) => splitLeafCount(id as EnemyTypeId),
      state.player?.lives ?? 100,
      enemyBaseDamageForWave(upcomingWave),
    );
    if (cap !== null) {
      const span = countRange[1] - countRange[0];
      headroom = span > 0 ? (cap - countRange[0]) / span : 1;
      headroom = Math.max(0, Math.min(1, headroom));
    }
  }

  return {
    candidates,
    candidateReason,
    countRange,
    hpMultRange,
    spawnDelayRange,
    fairnessHeadroom: headroom,
    survivableCount: cap,
    headroomByTemplate,
  };
}
