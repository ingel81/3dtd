/**
 * Symmetric editing for fair tower defense maps: mirror across the
 * north-south axis (X), the east-west axis (Y), both, or turn by 180 or 90
 * degrees around the map's middle.
 *
 * Brushes paint where the pointer is; afterwards the samples they changed
 * are copied to their images, from the part of the map the pointer is in
 * (its sector), so a stroke across an axis stays consistent. A stroke that
 * knows what its cells held before (SymmetryTouch.original) copies only
 * the cells it changed, so ground that is not symmetric keeps its own shape
 * around them instead of a rectangle of the source's ground (the dab's
 * whole rectangle copied over); a stroke that adds to the ground (raise,
 * a mountain, a crater: `heightsAdd`) gives each image the same change on
 * its own ground, one that sets heights (level, a cliff, pools at a water
 * level) the source's heights. Without it (the whole map mirrored) every
 * cell is copied. The grids are centred, so a mirrored sample is again
 * exactly a sample; the 90 degree turn needs a square map. Objects, roads
 * and spawns are copied as things.
 */
import type { CustomMapDocument, MapObject, MapPoint } from '../../world/custom-map/map-document';
import { mergeChanges, type DocChange, type PatchTarget } from '../model/editor-document';
import { sampleX, sampleY, texelX, texelY, type GridRect } from '../model/grid';
import type { ArrayLayout, PatchArray } from '../model/region-patch';
import { HEIGHT_LIMITS } from './terrain-ops';

export type SymmetryMode = 'none' | 'x' | 'y' | 'xy' | 'rot2' | 'rot4';

export const SYMMETRY_MODES: readonly { id: SymmetryMode; label: string; hint: string }[] = [
  { id: 'none', label: 'Off', hint: 'No symmetry' },
  { id: 'x', label: 'Mirror X', hint: 'Mirror east and west across the north-south axis' },
  { id: 'y', label: 'Mirror Y', hint: 'Mirror north and south across the east-west axis' },
  { id: 'xy', label: 'Both', hint: 'Mirror across both axes: four quarters' },
  { id: 'rot2', label: 'Turn 2', hint: 'Turn by 180 degrees around the middle' },
  { id: 'rot4', label: 'Turn 4', hint: 'Turn by 90 degrees around the middle (square maps)' },
];

/** One image of the symmetry: how points, grid cells and turns map */
export interface SymmetryImage {
  point(p: MapPoint): MapPoint;
  /** Cell (i, j) of a centred grid of columns x rows to its image */
  cell(i: number, j: number, columns: number, rows: number): [number, number];
  /** An object's turn (radians, counter-clockwise) to its image's */
  turn(r: number): number;
  /** Mirror images flip handedness: a drawn line runs backwards to keep its left side */
  flips: boolean;
}

const IDENTITY: SymmetryImage = { point: (p) => ({ x: p.x, y: p.y }), cell: (i, j) => [i, j], turn: (r) => r, flips: false };
/** Facing north turned by r: mirrored east-west it faces north turned by -r */
const MIRROR_X: SymmetryImage = {
  point: (p) => ({ x: -p.x, y: p.y }),
  cell: (i, j, c) => [c - 1 - i, j],
  turn: (r) => -r,
  flips: true,
};
const MIRROR_Y: SymmetryImage = {
  point: (p) => ({ x: p.x, y: -p.y }),
  cell: (i, j, _c, r) => [i, r - 1 - j],
  turn: (r) => Math.PI - r,
  flips: true,
};
const TURN_180: SymmetryImage = {
  point: (p) => ({ x: -p.x, y: -p.y }),
  cell: (i, j, c, r) => [c - 1 - i, r - 1 - j],
  turn: (r) => r + Math.PI,
  flips: false,
};
/** (x, y) to (-y, x): a quarter turn counter-clockwise */
const TURN_90: SymmetryImage = {
  point: (p) => ({ x: -p.y, y: p.x }),
  cell: (i, j, c) => [c - 1 - j, i],
  turn: (r) => r + Math.PI / 2,
  flips: false,
};
const TURN_270: SymmetryImage = {
  point: (p) => ({ x: p.y, y: -p.x }),
  cell: (i, j, _c, r) => [j, r - 1 - i],
  turn: (r) => r - Math.PI / 2,
  flips: false,
};

/** The images of a mode, identity first; `square` says whether a quarter turn fits the map */
export function symmetryImages(mode: SymmetryMode, square = true): SymmetryImage[] {
  switch (mode) {
    case 'none':
      return [IDENTITY];
    case 'x':
      return [IDENTITY, MIRROR_X];
    case 'y':
      return [IDENTITY, MIRROR_Y];
    case 'xy':
      return [IDENTITY, MIRROR_X, MIRROR_Y, TURN_180];
    case 'rot2':
      return [IDENTITY, TURN_180];
    case 'rot4':
      return square ? [IDENTITY, TURN_90, TURN_180, TURN_270] : [IDENTITY, TURN_180];
  }
}

