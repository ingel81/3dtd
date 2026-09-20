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

let cached: string | null = null;

/** The hash of the current balance. Computed once, the configs are constants. */
export function balanceConfigHash(): string {
  cached ??= fnv1a(balanceParts().map(stable).join('|'));
  return cached;
}

/** Only for specs: forget the cached hash. */
export function resetBalanceConfigHash(): void {
  cached = null;
}
