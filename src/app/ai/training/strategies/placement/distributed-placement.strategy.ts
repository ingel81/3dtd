/**
 * Distributed Placement Strategy
 *
 * Priority: 65 (above CoverageFill)
 * Purpose: Spread towers evenly across the entire path for AI training.
 * Uses zone-based scoring to fill under-defended path segments.
 * Saves up for expensive tower types to ensure variety.
 */

import { BaseStrategy } from '../tower-strategy.interface';
import { GameStateSnapshot } from '../../../core/models/game-state-snapshot';
import { TowerAction, BotConfig } from '../../bots/tower-bot.interface';
import { TowerTypeId, TOWER_TYPES } from '../../../../configs/tower-types.config';
import { StrategicPlacementService } from '../../../../services/strategic-placement.service';
import { GameStateManager } from '../../../../managers/game-state.manager';
import { Tower } from '../../../../entities/tower.entity';

export class DistributedPlacementStrategy extends BaseStrategy {
  private savingForType: TowerTypeId | null = null;

  constructor(
    private strategicPlacement: StrategicPlacementService,
    private gameState: GameStateManager,
    private config: BotConfig
  ) {
    super('DistributedPlacement', 65);
  }

  canExecute(state: GameStateSnapshot): boolean {
    const notMaxed = this.config.maxTowers <= 0 || state.defense.towerCount < this.config.maxTowers;
    if (!notMaxed) return false;

    // Stay active while saving for a type
    if (this.savingForType) return true;

    return state.player.credits >= 20;
  }

  execute(state: GameStateSnapshot): TowerAction | null {
    const existingTowers = this.gameState.towerManager.getAll();
    const existingTypes = new Set(existingTowers.map(t => t.typeConfig.id));

    // If we were saving for a type that now exists, clear goal
    if (this.savingForType && existingTypes.has(this.savingForType)) {
      this.savingForType = null;
    }

    // If saving: wait until we can afford it
    if (this.savingForType) {
      const target = TOWER_TYPES[this.savingForType];
      if (state.player.credits >= target.cost) {
        const result = this.placeTower(this.savingForType, existingTowers, 'saved up');
        if (result) this.savingForType = null;
        return result;
      }
      return {
        type: 'wait',
        reason: `Saving for ${target.name} (${state.player.credits}/${target.cost})`,
        confidence: 0.7
      } as TowerAction;
    }

    const affordable = this.getAffordableTowers(state.player.credits, this.config.knownTowerTypes);
    if (affordable.length === 0) return null;

    const missingTypes = this.config.knownTowerTypes.filter(t => !existingTypes.has(t));
    const missingAffordable = affordable.filter(t => !existingTypes.has(t));

    // Count existing tower types
    const typeCounts = new Map<string, number>();
    for (const t of existingTowers) {
      typeCounts.set(t.typeConfig.id, (typeCounts.get(t.typeConfig.id) || 0) + 1);
    }

    let chosen: TowerTypeId;
    let reason: string;

    if (existingTowers.length < 2) {
      // First 2 towers: cheapest (bootstrap defense)
      chosen = affordable.reduce((best, current) =>
        TOWER_TYPES[current].cost < TOWER_TYPES[best].cost ? current : best
      );
      reason = 'bootstrap';
    } else if (missingAffordable.length > 0) {
      // Can afford a new type: build it
      chosen = missingAffordable[Math.floor(Math.random() * missingAffordable.length)];
      reason = 'new type';
    } else if (missingTypes.length > 0 && existingTowers.length >= 2) {
      // Missing types exist but too expensive - save with 60% probability
      if (Math.random() < 0.6) {
        // Pick cheapest missing type to save for
        const target = missingTypes.reduce((best, current) =>
          TOWER_TYPES[current].cost < TOWER_TYPES[best].cost ? current : best
        );
        this.savingForType = target;
        return {
          type: 'wait',
          reason: `Saving for ${TOWER_TYPES[target].name} (${state.player.credits}/${TOWER_TYPES[target].cost})`,
          confidence: 0.7
        } as TowerAction;
      }
      // 40%: reinforce with what we have
      chosen = affordable.reduce((best, current) =>
        (typeCounts.get(current) || 0) < (typeCounts.get(best) || 0) ? current : best
      );
      reason = 'reinforce';
    } else {
      // All types placed: reinforce least-represented
      chosen = affordable.reduce((best, current) =>
        (typeCounts.get(current) || 0) < (typeCounts.get(best) || 0) ? current : best
      );
      reason = 'reinforce';
    }

    return this.placeTower(chosen, existingTowers, reason);
  }

  onReset(): void {
    this.savingForType = null;
  }

  private placeTower(chosen: TowerTypeId, existingTowers: Tower[], reason: string): TowerAction | null {
    const spawnPoints = this.gameState.getSpawnPoints();
    const paths = this.gameState.getCachedPaths();
    const candidates = this.strategicPlacement.findDistributedPositions(
      spawnPoints,
      paths,
      TOWER_TYPES[chosen].range,
      existingTowers
    );

    for (const candidate of candidates) {
      const validation = this.gameState.towerManager.validatePosition(candidate.position);
      if (validation.valid) {
        return {
          type: 'place',
          position: { x: candidate.position.lon, z: candidate.position.lat },
          towerType: chosen,
          confidence: 0.8,
          reason: `Distributed: ${TOWER_TYPES[chosen].name} (${reason}) - ${candidate.reason}`
        };
      }
    }

    return null;
  }
}
