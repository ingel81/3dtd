import { describe, it, expect, beforeEach } from 'vitest';
import { OrbitalLaserStrategy } from './orbital-laser.strategy';
import type { GameStateSnapshot } from '../../../core/models/game-state-snapshot';
import type { AbilityRejectReason } from '../../../../configs/abilities.config';
import { METERS_PER_DEGREE_LAT } from '../../../../utils/geo-utils';

const ORIGIN = { lat: 48.0, lon: 9.0 };
/** Two routes, 400 m long each */
const ROUTE_A = [ORIGIN, { lat: ORIGIN.lat + 400 / METERS_PER_DEGREE_LAT, lon: ORIGIN.lon }];
const ROUTE_B = [ORIGIN, { lat: ORIGIN.lat, lon: ORIGIN.lon + 0.01 }];

/** An enemy `metres` along `route` */
function enemyOn(route: typeof ROUTE_A, metres: number) {
  return {
    position: { lat: ORIGIN.lat + metres / METERS_PER_DEGREE_LAT, lon: ORIGIN.lon },
    movement: {
      path: route,
      getPathProgress: () => metres / 400,
      getDistanceAlongPath: () => metres,
    },
  };
}

describe('OrbitalLaserStrategy', () => {
  let enemies: ReturnType<typeof enemyOn>[];
  let useCheck: AbilityRejectReason | null;
  /** Reads of the enemy list: two per aim, the leaders and the columns behind them */
  let scans: number;
  let strategy: OrbitalLaserStrategy;
  const inWave = { phase: 'wave' } as GameStateSnapshot;

  beforeEach(() => {
    enemies = [];
    useCheck = null;
    scans = 0;
    const gameState = {
      abilityManager: { checkUse: () => useCheck },
      enemyManager: { getAlive: () => (scans++, enemies) },
    };
    strategy = new OrbitalLaserStrategy(gameState as never);
  });

  it('ranks under the EMP', () => {
    expect(strategy.priority).toBe(93);
  });

  it('waits for a wave and for its charge', () => {
    for (let i = 0; i < 12; i++) enemies.push(enemyOn(ROUTE_A, 300 - i * 5));
    expect(strategy.canExecute({ phase: 'setup' } as GameStateSnapshot)).toBe(false);
    useCheck = 'no-charge';
    expect(strategy.canExecute(inWave)).toBe(false);
  });

  it('aims at the head of a column so the beam burns back through it', () => {
    for (let i = 0; i < 12; i++) enemies.push(enemyOn(ROUTE_A, 300 - i * 5)); // 300 m down to 245 m
    expect(strategy.canExecute(inWave)).toBe(true);
    const action = strategy.execute(inWave)!;
    expect(action).toMatchObject({ type: 'use-ability', abilityId: 'orbital-laser' });
    const aimed = (action.position!.z - ORIGIN.lat) * METERS_PER_DEGREE_LAT;
    expect(aimed).toBeCloseTo(300, 3);
    expect(action.reason).toContain('12 enemies');
  });

  it('counts only the stretch behind, on the same route, within 72 m', () => {
    for (let i = 0; i < 6; i++) enemies.push(enemyOn(ROUTE_A, 300 - i * 5)); // six in reach
    for (let i = 0; i < 6; i++) enemies.push(enemyOn(ROUTE_A, 200 - i * 5)); // 100 m further back
    for (let i = 0; i < 6; i++) enemies.push(enemyOn(ROUTE_B, 295 - i * 5)); // another route
    expect(strategy.canExecute(inWave)).toBe(false);
  });

  it('aims once per decision: execute takes the aim canExecute found for the same snapshot', () => {
    for (let i = 0; i < 12; i++) enemies.push(enemyOn(ROUTE_A, 300 - i * 5));
    const decision = { phase: 'wave' } as GameStateSnapshot;
    expect(strategy.canExecute(decision)).toBe(true);
    expect(scans).toBe(2);
    expect(strategy.execute(decision)!.reason).toContain('12 enemies');
    expect(scans).toBe(2);

    strategy.execute({ phase: 'wave' } as GameStateSnapshot); // the next decision aims anew
    expect(scans).toBe(4);
  });
});
