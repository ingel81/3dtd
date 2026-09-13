import { describe, it, expect } from 'vitest';
import { BloomKick } from './bloom-kick';

const PEAK = { strength: 1.4, threshold: 0.45 };

describe('BloomKick', () => {
  it('blends strength and threshold towards the peak', () => {
    const pass = { strength: 0.3, threshold: 0.85 };
    const kick = new BloomKick(pass);
    kick.set(1, PEAK);
    expect(pass).toEqual(PEAK);
    kick.set(0.5, PEAK);
    expect(pass.strength).toBeCloseTo(0.85);
    expect(pass.threshold).toBeCloseTo(0.65);
    kick.set(3, PEAK);
    expect(pass).toEqual(PEAK);
  });

  it('puts the exact values back once the kick is over', () => {
    const pass = { strength: 0.3, threshold: 0.85 };
    const kick = new BloomKick(pass);
    for (const amount of [1, 0.73, 0.41, 0.07]) kick.set(amount, PEAK);
    kick.set(0, PEAK);
    expect(pass.strength).toBe(0.3);
    expect(pass.threshold).toBe(0.85);

    kick.set(0.6, PEAK);
    kick.reset();
    expect(pass).toEqual({ strength: 0.3, threshold: 0.85 });
  });

  it('leaves the pass alone without a kick', () => {
    const pass = { strength: 0.3, threshold: 0.85 };
    const kick = new BloomKick(pass);
    // Someone else sets the pass: a kick that is not running does not overwrite it
    pass.strength = 0.5;
    kick.set(0, PEAK);
    kick.reset();
    expect(pass.strength).toBe(0.5);
  });
});
