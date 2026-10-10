/**
 * Compact undo for brush strokes: a stroke writes straight into the map's
 * arrays and the recorder copies each 32 x 32 tile the first time the stroke
 * touches it. At the end the command keeps, per touched tile, the values
 * before and after: a stroke over a corner of a big map stores a few KB,
 * not the whole grid.
 */
import type { GridRect } from './grid';

export type PatchArray = Float32Array | Uint8Array;

export const PATCH_TILE = 32;

/** One tile of an array: its rectangle in elements and the values before and after */
export interface TilePatch<T extends PatchArray = PatchArray> {
  i0: number;
  j0: number;
  w: number;
  h: number;
  before: T;
  after: T;
}

/**
 * Grid layout of an array: `columns` x `rows` cells of `channels` values
 * (heights 1, splat RGBA 4, water mask 1).
 */
export interface ArrayLayout {
  columns: number;
  rows: number;
  channels: number;
}

export class RegionRecorder<T extends PatchArray> {
  private readonly saved = new Map<number, TilePatch<T>>();
  private readonly tilesX: number;
  private touchedRect: GridRect | null = null;

  constructor(
    readonly array: T,
    readonly layout: ArrayLayout,
  ) {
    this.tilesX = Math.ceil(layout.columns / PATCH_TILE);
  }

  /** Call before writing into `rect`: saves the tiles it reaches that are not saved yet */
  touch(rect: GridRect): void {
    if (rect.i1 < rect.i0 || rect.j1 < rect.j0) return;
    const t = this.touchedRect;
    this.touchedRect = t
      ? { i0: Math.min(t.i0, rect.i0), j0: Math.min(t.j0, rect.j0), i1: Math.max(t.i1, rect.i1), j1: Math.max(t.j1, rect.j1) }
      : { ...rect };
    const tx0 = Math.floor(rect.i0 / PATCH_TILE);
    const tx1 = Math.floor(rect.i1 / PATCH_TILE);
    const ty0 = Math.floor(rect.j0 / PATCH_TILE);
    const ty1 = Math.floor(rect.j1 / PATCH_TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const key = ty * this.tilesX + tx;
        if (this.saved.has(key)) continue;
        const i0 = tx * PATCH_TILE;
        const j0 = ty * PATCH_TILE;
        const w = Math.min(PATCH_TILE, this.layout.columns - i0);
        const h = Math.min(PATCH_TILE, this.layout.rows - j0);
        const before = copyTile(this.array, this.layout, i0, j0, w, h);
        this.saved.set(key, { i0, j0, w, h, before, after: before });
      }
    }
  }

  get rect(): GridRect | null {
    return this.touchedRect;
  }

  get empty(): boolean {
    return this.saved.size === 0;
  }

  /** The patches with the values as they are now; tiles the stroke left as they were drop out */
  finish(): TilePatch<T>[] {
    const out: TilePatch<T>[] = [];
    for (const p of this.saved.values()) {
      const after = copyTile(this.array, this.layout, p.i0, p.j0, p.w, p.h);
      if (sameValues(p.before, after)) continue;
      out.push({ ...p, after });
    }
    return out;
  }
}

/** Writes the `before` or `after` side of patches back into the array; returns the rectangle */
export function applyPatches<T extends PatchArray>(
  array: T,
  layout: ArrayLayout,
  patches: readonly TilePatch<T>[],
  side: 'before' | 'after',
): GridRect | null {
  let rect: GridRect | null = null;
  const ch = layout.channels;
  for (const p of patches) {
    const src = p[side];
    for (let r = 0; r < p.h; r++) {
      const at = ((p.j0 + r) * layout.columns + p.i0) * ch;
      array.set(src.subarray(r * p.w * ch, (r + 1) * p.w * ch), at);
    }
    const pr = { i0: p.i0, j0: p.j0, i1: p.i0 + p.w - 1, j1: p.j0 + p.h - 1 };
    rect = rect
      ? { i0: Math.min(rect.i0, pr.i0), j0: Math.min(rect.j0, pr.j0), i1: Math.max(rect.i1, pr.i1), j1: Math.max(rect.j1, pr.j1) }
      : pr;
  }
  return rect;
}

/** Bytes the patches hold, for the history's budget */
export function patchBytes(patches: readonly TilePatch[]): number {
  let n = 0;
  for (const p of patches) n += p.before.byteLength + p.after.byteLength;
  return n;
}

function copyTile<T extends PatchArray>(array: T, layout: ArrayLayout, i0: number, j0: number, w: number, h: number): T {
  const ch = layout.channels;
  const out = new (array.constructor as new (n: number) => T)(w * h * ch);
  for (let r = 0; r < h; r++) {
    const at = ((j0 + r) * layout.columns + i0) * ch;
    out.set(array.subarray(at, at + w * ch), r * w * ch);
  }
  return out;
}

function sameValues(a: PatchArray, b: PatchArray): boolean {
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return false;
  return true;
}
