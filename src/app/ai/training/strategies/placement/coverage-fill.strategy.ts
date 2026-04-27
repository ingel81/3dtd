/**
 * Coverage Fill Strategy
 *
 * Priority: MEDIUM (60)
 * Triggers when: Path coverage < 70% and has 2+ towers
 * Action: Place cheapest affordable tower in gap
 */

import { BaseStrategy } from '../tower-strategy.interface';
import { GameStateSnapshot } from '../../../core/models/game-state-snapshot';
import { TowerAction, BotConfig } from '../../bots/tower-bot.interface';
import { TowerTypeId, TOWER_TYPES } from '../../../../configs/tower-types.config';
import { StrategicPlacementService } from '../../../../services/strategic-placement.service';
import { GameStateManager } from '../../../../managers/game-state.manager';
import { Tower } from '../../../../entities/tower.entity';

export class CoverageFillStrategy extends BaseStrategy {
  private savingForType: TowerTypeId | null = null;

  constructor(
    private strategicPlacement: StrategicPlacementService,
    private gameState: GameStateManager,
    private config: BotConfig
  ) {
    super('CoverageFill', 60);
  }

  canExecute(state: GameStateSnapshot): boolean {
    const notMaxed = this.config.maxTowers <= 0 || state.defense.towerCount < this.config.maxTowers;
    if (!notMaxed) return false;

    // If saving for a type, stay active even if we can't afford anything yet
    if (this.savingForType) return true;

    return state.player.credits >= 20;
  }

  execute(state: GameStateSnapshot): TowerAction | null {
    const existingTowers = this.gameState.towerManager.getAll();
    const existingTypes = new Set(existingTowers.map(t => t.typeConfig.id));

    // If we were saving for a type that now exists, clear the goal
    if (this.savingForType && existingTypes.has(this.savingForType)) {
      this.savingForType = null;
    }

    // If saving for a specific type: commit to it
    if (this.savingForType) {
      const target = TOWER_TYPES[this.savingForType];
      if (state.player.credits >= target.cost) {
        return this.placeTower(this.savingForType, existingTowers, 'saved up');
      }
      return {
        type: 'wait',
        reason: `Saving for ${target.name} (${state.player.credits}/${target.cost})`,
        confidence: 0.7
      };
    }

    // Find affordable towers
    const affordable = this.getAffordableTowers(state.player.credits, this.config.knownTowerTypes, state);
    const missingTypes = this.config.knownTowerTypes.filter(t => !existingTypes.has(t));
    const missingAffordable = affordable.filter(t => !existingTypes.has(t));

    // Count existing tower types
    const typeCounts = new Map<string, number>();
    for (const t of existingTowers) {
      typeCounts.set(t.typeConfig.id, (typeCounts.get(t.typeConfig.id) || 0) + 1);
    }

    let chosen: TowerTypeId;
    let reason: string;

    if (existingTowers.length === 0) {
      // First tower: build cheapest to get started
      if (affordable.length === 0) return null;
      chosen = affordable.reduce((best, current) =>
        TOWER_TYPES[current].cost < TOWER_TYPES[best].cost ? current : best
      );
      reason = 'first tower';
    } else if (missingAffordable.length > 0) {
      // Can afford a new type: build it
      chosen = missingAffordable[Math.floor(Math.random() * missingAffordable.length)];
      reason = 'new type';
    } else if (missingTypes.length > 0 && existingTowers.length >= 2) {
      // Missing types exist but too expensive
      // 50% save for new type, 50% reinforce with what we have
      if (Math.random() < 0.5) {
        // Commit to saving for a random missing type
        const target = missingTypes[Math.floor(Math.random() * missingTypes.length)];
        this.savingForType = target;
        return {
          type: 'wait',
          reason: `Saving for ${TOWER_TYPES[target].name} (${state.player.credits}/${TOWER_TYPES[target].cost})`,
          confidence: 0.7
        };
      }
      // Build reinforcement instead
      if (affordable.length === 0) return null;
      chosen = affordable.reduce((best, current) =>
        (typeCounts.get(current) || 0) < (typeCounts.get(best) || 0) ? current : best
      );
      reason = 'reinforce';
    } else {
      // All types placed: reinforce least-represented
      if (affordable.length === 0) return null;
      chosen = affordable.reduce((best, current) =>
        (typeCounts.get(current) || 0) < (typeCounts.get(best) || 0) ? current : best
      );
      reason = 'reinforce';
    }

    // Archer dominance guard (see DistributedPlacement for rationale).
    const archerCount = existingTowers.filter(t => t.typeConfig.id === 'archer').length;
    if (chosen === 'archer' && archerCount > 0) {
      let maxNonArcher = 0;
      for (const [type, count] of typeCounts) {
        if (type !== 'archer' && count > maxNonArcher) maxNonArcher = count;
      }
      const archerCap = Math.max(4, maxNonArcher * 2);
      if (archerCount >= archerCap) {
        const alternatives = affordable.filter(t => t !== 'archer');
        if (alternatives.length > 0) {
          chosen = alternatives[Math.floor(Math.random() * alternatives.length)];
          reason = 'archer-ratio-cap';
        } else {
          const target = this.config.knownTowerTypes
            .filter(t => t !== 'archer')
            .reduce<TowerTypeId | null>(
              (best, current) =>
                best === null || TOWER_TYPES[current].cost < TOWER_TYPES[best].cost
                  ? current
                  : best,
              null,
            );
          if (target) {
            this.savingForType = target;
            return {
              type: 'wait',
              reason: `Saving for ${TOWER_TYPES[target].name} (archer cap ${archerCap} hit)`,
              confidence: 0.7,
            };
          }
        }
      }
    }

    return this.placeTower(chosen, existingTowers, reason);
  }

  onReset(): void {
    this.savingForType = null;
  }

  private placeTower(chosen: TowerTypeId, existingTowers: Tower[], reason: string): TowerAction | null {
    const spawnPoints = this.gameState.getSpawnPoints();
    const paths = this.gameState.getCachedPaths();
    const candidates = this.strategicPlacement.findStrategicPositions(
      spawnPoints,
      paths,
      TOWER_TYPES[chosen].range,
      existingTowers
    );

    for (const candidate of candidates) {
      const validation = this.gameState.towerManager.validatePosition(candidate.position);
      if (validation.valid) {
        // Clear saving goal on successful placement
        if (this.savingForType === chosen) {
          this.savingForType = null;
        }
        return {
          type: 'place',
          position: { x: candidate.position.lon, z: candidate.position.lat },
          towerType: chosen,
          confidence: 0.7,
          reason: `Building ${TOWER_TYPES[chosen].name} (${reason}) - ${candidate.reason}`
        };
      }
    }

    return null;
  }
}
