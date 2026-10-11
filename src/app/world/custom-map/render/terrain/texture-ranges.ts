import type { DataTexture } from 'three';

/** Texel rectangle, inclusive */
export interface TexelRect {
  i0: number;
  j0: number;
  i1: number;
  j1: number;
}

/**
 * Uploads only the rows of a rectangle on the next render instead of the
 * whole texture (an editor brush on a 1024 grid touches a few hundred
 * texels of millions). three counts update ranges in components of four per
 * texel whatever the format, and re-uploads everything when there are none.
 * The rectangle is clamped; an empty one uploads nothing.
 */
export function uploadRect(texture: DataTexture, rect: TexelRect | undefined): void {
  const w = texture.image.width;
  const h = texture.image.height;
  if (rect) {
    const i0 = Math.max(0, rect.i0);
    const j0 = Math.max(0, rect.j0);
    const i1 = Math.min(w - 1, rect.i1);
    const j1 = Math.min(h - 1, rect.j1);
    if (i1 < i0 || j1 < j0) return;
    // The whole texture goes up in one piece. three uploads each range as one
    // row (texSubImage2D, height 1), so a range wider than a row is refused by
    // WebGL: every other rectangle goes up row by row.
    if (i0 === 0 && i1 === w - 1 && j0 === 0 && j1 === h - 1) {
      texture.clearUpdateRanges();
    } else {
      for (let j = j0; j <= j1; j++) texture.addUpdateRange((j * w + i0) * 4, (i1 - i0 + 1) * 4);
    }
  } else {
    texture.clearUpdateRanges();
  }
  texture.needsUpdate = true;
}
