import { GAME_BALANCE } from '../../configs/game-balance.config';
import { TOWER_TYPES, type TowerTypeId } from '../../configs/tower-types.config';
import { getResearch } from '../../configs/research/research-tree.config';
import type { ResearchId } from '../../configs/research/research.types';

/**
 * The rules a world sets for the runs on it (a custom map's gameplay,
 * docs/CUSTOM_MAPS.md): start credits, HQ health, which tower types may be
 * built. A world without its own (the tiles, DevWorld) plays the game's
 * (DEFAULT_RUN_RULES). Part of the SimWorld and its key, so a coop guest and
 * a replay play by the same.
 */
export interface RunRules {
  /** Start credits per lane of a player (GAME_BALANCE.player.startCredits) */
  startCredits: number;
  /** HQ health at the start and its maximum (GAME_BALANCE.player.startHealth) */
  hqHealth: number;
  /** The tower types that may be built at all (research still unlocks them); null: every type */
  towers: readonly TowerTypeId[] | null;
}

export const DEFAULT_RUN_RULES: RunRules = {
  startCredits: GAME_BALANCE.player.startCredits,
  hqHealth: GAME_BALANCE.player.startHealth,
  towers: null,
};

/** Bounds a world's values are held in */
export const RUN_RULE_LIMITS = {
  startCredits: { min: 0, max: 100_000 },
  hqHealth: { min: 1, max: 100_000 },
} as const;

const clamp = (value: unknown, { min, max }: { min: number; max: number }, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;

/**
 * The rules a world asks for, completed with the game's and held in bounds:
 * whole numbers, known tower types only (an empty or unknown list: every
 * type), in the order TOWER_TYPES lists them.
 */
export function runRulesOf(asked: Partial<{ startCredits: unknown; hqHealth: unknown; towers: unknown }> | null | undefined): RunRules {
  if (!asked) return DEFAULT_RUN_RULES;
  const listed = Array.isArray(asked.towers) ? new Set(asked.towers.filter((t): t is string => typeof t === 'string')) : null;
  const towers = listed ? (Object.keys(TOWER_TYPES) as TowerTypeId[]).filter((id) => listed.has(id)) : [];
  return {
    startCredits: clamp(asked.startCredits, RUN_RULE_LIMITS.startCredits, DEFAULT_RUN_RULES.startCredits),
    hqHealth: clamp(asked.hqHealth, RUN_RULE_LIMITS.hqHealth, DEFAULT_RUN_RULES.hqHealth),
    towers: towers.length > 0 ? towers : null,
  };
}

/** Whether the rules allow building `towerId` at all */
export function towerAllowed(rules: RunRules, towerId: TowerTypeId): boolean {
  return rules.towers === null || rules.towers.includes(towerId);
}

/** The rules as a stable text for the world key; empty for the game's own */
export function runRulesKey(rules: RunRules | undefined): string {
  if (!rules) return '';
  return `r=${rules.startCredits},${rules.hqHealth},${rules.towers?.join('+') ?? '*'}`;
}

/**
 * Whether `towerId` can be built: the rules allow it, and it is the archer or
 * the research center or a completed research unlocks it. The one test of
 * the simulation (ResearchManager) and the build menu (ResearchStore).
 */
export function towerUnlockedBy(towerId: TowerTypeId, completed: Iterable<ResearchId>, rules: RunRules): boolean {
  if (!towerAllowed(rules, towerId)) return false;
  if (towerId === 'archer' || towerId === 'research-center') return true;
  for (const researchId of completed) {
    const config = getResearch(researchId);
    if (config?.effects.some((effect) => effect.kind === 'unlock-tower' && effect.towerId === towerId)) return true;
  }
  return false;
}
