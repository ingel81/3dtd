import { describe, it, expect } from 'vitest';
import { TD_THEME } from '../styles/td-theme';
import { SCREENSHOT_URL, screenshotFileName, stampScreenshot } from './screenshot';

describe('screenshotFileName', () => {
  const date = new Date(2026, 8, 13, 7, 5, 9);

  it('puts place and local time into the name', () => {
    expect(screenshotFileName('Times Square, New York', date)).toBe('3dtd-times-square-new-york-20260913-070509.png');
  });

  it('reduces accents and other characters to ASCII and dashes', () => {
    expect(screenshotFileName('Place de l\'Opéra, Paris 9e', date)).toBe('3dtd-place-de-l-opera-paris-9e-20260913-070509.png');
    expect(screenshotFileName('Staroměstské náměstí', date)).toBe('3dtd-staromestske-namesti-20260913-070509.png');
  });

  it('leaves the place out when nothing of it is left', () => {
    expect(screenshotFileName('渋谷', date)).toBe('3dtd-20260913-070509.png');
    expect(screenshotFileName('', date)).toBe('3dtd-20260913-070509.png');
  });

  it('caps a long place without a trailing dash', () => {
    const name = screenshotFileName('Avenida Nossa Senhora de Copacabana 165, Rio de Janeiro', date);
    const slug = name.slice('3dtd-'.length, -'-20260913-070509.png'.length);
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith('-')).toBe(false);
  });
});

/**
 * jsdom has no 2D canvas: a context that notes what is drawn, with the
 * alpha, outline width, colour and font size it is drawn at. Text is half
 * its font size wide per character.
 */
function fakeCanvas(width: number, height: number) {
  type Op = 'drawImage' | 'fillText' | 'strokeText' | 'fillRect';
  const calls: { op: Op; args: unknown[]; alpha: number; lineWidth: number; style: string; fontPx: number }[] = [];
  const saved: number[] = [];
  const ctx = {
    globalAlpha: 1,
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: '',
    textBaseline: '',
    shadowColor: '',
    shadowBlur: 0,
    save: () => saved.push(ctx.globalAlpha),
    restore: () => {
      ctx.globalAlpha = saved.pop() ?? 1;
    },
    measureText: (text: string) => ({ width: (text.length * fontPx()) / 2 }),
    drawImage: (...args: unknown[]) => note('drawImage', args, ''),
    fillText: (...args: unknown[]) => note('fillText', args, ctx.fillStyle),
    strokeText: (...args: unknown[]) => note('strokeText', args, ctx.strokeStyle),
    fillRect: (...args: unknown[]) => note('fillRect', args, ctx.fillStyle),
  };
  const fontPx = () => Number(/(\d+)px/.exec(ctx.font)?.[1] ?? 10);
  const note = (op: Op, args: unknown[], style: string) =>
    calls.push({ op, args, alpha: ctx.globalAlpha, lineWidth: ctx.lineWidth, style, fontPx: fontPx() });
  const canvas = { width, height, getContext: () => ctx } as unknown as HTMLCanvasElement;
  const drawn = (op: Op) => calls.filter((call) => call.op === op);
  return { canvas, drawn, calls };
}

const image = (naturalWidth: number, naturalHeight: number) => ({ naturalWidth, naturalHeight }) as HTMLImageElement;

