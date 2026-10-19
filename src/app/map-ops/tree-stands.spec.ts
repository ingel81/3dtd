import { describe, expect, it } from 'vitest';
import { standAge, standScale } from './tree-stands';

describe('tree stands', () => {
  const along = (x: number, seed = 0) => standScale(x, 0, 0.8, 1.2, ((x * 0.618) % 1 + 1) % 1, seed);

  it('keeps the placer\u2019s middle scale on average and spreads it from young to old stands', () => {
    const sizes = Array.from({ length: 5000 }, (_, k) => along(k * 3));
    const mean = sizes.reduce((s, v) => s + v, 0) / sizes.length;
    expect(mean).toBeGreaterThan(0.93);
    expect(mean).toBeLessThan(1.07);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(0.62);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(1.41);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeGreaterThan(0.5);
  });

  it('groups: neighbours a few metres apart are near in size, trees 300 m apart often not', () => {
    const near: number[] = [];
    const far: number[] = [];
    for (let x = 0; x < 3000; x += 4) {
      near.push(Math.abs(along(x) - along(x + 4)));
      far.push(Math.abs(along(x) - along(x + 300)));
    }
    const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    expect(mean(near)).toBeLessThan(mean(far) * 0.6);
  });

  it('is the same for the same place and seed, another for another seed', () => {
    expect(standAge(123, 456, 7)).toBe(standAge(123, 456, 7));
    expect(standAge(123, 456, 7)).not.toBe(standAge(123, 456, 8));
  });
});
