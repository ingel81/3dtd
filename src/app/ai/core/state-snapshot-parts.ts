/**
 * Sections of the AI state snapshot that are plain functions of their
 * inputs: the player, the research state and the armor the player should
 * prepare for. The collector assembles them with the defense analysis.
 */

import { PlayerState, ResearchSnapshot } from './models/game-state-snapshot';
import { WaveConfig } from './models/wave-config';
import { TOWER_TYPES, TowerTypeId } from '../../configs/tower-types.config';
import { ArmorType } from '../../configs/combat/combat.types';
import { getEnemyType, EnemyTypeId } from '../../configs/enemy-types.config';
import { templateObjectForWave } from '../../configs/wave-curriculum.config';
import { GAME_BALANCE } from '../../configs/game-balance.config';
import type { ResearchStore } from '../../store/research.store';

/** What the research snapshot reads from the research store. */
export type ResearchReader = Pick<
  ResearchStore,
  | 'completedResearches'
  | 'activeResearches'
  | 'centerLevel'
  | 'researchSlots'
  | 'airTargetingUnlocked'
  | 'maxUpgradeTier'
  | 'isTowerUnlocked'
>;

export function playerState(baseHealth: number, credits: number): PlayerState {
  const maxHealth = GAME_BALANCE.player.startHealth;
  return {
    credits,
    lives: baseHealth,
    maxLives: maxHealth,
    livesPercent: baseHealth / maxHealth,
  };
}

/**
 * The research tree the shipped ONNX model knows: checkpoint 7350, trained
 * from 2026-04-17 and exported 2026-04-27 (e8ae88a9), on these eleven nodes.
 * The research quota the encoder reads (completedCount / totalCount) counts
 * only them, so it keeps the scale the model was trained on. Every node
 * added since (Storm Mastery, the T4/T5 tiers, Chaos Rift, the abilities, the
 * hero's contract) would lower it at the same progress, and bots never take
 * the contract, so it could not reach 1 any more. A new training run is the
 * moment to widen it (AI_WAVE_DIRECTOR_PLAN.md, section 7).
 */
export const ENCODER_RESEARCH_IDS: readonly string[] = [
  'gatling-tech', 'ice-magic', 'tentacle-biology', 'toxic-compounds', 'siege-engineering', 'fire-alchemy',
  'arcane-studies', 'rocketry', 'aa-retrofit', 'advanced-weaponry', 'master-engineering',
];

/** Build a research-state snapshot from ResearchStore. */
export function researchSnapshot(research: ResearchReader): ResearchSnapshot {
  const completed = research.completedResearches();
  let completedCount = 0;
  for (const id of ENCODER_RESEARCH_IDS) {
    if (completed.has(id)) completedCount++;
  }

  // Build per-tower unlock map
  const towerUnlocked: Record<TowerTypeId, boolean> = {} as Record<TowerTypeId, boolean>;
  for (const id of Object.keys(TOWER_TYPES) as TowerTypeId[]) {
    towerUnlocked[id] = research.isTowerUnlocked(id);
  }

  const activeResearches = research.activeResearches();
  return {
    completedIds: [...completed],
    completedCount,
    totalCount: ENCODER_RESEARCH_IDS.length,
    activeIds: activeResearches.map(a => a.researchId),
    centerLevel: research.centerLevel(),
    slotsUsed: activeResearches.length,
    maxSlots: research.researchSlots(),
    airTargetingUnlocked: research.airTargetingUnlocked(),
    maxUpgradeTier: research.maxUpgradeTier(),
    towerUnlocked,
  };
}

/**
 * Armor distribution the player should prepare for.
 *
 * During a wave this is the wave actually running (`running`). Between waves
 * there is no running config (the collector clears it once a wave resolves),
 * and that is exactly when both the bot and the Wave Director look at this
 * feature — so an empty value there meant the AI planned against a
 * uniform-armor fallback for the entire build phase. Fall back to the
 * curriculum's template for `nextWave` instead, which is what will actually
 * spawn.
 */
export function expectedArmorDistribution(
  running: WaveConfig | null,
  nextWave: number,
): Record<ArmorType, number> | undefined {
  const groups = running?.enemies?.length
    ? running.enemies.map((g) => ({ type: g.type, weight: g.count }))
    : upcomingTemplateGroups(nextWave);
  if (!groups || groups.length === 0) return undefined;

  const dist: Record<ArmorType, number> = {
    unarmored: 0, light: 0, heavy: 0, fortified: 0, ethereal: 0,
  };
  let total = 0;
  for (const group of groups) {
    const enemyCfg = getEnemyType(group.type as EnemyTypeId);
    if (!enemyCfg?.armorType) continue;
    dist[enemyCfg.armorType] += group.weight;
    total += group.weight;
  }
  if (total === 0) return undefined;
  for (const k of Object.keys(dist) as ArmorType[]) {
    dist[k] /= total;
  }
  return dist;
}

/** Enemy shares of the template the curriculum pins to `wave`. */
function upcomingTemplateGroups(wave: number): { type: string; weight: number }[] | undefined {
  const template = templateObjectForWave(wave);
  if (!template) return undefined;
  return template.enemies.map(([type, share]) => ({ type, weight: share }));
}
