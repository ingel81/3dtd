/**
 * Near-Spawn Upgrade Strategy
 *
 * Priority: MEDIUM-HIGH (75)
 * Triggers when: Has 3+ towers, 50+ credits, and towers near spawn exist
 * Action: Upgrade towers closest to spawn (highest impact)
 */

import { BaseStrategy } from '../tower-strategy.interface';
import { GameStateSnapshot } from '../../../core/models/game-state-snapshot';
import { TowerAction } from '../../bots/tower-bot.interface';
import { GameStateManager } from '../../../../managers/game-state.manager';
import { OsmStreetService } from '../../../../services/osm-street.service';

export class NearSpawnUpgradeStrategy extends BaseStrategy {
  constructor(
    private gameState: GameStateManager,
    private osmService: OsmStreetService
  ) {
    super('NearSpawnUpgrade', 75);
  }

  canExecute(state: GameStateSnapshot): boolean {
    if (state.defense.towerCount < 3 || state.player.credits < 50) return false;

    // ~33% chance to fire (gives build/save strategies room)
    if (Math.random() > 0.33) return false;

    // Check if any tower actually has affordable upgrades (dynamic cost)
    const towers = this.gameState.towerManager.getAll();
    for (const tower of towers) {
      const upgrades = tower.getAvailableUpgrades();
      if (upgrades.some(u => tower.getNextUpgradeCost(u.id) <= state.player.credits)) {
        return true;
      }
    }
    return false;
  }

  execute(state: GameStateSnapshot): TowerAction | null {
    const towers = this.gameState.towerManager.getAll();
    const spawnPoints = this.gameState.getSpawnPoints();

    // Find towers with available upgrades
    const upgradeableTowers = towers.filter(t => t.getAvailableUpgrades().length > 0);
    if (upgradeableTowers.length === 0) {
      return null;
    }

    // Sort by distance to nearest spawn
    const towersWithDistance = upgradeableTowers.map(tower => {
      const minDist = Math.min(...spawnPoints.map(spawn => {
        return this.osmService.haversineDistance(
          tower.position.lat, tower.position.lon,
          spawn.lat, spawn.lon
        );
      }));
      return { tower, distance: minDist };
    });

    towersWithDistance.sort((a, b) => a.distance - b.distance);

    // Try to upgrade closest tower
    const closest = towersWithDistance[0].tower;
    const upgrades = closest.getAvailableUpgrades();
    const maxTier = state.research?.maxUpgradeTier ?? 1;
    const affordable = upgrades.filter(u => {
      if (closest.getNextUpgradeCost(u.id) > state.player.credits) return false;
      // Tier-Gate: T2 needs Advanced Weaponry, T3 needs Master Engineering
      // research-slots (Research Center) is always allowed
      if (u.id !== 'research-slots') {
        const currentLevel = closest.getUpgradeLevel(u.id);
        const requiredTier = currentLevel >= 2 ? 3 : currentLevel >= 1 ? 2 : 1;
        if (maxTier < requiredTier) return false;
      }
      return true;
    });

    if (affordable.length === 0) {
      return null;
    }

    // Pick random affordable upgrade (variety for training)
    const upgrade = affordable[Math.floor(Math.random() * affordable.length)];

    return {
      type: 'upgrade',
      towerId: closest.id,
      upgradeId: upgrade.id,
      confidence: 0.8,
      reason: `Upgrading ${closest.typeConfig.name} near spawn with ${upgrade.name}`
    };
  }
}
