import { describe, expect, it } from 'vitest';
import { TOWER_TYPES, TowerTypeId, UpgradeId } from '../../../configs/tower-types.config';
import type { GameStateSnapshot } from '../../../director/models/game-state-snapshot';
import { emptySides, threatFromWaves } from '../../decision/value';
import type { DecisionContext } from '../tower-strategy.interface';
import { TowerUpgradeStrategy } from './tower-upgrade.strategy';

function tower(id: string, typeId: TowerTypeId, levels: Partial<Record<UpgradeId, number>> = {}) {
  const typeConfig = TOWER_TYPES[typeId];
  return {
    id,
    typeConfig,
    getUpgradeLevel: (u: UpgradeId) => levels[u] ?? 0,
    getAvailableUpgrades: () => typeConfig.upgrades,
    getNextUpgradeCost: () => 50,
  };
}

const state = (maxUpgradeTier = 1) =>
  ({ research: { maxUpgradeTier, airTargetingUnlocked: false } }) as unknown as GameStateSnapshot;

function context(metres: Record<string, number>): DecisionContext {
  return {
    threat: threatFromWaves([{
      wave: 1, name: '', known: true, boss: false, air: false, armors: [], count: null, note: '', description: '',
      enemies: [['zombie', 1]], hpByArmor: [['unarmored', 5000]],
    }]),
    capacity: emptySides(),
    metresByTower: new Map(Object.entries(metres).map(([id, m]) => [id, { ground: m, air: m }])),
    routes: 1,
    routeMetres: 700,
  };
}

const propose = (towers: ReturnType<typeof tower>[], ctx: DecisionContext, tier = 1) =>
  new TowerUpgradeStrategy({ towerManager: { getAll: () => towers } } as never).propose(state(tier), ctx);

describe('TowerUpgradeStrategy', () => {
  it('proposes every upgrade of every combat tower, at its cost, and none of the research center', () => {
    const proposals = propose([tower('a', 'archer'), tower('rc', 'research-center')], context({ a: 40 }));
    expect(proposals).toHaveLength(TOWER_TYPES.archer.upgrades.length);
    expect(proposals.every((p) => p.kind === 'buy' && p.cost === 50)).toBe(true);
  });

  it('values a damage level more on a tower that sees more of the route', () => {
    const damage = (id: string) => propose([tower(id, 'archer')], context({ open: 60, hidden: 10 }))
      .find((p) => p.label.includes(TOWER_TYPES.archer.upgrades.find((u) => u.effect.stat === 'damage')!.name))!;
    expect(damage('open').value).toBeGreaterThan(damage('hidden').value);
  });

  it('values a range level by the route it adds', () => {
    const range = TOWER_TYPES.archer.upgrades.find((u) => u.effect.stat === 'range')!;
    const proposal = propose([tower('a', 'archer')], context({ a: 40 })).find((p) => p.label.includes(range.name))!;
    expect(proposal.value).toBeGreaterThan(0);
  });

  it('leaves out a level the researched tier does not allow yet', () => {
    // Level 5 of every track needs tier 2
    const capped = Object.fromEntries(TOWER_TYPES.archer.upgrades.map((u) => [u.id, 5]));
    expect(propose([tower('a', 'archer', capped)], context({ a: 40 }), 1)).toEqual([]);
    expect(propose([tower('a', 'archer', capped)], context({ a: 40 }), 2).length).toBeGreaterThan(0);
  });

  it('acts with the upgrade command', () => {
    const [first] = propose([tower('a', 'archer')], context({ a: 40 }));
    expect(first.act()).toEqual(expect.objectContaining({ type: 'upgrade', towerId: 'a' }));
  });
});
