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
import { DEFAULT_BUILD_TIME_MS, TOWER_TYPES } from '../configs/tower-types.config';
import { CAMO_HP_FACTOR, ENEMY_TYPES } from '../configs/enemy-types.config';
import { TOWER_PATHS } from '../configs/tower-paths.config';
import { GAME_BALANCE } from '../configs/game-balance.config';
import { CAMPAIGN } from '../configs/campaign.config';
import { RESEARCH_TREE } from '../configs/research/research-tree.config';
import { ABILITIES } from '../configs/abilities.config';
import { HERO } from '../configs/hero.config';
import { DAMAGE_MATRIX } from '../configs/combat/damage-matrix.config';
import { RUN_PLAN } from '../director/sources/budget/run-plan';
import { WAVE_TABLE } from '../director/sources/table/wave-table';
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
    RUN_PLAN,
    WAVE_TABLE,
    RESEARCH_TREE,
    ABILITIES,
    HERO,
    DAMAGE_MATRIX,
    // Rules beside the tables: a tower's default build time, a camouflaged enemy's HP, the tower paths
    { buildTimeMs: DEFAULT_BUILD_TIME_MS, camoHpFactor: CAMO_HP_FACTOR, paths: TOWER_PATHS },
  ];
}

const cached = new Map<WaveSourceId, string>();

/**
 * The hash of the current balance, for the run that plays `waveSource`.
 *
 * Two runs whose waves come from different sources must never land in the
 * same average, so the source goes into the hash. Only a source other than
 * the default does, so the default's hash stays what it was when a second
 * source is added (docs/WAVE_SOURCE_PLAN.md, section 8).
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
