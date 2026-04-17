/**
 * Research Pick Strategy
 *
 * Priority: 80 (between NearSpawnUpgrade=75 and SplashDefense=85).
 *
 * Fires when:
 * - Research Center is placed (centerLevel > 0)
 * - At least one free slot available
 * - Next research in skill-specific order is affordable + prereqs met
 *
 * Skill-level pick order:
 * - beginner: ['gatling-tech']
 * - casual: basic unlocks (gatling, ice, poison, cannon, fire)
 * - strategist: full tree + perks + tiers (adaptive: armor-gap aware)
 * - meta: same as strategist
 */

import { BaseStrategy } from '../tower-strategy.interface';
import { GameStateSnapshot } from '../../../core/models/game-state-snapshot';
import { TowerAction, BotConfig, BotSkillLevel } from '../../bots/tower-bot.interface';
import {
  getResearch,
  getAllResearchIds,
  getResearchForTower,
} from '../../../../configs/research/research-tree.config';
import { ResearchId, ResearchEffect } from '../../../../configs/research/research.types';
import { ArmorType, ARMOR_TYPES } from '../../../../configs/combat/combat.types';
import { DAMAGE_MATRIX } from '../../../../configs/combat/damage-matrix.config';
import { TowerTypeId, TOWER_TYPES } from '../../../../configs/tower-types.config';

export class ResearchPickStrategy extends BaseStrategy {
  constructor(private config: BotConfig) {
    super('ResearchPick', 80);
  }

  /** Static fallback order per skill — used when no adaptive pick is available. */
  private readonly researchOrderBySkill: Record<BotSkillLevel, ResearchId[]> = {
    beginner: ['gatling-tech'],
    casual: [
      'gatling-tech', 'ice-magic', 'toxic-compounds',
      'siege-engineering', 'fire-alchemy',
    ],
    strategist: [
      'gatling-tech', 'siege-engineering', 'ice-magic',
      'arcane-studies', 'rocketry', 'fire-alchemy',
      'toxic-compounds', 'tentacle-biology', 'aa-retrofit',
      'advanced-weaponry', 'master-engineering',
    ],
    meta: [
      'gatling-tech', 'siege-engineering', 'ice-magic',
      'arcane-studies', 'rocketry', 'fire-alchemy',
      'toxic-compounds', 'tentacle-biology', 'aa-retrofit',
      'advanced-weaponry', 'master-engineering',
    ],
  };

  canExecute(state: GameStateSnapshot): boolean {
    const r = state.research;
    if (!r) return false;
    if (r.centerLevel === 0) return false;
    if (r.slotsUsed >= r.maxSlots) return false;

    const next = this.pickNext(state);
    if (!next) return false;

    const cfg = getResearch(next);
    if (!cfg) return false;

    return state.player.credits >= cfg.cost;
  }

  execute(state: GameStateSnapshot): TowerAction | null {
    const next = this.pickNext(state);
    if (!next) return null;

    const cfg = getResearch(next);
    return {
      type: 'research-start',
      researchId: next,
      confidence: 0.85,
      reason: `Unlocking ${cfg?.name ?? next}`,
    };
  }

  /**
   * Pick the next research to start.
   * Strategist/Meta: armor-gap adaptive. Others: static skill list.
   */
  private pickNext(state: GameStateSnapshot): ResearchId | null {
    const skill = this.config.skillLevel;
    const r = state.research;
    if (!r) return null;

    // Adaptive: strategist/meta prefer researches that address armor coverage gaps
    if ((skill === 'strategist' || skill === 'meta') && state.expectedArmorDistribution) {
      const adaptive = this.pickByArmorGap(state);
      if (adaptive) return adaptive;
    }

    // Fallback: skill-order list
    const list = this.researchOrderBySkill[skill];
    return list.find(id =>
      !r.completedIds.includes(id) &&
      !this.isActive(id, state) &&
      this.prereqsMet(id, state)
    ) ?? null;
  }

  /**
   * Pick a research that unlocks a tower with good matchup against current armor distribution.
   * Scores each tower-unlock by its effective DPS-per-cost against the armor mix.
   */
  private pickByArmorGap(state: GameStateSnapshot): ResearchId | null {
    const r = state.research;
    const dist = state.expectedArmorDistribution!;

    let bestResearch: ResearchId | null = null;
    let bestScore = -Infinity;

    for (const id of getAllResearchIds()) {
      if (r.completedIds.includes(id)) continue;
      if (this.isActive(id, state)) continue;
      if (!this.prereqsMet(id, state)) continue;
      const cfg = getResearch(id);
      if (!cfg) continue;

      // Score based on effect type
      let score = 0;
      for (const effect of cfg.effects) {
        score += this.scoreEffect(effect, dist, state);
      }

      if (score > bestScore) {
        bestScore = score;
        bestResearch = id;
      }
    }

    return bestResearch;
  }

  private scoreEffect(
    effect: ResearchEffect,
    dist: Record<ArmorType, number>,
    state: GameStateSnapshot,
  ): number {
    if (effect.kind === 'unlock-tower') {
      const towerCfg = TOWER_TYPES[effect.towerId as TowerTypeId];
      if (!towerCfg) return 0;
      // Score: avg damage multiplier against current armor mix, weighted by DPS/cost
      const dps = towerCfg.attackType === 'beam'
        ? (towerCfg.damagePerSecond ?? 0)
        : towerCfg.damage * towerCfg.fireRate;
      const avgMult = ARMOR_TYPES.reduce((s, a) =>
        s + (DAMAGE_MATRIX[towerCfg.damageType]?.[a] ?? 1) * (dist[a] ?? 0), 0);
      return (dps * avgMult) / Math.max(1, towerCfg.cost);
    }
    if (effect.kind === 'unlock-upgrade-tier') {
      // High priority if current max tier < unlock-tier
      return state.research && effect.tier > state.research.maxUpgradeTier ? 2.0 : 0.2;
    }
    if (effect.kind === 'global-perk' || effect.kind === 'enable-targeting') {
      return 1.0; // generic useful signal
    }
    return 0.5;
  }

  private prereqsMet(id: ResearchId, state: GameStateSnapshot): boolean {
    const cfg = getResearch(id);
    if (!cfg) return false;
    return cfg.prerequisites.every(p => state.research.completedIds.includes(p));
  }

  private isActive(id: ResearchId, state: GameStateSnapshot): boolean {
    return state.research.activeIds.includes(id);
  }
}
