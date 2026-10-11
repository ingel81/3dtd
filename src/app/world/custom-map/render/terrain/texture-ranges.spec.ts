import { DataTexture, FloatType, RGBAFormat } from 'three';
import { describe, expect, it } from 'vitest';
import { uploadRect } from './texture-ranges';

function texture(w: number, h: number): DataTexture {
  return new DataTexture(new Float32Array(w * h * 4), w, h, RGBAFormat, FloatType);
}

describe('uploadRect', () => {
  it('uploads a full-width band row by row, never a range wider than a row', () => {
    const t = texture(8, 6);
    uploadRect(t, { i0: 0, j0: 1, i1: 7, j1: 3 });
    expect(t.updateRanges).toEqual([
      { start: 1 * 8 * 4, count: 8 * 4 },
      { start: 2 * 8 * 4, count: 8 * 4 },
      { start: 3 * 8 * 4, count: 8 * 4 },
    ]);
    for (const r of t.updateRanges) expect(r.count).toBeLessThanOrEqual(8 * 4);
  });

  it('uploads the whole texture in one piece when the rectangle covers it', () => {
    const t = texture(8, 6);
    t.addUpdateRange(0, 4);
    uploadRect(t, { i0: -2, j0: -2, i1: 20, j1: 20 });
    expect(t.updateRanges).toEqual([]);
  });

  it('uploads part of a row as one range per row', () => {
    const t = texture(8, 6);
    uploadRect(t, { i0: 2, j0: 4, i1: 3, j1: 5 });
    expect(t.updateRanges).toEqual([
      { start: (4 * 8 + 2) * 4, count: 2 * 4 },
      { start: (5 * 8 + 2) * 4, count: 2 * 4 },
    ]);
  });
});
