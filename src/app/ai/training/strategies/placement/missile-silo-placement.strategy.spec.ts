import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MissileSiloPlacementStrategy } from './missile-silo-placement.strategy';
import type { GameStateSnapshot } from '../../../core/models/game-state-snapshot';
import { ABILITIES } from '../../../../configs/abilities.config';
import { TOWER_TYPES } from '../../../../configs/tower-types.config';

const SILO_AND_ARCHER = TOWER_TYPES['missile-silo'].cost + TOWER_TYPES.archer.cost;
const SPOT = { lat: 48.1, lon: 9.1 };

/** A snapshot with `credits`, the silo researched or not, `silos` of them standing */
function state(credits: number, researched = true, silos = 0): GameStateSnapshot {
  return {
    player: { credits },
    research: { towerUnlocked: { 'missile-silo': researched } },
    defense: { towerDistribution: silos > 0 ? { 'missile-silo': { count: silos } } : {} },
  } as unknown as GameStateSnapshot;
}

describe('MissileSiloPlacementStrategy', () => {
  let findStrategicPositions: ReturnType<typeof vi.fn>;
  let strategy: MissileSiloPlacementStrategy;

  beforeEach(() => {
    findStrategicPositions = vi.fn(() => [{ position: SPOT, score: 1 }]);
    const gameState = { getSpawnPoints: () => ['spawn'], getCachedPaths: () => new Map([['spawn', []]]) };
    strategy = new MissileSiloPlacementStrategy({ findStrategicPositions } as never, gameState as never);
  });

  it('builds the launch site of the nuclear strike, above the combat placements and under the abilities', () => {
    expect(ABILITIES['nuclear-strike'].launchFrom).toBe('missile-silo');
    expect(strategy.priority).toBeGreaterThan(90);
    expect(strategy.priority).toBeLessThan(93);
  });

  it('waits for the research, then for the silo plus an Archer in credits', () => {
    expect(strategy.canExecute(state(10_000, false))).toBe(false);
    expect(strategy.canExecute(state(SILO_AND_ARCHER - 1))).toBe(false);
    expect(strategy.canExecute(state(SILO_AND_ARCHER))).toBe(true);
  });

  it('builds one only: not while a silo stands', () => {
    expect(strategy.canExecute(state(10_000, true, 1))).toBe(false);
  });

  it('places it on the best strategic spot for its type', () => {
    const action = strategy.execute(state(10_000))!;
    expect(findStrategicPositions).toHaveBeenCalledWith(['spawn'], expect.any(Map), 'missile-silo');
    expect(action).toMatchObject({ type: 'place', towerType: 'missile-silo', position: { x: SPOT.lon, z: SPOT.lat } });
  });

  it('places nothing where no spot is found', () => {
    findStrategicPositions.mockReturnValue([]);
    expect(strategy.execute(state(10_000))).toBeNull();
  });
});
