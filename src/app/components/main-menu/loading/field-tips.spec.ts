import { describe, expect, it } from 'vitest';
import { en } from '../../../i18n/messages/en';
import { de } from '../../../i18n/messages/de';

const FIELD_TIPS = en.menu.tips;

/**
 * The start menu renders each part of a tip as text and an accent as a
 * coloured `<b>` (main-menu.component.html). Markup in a part would
 * show as literal text, so the tips carry none.
 */
describe('the field tips (menu.tips)', () => {
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

  it('every language has the same tips with the same accents, and no markup', () => {
    expect(de.menu.tips).toHaveLength(FIELD_TIPS.length);
    de.menu.tips.forEach((tip, i) => {
      expect(tip.parts.filter((part) => part.accent).map((part) => part.accent)).toEqual(FIELD_TIPS[i].parts.filter((part) => part.accent).map((part) => part.accent));
      for (const part of tip.parts) expect(part.text).not.toMatch(/[<>]/);
    });
  });
});
