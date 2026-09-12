import { describe, it, expect, beforeEach } from 'vitest';
import { NuclearStrikeStrategy } from './nuclear-strike.strategy';
import type { GameStateSnapshot } from '../../../core/models/game-state-snapshot';
import type { AbilityRejectReason } from '../../../../configs/abilities.config';
import { METERS_PER_DEGREE_LAT } from '../../../../utils/geo-utils';

const ORIGIN = { lat: 48.0, lon: 9.0 };

/** An enemy `metersNorth` of the origin at `progress` along its route. */
function enemyAt(metersNorth: number, progress: number) {
  return {
    position: { lat: ORIGIN.lat + metersNorth / METERS_PER_DEGREE_LAT, lon: ORIGIN.lon },
    movement: { getPathProgress: () => progress },
  };
}

describe('NuclearStrikeStrategy', () => {
  let enemies: ReturnType<typeof enemyAt>[];
  let useCheck: AbilityRejectReason | null;
  let strategy: NuclearStrikeStrategy;
  const inWave = { phase: 'wave' } as GameStateSnapshot;

  beforeEach(() => {
    enemies = [];
    useCheck = null;
    const gameState = {
      abilityManager: { checkUse: () => useCheck },
      enemyManager: { getAlive: () => enemies },
    };
    strategy = new NuclearStrikeStrategy(gameState as never);
  });

  /** Eight enemies packed within 7 m, four more 200 m further on: 12 in the last fifth. */
  const packedFinalStretch = () => {
    for (let i = 0; i < 8; i++) enemies.push(enemyAt(i, 0.9));
    for (let i = 0; i < 4; i++) enemies.push(enemyAt(200 + i, 0.95));
  };

  it('outranks every other strategy', () => {
    expect(strategy.priority).toBeGreaterThan(95);
  });

  it('waits for a wave', () => {
    packedFinalStretch();
    expect(strategy.canExecute({ phase: 'setup' } as GameStateSnapshot)).toBe(false);
  });

  it('waits until the strike is ready', () => {
    packedFinalStretch();
    useCheck = 'no-charge';
    expect(strategy.canExecute(inWave)).toBe(false);
    useCheck = 'locked';
    expect(strategy.canExecute(inWave)).toBe(false);
  });

  it('keeps the charge while few enemies stand in the last fifth', () => {
    for (let i = 0; i < 9; i++) enemies.push(enemyAt(i, 0.9));
    for (let i = 0; i < 30; i++) enemies.push(enemyAt(i, 0.5)); // still in the middle of the route
    expect(strategy.canExecute(inWave)).toBe(false);
  });

  it('aims at the densest spot of the last fifth', () => {
    packedFinalStretch();
    expect(strategy.canExecute(inWave)).toBe(true);

    const action = strategy.execute(inWave)!;
    expect(action.type).toBe('use-ability');
    expect(action.abilityId).toBe('nuclear-strike');
    const aimedNorth = (action.position!.z - ORIGIN.lat) * METERS_PER_DEGREE_LAT;
    expect(aimedNorth).toBeLessThan(10);      // the pack of eight, not the four behind
    expect(action.position!.x).toBeCloseTo(ORIGIN.lon);
    expect(action.reason).toContain('8 of 12');
  });
});
