import { TD_FONTS, TD_THEME } from '../styles/td-theme';

/**
 * Screenshot helpers for photo mode: file name, the stamp with the
 * attribution the tiles require and the game's own mark, PNG download. The
 * frame itself comes from ThreeTilesEngine.captureFrame().
 */

/** The site a saved picture points to */
export const SCREENSHOT_URL = 'https://3dtd.sgeht.net';

/** Watermark logo height in font sizes of the stamp: about 48 px on a 1080 p picture */
const WATERMARK_HEIGHT = 4;
const WATERMARK_ALPHA = 0.6;
const URL_ALPHA = 0.75;

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 3dtd-<place>-<yyyymmdd>-<hhmmss>.png, the place reduced to ASCII letters, digits and dashes. */
export function screenshotFileName(place: string, date: Date): string {
  const slug = place
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 40)
    .replace(/^-+|-+$/g, '');
  const stamp = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}`
    + `-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
  return slug ? `3dtd-${slug}-${stamp}.png` : `3dtd-${stamp}.png`;
}

/** The image, or null when it does not load. */
export function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** The game's mark in a saved picture. */
export interface ScreenshotBrand {
  /** The 3DTD logo, null when it did not load */
  logo: HTMLImageElement | null;
  url: string;
}

/**
 * Draw into the picture what the screen shows as HTML over the canvas, which
 * a canvas copy has none of: the map attribution as the game shows it
 * (provider logos bottom left, the data attribution bottom right on a light
 * strip), and the game's mark: its address small after the provider logos
 * (a line above them where the strip reaches that far left), its logo as a
 * faint watermark bottom right above the attribution.
 */
export function stampScreenshot(
  canvas: HTMLCanvasElement,
  attribution: string,
  logos: readonly HTMLImageElement[],
  brand: ScreenshotBrand,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const fontPx = Math.max(10, Math.round(canvas.height / 90));
  const margin = Math.round(fontPx * 0.6);

  const logoHeight = Math.round(fontPx * 1.6);
  let x = margin;
  for (const logo of logos) {
    if (logo.naturalWidth <= 0 || logo.naturalHeight <= 0) continue;
    const width = Math.round((logo.naturalWidth * logoHeight) / logo.naturalHeight);
    ctx.drawImage(logo, x, canvas.height - margin - logoHeight, width, logoHeight);
    x += width + margin;
  }

  // The attribution strip bottom right, measured first: the address keeps
  // clear of it
  const stripHeight = Math.round(fontPx * 1.5);
  const stripY = canvas.height - margin - stripHeight;
  const padX = Math.round(fontPx * 0.5);
  let textWidth = 0;
  let stripX = canvas.width;
  if (attribution) {
    ctx.font = `${fontPx}px sans-serif`;
    textWidth = Math.min(ctx.measureText(attribution).width, canvas.width * 0.6);
    stripX = canvas.width - margin - textWidth - 2 * padX;
  }

  // The address on the logos' middle line, a gap after them; light with a
  // soft shadow, so it reads over bright facades and dark streets alike.
  // Where it would run under the strip (a narrow picture with a long
  // attribution), a line up instead, above the logos at the left margin.
  ctx.save();
  ctx.font = `500 ${fontPx}px ${TD_FONTS.body}`;
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = URL_ALPHA;
  ctx.fillStyle = TD_THEME.textPrimary;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = Math.round(fontPx * 0.4);
  const urlX = x === margin ? x : x + margin;
  if (urlX + ctx.measureText(brand.url).width + margin <= stripX) {
    ctx.fillText(brand.url, urlX, canvas.height - margin - logoHeight / 2);
  } else {
    ctx.fillText(brand.url, margin, canvas.height - 2 * margin - logoHeight - fontPx / 2);
  }
  ctx.restore();

  if (attribution) {
    ctx.font = `${fontPx}px sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.fillRect(stripX, stripY, textWidth + 2 * padX, stripHeight);
    ctx.fillStyle = '#444';
    ctx.fillText(attribution, stripX + padX, stripY + stripHeight / 2, textWidth);
  }

  const mark = brand.logo;
  if (!mark || mark.naturalWidth <= 0 || mark.naturalHeight <= 0) return;
  const markHeight = fontPx * WATERMARK_HEIGHT;
  const markWidth = Math.round((mark.naturalWidth * markHeight) / mark.naturalHeight);
  const markBottom = attribution ? stripY - margin : canvas.height - margin;
  ctx.save();
  ctx.globalAlpha = WATERMARK_ALPHA;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
  ctx.shadowBlur = Math.round(fontPx * 0.5);
  ctx.drawImage(mark, canvas.width - margin - markWidth, markBottom - markHeight, markWidth, markHeight);
  ctx.restore();
}

/** Save the canvas as a PNG through a download link. Resolves false when encoding fails. */
export function downloadCanvasPng(canvas: HTMLCanvasElement, fileName: string): Promise<boolean> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        resolve(false);
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      // The download has picked the blob up by then
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      resolve(true);
    }, 'image/png');
  });
}
