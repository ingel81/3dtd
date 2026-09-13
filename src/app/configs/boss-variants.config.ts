/**
 * Boss variants: bosses that are no wave template of the director and come in
 * through a rotation over the boss waves past the curriculum instead.
 *
 * The director stays as it is. It plans every wave as before, boss waves
 * included; on a boss wave the rotation names a variant for, the variant's
 * wave ships in place of the director's (GameLoopFacadeService). Templates,
 * curriculum, the encoder and ai-schema.json do not know the variants, so
 * neither the rule director nor a trained model can pick one, and training
 * runs (their waves come from the backend) never see them. W1 to W30 are
 * curriculum waves and stay untouched.
 */

import type { WaveConfig as AIWaveConfig } from '../ai/core/models/wave-config';
import type { EnemyTypeId } from './enemy-types.config';
import {
  BOSS_WAVE_INTERVAL_AFTER_CURRICULUM,
  CURRICULUM_FORCED_THROUGH_WAVE,
  isBossWave,
} from './wave-curriculum.config';

export type BossVariantId = 'worm';

export interface BossVariant {
  id: BossVariantId;
  /** Wave name, as a template's ("Boss: ...") */
  name: string;
  /** What the wave sends: one enemy of this type (a worm is one enemy per segment) */
  enemyType: EnemyTypeId;
  description: string;
}

export const BOSS_VARIANTS: Record<BossVariantId, BossVariant> = {
  worm: {
    id: 'worm',
    name: 'Boss: Chitin Worm',
    enemyType: 'worm',
    description:
      'A chitin worm as long as the route. Every segment is a target of its own; '
      + 'destroying one splits the worm in two.',
  },
};

/**
 * The boss waves past the curriculum in order, W35, W40, W45, ...: the
 * variant that takes the wave, or null for the director's own boss template.
 * Repeats from the start once through.
 */
export const BOSS_VARIANT_ROTATION: readonly (BossVariantId | null)[] = ['worm', null];

/** The variant that takes wave `wave`, null on every other wave. */
export function bossVariantForWave(wave: number): BossVariant | null {
  if (wave <= CURRICULUM_FORCED_THROUGH_WAVE || !isBossWave(wave)) return null;
  const n = Math.floor((wave - CURRICULUM_FORCED_THROUGH_WAVE - 1) / BOSS_WAVE_INTERVAL_AFTER_CURRICULUM);
  const id = BOSS_VARIANT_ROTATION[n % BOSS_VARIANT_ROTATION.length];
  return id ? BOSS_VARIANTS[id] : null;
}

/**
 * The wave of `variant` in place of `directed`, the director's plan for this
 * boss wave. It takes the director's HP multiplier (template range, DPS
 * ramp, endgame multiplier); a worm takes it per segment. Its size is the
 * variant's own, the fairness gate does not size it.
 */
export function bossVariantWave(variant: BossVariant, directed: AIWaveConfig, wave: number): AIWaveConfig {
  const hpMult = directed.templateStrength ?? 1;
  return {
    enemies: [{ type: variant.enemyType, count: 1, healthMultiplier: hpMult }],
    totalCount: 1,
    spawnDelay: 0,
    pattern: 'sequential',
    templateName: variant.name,
    templateStrength: hpMult,
    explanation: {
      summary: `W${wave}: ${variant.name}, HP ×${hpMult}`,
      reasons: [
        `Boss rotation past W${CURRICULUM_FORCED_THROUGH_WAVE}: ${variant.name} takes this boss wave `
          + `in place of the director's ${directed.templateName ?? 'boss template'}.`,
        `HP ×${hpMult} as the director planned it for this wave.`,
      ],
    },
  };
}
