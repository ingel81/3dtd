import { describe, it, expect, beforeEach } from 'vitest';
import { FrostBombStrategy } from './frost-bomb.strategy';
import type { GameStateSnapshot } from '../../../core/models/game-state-snapshot';
import type { AbilityId, AbilityRejectReason } from '../../../../configs/abilities.config';
import { METERS_PER_DEGREE_LAT } from '../../../../utils/geo-utils';

const ORIGIN = { lat: 48.0, lon: 9.0 };

/** An enemy `metersNorth` of the origin at `progress` along its route. */
function enemyAt(metersNorth: number, progress: number) {
  return {
    position: { lat: ORIGIN.lat + metersNorth / METERS_PER_DEGREE_LAT, lon: ORIGIN.lon },
    movement: { getPathProgress: () => progress },
  };
}

describe('FrostBombStrategy', () => {
  let enemies: ReturnType<typeof enemyAt>[];
  let useCheck: AbilityRejectReason | null;
  let checked: AbilityId[];
  /** Reads of the enemy list: one per aim */
  let scans: number;
  let strategy: FrostBombStrategy;
  const inWave = { phase: 'wave' } as GameStateSnapshot;

  beforeEach(() => {
    enemies = [];
    useCheck = null;
    checked = [];
    scans = 0;
    const gameState = {
      abilityManager: { checkUse: (id: AbilityId) => (checked.push(id), useCheck) },
      enemyManager: { getAlive: () => (scans++, enemies) },
    };
    strategy = new FrostBombStrategy(gameState as never);
  });

  /** Ten enemies packed within 10 m past the middle of the route, three stragglers 150 m on. */
  const packedGroup = () => {
    for (let i = 0; i < 10; i++) enemies.push(enemyAt(i, 0.6));
    for (let i = 0; i < 3; i++) enemies.push(enemyAt(150 + i, 0.7));
  };

  it('ranks right under the nuclear strike', () => {
    expect(strategy.priority).toBe(96);
  });

  it('waits for a wave and for its own charge', () => {
    packedGroup();
    expect(strategy.canExecute({ phase: 'setup' } as GameStateSnapshot)).toBe(false);
    useCheck = 'no-charge';
    expect(strategy.canExecute(inWave)).toBe(false);
    expect(checked).toEqual(['frost-bomb']);
  });

  it('keeps the charge while no group is big enough, or the group is still in the first half', () => {
    for (let i = 0; i < 7; i++) enemies.push(enemyAt(i, 0.6));     // seven: one short
    for (let i = 0; i < 20; i++) enemies.push(enemyAt(100 + i * 30, 0.8)); // spread far apart
    for (let i = 0; i < 30; i++) enemies.push(enemyAt(i, 0.3));    // packed, but early
    expect(strategy.canExecute(inWave)).toBe(false);
  });

  it('aims at the densest spot of the second half', () => {
    packedGroup();
    expect(strategy.canExecute(inWave)).toBe(true);
    const action = strategy.execute(inWave)!;
    expect(action).toMatchObject({ type: 'use-ability', abilityId: 'frost-bomb' });
    const aimedNorth = (action.position!.z - ORIGIN.lat) * METERS_PER_DEGREE_LAT;
    expect(aimedNorth).toBeLessThan(10);
    expect(action.reason).toContain('10 enemies');
  });

  it('aims once per decision: execute takes the aim canExecute found for the same snapshot', () => {
    packedGroup();
    const decision = { phase: 'wave' } as GameStateSnapshot;
    expect(strategy.canExecute(decision)).toBe(true);
    expect(scans).toBe(1);
    expect(strategy.execute(decision)).not.toBeNull();
    expect(scans).toBe(1);

    // Used up: the next decision, or the same snapshot again, aims anew
    strategy.execute(decision);
    expect(scans).toBe(2);
    strategy.canExecute(decision);
    strategy.execute({ phase: 'wave' } as GameStateSnapshot);
    expect(scans).toBe(4);
  });
});
