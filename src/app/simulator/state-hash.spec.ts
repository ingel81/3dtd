import { describe, it, expect } from 'vitest';
import { StateHasher, type StateHashSource } from './state-hash';
import type { Enemy } from '../entities/enemy.entity';
import type { Tower } from '../entities/tower.entity';

function enemy(id: string, lat: number, hp: number): Enemy {
  return {
    id,
    position: { lat, lon: 9.1 },
    transform: { terrainHeight: 3 },
    health: { hp },
    movement: { getPathProgress: () => 0.25 },
  } as unknown as Enemy;
}

function tower(id: string, cooldown: number): Tower {
  return {
    id,
    combat: { cooldownRemaining: cooldown, kills: 2, damageDealt: 40 },
    currentTarget: null,
  } as unknown as Tower;
}

function source(enemies: Enemy[], towers: Tower[] = [tower('tower-1', 10)]): StateHashSource {
  return {
    subStep: () => 600,
    credits: () => 250,
    baseHealth: () => 480,
    waveNumber: () => 3,
    idCounter: () => 42,
    rngState: () => ({ seed: 7, streams: { director: 1, spawn: 2, enemy: 3, bot: 4 } }),
    enemies: () => enemies,
    towers: () => towers,
    projectiles: () => [],
    hero: () => null,
  };
}

describe('StateHasher', () => {
  const hasher = new StateHasher();

  it('gives the same hash for the same state', () => {
    expect(hasher.hash(source([enemy('enemy-1', 48.1, 90)])))
      .toBe(hasher.hash(source([enemy('enemy-1', 48.1, 90)])));
  });

  it('notices a difference in the last bit of a position', () => {
    const lat = 48.1;
    const next = lat + Number.EPSILON * 64;
    expect(next).not.toBe(lat);
    expect(hasher.hash(source([enemy('enemy-1', lat, 90)])))
      .not.toBe(hasher.hash(source([enemy('enemy-1', next, 90)])));
  });

  it('notices another order of the same enemies', () => {
    const a = enemy('enemy-1', 48.1, 90);
    const b = enemy('enemy-2', 48.2, 90);
    expect(hasher.hash(source([a, b]))).not.toBe(hasher.hash(source([b, a])));
  });

  it('notices a tower cooldown', () => {
    expect(hasher.hash(source([], [tower('tower-1', 10)])))
      .not.toBe(hasher.hash(source([], [tower('tower-1', 11)])));
  });
});