/** Whether point p lies in the same sector as the pointer c (the part of the map the copies come from) */
export function sameSector(mode: SymmetryMode, p: MapPoint, c: MapPoint): boolean {
  switch (mode) {
    case 'none':
      return true;
    case 'x':
      return p.x * Math.sign(c.x || 1) >= 0;
    case 'y':
      return p.y * Math.sign(c.y || 1) >= 0;
    case 'xy':
      return p.x * Math.sign(c.x || 1) >= 0 && p.y * Math.sign(c.y || 1) >= 0;
    case 'rot2':
      return p.x * c.x + p.y * c.y >= 0;
    case 'rot4': {
      // Within 45 degrees of the pointer's direction
      const a = Math.atan2(p.y, p.x) - Math.atan2(c.y || 1e-9, c.x || 1e-9);
      const d = Math.atan2(Math.sin(a), Math.cos(a));
      return Math.abs(d) <= Math.PI / 4 + 1e-9;
    }
  }
}

/** The rectangle of a rect's images, for saving them before the copy writes there */
export function imageRects(images: readonly SymmetryImage[], rect: GridRect, columns: number, rows: number): GridRect[] {
  return images.slice(1).map((img) => {
    const [a0, b0] = img.cell(rect.i0, rect.j0, columns, rows);
    const [a1, b1] = img.cell(rect.i1, rect.j1, columns, rows);
    return {
      i0: Math.max(0, Math.min(a0, a1)),
      j0: Math.max(0, Math.min(b0, b1)),
      i1: Math.min(columns - 1, Math.max(a0, a1)),
      j1: Math.min(rows - 1, Math.max(b0, b1)),
    };
  });
}

/**
 * How a symmetric stroke copies a cell to its images: every cell as it is
 * (`all`), only the cells the stroke changed (`changed`, from what they
 * held before), or a height's change added to the image's own (`delta`)
 */
interface CopyMode {
  kind: 'all' | 'changed' | 'delta';
  /** What element (i, j, channel) held before the stroke, for `changed` and `delta` */
  before?: (i: number, j: number, channel: number) => number;
  /** For `changed` on paint split over several maps: whether the texel changed in any of them */
  changedAt?: (i: number, j: number) => boolean;
}

const COPY_ALL: CopyMode = { kind: 'all' };

/**
 * Copies the cells of `rect` that lie in the pointer's sector to their
 * images (`copy` says which and how). `position` gives a cell's map
 * position (to test the sector).
 */
export function mirrorCells(
  mode: SymmetryMode,
  images: readonly SymmetryImage[],
  array: PatchArray,
  layout: ArrayLayout,
  rect: GridRect,
  center: MapPoint,
  position: (i: number, j: number) => MapPoint,
  copy: CopyMode = COPY_ALL,
): void {
  if (images.length < 2) return;
  const { columns, rows, channels } = layout;
  const before = copy.before;
  for (let j = rect.j0; j <= rect.j1; j++) {
    for (let i = rect.i0; i <= rect.i1; i++) {
      if (!sameSector(mode, position(i, j), center)) continue;
      const from = (j * columns + i) * channels;
      // A cell back at what it held before the stroke (a pool's mask an earlier dab set and a later one drained)
      // still goes to the images the stroke wrote it to; images the stroke never touched keep their own
      let reverted = false;
      if (copy.kind === 'changed' && before) {
        let same = !copy.changedAt || !copy.changedAt(i, j);
        for (let ch = 0; same && ch < channels; ch++) same = array[from + ch] === before(i, j, ch);
        if (same) reverted = true;
      }
      const rise = copy.kind === 'delta' && before ? array[from] - before(i, j, 0) : 0;
      if (copy.kind === 'delta' && rise === 0) continue;
      for (let k = 1; k < images.length; k++) {
        const [ti, tj] = images[k].cell(i, j, columns, rows);
        if (ti < 0 || tj < 0 || ti >= columns || tj >= rows) continue;
        const to = (tj * columns + ti) * channels;
        if (to === from) continue;
        if (reverted) {
          let touched = false;
          for (let ch = 0; !touched && ch < channels; ch++) touched = array[to + ch] !== before!(ti, tj, ch);
          if (!touched) continue;
        }
        if (copy.kind === 'delta' && before) {
          array[to] = Math.min(HEIGHT_LIMITS.max, Math.max(HEIGHT_LIMITS.min, before(ti, tj, 0) + rise));
          continue;
        }
        for (let ch = 0; ch < channels; ch++) array[to + ch] = array[from + ch];
      }
    }
  }
}

