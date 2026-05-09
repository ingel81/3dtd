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
} from '../../../../configs/research/research-tree.config';
import { ResearchId, ResearchEffect } from '../../../../configs/research/research.types';
import { ArmorType, ARMOR_TYPES } from '../../../../configs/combat/combat.types';
import { DAMAGE_MATRIX } from '../../../../configs/combat/damage-matrix.config';
import { TowerTypeId, TOWER_TYPES } from '../../../../configs/tower-types.config';
import { templateObjectForWave } from '../../../../configs/wave-curriculum.config';
import { ENEMY_TYPES, EnemyTypeId } from '../../../../configs/enemy-types.config';

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
    // Phase 5.16: order aligned to wave-curriculum so the bot has the
    // right counters by the time the curriculum forces a new armor type.
    //   W7  bat_swarm     → needs Anti-Air → rocketry/aa-retrofit done by W6
    //   W10 boss_herbert  → needs Cannon (Heavy/Boss) → siege-engineering
    //   W13 ghost_surge   → needs Magic (Ethereal) → arcane-studies done by W12
    strategist: [
      'gatling-tech',           // W1 — Dual-Gatling early DPS
      'ice-magic',              // W1-2 — Ice (slow, ethereal-decent later)
      'tentacle-biology',       // W2-3 — chokepoint melee
      'siege-engineering',      // W3-4 — Cannon for heavy/boss/fortified
      'rocketry',               // W4-5 — Anti-Air ready before W7
      'aa-retrofit',            // W5-6 — Gatling can shoot air
      'arcane-studies',         // W6-9 — Magic for Ethereal W13
      'toxic-compounds',        // W9+
      'fire-alchemy',           // W10+
      'advanced-weaponry',      // W11-15 — T2 upgrades
      'master-engineering',     // W15-18 — T3 upgrades
      'advanced-engineering',   // W19-23 — T4 upgrades (L16-20)
      'transcendent-tech',      // W24-30 — T5 upgrades (L21-25)
    ],
    meta: [
      'gatling-tech', 'ice-magic', 'tentacle-biology',
      'siege-engineering', 'rocketry', 'aa-retrofit',
      'arcane-studies', 'toxic-compounds', 'fire-alchemy',
      'advanced-weaponry', 'master-engineering',
      'advanced-engineering', 'transcendent-tech',
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
   *
   * Phase 5.16: when the upcoming wave contains AIR units and the bot has
   * no anti-air capability yet, anti-air researches (rocketry, aa-retrofit)
   * get a hard priority bump — without it, raw armor-matrix scoring picks
   * Magic (1.0× vs light) over Rocket (0.7× vs light) and the bot enters a
   * forced-air wave defenseless.
   */
  private pickByArmorGap(state: GameStateSnapshot): ResearchId | null {
    const r = state.research;
    const dist = state.expectedArmorDistribution!;
    const upcomingHasAir = this.upcomingWaveHasAir(state);
    const hasAntiAir = this.hasAntiAirCapability(state);
    const airUrgent = upcomingHasAir && !hasAntiAir;

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

      // Anti-Air urgency bump
      if (airUrgent && (id === 'rocketry' || id === 'aa-retrofit')) {
        score += 100;
      }

      if (score > bestScore) {
        bestScore = score;
        bestResearch = id;
      }
    }

    return bestResearch;
  }

  /** True iff the upcoming wave's enemy mix includes any air unit. */
  private upcomingWaveHasAir(state: GameStateSnapshot): boolean {
    // expectedArmorDistribution doesn't expose air-vs-ground, so we look up
    // the curriculum-forced template for the next wave (if in curriculum range)
    // and check enemies.
    const next = state.waveNumber + 1;
    const forced = templateObjectForWave(next);
    if (!forced) return false;
    return forced.enemies.some(([typeId]) => {
      const cfg = ENEMY_TYPES[typeId as EnemyTypeId];
      return !!cfg?.isAirUnit;
    });
  }

  /** True iff the bot already has any anti-air capability researched. */
  private hasAntiAirCapability(state: GameStateSnapshot): boolean {
    const r = state.research;
    if (!r) return false;
    return !!(r.towerUnlocked?.['rocket'] || r.airTargetingUnlocked);
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
