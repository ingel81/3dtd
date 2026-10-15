import { describe, expect, it } from 'vitest';
import { crackDistance } from './lava-noise';

describe('crackDistance', () => {
  it('runs from 0 on the cracks to 1 inside the plates', () => {
    const d = crackDistance(64, 4, 23);
    expect(Math.min(...d)).toBeLessThan(0.05);
    expect(Math.max(...d)).toBe(1);
    expect(d.every((v) => v >= 0 && v <= 1)).toBe(true);
  });

  it('tiles: the texture continues across its edges', () => {
    const size = 64;
    const d = crackDistance(size, 4, 23);
    // Neighbours across the wrap differ no more than neighbours inside the texture do
    let inside = 0;
    let across = 0;
    for (let y = 0; y < size; y++) {
      inside = Math.max(inside, Math.abs(d[y * size + 1] - d[y * size + 2]));
      across = Math.max(across, Math.abs(d[y * size + size - 1] - d[y * size]));
    }
    expect(across).toBeLessThanOrEqual(inside + 0.05);
  });
});
