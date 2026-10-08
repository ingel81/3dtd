/**
 * Contrast of the theme tokens (WCAG 2.x): text on every surface it stands
 * on reaches 4.5:1, large titles and non-text marks (focus ring, stripes,
 * icons) 3:1. A token that fails here is changed in td-theme.ts, not here.
 */
import { describe, expect, it } from 'vitest';
import { TD_THEME } from './td-theme';

type Token = keyof typeof TD_THEME;

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Token, b: Token): number {
  const [hi, lo] = [luminance(TD_THEME[a]), luminance(TD_THEME[b])].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The surfaces text stands on: panels, plates, title plates, the page */
const SURFACES: Token[] = [
  'bgDark', 'bgSurface', 'panelMain', 'panelSecondary',
  'plateTop', 'plateBottom', 'plateHeadTop', 'plateHeadBottom',
];

/** Colours used for running text, labels and numbers */
const TEXT: Token[] = [
  'textPrimary', 'textSecondary', 'textMuted',
  'gold', 'goldLight', 'teal', 'tealLight', 'green',
  'warnText', 'hpText', 'hpLow', 'gain', 'loss',
];

/** Marks that are no text: focus ring, warning stripe and fills, quiet icons and rules */
const NON_TEXT: Token[] = ['goldLight', 'warnOrange', 'textTertiary'];

const DANGER_SURFACES: Token[] = ['dangerBg', 'dangerPlateTop', 'dangerPlateBottom'];
const DANGER_TEXT: Token[] = ['dangerText', 'textPrimary', 'textSecondary', 'textMuted', 'hpLow'];

const pairs = (fgs: Token[], bgs: Token[]) => fgs.flatMap((fg) => bgs.map((bg) => [fg, bg] as const));

describe('theme contrast', () => {
  it.each(pairs(TEXT, SURFACES))('%s on %s reaches 4.5:1', (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(pairs(DANGER_TEXT, DANGER_SURFACES))('%s on %s reaches 4.5:1', (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(pairs(NON_TEXT, SURFACES))('%s next to %s reaches 3:1', (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(3);
  });

  // The HQ plate under 30 %: its number, label and max on the warm plate
  it.each(pairs(['hpLow', 'textMuted', 'textPrimary'], ['hpWarmTop', 'hpWarmBottom']))('%s on %s reaches 4.5:1', (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([['ink', 'gold'], ['ink', 'goldLight']] as const)('%s on the brass button (%s) reaches 4.5:1', (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps healthRed, too dark for text, apart from the HP number', () => {
    expect(contrast('healthRed', 'plateTop')).toBeLessThan(4.5);
    expect(TD_THEME.hpText).not.toBe(TD_THEME.healthRed);
  });
});
