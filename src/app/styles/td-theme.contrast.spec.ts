/**
 * Contrast of the theme tokens (WCAG 2.x): text on every surface it stands
 * on reaches 4.5:1, non-text marks (focus ring, stripes, quiet icons) 3:1.
 * The plaster and stone surfaces are measured by their one-colour stand-ins
 * in TD_THEME (panelMain, stoneDark, ...). A token that fails here is changed
 * in td-theme.ts, not here.
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

/** The surfaces text stands on: the page, flat areas, the plaster panel, a sunken field, the top bar */
const SURFACES: Token[] = ['bgDark', 'bgSurface', 'panelMain', 'panelSecondary', 'well', 'topbar'];

/** Colours used for running text, labels and numbers */
const TEXT: Token[] = [
  'textPrimary', 'textSecondary', 'textMuted', 'textQuiet', 'textTitle', 'textEngraved', 'textValue',
  'brass', 'brassLight', 'teal', 'tealLight', 'green',
  'warnText', 'hpText', 'hpLow', 'gain', 'loss', 'errorText',
];

/** Marks that are no text: focus ring, warning stripe and fills, quiet icons and rules */
const NON_TEXT: Token[] = ['brassLight', 'warnOrange', 'textTertiary'];

const pairs = (fgs: Token[], bgs: Token[]) => fgs.flatMap((fg) => bgs.map((bg) => [fg, bg] as const));

describe('theme contrast', () => {
  it.each(pairs(TEXT, SURFACES))('%s on %s reaches 4.5:1', (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(pairs(NON_TEXT, SURFACES))('%s next to %s reaches 3:1', (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(3);
  });

  // Buttons: the text of main, secondary and danger buttons on their stone
  it.each(pairs(['brassLight', 'textQuiet', 'dangerText', 'errorText', 'textMuted'], ['stoneDark', 'stoneDarker']))('%s on the button stone (%s) reaches 4.5:1', (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  // The chosen row and the chosen menu entry: lighter stone, brass text
  it.each(pairs(['brassLight', 'textPrimary', 'textSecondary'], ['stoneLit', 'stonePlate']))('%s on the chosen plate (%s) reaches 4.5:1', (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('the dim label before the place reads on the top bar', () => {
    expect(contrast('textDim', 'topbar')).toBeGreaterThanOrEqual(4.5);
  });

  // Research tree: the titles and feet of nodes on their own surfaces
  const NODE_SURFACES: Token[] = [
    'nodeTop', 'nodeBottom', 'nodeOpenTop', 'nodeOpenBottom', 'nodeActiveTop', 'nodeActiveBottom',
    'nodeQueuedTop', 'nodeQueuedBottom', 'nodeDoneTop', 'nodeDoneBottom',
  ];
  it.each(pairs(['nodeLockedTitle', 'nodeLockedFoot', 'textMuted'], ['nodeLockedTop', 'nodeLockedBottom']))('%s on the locked node (%s) reaches 4.5:1', (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
  it.each(pairs(['textPrimary', 'textSecondary', 'textMuted', 'brassLight', 'tealLight', 'green', 'warnText'], NODE_SURFACES))('%s on the node (%s) reaches 4.5:1', (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
  // Strand tints and the poor glyph are icon colours: 3:1 on the nodes they stand on
  // (strands on every node still in play, the poor glyph on the resting node)
  it.each([
    ...pairs(['branchBiology', 'branchEngineering'], NODE_SURFACES),
    ...pairs(['nodePoorGlyph'], ['nodeTop', 'nodeBottom']),
  ])('%s next to %s reaches 3:1', (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(3);
  });

  it('keeps healthRed, too dark for text, apart from the HP number', () => {
    expect(contrast('healthRed', 'panelMain')).toBeLessThan(4.5);
    expect(TD_THEME.hpText).not.toBe(TD_THEME.healthRed);
  });
});