/** Where a stroke saves cells before writing: the arrays the symmetry copies into */
export interface SymmetryTouch {
  heights(rect: GridRect): void;
  splat(rect: GridRect): void;
  /** The main water's mask; left out when the dab did not paint it */
  water?(rect: GridRect): void;
  /** Further bodies whose masks the dab painted, and their recorders */
  bodies?: readonly number[];
  body?(index: number, rect: GridRect): void;
  /**
   * What element (i, j, channel) of a target held before the stroke (its
   * recorder's saved tiles): only the cells the stroke changed copy to the
   * images, the rest of their ground stays. Left out, every cell is copied.
   */
  original?(target: PatchTarget, i: number, j: number, channel: number): number;
  /** With `original`: heights rise by the source's change on the image's own ground instead of taking the source's */
  heightsAdd?: boolean;
}

/**
 * Copies what one dab changed (heights, splat, water) from the pointer's
 * sector to the images; returns the change including the images' rects.
 */
export function mirrorChange(
  doc: CustomMapDocument,
  mode: SymmetryMode,
  center: MapPoint,
  change: DocChange,
  touch: SymmetryTouch,
  /** Water mask samples a dab changed (heights and mask share the grid) */
  waterRect?: GridRect,
): DocChange {
  if (mode === 'none') return change;
  const t = doc.terrain;
  const g = t.grid;
  const images = symmetryImages(mode, g.columns === g.rows && t.splat.resolution > 0);
  let out: DocChange = { ...change };
  const original = touch.original?.bind(touch);
  /** How cells of `target` copy: as they are without a record of before, else only changed ones (heights by their change) */
  const copyOf = (target: PatchTarget, changedAt?: CopyMode['changedAt']): CopyMode =>
    original
      ? { kind: target === 'heights' && touch.heightsAdd ? 'delta' : 'changed', before: (i, j, ch) => original(target, i, j, ch), changedAt }
      : COPY_ALL;
  if (change.heights) {
    const rects = imageRects(images, change.heights, g.columns, g.rows);
    for (const r of rects) touch.heights(r);
    mirrorCells(
      mode,
      images,
      g.heights,
      { columns: g.columns, rows: g.rows, channels: 1 },
      change.heights,
      center,
      (i, j) => ({ x: sampleX(t, i), y: sampleY(t, j) }),
      copyOf('heights'),
    );
    for (const r of rects) out = mergeChanges(out, { heights: r });
  }
  if (change.water) {
    const rect = waterRect ?? change.heights ?? { i0: 0, j0: 0, i1: g.columns - 1, j1: g.rows - 1 };
    const at = (i: number, j: number) => ({ x: sampleX(t, i), y: sampleY(t, j) });
    const layout = { columns: g.columns, rows: g.rows, channels: 1 };
    if (t.water && touch.water) {
      for (const r of imageRects(images, rect, g.columns, g.rows)) touch.water(r);
      mirrorCells(mode, images, t.water.mask, layout, rect, center, at, copyOf('water'));
    }
    for (const index of touch.bodies ?? []) {
      const body = t.waterBodies?.[index];
      if (!body) continue;
      for (const r of imageRects(images, rect, g.columns, g.rows)) touch.body?.(index, r);
      mirrorCells(mode, images, body.mask, layout, rect, center, at, copyOf(`body${index}`));
    }
  }
  if (change.splat) {
    const res = t.splat.resolution;
    const rects = imageRects(images, change.splat, res, res);
    for (const r of rects) touch.splat(r);
    // A texel's weights add up to 255 over all maps: one that changed in any map copies in all of them
    const maps = t.splat.maps;
    const changedAt = original
      ? (u: number, v: number) => {
          const at = (v * res + u) * 4;
          for (let m = 0; m < maps.length; m++) {
            for (let ch = 0; ch < 4; ch++) if (maps[m][at + ch] !== original(`splat${m}` as PatchTarget, u, v, ch)) return true;
          }
          return false;
        }
      : undefined;
    const splatRect = change.splat;
    maps.forEach((map, m) => {
      mirrorCells(
        mode,
        images,
        map,
        { columns: res, rows: res, channels: 4 },
        splatRect,
        center,
        (u, v) => ({ x: texelX(t, u), y: texelY(t, v) }),
        copyOf(`splat${m}` as PatchTarget, changedAt),
      );
    });
    for (const r of rects) out = mergeChanges(out, { splat: r });
  }
  return out;
}

/** Copies of objects at the symmetry's images, with ids from `take`; those outside the map drop out */
export function objectImages<T extends MapObject>(objects: readonly T[], images: readonly SymmetryImage[], take: () => string, halfWidth: number, halfDepth: number): T[] {
  const out: T[] = [];
  for (const o of objects) {
    for (const img of images.slice(1)) {
      const p = img.point(o);
      if (Math.abs(p.x) > halfWidth || Math.abs(p.y) > halfDepth) continue;
      if (Math.hypot(p.x - o.x, p.y - o.y) < 0.01) continue;
      const turn = img.turn(o.rotation);
      out.push({ ...o, id: take(), x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100, rotation: Math.round((((turn % TAU) + TAU) % TAU) * 1000) / 1000 });
    }
  }
  return out;
}

const TAU = Math.PI * 2;
