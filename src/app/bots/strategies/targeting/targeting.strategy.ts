/**
 * Targeting Strategy (docs/BOT_PLAYER_PLAN.md, B4)
 *
 * A rule (decision/arbiter.ts): what a player sets in the tower panel before
 * a wave, in the build phase only. Against a boss the strongest single-target
 * towers (BOSS_HUNTERS, by DPS) aim at the most HP, so the boss does not walk
 * through while they pick off the escort. Against a wave that brings much of
 * its HP by air, the strongest third of the towers that hit both aim at air
 * first. Every other tower keeps the default of its type. One tower per
 * decision, like clicks: a first build that turned every archer before each
 * air wave and back after it made 104 changes by wave 13.
 */

import type { GameStateSnapshot } from '../../../director/models/game-state-snapshot';
import type { TargetingStrategy as Targeting, TowerTypeId } from '../../../configs/tower-types.config';
import { computeTowerDPS } from '../../../director/tower-dps.util';
import { isSplashTower } from '../../../director/defense-analyzer';
import { canTargetAirEffective } from '../../../entities/tower-targeting.util';
import type { Tower } from '../../../entities/tower.entity';
import type { BotWorld } from '../../bot-world';
import type { TowerAction } from '../../bots/tower-bot.interface';
import { threatFromWaves } from '../../decision/value';
import { BaseStrategy } from '../tower-strategy.interface';

/** Share of a wave's HP in the air from which the towers that hit both aim at air first */
export const AIR_FIRST_SHARE = 0.3;

/** The strongest single-target towers that aim at a boss */
export const BOSS_HUNTERS = 3;

/** Share of the towers that hit both, the strongest, that aim at air first */
export const AIR_FIRST_TOWERS = 1 / 3;

export class TargetingStrategy extends BaseStrategy {
  constructor(private readonly world: BotWorld) {
    super('Targeting');
  }

  canExecute(state: GameStateSnapshot): boolean {
    return this.nextChange(state) !== null;
  }

  execute(state: GameStateSnapshot): TowerAction | null {
    const change = this.nextChange(state);
    if (!change) return null;
    return {
      type: 'set-targeting',
      towerId: change.tower.id,
      targeting: change.targeting,
      reason: `${change.tower.typeConfig.name} aims at ${change.targeting}`,
    };
  }

  /** The first own tower whose targeting differs from what the wave calls for */
  private nextChange(state: GameStateSnapshot): { tower: Tower; targeting: Targeting } | null {
    if (state.phase !== 'setup') return null;
    const [facts] = this.world.peekWaves(state.waveNumber + 1, 1);
    const towers = this.world.towerManager.getAll().filter((t) => t.typeConfig.attackType !== 'passive');
    if (towers.length === 0) return null;

    const threat = facts ? threatFromWaves([facts]) : null;
    const total = (side: Record<string, number>) => Object.values(side).reduce((a, b) => a + b, 0);
    const airShare = threat ? total(threat.air) / Math.max(1, total(threat.air) + total(threat.ground)) : 0;
    const airUnlocked = state.research?.airTargetingUnlocked ?? false;

    const strongest = [...towers].sort((a, b) => computeTowerDPS(b) - computeTowerDPS(a));
    const hunters = new Set(facts?.boss
      ? strongest.filter((t) => !isSplashTower(t.typeConfig.id as TowerTypeId)).slice(0, BOSS_HUNTERS).map((t) => t.id)
      : []);
    const bothSides = strongest.filter((t) => !hunters.has(t.id) && (t.typeConfig.canTargetGround ?? true)
      && canTargetAirEffective(t.typeConfig.id as TowerTypeId, airUnlocked));
    const airFirst = new Set(airShare >= AIR_FIRST_SHARE
      ? bothSides.slice(0, Math.ceil(bothSides.length * AIR_FIRST_TOWERS)).map((t) => t.id)
      : []);

    for (const tower of towers) {
      const targeting: Targeting = hunters.has(tower.id) ? 'highest-hp'
        : airFirst.has(tower.id) ? 'air-priority'
          : tower.typeConfig.defaultTargeting ?? 'closest';
      if (tower.targetingStrategy !== targeting) return { tower, targeting };
    }
    return null;
  }
}
