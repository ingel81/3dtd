/**
 * Path-Coverage Upgrade Strategy
 *
 * Priority: MEDIUM-HIGH (75)
 * Triggers when: Has 3+ towers, 50+ credits, and upgradeable towers exist
 * Action: Upgrade towers at BOTH ends of the path — near spawn and near base
 *
 * This used to upgrade only the spawn-nearest towers, and since it outranks
 * every placement strategy it fires on most ticks, practically all upgrade
 * gold landed in one cluster at the spawn. The measured consequence was a
 * defense that is binary rather than graded:
 *
 *   waves where the defense killed EVERYTHING   70%
 *   waves where more than 5% got through        28%
 *   anything in between                          2%
 *
 * and, over 1834 waves, enemies in a wave that leaked nothing died at a median
 * of 12% along the path, while any enemy that got past 80% arrived at the base
 * in 95% of cases. There was no "almost stopped": one killzone at the spawn,
 * then an undefended corridor.
 *
 * That shape is why the wave director could not be trained. Its reward asks for
 * near-misses, the fraction of a wave that passes 80% of the path WITHOUT
 * arriving — reachable in 2.2% of waves, because nothing kills anything in the
 * last stretch. Four directors as different as a policy network and a uniform
 * random sampler produced statistically identical runs.
 *
 * Spreading the upgrades gives the back half of the path teeth, so a wave can
 * be nearly stopped instead of only wholly stopped or not at all.
 */

import { BaseStrategy } from '../tower-strategy.interface';
import { requiredUpgradeTier } from '../../../../configs/tower-types.config';
import { GameStateSnapshot } from '../../../core/models/game-state-snapshot';
import { TowerAction } from '../../bots/tower-bot.interface';
import { GameStateManager } from '../../../../managers/game-state.manager';
import { OsmStreetService } from '../../../../services/location/osm-street.service';

/**
 * How many towers are considered for an upgrade before giving up. Bounded so
 * the strategy stays cheap in the sub-step loop.
 */
const UPGRADE_CANDIDATE_COUNT = 8;

export class PathCoverageUpgradeStrategy extends BaseStrategy {
  constructor(
    private gameState: GameStateManager,
    private osmService: OsmStreetService
  ) {
    super('PathCoverageUpgrade', 75);
  }

  canExecute(state: GameStateSnapshot): boolean {
    if (state.defense.towerCount < 3 || state.player.credits < 50) return false;

    // Fire rate: 70% baseline, 90% when rich (>2000 credits) so gold-hoarding
    // bots actively drain their coffers into upgrades instead of sitting on
    // 300k+ credits.
    const richThreshold = 2000;
    const rate = state.player.credits >= richThreshold ? 0.9 : 0.7;
    if (Math.random() > rate) return false;

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

    // Take from BOTH ends of the sorted list, alternating.
    //
    // The list runs spawn-nearest to spawn-furthest, and spawn-furthest is
    // base-nearest, so this needs no separate distance calculation: it funds a
    // killzone at each end of the path instead of one at the spawn. Front first
    // on each pair, because the opening waves are decided at the spawn and an
    // early run has too few towers for the far end to matter yet.
    const front = towersWithDistance;
    const back = [...towersWithDistance].reverse();
    const candidates: typeof towersWithDistance = [];
    const seen = new Set<string>();
    for (let i = 0; candidates.length < UPGRADE_CANDIDATE_COUNT
                    && i < towersWithDistance.length; i++) {
      for (const entry of [front[i], back[i]]) {
        if (!entry || seen.has(entry.tower.id)) continue;
        seen.add(entry.tower.id);
        candidates.push(entry);
      }
    }

    // Walk the closest N towers, not just the closest one.
    //
    // Considering only towersWithDistance[0] meant that as soon as that single
    // tower's next upgrade was unaffordable or tier-locked, this strategy
    // returned null and the placement strategies (lower priority, but always
    // applicable) took every turn. With the late-game gold curve that produced
    // a defense of ~300 towers at low levels instead of a compact upgraded one
    // — and 300 towers is what pushes combat resolution into multi-millisecond
    // territory per sub-step.
    const maxTier = state.research?.maxUpgradeTier ?? 1;

    for (const { tower } of candidates) {
      const affordable = tower.getAvailableUpgrades().filter((u) => {
        if (tower.getNextUpgradeCost(u.id) > state.player.credits) return false;
        // Tier gate, using the same band rule the engine enforces. The bot used
        // to carry a much stricter local copy (tier 2 already at level 1, tier 3
        // at level 2, nothing above that), so it declined upgrades the engine
        // would have accepted and never reached tiers 4 and 5 at all.
        // research-slots (Research Center) is exempt.
        if (u.id === 'research-slots') return true;
        return maxTier >= requiredUpgradeTier(tower.getUpgradeLevel(u.id));
      });

      if (affordable.length === 0) continue;

      // Pick the upgrade with the LOWEST current level so tracks stay spread
      // instead of one path being maxed. Random tie-break among equals.
      affordable.sort((a, b) => {
        const levelA = tower.getUpgradeLevel(a.id);
        const levelB = tower.getUpgradeLevel(b.id);
        if (levelA !== levelB) return levelA - levelB;
        return Math.random() - 0.5;
      });
      const upgrade = affordable[0];

      return {
        type: 'upgrade',
        towerId: tower.id,
        upgradeId: upgrade.id,
        confidence: 0.8,
        reason: `Upgrading ${tower.typeConfig.name} with ${upgrade.name} (T${tower.getUpgradeLevel(upgrade.id) + 1})`,
      };
    }

    return null;
  }
}
