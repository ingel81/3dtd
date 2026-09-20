import { describe, expect, it } from 'vitest';
import { FavouriteTowerUpgradeStrategy } from './favourite-tower-upgrade.strategy';
import { createEmptySnapshot, GameStateSnapshot } from '../../../director/models/game-state-snapshot';
import { GameStateManager } from '../../../managers/game-state.manager';
import { GameRng } from '../../../utils/game-rng';

/** A tower as the strategy reads it: damage done, upgrades and their prices. */
function tower(id: string, damage: number, upgrades: { id: string; cost: number; level?: number }[]) {
  return {
    id,
    combat: { damageDealt: damage },
    typeConfig: { name: `Tower ${id}` },
    getAvailableUpgrades: () => upgrades.map((u) => ({ id: u.id, name: u.id })),
    getNextUpgradeCost: (upgradeId: string) => upgrades.find((u) => u.id === upgradeId)!.cost,
    getUpgradeLevel: (upgradeId: string) => upgrades.find((u) => u.id === upgradeId)?.level ?? 0,
  };
}

function strategyWith(towers: ReturnType<typeof tower>[], rolls = [0]) {
  let roll = 0;
  const rng = new GameRng(1);
  rng.stream = () => () => rolls[Math.min(roll++, rolls.length - 1)];
  const gameState = { towerManager: { getAll: () => towers }, rng } as unknown as GameStateManager;
  return new FavouriteTowerUpgradeStrategy(gameState);
}

function stateWith(credits: number, towerCount: number, maxUpgradeTier = 5): GameStateSnapshot {
  const state = createEmptySnapshot();
  state.player.credits = credits;
  state.defense.towerCount = towerCount;
  state.research = { ...state.research, maxUpgradeTier };
  return state;
}

describe('FavouriteTowerUpgradeStrategy', () => {
  it('upgrades the tower that has done the most damage', () => {
    const strategy = strategyWith([
      tower('weak', 100, [{ id: 'damage', cost: 50 }]),
      tower('carry', 9000, [{ id: 'damage', cost: 50 }]),
    ]);

    const action = strategy.execute(stateWith(1000, 2));

    expect(action).toMatchObject({ type: 'upgrade', towerId: 'carry', upgradeId: 'damage' });
  });

  it('takes the cheapest branch, unlike the expert who spreads them', () => {
    const strategy = strategyWith([
      tower('t1', 500, [
        { id: 'range', cost: 400 },
        { id: 'damage', cost: 80 },
      ]),
    ]);

    expect(strategy.execute(stateWith(1000, 1))).toMatchObject({ upgradeId: 'damage' });
  });

  it('keeps a cushion beside the price', () => {
    const strategy = strategyWith([tower('t1', 500, [{ id: 'damage', cost: 100 }])]);

    // 120 covers the price but not the cushion, 150 does
    expect(strategy.execute(stateWith(120, 1))).toBeNull();
    expect(strategy.execute(stateWith(150, 1))).toMatchObject({ upgradeId: 'damage' });
  });

  it('declines an upgrade the research tier does not allow yet', () => {
    // Level 5 needs a higher tier than a run with maxUpgradeTier 1 has
    const strategy = strategyWith([tower('t1', 500, [{ id: 'damage', cost: 50, level: 5 }])]);

    expect(strategy.execute(stateWith(10_000, 1, 1))).toBeNull();
  });

  it('spends more readily once the gold piles up', () => {
    // The bug this exists for: the beginner sat on 150,000 credits
    const strategy = strategyWith([tower('t1', 500, [{ id: 'damage', cost: 50 }])], [0.6]);

    expect(strategy.canExecute(stateWith(500, 1))).toBe(false);    // 0.6 > 0.4
    expect(strategy.canExecute(stateWith(50_000, 1))).toBe(true);  // 0.6 <= 0.8
  });

  it('does nothing without a tower or without money', () => {
    const strategy = strategyWith([tower('t1', 500, [{ id: 'damage', cost: 50 }])]);

    expect(strategy.canExecute(stateWith(1000, 0))).toBe(false);
    expect(strategy.canExecute(stateWith(10, 1))).toBe(false);
  });
});
