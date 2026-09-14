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
/** Address size in font sizes of the stamp: 15 px on a 1080 p picture */
const URL_SIZE = 1.25;
const URL_ALPHA = 0.9;
/** Width of the address' dark outline in its font size: 3 px at 15 px, half of it outside the letters */
const URL_OUTLINE = 0.2;
const URL_OUTLINE_ALPHA = 0.6;
/** Gap between logo and address in font sizes of the stamp */
const BRAND_GAP = 0.25;

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
 * strip), and the game's mark as one block bottom right, a margin above that
 * bottom row, so it stays clear of both however wide the strip gets.
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
  // Height of the bottom row as far as anything is drawn in it
  let rowHeight = 0;

  const logoHeight = Math.round(fontPx * 1.6);
  let x = margin;
  for (const logo of logos) {
    if (logo.naturalWidth <= 0 || logo.naturalHeight <= 0) continue;
    const width = Math.round((logo.naturalWidth * logoHeight) / logo.naturalHeight);
    ctx.drawImage(logo, x, canvas.height - margin - logoHeight, width, logoHeight);
    x += width + margin;
    rowHeight = logoHeight;
  }

  if (attribution) {
    const stripHeight = Math.round(fontPx * 1.5);
    const stripY = canvas.height - margin - stripHeight;
    const padX = Math.round(fontPx * 0.5);
    ctx.font = `${fontPx}px sans-serif`;
    ctx.textBaseline = 'middle';
    const textWidth = Math.min(ctx.measureText(attribution).width, canvas.width * 0.6);
    const stripX = canvas.width - margin - textWidth - 2 * padX;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.fillRect(stripX, stripY, textWidth + 2 * padX, stripHeight);
    ctx.fillStyle = '#444';
    ctx.fillText(attribution, stripX + padX, stripY + stripHeight / 2, textWidth);
    rowHeight = Math.max(rowHeight, stripHeight);
  }

  const bottom = canvas.height - margin - (rowHeight > 0 ? rowHeight + margin : 0);
  stampBrand(ctx, canvas.width, brand, fontPx, margin, bottom);
}

/**
 * The game's mark with its lower edge at `bottom`, its right edge on the
 * margin like the attribution strip's: the logo as a faint watermark, the
 * address centred under it. The address is light with a dark outline, so it
 * reads over bright facades and dark streets alike.
 */
function stampBrand(
  ctx: CanvasRenderingContext2D,
  width: number,
  brand: ScreenshotBrand,
  fontPx: number,
  margin: number,
  bottom: number,
): void {
  const urlPx = Math.round(fontPx * URL_SIZE);
  ctx.save();
  ctx.font = `500 ${urlPx}px ${TD_FONTS.body}`;
  const urlWidth = Math.min(ctx.measureText(brand.url).width, width - 2 * margin);
  const mark = brand.logo && brand.logo.naturalWidth > 0 && brand.logo.naturalHeight > 0 ? brand.logo : null;
  const markHeight = fontPx * WATERMARK_HEIGHT;
  const markWidth = mark ? Math.round((mark.naturalWidth * markHeight) / mark.naturalHeight) : 0;
  const centre = width - margin - Math.max(urlWidth, markWidth) / 2;

  // Outline first, the letters over its inner half
  const urlX = Math.round(centre - urlWidth / 2);
  ctx.textBaseline = 'bottom';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, Math.round(urlPx * URL_OUTLINE));
  ctx.strokeStyle = TD_THEME.panelShadow;
  ctx.globalAlpha = URL_OUTLINE_ALPHA;
  ctx.strokeText(brand.url, urlX, bottom, urlWidth);
  ctx.globalAlpha = URL_ALPHA;
  ctx.fillStyle = TD_THEME.textPrimary;
  ctx.fillText(brand.url, urlX, bottom, urlWidth);

  if (mark) {
    ctx.globalAlpha = WATERMARK_ALPHA;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = Math.round(fontPx * 0.5);
    const markBottom = bottom - urlPx - Math.round(fontPx * BRAND_GAP);
    ctx.drawImage(mark, Math.round(centre - markWidth / 2), markBottom - markHeight, markWidth, markHeight);
  }
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