describe('stampScreenshot', () => {
  // 1080 p: font 12 px, margin 7 px, provider logos 19 px high, strip 18 px;
  // the mark: logo 85 x 48 px, address 15 px high and 165 px wide
  const google = image(200, 50);
  const logo = image(480, 272);
  const LONG_ATTRIBUTION = 'Map data ©2026 Google, Airbus, Landsat / Copernicus, Maxar Technologies';

  const address = (drawn: ReturnType<typeof fakeCanvas>['drawn']) =>
    drawn('fillText').find((call) => call.args[0] === SCREENSHOT_URL)!;
  const watermark = (drawn: ReturnType<typeof fakeCanvas>['drawn']) =>
    drawn('drawImage').find((call) => call.args[0] === logo);

  it('keeps the provider logos bottom left and the attribution text as it was', () => {
    const { canvas, drawn } = fakeCanvas(1920, 1080);
    stampScreenshot(canvas, 'Map data ©2026 Google', [google], { logo, url: SCREENSHOT_URL });

    expect(drawn('drawImage')[0].args).toEqual([google, 7, 1054, 76, 19]);
    const [strip] = drawn('fillRect');
    expect((strip.args as number[])[1]).toBe(1080 - 7 - 18);
    const text = drawn('fillText').find((call) => call.args[0] === 'Map data ©2026 Google')!;
    expect(text.alpha).toBe(1);
    expect(text.style).toBe('#444');
  });

  it('stacks logo and address as one block bottom right, the address centred under the logo', () => {
    const { canvas, drawn } = fakeCanvas(1920, 1080);
    stampScreenshot(canvas, 'Map data ©2026 Google', [google], { logo, url: SCREENSHOT_URL });

    // A margin above the bottom row (the provider logo, 19 px, is its tallest)
    const url = address(drawn);
    expect(url.fontPx).toBe(15);
    const [, urlX, urlBottom] = url.args as [string, number, number];
    expect(urlBottom).toBe(1080 - 7 - 19 - 7);
    // The wider address sits on the right margin, flush with the strip
    expect(urlX + 165).toBe(1920 - 7);

    const mark = watermark(drawn)!;
    const [, x, y, width, height] = mark.args as [unknown, number, number, number, number];
    expect([width, height]).toEqual([85, 48]);
    // Centred over the address, 3 px above its top
    expect(x + width / 2).toBeCloseTo(urlX + 165 / 2, 0);
    expect(y + height).toBe(urlBottom - 15 - 3);
    expect(mark.alpha).toBeGreaterThan(0);
    expect(mark.alpha).toBeLessThan(1);
  });

  it('draws the address light over a dark, semi-transparent outline', () => {
    const { canvas, calls } = fakeCanvas(1920, 1080);
    stampScreenshot(canvas, 'Map data ©2026 Google', [google], { logo, url: SCREENSHOT_URL });

    const own = calls.filter((call) => call.args[0] === SCREENSHOT_URL);
    expect(own.map((call) => call.op)).toEqual(['strokeText', 'fillText']);
    const [outline, letters] = own;
    expect(outline.args).toEqual(letters.args);
    expect(outline.style).toBe(TD_THEME.panelShadow);
    expect(outline.lineWidth).toBe(3);
    expect(outline.alpha).toBeGreaterThan(0);
    expect(outline.alpha).toBeLessThan(letters.alpha);
    expect(letters.style).toBe(TD_THEME.textPrimary);
    expect(letters.alpha).toBeLessThan(1);
  });

  /**
   * The mark's box, the outline's outer half included, and the top of the
   * bottom row (the higher of the provider logos and the strip).
   */
  function layout(width: number, height: number, attribution: string, logos: HTMLImageElement[]) {
    const { canvas, drawn } = fakeCanvas(width, height);
    stampScreenshot(canvas, attribution, logos, { logo, url: SCREENSHOT_URL });
    const outline = drawn('strokeText')[0];
    const [, urlX, urlBottom, urlWidth] = outline.args as [string, number, number, number];
    const half = outline.lineWidth / 2;
    const [, markX, markY, markWidth] = watermark(drawn)!.args as [unknown, number, number, number];
    const rowTops = [
      ...drawn('fillRect').map((call) => (call.args as number[])[1]),
      ...drawn('drawImage').filter((call) => call.args[0] !== logo).map((call) => (call.args as number[])[2]),
    ];
    return {
      left: Math.min(markX, urlX - half),
      right: Math.max(markX + markWidth, urlX + urlWidth + half),
      top: markY,
      bottom: urlBottom + half,
      rowTop: Math.min(height, ...rowTops),
      stripX: drawn('fillRect')[0]?.args[0] as number | undefined,
    };
  }

  it.each([
    ['landscape 1920 x 1080', 1920, 1080],
    ['portrait 1170 x 2532 (390 x 844 at dpr 3)', 1170, 2532],
    ['portrait 780 x 1688 (390 x 844, the engine caps the pixel ratio at 2)', 780, 1688],
  ])('keeps the mark inside a %s picture and above a long attribution', (_, width, height) => {
    const box = layout(width, height, LONG_ATTRIBUTION, [google]);
    expect(box.left).toBeGreaterThan(0);
    expect(box.right).toBeLessThan(width);
    expect(box.top).toBeGreaterThan(0);
    expect(box.bottom).toBeLessThan(box.rowTop);
    // In portrait the strip reaches under the mark: only the row's top keeps them apart
    if (width < 1500) expect(box.stripX).toBeLessThan(box.left);
  });

  it('sets the mark on the bottom margin in DevWorld (no attribution, no provider logos)', () => {
    const { canvas, drawn } = fakeCanvas(1280, 720);
    stampScreenshot(canvas, '', [], { logo, url: SCREENSHOT_URL });
    expect(drawn('fillRect')).toEqual([]);
    expect(drawn('drawImage').map((call) => call.args[0])).toEqual([logo]);

    // 720 p: font 10 px (the least), margin 6 px, address 13 px
    const [, urlX, urlBottom] = address(drawn).args as [string, number, number];
    expect(urlBottom).toBe(720 - 6);
    expect(urlX + (SCREENSHOT_URL.length * 13) / 2).toBe(1280 - 6);
    const box = layout(1280, 720, '', []);
    expect(box.top).toBeGreaterThan(0);
    expect(box.bottom).toBeLessThan(720);
  });

  it('keeps the mark above provider logos without attribution', () => {
    const box = layout(1920, 1080, '', [google]);
    expect(box.rowTop).toBe(1054);
    expect(box.bottom).toBeLessThan(1054);
  });

  it('stamps the address alone on the right margin when the logo did not load', () => {
    const { canvas, drawn } = fakeCanvas(1920, 1080);
    stampScreenshot(canvas, 'Map data ©2026 Google', [google], { logo: null, url: SCREENSHOT_URL });
    expect(watermark(drawn)).toBeUndefined();
    const [, urlX, urlBottom] = address(drawn).args as [string, number, number];
    expect(urlX + 165).toBe(1920 - 7);
    expect(urlBottom).toBe(1080 - 7 - 19 - 7);
  });

  it('leaves out logos that did not decode', () => {
    const { canvas, drawn } = fakeCanvas(1920, 1080);
    stampScreenshot(canvas, 'Map data', [image(0, 0)], { logo: image(0, 0), url: SCREENSHOT_URL });
    expect(drawn('drawImage')).toEqual([]);
    expect(drawn('fillText').map((call) => call.args[0])).toEqual(['Map data', SCREENSHOT_URL]);
  });
});
