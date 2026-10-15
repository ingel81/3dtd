import { describe, expect, it } from 'vitest';
import { waterLight } from './water-material';

describe('waterLight', () => {
  const sunOnly = (i: number) => Math.min(1.1, Math.max(0.12, (i / 3.4) * 0.85 + 0.15));

  it('by day follows the sun alone, as before', () => {
    for (const i of [0.5, 1.6, 2.2, 3.8, 4.6]) expect(waterLight(i, 0)).toBeCloseTo(sunOnly(i), 6);
  });

  it('dims with the scene: a little at dusk, much at night', () => {
    const day = waterLight(2.2, 0);
    const dusk = waterLight(2.2, 0.6);
    const night = waterLight(2.2, 1);
    expect(dusk).toBeLessThan(day);
    expect(dusk).toBeGreaterThan(day * 0.7);
    expect(night).toBeLessThan(dusk);
    expect(night).toBeLessThanOrEqual(day * 0.3 + 1e-9);
  });

  it('keeps a night map with moonlight dark though the moon raises the sun', () => {
    // A city night: sun 0.5, moonlight adds 1.5
    expect(waterLight(0.5 + 1.5, 1)).toBeLessThan(0.25);
  });

  it('never goes black, and leaves lava to its own glow', () => {
    expect(waterLight(0, 1)).toBeGreaterThan(0);
    expect(waterLight(2.2, 1, true)).toBeCloseTo(sunOnly(2.2), 6);
  });
});
