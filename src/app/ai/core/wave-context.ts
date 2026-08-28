/**
 * Wave Context — what the model's continuous factors will be applied to.
 *
 * The params head emits four values in [0,1]. On their own they are
 * meaningless: `count_factor = 0.5` is ~1000 enemies for `zombie_horde` and
 * ~50 for `mech_army`. Inside the curriculum the template is determined by the
 * wave number, so the net *could* memorise the mapping — but past wave 30 it
 * chooses the template in the same forward pass that produces the factors, and
 * there it was genuinely blind.
 *
 * This module derives that context once so the encoder and the decoder cannot
 * disagree about it: the same availability mask feeds the model's input, the
 * masked softmax over templates, and the fairness gate.
 *
 * Mirrored by `schema.build_wave_context` in the training backend.
 */

import {
  TEMPLATES,
  MAX_TEMPLATE_SLOTS,
  getAvailableTemplateMask,
  fairMaxCount,
  type NumberRange,
  type Template,
} from './templates';
import { templateForWave, enemyBaseDamageForWave } from '../../configs/wave-curriculum.config';
import { ENEMY_TYPES, type EnemyTypeId } from '../../configs/enemy-types.config';
import { GameStateSnapshot } from './models/game-state-snapshot';

export interface WaveContext {
  /** Which template slots the model may pick this wave. */
  mask: boolean[];
  /**
   * Ranges of the template that will actually run. Inside the curriculum that
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
  fairMaxCount: number | null;
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
      || research?.airTargetingUnlocked
    ),
    hasAntiEthereal: caps?.hasAntiEthereal ?? !!(
      research?.towerUnlocked?.['magic']
      || research?.towerUnlocked?.['ice']
      || research?.towerUnlocked?.['lightning']
    ),
  };
}

/**
 * Build the wave context for the wave that comes *after* the snapshot's
 * current one — the wave the model is about to decide.
 *
 * `recentTemplateIndices` drives the reuse cooldown; pass the director's
 * history when available. It only affects free choice past the curriculum.
 */
export function buildWaveContext(
  state: GameStateSnapshot,
  recentTemplateIndices: readonly number[] = [],
): WaveContext {
  const upcomingWave = (state.waveNumber ?? 0) + 1;
  const { hasAntiAir, hasAntiEthereal } = deriveCapabilities(state);

  const mask = getAvailableTemplateMask(
    upcomingWave,
    hasAntiAir,
    hasAntiEthereal,
    recentTemplateIndices,
    templateForWave(upcomingWave),
  );

  const allowed: Template[] = [];
  for (let i = 0; i < TEMPLATES.length && i < MAX_TEMPLATE_SLOTS; i++) {
    if (mask[i]) allowed.push(TEMPLATES[i]);
  }

  const countRange = averageRange(allowed, (t) => t.countRange);
  const hpMultRange = averageRange(allowed, (t) => t.hpMultRange);
  const spawnDelayRange = averageRange(allowed, (t) => t.spawnDelayRange);

  // Evaluate the gate against a representative wave: the midpoint of the HP and
  // delay ranges. The exact factors are not known yet — they are what the model
  // is about to emit — so this is a signal about the ceiling, not a prediction.
  let cap: number | null = null;
  let headroom = 1;
  if (allowed.length > 0) {
    const midHp = (hpMultRange[0] + hpMultRange[1]) / 2;
    const midDelay = (spawnDelayRange[0] + spawnDelayRange[1]) / 2;
    cap = fairMaxCount(
      allowed[0],
      midHp,
      midDelay,
      state.defense?.effectiveDPSPerArmor,
      state.defense?.killThroughput,
      (id) => ENEMY_TYPES[id as EnemyTypeId]?.armorType ?? 'unarmored',
      (id) => ENEMY_TYPES[id as EnemyTypeId]?.isAirUnit === true,
      (id) => ENEMY_TYPES[id as EnemyTypeId]?.baseHp ?? 80,
      (id) => ENEMY_TYPES[id as EnemyTypeId]?.baseSpeed ?? 5,
      state.player?.lives ?? 100,
      enemyBaseDamageForWave(upcomingWave),
    );
    if (cap !== null) {
      const span = countRange[1] - countRange[0];
      headroom = span > 0 ? (cap - countRange[0]) / span : 1;
      headroom = Math.max(0, Math.min(1, headroom));
    }
  }

  return { mask, countRange, hpMultRange, spawnDelayRange, fairnessHeadroom: headroom, fairMaxCount: cap };
}
