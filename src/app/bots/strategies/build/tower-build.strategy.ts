/**
 * Tower Build Strategy (docs/BOT_PLAYER_PLAN.md, B3)
 *
 * Proposes one new tower of every type the bot may build, each with its
 * value against the coming waves (decision/value.ts); the arbiter picks.
 * Replaces the five placements that each answered "which type now" with a
 * rule of their own (anti-air from wave 4, a quarter against ethereal, splash
 * from wave 3, a fill with a coin flip between saving and reinforcing, an
 * archer cap): a type that closes a gap is worth most because the returns on
 * what stands fall, and a short reach is worth less because it covers less
 * route (chordMetres). The spot is looked for only for the buy the arbiter
 * takes: the placement service, with its line of sight probe (B2). How many
 * towers stand by a wave is the bot's pace (BotConfig.buildTempo), not a value.
 */

import type { GameStateSnapshot } from '../../../director/models/game-state-snapshot';
import { TOWER_TYPES, TowerTypeId } from '../../../configs/tower-types.config';
import type { StrategicPlacementService } from '../../../services/world/strategic-placement.service';
import type { BotWorld } from '../../bot-world';
import { BotConfig, TowerAction, towersByWave } from '../../bots/tower-bot.interface';
import type { Proposal } from '../../decision/arbiter';
import { killTimeSaved, newTowerCapacity } from '../../decision/value';
import type { DecisionContext, ITowerStrategy } from '../tower-strategy.interface';

/** Where the spot comes from: zones along the route that lack towers, or the two ends of the route */
export type BuildSpots = 'distributed' | 'strategic';

export class TowerBuildStrategy implements ITowerStrategy {
  readonly name = 'Build';

  constructor(
    private readonly placement: StrategicPlacementService,
    private readonly world: BotWorld,
    private readonly config: BotConfig,
    private readonly spots: BuildSpots,
  ) {}

  propose(state: GameStateSnapshot, context: DecisionContext): Proposal[] {
    const { maxTowers } = this.config;
    if (maxTowers > 0 && state.defense.towerCount >= maxTowers) return [];
    // A player's pace: the gold beyond it goes into upgrades and research
    const fighting = this.world.towerManager.getAll().filter((t) => t.typeConfig.attackType !== 'passive').length;
    if (fighting >= towersByWave(this.config, state.waveNumber)) return [];
    const airUnlocked = state.research?.airTargetingUnlocked ?? false;
    const proposals: Proposal[] = [];
    for (const typeId of this.config.knownTowerTypes) {
      const cfg = TOWER_TYPES[typeId];
      if (!cfg || cfg.attackType === 'passive') continue;
      if (state.research && !state.research.towerUnlocked[typeId]) continue;
      const added = newTowerCapacity(typeId, airUnlocked, context.routes, context.capacity, context.routeMetres);
      proposals.push({
        kind: 'buy',
        label: cfg.name,
        cost: cfg.cost,
        value: killTimeSaved(context.threat, context.capacity, added),
        act: () => this.place(typeId),
      });
    }
    return proposals;
  }

  private place(typeId: TowerTypeId): TowerAction | null {
    const spawns = this.world.getSpawnPoints();
    const paths = this.world.getCachedPaths();
    const [best] = this.spots === 'distributed'
      ? this.placement.findDistributedPositions(spawns, paths, typeId, this.world.towerManager.getAll())
      : this.placement.findStrategicPositions(spawns, paths, typeId);
    if (!best) return null;
    return {
      type: 'place',
      position: { x: best.position.lon, z: best.position.lat },
      towerType: typeId,
      reason: `Build ${TOWER_TYPES[typeId].name} - ${best.reason}`,
    };
  }
}
