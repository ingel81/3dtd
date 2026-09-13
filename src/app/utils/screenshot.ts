/**
 * Screenshot helpers for photo mode: file name, the attribution stamp the
 * tiles require, PNG download. The frame itself comes from
 * ThreeTilesEngine.captureFrame().
 */

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

/**
 * Draw the map attribution into the picture as the game shows it on screen:
 * provider logos bottom left, the data attribution bottom right on a light
 * strip. The screen's logos and text are HTML, a canvas copy has neither.
 */
export function stampAttribution(
  canvas: HTMLCanvasElement,
  attribution: string,
  logos: readonly HTMLImageElement[],
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

  if (!attribution) return;
  ctx.font = `${fontPx}px sans-serif`;
  ctx.textBaseline = 'middle';
  const padX = Math.round(fontPx * 0.5);
  const textWidth = Math.min(ctx.measureText(attribution).width, canvas.width * 0.6);
  const stripHeight = Math.round(fontPx * 1.5);
  const stripX = canvas.width - margin - textWidth - 2 * padX;
  const stripY = canvas.height - margin - stripHeight;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.fillRect(stripX, stripY, textWidth + 2 * padX, stripHeight);
  ctx.fillStyle = '#444';
  ctx.fillText(attribution, stripX + padX, stripY + stripHeight / 2, textWidth);
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
