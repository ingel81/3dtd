/**
 * Height brushes: each dab changes the samples under a round brush and
 * returns the samples it touched. Amounts are per dab; the tool scales them
 * with the time between dabs so a held brush works at the same speed at any
 * frame rate.
 */
import type { MapTerrain } from '../../world/custom-map/map-document';
import { valueNoise } from '../../world/custom-map/map-create';
import { clamp, sampleRectAround, sampleX, sampleY, type GridRect } from '../model/grid';
import { brushWeight, type BrushSettings } from './brush';

/** Lowest and highest height the editor writes, metres */
export const HEIGHT_LIMITS = { min: -200, max: 800 } as const;

type SampleFn = (h: number, w: number, i: number, j: number, k: number) => number;

/** Runs `fn` over the samples under the brush with their weight */
function eachSample(t: MapTerrain, x: number, y: number, brush: BrushSettings, fn: SampleFn): GridRect {
  const rect = sampleRectAround(t, x, y, brush.radius);
  const g = t.grid;
  const h = g.heights;
  for (let j = rect.j0; j <= rect.j1; j++) {
    const dy = sampleY(t, j) - y;
    for (let i = rect.i0; i <= rect.i1; i++) {
      const dx = sampleX(t, i) - x;
      const w = brushWeight(Math.hypot(dx, dy), brush.radius, brush.falloff);
      if (w <= 0) continue;
      const k = j * g.columns + i;
      h[k] = clamp(fn(h[k], w, i, j, k), HEIGHT_LIMITS.min, HEIGHT_LIMITS.max);
    }
  }
  return rect;
}

/** Raise (amount > 0) or lower by up to `amount` metres at the centre */
export function raiseDab(t: MapTerrain, x: number, y: number, brush: BrushSettings, amount: number): GridRect {
  return eachSample(t, x, y, brush, (h, w) => h + amount * brush.strength * w);
}

/** Pull each sample toward the mean of its neighbours; `k` 0..1 per dab */
export function smoothDab(t: MapTerrain, x: number, y: number, brush: BrushSettings, k: number): GridRect {
  const rect = sampleRectAround(t, x, y, brush.radius);
  const src = copyRect(t, rect, 1);
  const g = t.grid;
  const c = g.columns;
  const read = (i: number, j: number): number => {
    const ci = clamp(i, 0, g.columns - 1);
    const cj = clamp(j, 0, g.rows - 1);
    // Outside the copied rect the grid did not change this dab
    if (ci >= src.i0 && ci <= src.i1 && cj >= src.j0 && cj <= src.j1) return src.data[(cj - src.j0) * src.w + (ci - src.i0)];
    return g.heights[cj * c + ci];
  };
  return eachSample(t, x, y, brush, (h, w, i, j) => {
    let sum = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) sum += read(i + di, j + dj);
    const mean = sum / 9;
    return h + (mean - h) * clamp(k * brush.strength * w, 0, 1);
  });
}

/** Pull toward a height (flatten to the sampled height, level to a set height) */
export function flattenDab(t: MapTerrain, x: number, y: number, brush: BrushSettings, target: number, k: number): GridRect {
  return eachSample(t, x, y, brush, (h, w) => h + (target - h) * clamp(k * brush.strength * w, 0, 1));
}

/** Roughen with value noise of a wavelength around a quarter of the brush */
export function noiseDab(
  t: MapTerrain,
  x: number,
  y: number,
  brush: BrushSettings,
  amplitude: number,
  seed: number,
): GridRect {
  const wave = Math.max(t.grid.cellSize * 2, brush.radius / 4);
  return eachSample(t, x, y, brush, (h, w, i, j) => {
    const n = valueNoise(sampleX(t, i) / wave, sampleY(t, j) / wave, seed) * 0.7 +
      valueNoise(sampleX(t, i) / (wave / 2.3), sampleY(t, j) / (wave / 2.3), seed + 17) * 0.3;
    return h + n * amplitude * brush.strength * w;
  });
}

/**
 * Thermal erosion: where a sample stands higher above a neighbour than the
 * talus angle allows, part of the difference slides down. A few passes per
 * dab soften cliffs into scree slopes.
 */
export function erodeDab(t: MapTerrain, x: number, y: number, brush: BrushSettings, passes = 3, talusDeg = 33): GridRect {
  const rect = sampleRectAround(t, x, y, brush.radius);
  // A dab wholly beyond the map's edge touches no sample
  if (rect.i1 < rect.i0 || rect.j1 < rect.j0) return rect;
  const g = t.grid;
  const c = g.columns;
  const h = g.heights;
  const talus = Math.tan((talusDeg * Math.PI) / 180) * g.cellSize;
  const weight = new Float32Array((rect.i1 - rect.i0 + 1) * (rect.j1 - rect.j0 + 1));
  const rw = rect.i1 - rect.i0 + 1;
  for (let j = rect.j0; j <= rect.j1; j++) {
    for (let i = rect.i0; i <= rect.i1; i++) {
      weight[(j - rect.j0) * rw + (i - rect.i0)] = brushWeight(
        Math.hypot(sampleX(t, i) - x, sampleY(t, j) - y),
        brush.radius,
        brush.falloff,
      );
    }
  }
  const nbr = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (let pass = 0; pass < passes; pass++) {
    for (let j = rect.j0; j <= rect.j1; j++) {
      for (let i = rect.i0; i <= rect.i1; i++) {
        const w = weight[(j - rect.j0) * rw + (i - rect.i0)];
        if (w <= 0) continue;
        const k = j * c + i;
        for (const [di, dj] of nbr) {
          const ni = i + di;
          const nj = j + dj;
          if (ni < rect.i0 || ni > rect.i1 || nj < rect.j0 || nj > rect.j1) continue;
          const nk = nj * c + ni;
          const diff = h[k] - h[nk];
          if (diff <= talus) continue;
          const move = (diff - talus) * 0.25 * brush.strength * w;
          h[k] -= move;
          h[nk] += move;
        }
      }
    }
  }
  return rect;
}

