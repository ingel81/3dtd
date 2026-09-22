/**
 * Boss variants: bosses that are no wave template of the director and come in
 * through a rotation over the boss waves past the campaign instead.
 *
 * The director stays as it is. It plans every wave as before, boss waves
 * included; on a boss wave the rotation names a variant for, the variant's
 * wave ships in place of the director's (GameLoopFacadeService). Templates
 * and campaign do not know the variants, so the director cannot pick one.
 * W1 to W30 are campaign waves and stay untouched.
 */

import type { WaveConfig as DirectorWave } from '../director/models/wave-config';
import type { WaveSizing } from '../director/wave-explanation';
import type { EnemyTypeId } from './enemy-types.config';
import {
  BOSS_WAVE_INTERVAL_AFTER_CAMPAIGN,
  CAMPAIGN_LENGTH,
  isBossWave,
} from './campaign.config';

export type BossVariantId = 'worm' | 'ooze';

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
    name: 'Boss: Skarnax',
    enemyType: 'worm',
    description:
      'A chitin worm as long as the route. Every segment is a target of its own; '
      + 'destroying one splits the worm in two.',
  },
  ooze: {
    id: 'ooze',
    name: 'Boss: Ooze',
    enemyType: 'ooze',
    description:
      'A mass of slime that grows along the route from the portal. Every tower along it hits it; '
      + 'at the HQ it flows in metre by metre, and a kill breaks it into slime clumps.',
  },
};

/**
 * The boss waves past the campaign in order, W35, W40, W45, ...: the
 * variant that takes the wave, or null for the director's own boss template.
 * Repeats from the start once through: W35 the worm, W45 the ooze, W55 the
 * worm again, the waves between them the director's.
 */
export const BOSS_VARIANT_ROTATION: readonly (BossVariantId | null)[] = ['worm', null, 'ooze', null];

/** The variant that takes wave `wave`, null on every other wave. */
export function bossVariantForWave(wave: number): BossVariant | null {
  if (wave <= CAMPAIGN_LENGTH || !isBossWave(wave)) return null;
  const n = Math.floor((wave - CAMPAIGN_LENGTH - 1) / BOSS_WAVE_INTERVAL_AFTER_CAMPAIGN);
  const id = BOSS_VARIANT_ROTATION[n % BOSS_VARIANT_ROTATION.length];
  return id ? BOSS_VARIANTS[id] : null;
}

/**
 * The wave of `variant` in place of `directed`, the director's plan for this
 * boss wave. It takes the director's HP multiplier (template range, DPS
 * ramp, endgame multiplier); a worm takes it per segment. Its size is the
 * variant's own, the fairness gate does not size it.
 */
/** What a boss wave reports when the director handed over no numbers. */
const EMPTY_SIZING: WaveSizing = {
  countRange: [1, 1],
  dpsScaledMax: 1,
  totalDps: 0,
  cap: null,
  countFactor: 1,
  count: 1,
  hpMult: 1,
  endgameHpMult: 1,
  spawnDelay: 0,
  durationCapped: false,
};

export function bossVariantWave(variant: BossVariant, directed: DirectorWave, wave: number): DirectorWave {
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
        `Boss rotation past W${CAMPAIGN_LENGTH}: ${variant.name} takes this boss wave `
          + `in place of the director's ${directed.templateName ?? 'boss template'}.`,
        `HP ×${hpMult} as the director planned it for this wave.`,
      ],
      // The numbers the director came to, with this wave's own size: one boss,
      // and no cap, because the fairness gate did not size this one.
      sizing: {
        ...(directed.explanation?.sizing ?? EMPTY_SIZING),
        cap: null,
        count: 1,
        hpMult,
      },
    },
  };
}
