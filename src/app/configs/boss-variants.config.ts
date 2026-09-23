/**
 * Boss variants: bosses that are no wave template of the director. They come
 * in on two campaign boss waves (W20 the ooze, W30 Skarnax) and through a
 * rotation over the boss waves past the campaign.
 *
 * The director stays as it is. It plans every wave as before, boss waves
 * included; on a boss wave a variant is named for, the variant's wave ships in
 * place of the director's (AdaptiveSource). Templates do not know the
 * variants, so the director cannot pick one.
 */

import type { WaveConfig as DirectorWave } from '../director/models/wave-config';
import type { WaveSizing } from '../director/wave-explanation';
import { ENEMY_TYPES, WORM_MAX_SEGMENTS, lineageHp, type EnemyTypeId } from './enemy-types.config';
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

/**
 * Campaign boss waves a variant takes (User, 2026-09-23): three Herberts in
 * thirty waves were too many. W10 stays Herbert, the first boss of a run.
 */
export const CAMPAIGN_BOSS_VARIANTS: Readonly<Record<number, BossVariantId>> = { 20: 'ooze', 30: 'worm' };

/** The variant that takes wave `wave`, null on every other wave. */
export function bossVariantForWave(wave: number): BossVariant | null {
  if (wave <= CAMPAIGN_LENGTH) {
    const id = CAMPAIGN_BOSS_VARIANTS[wave];
    return id ? BOSS_VARIANTS[id] : null;
  }
  if (!isBossWave(wave)) return null;
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

/**
 * HP of one variant at multiplier 1, splits included. A worm counts at its
 * longest; on a shorter route it has fewer segments and so less HP, never more.
 */
function variantNominalHp(variant: BossVariant): number {
  const type = ENEMY_TYPES[variant.enemyType];
  return type?.chain ? type.baseHp * WORM_MAX_SEGMENTS : lineageHp(variant.enemyType);
}

/** HP of the wave the director planned, splits included. */
function directedTotalHp(directed: DirectorWave): number {
  return directed.enemies.reduce(
    (sum, e) => sum + e.count * lineageHp(e.type as EnemyTypeId) * (e.healthMultiplier ?? 1), 0);
}

export function bossVariantWave(variant: BossVariant, directed: DirectorWave, wave: number): DirectorWave {
  // In the campaign the director plans a Herbert wave here, sized by the
  // survivability cap; the variant takes that wave's HP as a whole. Its own
  // multiplier would not fit: the Herbert range reaches x20, and at W20 that
  // made a 500,000 HP ooze against a defense dealing 76,000 a wave.
  const inCampaign = wave <= CAMPAIGN_LENGTH;
  const hpMult = inCampaign
    ? Math.max(0.05, Math.round((directedTotalHp(directed) / variantNominalHp(variant)) * 1000) / 1000)
    : directed.templateStrength ?? 1;
  const reasons = inCampaign
    ? [
      `Campaign boss W${wave}: ${variant.name} takes this boss wave `
        + `in place of the director's ${directed.templateName ?? 'boss template'}.`,
      `HP ×${hpMult}: as much HP as the wave the director planned for it.`,
    ]
    : [
      `Boss rotation past W${CAMPAIGN_LENGTH}: ${variant.name} takes this boss wave `
        + `in place of the director's ${directed.templateName ?? 'boss template'}.`,
      `HP ×${hpMult} as the director planned it for this wave.`,
    ];
  return {
    enemies: [{ type: variant.enemyType, count: 1, healthMultiplier: hpMult }],
    totalCount: 1,
    spawnDelay: 0,
    pattern: 'sequential',
    templateName: variant.name,
    templateStrength: hpMult,
    explanation: {
      summary: `W${wave}: ${variant.name}, HP ×${hpMult}`,
      reasons,
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
