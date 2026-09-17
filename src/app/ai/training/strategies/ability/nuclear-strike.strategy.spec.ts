import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NuclearStrikeStrategy } from './nuclear-strike.strategy';
import type { GameStateSnapshot } from '../../../core/models/game-state-snapshot';
import { ABILITIES, type AbilityRejectReason } from '../../../../configs/abilities.config';
import { METERS_PER_DEGREE_LAT } from '../../../../utils/geo-utils';
import { getRouteProfile } from '../../../../utils/route-corridor';
import type { GeoPosition } from '../../../../models/game.types';

const ORIGIN = { lat: 48.0, lon: 9.0 };
/** A point `north` metres from the origin */
const at = (north: number): GeoPosition => ({ lat: ORIGIN.lat + north / METERS_PER_DEGREE_LAT, lon: ORIGIN.lon });
/** Metres north of the origin */
const northOf = (lat: number) => (lat - ORIGIN.lat) * METERS_PER_DEGREE_LAT;

/** Straight north, 1000 m from the spawn to the HQ */
const ROUTE = [at(0), at(1000)];
/** Metres along the route as the game measures them (route profile) per flat metre */
const MEASURE = getRouteProfile(ROUTE).totalLength / 1000;
const WARNING_S = ABILITIES['nuclear-strike'].warningMs / 1000;
const GAME_TIME_MS = 42_000;

/** An enemy `metres` along the route, walking north at `speed` m/s right now. */
function enemyAt(metres: number, speed = 5) {
  return {
    position: at(metres),
    movement: {
      path: ROUTE,
      getPathProgress: () => metres / 1000,
      getDistanceAlongPath: () => metres * MEASURE,
      getEffectiveSpeed: vi.fn(() => speed),
    },
  };
}

/** `count` enemies 1 m apart from `head` back toward the spawn */
const pack = (head: number, count: number, speed = 5) =>
  Array.from({ length: count }, (_, i) => enemyAt(head - i, speed));

describe('NuclearStrikeStrategy', () => {
  let enemies: ReturnType<typeof enemyAt>[];
  let useCheck: AbilityRejectReason | null;
  let strategy: NuclearStrikeStrategy;
  const inWave = { phase: 'wave' } as GameStateSnapshot;

  beforeEach(() => {
    enemies = [];
    useCheck = null;
    const gameState = {
      gameTimeMs: GAME_TIME_MS,
      abilityManager: { checkUse: () => useCheck },
      enemyManager: { getAlive: () => enemies },
    };
    strategy = new NuclearStrikeStrategy(gameState as never);
  });

  /** Metres north the strategy aims at, and its reason */
  const aimed = () => {
    const action = strategy.execute(inWave)!;
    expect(action).toMatchObject({ type: 'use-ability', abilityId: 'nuclear-strike' });
    expect(action.position!.x).toBeCloseTo(ORIGIN.lon);
    return { north: northOf(action.position!.z), reason: action.reason };
  };

  it('outranks every other strategy', () => {
    expect(strategy.priority).toBeGreaterThan(95);
  });

  it('waits for a wave', () => {
    enemies.push(...pack(900, 12));
    expect(strategy.canExecute({ phase: 'setup' } as GameStateSnapshot)).toBe(false);
  });

  it('waits until the strike is ready, a missile silo standing included', () => {
    enemies.push(...pack(900, 12));
    for (const reason of ['no-charge', 'locked', 'no-launch-site'] as AbilityRejectReason[]) {
      useCheck = reason;
      expect(strategy.canExecute(inWave), reason).toBe(false);
    }
    useCheck = null;
    expect(strategy.canExecute(inWave)).toBe(true);
  });

  it('leads a pack: fires on one still short of the last fifth that walks into it, aims where it will be', () => {
    expect(WARNING_S).toBe(6.5);
    // 770 to 781 m now (last fifth from 800 m), 32.5 m further at the impact
    enemies.push(...pack(781, 12));
    expect(strategy.canExecute(inWave)).toBe(true);

    const { north, reason } = aimed();
    expect(north).toBeGreaterThan(800);
    expect(north).toBeLessThan(815);
    expect(reason).toContain('12 of 12');
    // The speed of the moment, read on the game clock
    expect(enemies[0].movement.getEffectiveSpeed).toHaveBeenCalledWith(GAME_TIME_MS);
  });

  it('does not count enemies that reach the HQ before the impact', () => {
    // 975 to 986 m now: past the 1000 m at the impact
    enemies.push(...pack(986, 12));
    expect(strategy.canExecute(inWave)).toBe(false);

    // Ten more at 841 to 850 m: they are the ones it fires on
    enemies.push(...pack(850, 10));
    expect(strategy.canExecute(inWave)).toBe(true);
    const { north, reason } = aimed();
    expect(north).toBeGreaterThan(870);
    expect(north).toBeLessThan(885);
    expect(reason).toContain('10 of 10');
  });

  it('keeps the charge while fewer than ten will stand in the last fifth at the impact', () => {
    enemies.push(...pack(850, 9));
    // Still in the middle of the route at the impact (500 + 32.5 m)
    enemies.push(...pack(500, 30));
    expect(strategy.canExecute(inWave)).toBe(false);
  });

  it('aims a halted pack where it stands', () => {
    enemies.push(...pack(905, 10, 0));
    expect(strategy.canExecute(inWave)).toBe(true);
    const { north } = aimed();
    expect(north).toBeGreaterThan(895);
    expect(north).toBeLessThan(906);
  });

  it('aims at the densest spot at the impact, not at the first enemy', () => {
    // Three spread out ahead, a pack of ten behind them: all in the last fifth at the impact
    enemies.push(enemyAt(960), enemyAt(920), enemyAt(880), ...pack(830, 10));
    const { north, reason } = aimed();
    expect(north).toBeGreaterThan(850);
    expect(north).toBeLessThan(865);
    expect(reason).toContain('of 13');
  });
});
