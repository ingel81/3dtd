import { describe, it, expect } from 'vitest';
import { simPartsPerTick } from './performance-profiler.service';
import { SimProfile } from '../../sim/core/sim-profile';

describe('simPartsPerTick', () => {
  it('gives the worker parts per tick, the unnamed rest of the sub-steps as other', () => {
    const profile = new SimProfile();
    profile.addTick(0.2, 8, 1, 4);
    profile.addTick(0.2, 12, 1, 4);
    profile.accumulateEnemyTiming(3, 1, 1, 6);
    profile.accumulateEnemyTiming(3, 1, 1, 6);
    profile.accumulateFrameTiming(2, 4, 1);
    const parts = simPartsPerTick(profile.take())!;
    expect(parts.tickMs).toBeCloseTo(11.2);
    expect(parts.updateMs).toBe(10);
    expect(parts.enemyMs).toBe(6);
    expect(parts.enemyMoveMs).toBe(3);
    expect(parts.combatMs).toBe(2);
    expect(parts.otherMs).toBeCloseTo(10 - 6 - 1 - 2 - 0.5);
    expect(parts.packetMs).toBe(1);
  });

  it('has nothing for a window without a tick', () => {
    expect(simPartsPerTick(new SimProfile().take())).toBeNull();
  });
});