/**
 * Cliff levels like Warcraft: pull heights toward the nearest multiple of
 * `step` metres (above `base`), with a sharp edge between the levels.
 */
export function terraceDab(
  t: MapTerrain,
  x: number,
  y: number,
  brush: BrushSettings,
  step: number,
  k: number,
  base = 0,
): GridRect {
  const s = Math.max(0.5, step);
  return eachSample(t, x, y, brush, (h, w) => {
    const target = base + Math.round((h - base) / s) * s;
    return h + (target - h) * clamp(k * brush.strength * w, 0, 1);
  });
}

/** Raise to the next cliff level (or lower one level): the plateau brush */
export function plateauDab(
  t: MapTerrain,
  x: number,
  y: number,
  brush: BrushSettings,
  level: number,
  k: number,
): GridRect {
  return eachSample(t, x, y, brush, (h, w) => {
    // A hard edge inside the falloff makes a cliff: full pull once w passes one half
    const hard = w >= 0.5 ? 1 : w * 2 * 0.2;
    return h + (level - h) * clamp(k * hard, 0, 1);
  });
}

export interface RampEnd {
  x: number;
  y: number;
  h: number;
}

/**
 * A ramp from `a` to `b`: samples within `width / 2` of the line take the
 * height interpolated along it, fading into the ground over `falloff` of
 * the half width. Returns the touched samples.
 *
 * With `sides` (metres of height per metre across) the ramp is cut and
 * filled like an embankment: beyond its flat crest the ground may differ
 * from the ramp's height by at most `sides` per metre, round its ends too,
 * so a ramp over low ground stands on slopes down to it and one through a
 * hill gets sloped cuts, instead of the falloff's few metres of near-wall.
 */
export function rampBetween(
  t: MapTerrain,
  a: RampEnd,
  b: RampEnd,
  width: number,
  falloff: number,
  beforeWrite?: (rect: GridRect) => void,
  sides?: number,
): GridRect | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-6) return null;
  const len = Math.sqrt(len2);
  const half = width / 2;
  const crest = half * (1 - falloff);
  const g = t.grid;
  const rectAround = (pad: number): GridRect => ({
    i0: clamp(Math.floor((Math.min(a.x, b.x) - pad + t.width / 2) / g.cellSize), 0, g.columns - 1),
    i1: clamp(Math.ceil((Math.max(a.x, b.x) + pad + t.width / 2) / g.cellSize), 0, g.columns - 1),
    j0: clamp(Math.floor((Math.min(a.y, b.y) - pad + t.depth / 2) / g.cellSize), 0, g.rows - 1),
    j1: clamp(Math.ceil((Math.max(a.y, b.y) + pad + t.depth / 2) / g.cellSize), 0, g.rows - 1),
  });
  /** Along the line (0..1, unclamped) and the ramp's height there, at sample (i, j) */
  const along = (i: number, j: number): [number, number] => {
    const s = ((sampleX(t, i) - a.x) * dx + (sampleY(t, j) - a.y) * dy) / len2;
    return [s, a.h + (b.h - a.h) * clamp(s, 0, 1)];
  };
  // How far the embankment reaches: the largest step between the ground and the ramp under it
  let reach = 0;
  if (sides && sides > 0) {
    const strip = rectAround(half);
    let step = 0;
    for (let j = strip.j0; j <= strip.j1; j++) {
      for (let i = strip.i0; i <= strip.i1; i++) {
        const [, target] = along(i, j);
        step = Math.max(step, Math.abs(g.heights[j * g.columns + i] - target));
      }
    }
    reach = Math.min(step / sides, 4 * width + 20);
  }
  const rect = rectAround(half + reach);
  beforeWrite?.(rect);
  for (let j = rect.j0; j <= rect.j1; j++) {
    for (let i = rect.i0; i <= rect.i1; i++) {
      const px = sampleX(t, i) - a.x;
      const py = sampleY(t, j) - a.y;
      const [s, target] = along(i, j);
      const k = j * g.columns + i;
      let h = g.heights[k];
      if (reach > 0) {
        // Distance from the segment, round its ends; beyond the crest the slope holds the ground to the ramp
        const sc = clamp(s, 0, 1);
        const d = Math.hypot(px - dx * sc, py - dy * sc);
        const allow = Math.max(0, d - crest) * sides!;
        h = clamp(h, target - allow, target + allow);
      }
      if (s >= 0 && s <= 1) {
        const side = Math.abs(px * dy - py * dx) / len;
        h += (target - h) * brushWeight(side, half, falloff);
      }
      g.heights[k] = h;
    }
  }
  return rect;
}

function copyRect(t: MapTerrain, rect: GridRect, pad: number): GridRect & { data: Float32Array; w: number } {
  const g = t.grid;
  const r = {
    i0: Math.max(0, rect.i0 - pad),
    j0: Math.max(0, rect.j0 - pad),
    i1: Math.min(g.columns - 1, rect.i1 + pad),
    j1: Math.min(g.rows - 1, rect.j1 + pad),
  };
  // A dab wholly off the grid copies nothing
  const w = Math.max(0, r.i1 - r.i0 + 1);
  const data = new Float32Array(w * Math.max(0, r.j1 - r.j0 + 1));
  for (let j = r.j0; j <= r.j1; j++) {
    data.set(g.heights.subarray(j * g.columns + r.i0, j * g.columns + r.i1 + 1), (j - r.j0) * w);
  }
  return { ...r, data, w };
}
