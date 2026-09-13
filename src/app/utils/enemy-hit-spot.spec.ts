import { describe, it, expect } from 'vitest';
import type { Enemy } from '../entities/enemy.entity';
import { enemyBloodColor, enemyHitSpot } from './enemy-hit-spot';

describe('enemyHitSpot', () => {
  it('is the position at the model origin for an enemy without a body', () => {
    const zombie = {
      body: null,
      position: { lat: 1, lon: 2 },
      transform: { terrainHeight: 30 },
      heightOffset: 0.5,
    } as unknown as Enemy;
    expect(enemyHitSpot(zombie)).toEqual({ lat: 1, lon: 2, height: 30.5 });
  });

  it('is the point the hit landed on for a body along the route', () => {
    const hit = { lat: 3, lon: 4, height: 12 };
    const ooze = { body: { hit }, position: { lat: 9, lon: 9 } } as unknown as Enemy;
    expect(enemyHitSpot(ooze)).toBe(hit);
  });
});

describe('enemyBloodColor', () => {
  it('reads the type colour as hex and leaves the default red undefined', () => {
    expect(enemyBloodColor({ typeConfig: { id: 'ooze', bloodColor: '#6fe021' } } as unknown as Enemy)).toBe(0x6fe021);
    expect(enemyBloodColor({ typeConfig: { id: 'zombie' } } as unknown as Enemy)).toBeUndefined();
  });
});
