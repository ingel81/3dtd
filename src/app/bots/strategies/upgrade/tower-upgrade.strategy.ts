/**
 * Tower Upgrade Strategy (docs/BOT_PLAYER_PLAN.md, B3)
 *
 * Proposes every upgrade the bot may buy on its towers, each with its value
 * against the coming waves (decision/value.ts): the damage it adds times the
 * metres of route that tower really has under fire. A tower that sees much of
 * the route gains more from a damage level than one behind a facade; a range
 * level is worth the route it adds. Replaces the upgrade along both ends of
 * the route (PathCoverageUpgrade, with its 70 % fire rate and its "build out
 * first" count) and the favourite tower of the beginner: the arbiter weighs
 * each level against a new tower.
 *
 * The research center's slots are no upgrade of the defense and stay out.
 */

import type { GameStateSnapshot } from '../../../director/models/game-state-snapshot';
import { requiredUpgradeTier, TowerTypeId } from '../../../configs/tower-types.config';
import type { UpgradeLevels } from '../../../director/tower-dps.util';
import type { BotWorld } from '../../bot-world';
import type { Proposal } from '../../decision/arbiter';
import { chordMetres, difference, expectedMetres, killTimeSaved, rangeAt, slowAdded, sum, towerCapacity } from '../../decision/value';
import type { DecisionContext, ITowerStrategy } from '../tower-strategy.interface';

export class TowerUpgradeStrategy implements ITowerStrategy {
  readonly name = 'Upgrade';

  constructor(private readonly world: BotWorld) {}

  propose(state: GameStateSnapshot, context: DecisionContext): Proposal[] {
    const maxTier = state.research?.maxUpgradeTier ?? 1;
    const airUnlocked = state.research?.airTargetingUnlocked ?? false;
    const proposals: Proposal[] = [];
    for (const tower of this.world.towerManager.getAll()) {
      const cfg = tower.typeConfig;
      if (cfg.attackType === 'passive') continue;
      const levels: UpgradeLevels = {};
      for (const u of cfg.upgrades) levels[u.id] = tower.getUpgradeLevel(u.id);
      const expected = expectedMetres(cfg.id as TowerTypeId, context.routes);
      const metres = context.metresByTower.get(tower.id) ?? { ground: expected, air: expected };
      const own = (at: UpgradeLevels, m: { ground: number; air: number }) =>
        sum(towerCapacity(cfg, at, airUnlocked, m), slowAdded(cfg, at, m, context.capacity, context.routeMetres));
      const before = own(levels, metres);
      const reach = chordMetres(rangeAt(cfg, levels));

      for (const upgrade of tower.getAvailableUpgrades()) {
        if (upgrade.id === 'research-slots') continue;
        const level = levels[upgrade.id] ?? 0;
        if (maxTier < requiredUpgradeTier(level)) continue;
        const next = { ...levels, [upgrade.id]: level + 1 };
        // A range level adds the route its longer chord covers
        const scale = reach > 0 ? chordMetres(rangeAt(cfg, next)) / reach : 1;
        const after = own(next, { ground: metres.ground * scale, air: metres.air * scale });
        proposals.push({
          kind: 'buy',
          label: `${cfg.name} ${upgrade.name}`,
          cost: tower.getNextUpgradeCost(upgrade.id),
          value: killTimeSaved(context.threat, context.capacity, difference(after, before)),
          act: () => ({
            type: 'upgrade',
            towerId: tower.id,
            upgradeId: upgrade.id,
            reason: `Upgrading ${cfg.name} with ${upgrade.name} (T${level + 1})`,
          }),
        });
      }
    }
    return proposals;
  }
}
