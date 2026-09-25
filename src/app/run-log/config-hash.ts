/**
 * One hash over everything that decides how a run plays.
 *
 * Two runs with different balance must never land in the same average. The
 * hash goes into the run log's head; the analysis groups by it and warns when
 * a batch mixes states (BALANCING_PLAN.md, phase 2c).
 *
 * It covers the configs, not the code: a changed formula with unchanged tables
 * gives the same hash. The commit in the head is what separates those, which
 * is why the head carries both.
 */

import { fnv1a } from '../utils/fnv1a';
import { TOWER_TYPES } from '../configs/tower-types.config';
import { ENEMY_TYPES } from '../configs/enemy-types.config';
import { GAME_BALANCE } from '../configs/game-balance.config';
import { CAMPAIGN } from '../configs/campaign.config';
import { TEMPLATES } from '../director/templates';
import { RESEARCH_TREE } from '../configs/research/research-tree.config';
import { ABILITIES } from '../configs/abilities.config';
import { HERO } from '../configs/hero.config';
import { BOSS_VARIANTS } from '../configs/boss-variants.config';
import { DAMAGE_MATRIX } from '../configs/combat/damage-matrix.config';
import { DEFAULT_WAVE_SOURCE } from '../configs/director.config';
import type { WaveSourceId } from '../director/wave-source';

/**
 * `JSON.stringify` with the keys of every object sorted, so a reordering in
 * the source does not read as a balance change.
 */
function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => typeof v !== 'function')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`);
  return `{${entries.join(',')}}`;
}

/** The configs the hash covers, in a fixed order. */
function balanceParts(): unknown[] {
  return [
    TOWER_TYPES,
    ENEMY_TYPES,
    GAME_BALANCE,
    CAMPAIGN,
    TEMPLATES,
    RESEARCH_TREE,
    ABILITIES,
    HERO,
    BOSS_VARIANTS,
    DAMAGE_MATRIX,
  ];
}

const cached = new Map<WaveSourceId, string>();

/**
 * The hash of the current balance, for the run that plays `waveSource`.
 *
 * Two runs whose waves come from different sources must never land in the
 * same average, so the source goes into the hash. Only a source other than
 * the default does: the hashes of every run measured so far belong to the
 * adaptive one, and moving them would throw that comparability away for a
 * change that changed no balance (docs/WAVE_SOURCE_PLAN.md, section 8).
 *
 * Computed once per source; the configs are constants.
 */
export function balanceConfigHash(waveSource: WaveSourceId = DEFAULT_WAVE_SOURCE): string {
  const known = cached.get(waveSource);
  if (known) return known;
  const parts = balanceParts();
  if (waveSource !== DEFAULT_WAVE_SOURCE) parts.push(waveSource);
  const hash = fnv1a(parts.map(stable).join('|'));
  cached.set(waveSource, hash);
  return hash;
}
