import { describe, it, expect } from 'vitest';
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
 * alpha it is drawn at.
 */
function fakeCanvas(width: number, height: number) {
  const calls: { op: 'drawImage' | 'fillText' | 'fillRect'; args: unknown[]; alpha: number }[] = [];
  const saved: number[] = [];
  const ctx = {
    globalAlpha: 1,
    font: '',
    fillStyle: '',
    textBaseline: '',
    shadowColor: '',
    shadowBlur: 0,
    save: () => saved.push(ctx.globalAlpha),
    restore: () => {
      ctx.globalAlpha = saved.pop() ?? 1;
    },
    measureText: (text: string) => ({ width: text.length * 6 }),
    drawImage: (...args: unknown[]) => calls.push({ op: 'drawImage', args, alpha: ctx.globalAlpha }),
    fillText: (...args: unknown[]) => calls.push({ op: 'fillText', args, alpha: ctx.globalAlpha }),
    fillRect: (...args: unknown[]) => calls.push({ op: 'fillRect', args, alpha: ctx.globalAlpha }),
  };
  const canvas = { width, height, getContext: () => ctx } as unknown as HTMLCanvasElement;
  const drawn = (op: string) => calls.filter((call) => call.op === op);
  return { canvas, drawn };
}

const image = (naturalWidth: number, naturalHeight: number) => ({ naturalWidth, naturalHeight }) as HTMLImageElement;

describe('stampScreenshot', () => {
  // 1080 p: font 12 px, margin 7 px, provider logos 19 px high, strip 18 px
  const google = image(200, 50);
  const logo = image(480, 272);

  it('writes the address after the provider logos, on their middle line, a little faded', () => {
    const { canvas, drawn } = fakeCanvas(1920, 1080);
    stampScreenshot(canvas, 'Map data ©2026 Google', [google], { logo, url: SCREENSHOT_URL });

    const [googleCall] = drawn('drawImage');
    expect(googleCall.args).toEqual([google, 7, 1054, 76, 19]);
    const url = drawn('fillText').find((call) => call.args[0] === SCREENSHOT_URL)!;
    // One margin gap after the logo's own
    expect(url.args[1]).toBe(7 + 76 + 7 + 7);
    expect(url.args[2]).toBeCloseTo(1054 + 19 / 2);
    expect(url.alpha).toBeGreaterThan(0);
    expect(url.alpha).toBeLessThan(1);
  });

  it('puts the logo as a faint watermark bottom right, above the attribution strip', () => {
    const { canvas, drawn } = fakeCanvas(1920, 1080);
    stampScreenshot(canvas, 'Map data ©2026 Google', [google], { logo, url: SCREENSHOT_URL });

    // y of the attribution strip
    const strip = (drawn('fillRect')[0].args as number[])[1];
    expect(strip).toBe(1080 - 7 - 18);
    const mark = drawn('drawImage').find((call) => call.args[0] === logo)!;
    const [, x, y, width, height] = mark.args as [unknown, number, number, number, number];
    expect(height).toBe(48);
    expect(width).toBe(Math.round((480 * 48) / 272));
    expect(x + width).toBe(1920 - 7);
    expect(y + height).toBe(strip - 7);
    expect(mark.alpha).toBeGreaterThan(0);
    expect(mark.alpha).toBeLessThan(1);
  });

  it('keeps the attribution text itself as it was, and draws the address before it', () => {
    const { canvas, drawn } = fakeCanvas(1920, 1080);
    stampScreenshot(canvas, 'Map data ©2026 Google', [google], { logo, url: SCREENSHOT_URL });
    const texts = drawn('fillText');
    expect(texts.map((call) => call.args[0])).toEqual([SCREENSHOT_URL, 'Map data ©2026 Google']);
    expect(texts[1].alpha).toBe(1);
  });

  it('starts the address at the margin without provider logos (DevWorld), with or without a logo', () => {
    const { canvas, drawn } = fakeCanvas(1280, 720);
    stampScreenshot(canvas, '', [], { logo: null, url: SCREENSHOT_URL });
    expect(drawn('drawImage')).toEqual([]);
    expect(drawn('fillRect')).toEqual([]);
    const [url] = drawn('fillText');
    // 720 p: font 10 px (the least), margin 6 px
    expect(url.args[0]).toBe(SCREENSHOT_URL);
    expect(url.args[1]).toBe(6);
  });

  it('sets the watermark on the bottom margin when there is no attribution', () => {
    const { canvas, drawn } = fakeCanvas(1920, 1080);
    stampScreenshot(canvas, '', [], { logo, url: SCREENSHOT_URL });
    const [mark] = drawn('drawImage');
    const [, , y, , height] = mark.args as number[];
    expect(y + height).toBe(1080 - 7);
  });

  it('leaves out a logo that did not decode', () => {
    const { canvas, drawn } = fakeCanvas(1920, 1080);
    stampScreenshot(canvas, 'Map data', [image(0, 0)], { logo: image(0, 0), url: SCREENSHOT_URL });
    expect(drawn('drawImage')).toEqual([]);
    expect(drawn('fillText').map((call) => call.args[0])).toEqual([SCREENSHOT_URL, 'Map data']);
  });
});
