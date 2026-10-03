/**
 * Tower Sell Strategy (docs/BOT_PLAYER_PLAN.md, B4)
 *
 * A rule (decision/arbiter.ts): what a player sells.
 *
 * - **A blind tower:** one that sees little of the route (its metres under
 *   fire under BLIND_SHARE of what its reach should cover) and did almost
 *   nothing over the last IDLE_WAVES waves (under IDLE_DAMAGE_SHARE of the
 *   damage). It stands behind a facade; its gold builds better elsewhere.
 * - **Room for better:** in the build phase at the bot's pace
 *   (towersByWave), when a type it may build is worth REPLACE_GAIN times what
 *   its weakest unupgraded tower adds and is affordable: sell that one, the
 *   build takes the free place next.
 *
 * Replaces SellUnderperformer, which sold unupgraded archers once the bot sat
 * on 2,000 gold. A tower stands IDLE_WAVES waves before it can go, so the bot
 * does not sell what it just built.
 */

import type { GameStateSnapshot } from '../../../director/models/game-state-snapshot';
import { TOWER_TYPES, TowerTypeId } from '../../../configs/tower-types.config';
import type { UpgradeLevels } from '../../../director/tower-dps.util';
import type { Tower } from '../../../entities/tower.entity';
import type { BotWorld } from '../../bot-world';
import { BotConfig, TowerAction, towersByWave } from '../../bots/tower-bot.interface';
import type { Proposal } from '../../decision/arbiter';
import { difference, expectedMetres, killTimeSaved, newTowerCapacity, ownCapacity } from '../../decision/value';
import type { DecisionContext, ITowerStrategy } from '../tower-strategy.interface';

/** Waves a tower must have stood before it can be sold */
export const IDLE_WAVES = 3;

/** Share of the damage under which a tower did almost nothing */
export const IDLE_DAMAGE_SHARE = 0.02;

/** Share of its expected metres under fire under which a tower is blind */
export const BLIND_SHARE = 0.3;

/** How much more a new type must be worth than the tower it replaces */
export const REPLACE_GAIN = 2;

/** Game time between two sales */
const SELL_COOLDOWN_MS = 4000;

export class TowerSellStrategy implements ITowerStrategy {
  readonly name = 'Sell';
  private cooldownMs = 0;

  constructor(private readonly world: BotWorld, private readonly config: BotConfig) {}

  tickCooldowns(deltaTime: number): void {
    this.cooldownMs = Math.max(0, this.cooldownMs - deltaTime);
  }

  onReset(): void {
    this.cooldownMs = 0;
  }

  propose(state: GameStateSnapshot, context: DecisionContext): Proposal[] {
    if (this.cooldownMs > 0) return [];
    const towers = this.world.towerManager.getAll().filter((t) => t.typeConfig.attackType !== 'passive');
    const sale = this.blind(towers, context) ?? this.roomForBetter(state, towers, context);
    if (!sale) return [];
    return [{
      kind: 'rule',
      label: this.name,
      cost: 0,
      value: 0,
      act: (): TowerAction => {
        this.cooldownMs = SELL_COOLDOWN_MS;
        return { type: 'sell', towerId: sale.tower.id, reason: sale.reason };
      },
    }];
  }

  /** A tower that sees little and did almost nothing for IDLE_WAVES waves */
  private blind(towers: Tower[], context: DecisionContext): { tower: Tower; reason: string } | null {
    const damageOf = (t: Tower) => this.world.perception.tower(t.id)?.waves.reduce((sum, w) => sum + w.damage, 0) ?? 0;
    const total = towers.reduce((sum, t) => sum + damageOf(t), 0);
    if (total <= 0) return null;
    for (const tower of towers) {
      const record = this.world.perception.tower(tower.id);
      if (!record || record.waves.length < IDLE_WAVES) continue;
      const expected = expectedMetres(tower.typeConfig.id as TowerTypeId, context.routes);
      const metres = context.metresByTower.get(tower.id) ?? { ground: 0, air: 0 };
      const seen = Math.max(metres.ground, metres.air) / Math.max(1e-6, expected);
      const share = damageOf(tower) / total;
      if (seen < BLIND_SHARE && share < IDLE_DAMAGE_SHARE) {
        return { tower, reason: `${tower.typeConfig.name} sees ${Math.round(seen * 100)}% of its reach, did ${(share * 100).toFixed(1)}% of the damage` };
      }
    }
    return null;
  }

  /** At the pace, in the build phase: the weakest unupgraded tower, when a type worth REPLACE_GAIN times more is affordable */
  private roomForBetter(state: GameStateSnapshot, towers: Tower[], context: DecisionContext): { tower: Tower; reason: string } | null {
    if (state.phase !== 'setup' || towers.length < towersByWave(this.config, state.waveNumber)) return null;
    const air = state.research?.airTargetingUnlocked ?? false;

    let best: { type: TowerTypeId; value: number } | null = null;
    for (const type of this.config.knownTowerTypes) {
      const cfg = TOWER_TYPES[type];
      if (!cfg || cfg.attackType === 'passive' || cfg.cost > state.player.credits) continue;
      if (state.research && !state.research.towerUnlocked[type]) continue;
      const value = killTimeSaved(context.threat, context.capacity,
        newTowerCapacity(type, air, context.routes, context.capacity, context.routeMetres));
      if (!best || value > best.value) best = { type, value };
    }
    if (!best) return null;

    let weakest: { tower: Tower; value: number } | null = null;
    for (const tower of towers) {
      const cfg = tower.typeConfig;
      if (cfg.upgrades.some((u) => tower.getUpgradeLevel(u.id) > 0)) continue;
      const record = this.world.perception.tower(tower.id);
      if (!record || record.waves.length < IDLE_WAVES) continue;
      const expected = expectedMetres(cfg.id as TowerTypeId, context.routes);
      const metres = context.metresByTower.get(tower.id) ?? { ground: expected, air: expected };
      const own = ownCapacity(cfg, {} as UpgradeLevels, air, metres, context.capacity, context.routeMetres);
      const value = killTimeSaved(context.threat, difference(context.capacity, own), own);
      if (!weakest || value < weakest.value) weakest = { tower, value };
    }
    if (!weakest || best.value < REPLACE_GAIN * weakest.value) return null;
    return {
      tower: weakest.tower,
      reason: `${weakest.tower.typeConfig.name} makes room for a ${TOWER_TYPES[best.type].name}`,
    };
  }
}
