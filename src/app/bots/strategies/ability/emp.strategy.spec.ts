import { describe, it, expect, beforeEach } from 'vitest';
import { EmpStrategy } from './emp.strategy';
import type { GameStateSnapshot } from '../../../director/models/game-state-snapshot';
import type { AbilityRejectReason } from '../../../configs/abilities.config';
import { ENEMY_TYPES } from '../../../configs/enemy-types.config';
import { METERS_PER_DEGREE_LAT } from '../../../utils/geo-utils';

const ORIGIN = { lat: 48.0, lon: 9.0 };

/** An enemy of `type` `metersNorth` of the origin at `progress` along its route. */
function enemyAt(type: string, metersNorth: number, progress: number) {
  return {
    typeConfig: ENEMY_TYPES[type],
    position: { lat: ORIGIN.lat + metersNorth / METERS_PER_DEGREE_LAT, lon: ORIGIN.lon },
    movement: { getPathProgress: () => progress },
  };
}

describe('EmpStrategy', () => {
  let enemies: ReturnType<typeof enemyAt>[];
  let useCheck: AbilityRejectReason | null;
  /** Reads of the enemy list: one for the machines, one more for a crowd */
  let scans: number;
  let strategy: EmpStrategy;
  const inWave = { phase: 'wave' } as GameStateSnapshot;
  const aimedNorth = () => (strategy.execute(inWave)!.position!.z - ORIGIN.lat) * METERS_PER_DEGREE_LAT;

  beforeEach(() => {
    enemies = [];
    useCheck = null;
    scans = 0;
    const gameState = {
      abilityManager: { checkUse: () => useCheck },
      enemyManager: { getAlive: () => (scans++, enemies) },
    };
    strategy = new EmpStrategy(gameState as never);
  });

  it('ranks under the frost bomb', () => {
    expect(strategy.priority).toBe(94);
  });

  it('waits for a wave and for its charge', () => {
    for (let i = 0; i < 3; i++) enemies.push(enemyAt('tank', i * 5, 0.5));
    expect(strategy.canExecute({ phase: 'setup' } as GameStateSnapshot)).toBe(false);
    useCheck = 'no-charge';
    expect(strategy.canExecute(inWave)).toBe(false);
  });

  it('fires on three machines together, even with no crowd around them', () => {
    for (let i = 0; i < 3; i++) enemies.push(enemyAt('tank', 200 + i * 5, 0.5));
    for (let i = 0; i < 5; i++) enemies.push(enemyAt('zombie', i, 0.9));
    expect(strategy.canExecute(inWave)).toBe(true);
    expect(aimedNorth()).toBeGreaterThan(190);
    expect(strategy.execute(inWave)!.reason).toBe('EMP on 3 machines');
  });

  it('keeps the charge for two machines and a small crowd', () => {
    enemies.push(enemyAt('mech', 0, 0.5), enemyAt('tank', 5, 0.5));
    for (let i = 0; i < 11; i++) enemies.push(enemyAt('zombie', 100 + i, 0.9));
    expect(strategy.canExecute(inWave)).toBe(false);
  });

  it('fires on a crowd of twelve in the last 40% of the route', () => {
    for (let i = 0; i < 12; i++) enemies.push(enemyAt('zombie', 100 + i, 0.7));
    expect(strategy.canExecute(inWave)).toBe(true);
    expect(aimedNorth()).toBeGreaterThan(99);
    expect(strategy.execute(inWave)!.reason).toContain('12 enemies');
  });

  it('aims once per decision: execute takes the aim canExecute found for the same snapshot', () => {
    for (let i = 0; i < 12; i++) enemies.push(enemyAt('zombie', 100 + i, 0.7));
    const decision = { phase: 'wave' } as GameStateSnapshot;
    expect(strategy.canExecute(decision)).toBe(true);
    expect(scans).toBe(2); // no machines, then the crowd
    expect(strategy.execute(decision)!.reason).toContain('12 enemies');
    expect(scans).toBe(2);

    strategy.execute({ phase: 'wave' } as GameStateSnapshot); // the next decision aims anew
    expect(scans).toBe(4);
  });
});
