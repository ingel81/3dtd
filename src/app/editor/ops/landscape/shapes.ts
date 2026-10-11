/**
 * Landform brushes: mountain (ridged peaks), valley, plateau, and a cliff
 * edge along a drawn line. Each pulls toward a target built from the ground
 * before the stroke, so holding the brush grows the form to its full size
 * and no further.
 */
import type { MapPoint } from '../../../world/custom-map/map-document';
import { sampleRectAround, sampleX, sampleY, type GridRect } from '../../model/grid';
import { brushWeight, type BrushSettings } from '../brush';
import { nearestOnPolyline } from '../path-graph';
import { HEIGHT_LIMITS } from '../terrain-ops';
import { smooth } from './landscape-noise';
import type { LandscapeStroke } from './landscape-stroke';

/** Share per second a form closes toward its target */
const FORM_RATE = 1.6;

export type FormKind = 'mountain' | 'valley' | 'plateau';

/** Peak height of a form for a brush: a mountain grows to about 60 % of its radius at full strength */
export function formHeight(kind: FormKind, brush: BrushSettings): number {
  switch (kind) {
    case 'mountain':
      return brush.radius * 0.6 * brush.strength;
    case 'valley':
      return brush.radius * 0.3 * brush.strength;
    case 'plateau':
      return Math.max(2, brush.radius * 0.25 * brush.strength);
  }
}

export function formDab(stroke: LandscapeStroke, kind: FormKind, center: MapPoint, brush: BrushSettings, dt: number): GridRect {
  const t = stroke.doc.terrain;
  const g = t.grid;
  const rect = sampleRectAround(t, center.x, center.y, brush.radius);
  stroke.touchHeights(rect);
  const [ai, aj] = [
    Math.min(g.columns - 1, Math.max(0, Math.round((center.x + t.width / 2) / g.cellSize))),
    Math.min(g.rows - 1, Math.max(0, Math.round((center.y + t.depth / 2) / g.cellSize))),
  ];
  stroke.anchor ??= { ...center, h: stroke.baseHeight(ai, aj) };
  const n = stroke.noise;
  const height = formHeight(kind, brush);
  const a = 1 - Math.exp(-FORM_RATE * Math.min(dt, 0.1));
  for (let j = rect.j0; j <= rect.j1; j++) {
    const y = sampleY(t, j);
    for (let i = rect.i0; i <= rect.i1; i++) {
      const x = sampleX(t, i);
      const d = Math.hypot(x - center.x, y - center.y);
      if (d >= brush.radius) continue;
      const keep = stroke.roadKeep(x, y);
      if (keep <= 0) continue;
      const base = stroke.baseHeight(i, j);
      const k = j * g.columns + i;
      const cur = g.heights[k];
      let target: number;
      if (kind === 'mountain') {
        // A cone softened to a bell, broken up by ridges; wider brushes make broader ridges
        const bell = Math.pow(brushWeight(d, brush.radius, 1), 1.3);
        const ridges = n.ridged(x, y, Math.max(20, brush.radius * 0.6));
        target = Math.max(cur, base + height * bell * (0.45 + 0.75 * ridges));
      } else if (kind === 'valley') {
        const bowl = brushWeight(d, brush.radius, 1);
        target = Math.min(cur, base - height * bowl * (0.8 + 0.2 * n.fbm(x, y, brush.radius, 3)));
      } else {
        // A table with a steep frayed rim at about two thirds of the radius
        const rim = brush.radius * (0.62 + 0.12 * n.fbm(x, y, 14, 3, 'n4'));
        const top = 1 - smooth(rim - 2 * g.cellSize, rim + g.cellSize, d);
        target = Math.max(cur, stroke.anchor.h + height * top + (base - stroke.anchor.h) * (1 - top));
      }
      const h = cur + (target - cur) * Math.min(1, a * keep);
      g.heights[k] = Math.min(HEIGHT_LIMITS.max, Math.max(HEIGHT_LIMITS.min, h));
    }
  }
  return rect;
}

/**
 * A cliff along a drawn line: the ground left of the drawing direction
 * rises by `height` with a steep, slightly ragged face, within `reach`
 * metres of the line.
 */
export function cliffAlong(stroke: LandscapeStroke, line: readonly MapPoint[], height: number, reach: number): GridRect | null {
  if (line.length < 2) return null;
  const t = stroke.doc.terrain;
  const g = t.grid;
  const xs = line.map((p) => p.x);
  const ys = line.map((p) => p.y);
  const cell = g.cellSize;
  const rect: GridRect = {
    i0: Math.max(0, Math.floor((Math.min(...xs) - reach + t.width / 2) / cell)),
    i1: Math.min(g.columns - 1, Math.ceil((Math.max(...xs) + reach + t.width / 2) / cell)),
    j0: Math.max(0, Math.floor((Math.min(...ys) - reach + t.depth / 2) / cell)),
    j1: Math.min(g.rows - 1, Math.ceil((Math.max(...ys) + reach + t.depth / 2) / cell)),
  };
  stroke.touchHeights(rect);
  const n = stroke.noise;
  for (let j = rect.j0; j <= rect.j1; j++) {
    const y = sampleY(t, j);
    for (let i = rect.i0; i <= rect.i1; i++) {
      const x = sampleX(t, i);
      const hit = nearestOnPolyline(line, { x, y });
      if (!hit || hit.dist > reach) continue;
      const a = line[hit.segment];
      const b = line[hit.segment + 1];
      // Signed distance: positive to the left of the drawing direction
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const side = ((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x)) / len;
      const jitter = n.fbm(x, y, 10, 3, 'n5') * cell;
      const up = smooth(-cell * 0.75, cell * 0.75, side + jitter);
      // Fade out toward the ends of the reach so the cliff meets the land
      const fade = 1 - smooth(reach * 0.7, reach, hit.dist);
      const k = j * g.columns + i;
      const base = stroke.baseHeight(i, j);
      const keep = stroke.roadKeep(x, y);
      g.heights[k] = base + height * up * fade * keep * (0.85 + 0.15 * n.fbm(x, y, 30, 2));
    }
  }
  return rect;
}
