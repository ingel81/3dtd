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

  it('leaves other vegetation its size and stance, only its shade varies', () => {
    for (const id of ids.slice(0, 50)) {
      const v = instanceVariation(id, 'plant');
      expect(v.size).toBe(1);
      expect(v.lean).toBe(0);
    }
  });
});
