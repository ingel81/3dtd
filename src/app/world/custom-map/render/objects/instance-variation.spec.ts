import { instanceVariation } from './instance-variation';

describe('instanceVariation', () => {
  const ids = Array.from({ length: 400 }, (_, k) => `o${k}`);

  it('keeps an object its look: the same id gives the same variation', () => {
    expect(instanceVariation('o17', 'tree')).toEqual(instanceVariation('o17', 'tree'));
  });

  it('varies trees in size and lean within their bounds, most nearly upright', () => {
    const trees = ids.map((id) => instanceVariation(id, 'tree'));
    const sizes = trees.map((t) => t.size);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(0.88);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(1.12);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeGreaterThan(0.2);
    const leans = trees.map((t) => t.lean);
    expect(Math.max(...leans)).toBeLessThanOrEqual(0.07);
    expect(leans.filter((l) => l < 0.02).length).toBeGreaterThan(trees.length / 2);
    // Shades spread over brightness and along green to olive
    const reds = trees.map((t) => t.r);
    expect(Math.max(...reds) - Math.min(...reds)).toBeGreaterThan(0.3);
  });

  it('varies plants a little in size, never in stance, and leaves rocks and buildings their size', () => {
    const plants = ids.map((id) => instanceVariation(id, 'plant'));
    for (const v of plants) {
      expect(v.size).toBeGreaterThanOrEqual(0.92);
      expect(v.size).toBeLessThanOrEqual(1.08);
      expect(v.lean).toBe(0);
    }
    expect(new Set(plants.map((v) => v.size)).size).toBeGreaterThan(50);
    for (const id of ids.slice(0, 50)) expect(instanceVariation(id, 'rock').size).toBe(1);
  });

  it('turns autumn foliage further apart: between red (less green) and yellow (less blue)', () => {
    const autumn = ids.map((id) => instanceVariation(id, 'tree', ['autumn']));
    const green = ids.map((id) => instanceVariation(id, 'tree', ['temperate']));
    // Spread of green against red as a standard deviation: a few early-turning green trees do not count much
    const spread = (vs: { g: number; r: number }[]) => {
      const hue = vs.map((v) => v.g / v.r);
      const mean = hue.reduce((a, h) => a + h, 0) / hue.length;
      return Math.sqrt(hue.reduce((a, h) => a + (h - mean) ** 2, 0) / hue.length);
    };
    expect(spread(autumn)).toBeGreaterThan(spread(green) * 1.5);
    // Same shape and stance as any tree of that id: only the colour differs
    expect(autumn[3].size).toBe(green[3].size);
    expect(autumn[3].lean).toBe(green[3].lean);
    expect(autumn.some((v) => v.g / v.r < 0.75)).toBe(true);
    expect(autumn.some((v) => v.b / v.g < 0.8 && v.g / v.r > 0.9)).toBe(true);
  });
});
