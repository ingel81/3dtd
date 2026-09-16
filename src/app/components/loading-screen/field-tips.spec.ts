import { describe, expect, it } from 'vitest';
import { FIELD_TIPS } from './field-tips';

/**
 * The loading screen renders each part of a tip as text and an accent as a
 * coloured `<b>` (loading-screen.component.html). Markup in a part would
 * show as literal text, so the tips carry none.
 */
describe('FIELD_TIPS', () => {
  it('carries text in every part and no markup', () => {
    for (const tip of FIELD_TIPS) {
      expect(tip.parts.length).toBeGreaterThan(0);
      for (const part of tip.parts) {
        expect(part.text.length).toBeGreaterThan(0);
        expect(part.text).not.toMatch(/[<>]/);
      }
    }
  });

  it('keeps the accents as parts of their own, with the spaces around them in the text', () => {
    const selling = FIELD_TIPS.find((tip) => tip.parts.some((part) => part.text === '75%'))!;
    expect(selling.parts).toEqual([
      { text: 'Selling a tower refunds ' },
      { text: '75%', accent: 'gold' },
      { text: ' of everything you invested, base cost plus all upgrades. Don\'t hesitate to reshuffle between waves.' },
    ]);
    expect(FIELD_TIPS.flatMap((tip) => tip.parts.filter((part) => part.accent).map((part) => part.accent)))
      .toEqual(['gold', 'teal', 'teal', 'gold']);
  });
});
