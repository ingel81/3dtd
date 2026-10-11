/**
 * Hydraulic erosion, simplified: rain drops land under the brush, run
 * downhill with some inertia, pick up soil where they speed up and drop it
 * where they slow down or the ground flattens. Painted mountains get gullies
 * and fans of scree. Each dab uses the stroke seed and its own number, so a
 * stroke erodes the same way every time.
 */
import type { MapPoint } from '../../../world/custom-map/map-document';
import { sampleRectAround, type GridRect } from '../../model/grid';
import type { BrushSettings } from '../brush';
import { hashCell } from './landscape-noise';
import type { LandscapeStroke } from './landscape-stroke';

const INERTIA = 0.3;
const CAPACITY = 4;
const ERODE = 0.3;
const DEPOSIT = 0.3;
const EVAPORATE = 0.04;
const STEPS = 40;

export function erosionDab(stroke: LandscapeStroke, center: MapPoint, brush: BrushSettings, dab: number): GridRect {
  const t = stroke.doc.terrain;
  const g = t.grid;
  const reach = brush.radius * 1.3;
  const rect = sampleRectAround(t, center.x, center.y, reach);
  stroke.touchHeights(rect);
  const h = g.heights;
  const cols = g.columns;
  const cell = g.cellSize;
  // Position in grid units
  const fi0 = (center.x + t.width / 2) / cell;
  const fj0 = (center.y + t.depth / 2) / cell;
  const r = brush.radius / cell;
  const drops = Math.max(4, Math.round(brush.radius * 1.5 * brush.strength));
  const inside = (i: number, j: number) => i >= rect.i0 && j >= rect.j0 && i < rect.i1 && j < rect.j1;

  for (let n = 0; n < drops; n++) {
    const angle = hashCell(dab, n, stroke.seed + 11) * Math.PI * 2;
    const dist = Math.sqrt(hashCell(dab, n, stroke.seed + 12)) * r;
    let x = fi0 + Math.cos(angle) * dist;
    let y = fj0 + Math.sin(angle) * dist;
    let dx = 0;
    let dy = 0;
    let speed = 1;
    let water = 1;
    let sediment = 0;
    for (let s = 0; s < STEPS; s++) {
      const i = Math.floor(x);
      const j = Math.floor(y);
      if (!inside(i, j)) break;
      const u = x - i;
      const v = y - j;
      const k = j * cols + i;
      const h00 = h[k];
      const h10 = h[k + 1];
      const h01 = h[k + cols];
      const h11 = h[k + cols + 1];
      const gx = (h10 - h00) * (1 - v) + (h11 - h01) * v;
      const gy = (h01 - h00) * (1 - u) + (h11 - h10) * u;
      const here = h00 * (1 - u) * (1 - v) + h10 * u * (1 - v) + h01 * (1 - u) * v + h11 * u * v;
      dx = dx * INERTIA - gx * (1 - INERTIA);
      dy = dy * INERTIA - gy * (1 - INERTIA);
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) break;
      dx /= len;
      dy /= len;
      const nx = x + dx;
      const ny = y + dy;
      const ni = Math.floor(nx);
      const nj = Math.floor(ny);
      if (!inside(ni, nj)) break;
      const nu = nx - ni;
      const nv = ny - nj;
      const nk = nj * cols + ni;
      const next =
        h[nk] * (1 - nu) * (1 - nv) + h[nk + 1] * nu * (1 - nv) + h[nk + cols] * (1 - nu) * nv + h[nk + cols + 1] * nu * nv;
      const drop = next - here;
      // Speed from the slope (drop per metre), not the raw drop, and capped: a steep peak must not fling drops
      const slope = drop / cell;
      const capacity = Math.max(-drop, 0.01) * speed * water * CAPACITY;
      let change: number;
      if (sediment > capacity || drop > 0) {
        // Uphill or overloaded: deposit
        change = drop > 0 ? Math.min(drop, sediment) : (sediment - capacity) * DEPOSIT;
        sediment -= change;
      } else {
        change = -Math.min((capacity - sediment) * ERODE * brush.strength, -drop);
        sediment -= change;
      }
      if (change > 0) {
        // Deposit on the four corners of the cell left behind
        h[k] += change * (1 - u) * (1 - v);
        h[k + 1] += change * u * (1 - v);
        h[k + cols] += change * (1 - u) * v;
        h[k + cols + 1] += change * u * v;
      } else {
        // Erode over a small disc, so a drop carves a gully and not a single pit
        spread(h, cols, x, y, change, rect);
      }
      speed = Math.min(MAX_SPEED, Math.sqrt(Math.max(0, speed * speed - slope)));
      water *= 1 - EVAPORATE;
      x = nx;
      y = ny;
    }
  }
  flattenSpikes(h, cols, rect, cell);
  return rect;
}

/** Cells a drop erodes around itself */
const ERODE_RADIUS = 2;
const MAX_SPEED = 4;

/** Adds `amount` (negative) over the samples within ERODE_RADIUS cells of (x, y), weighted toward the middle */
function spread(h: Float32Array, cols: number, x: number, y: number, amount: number, rect: GridRect): void {
  const i0 = Math.max(rect.i0, Math.ceil(x - ERODE_RADIUS));
  const i1 = Math.min(rect.i1, Math.floor(x + ERODE_RADIUS));
  const j0 = Math.max(rect.j0, Math.ceil(y - ERODE_RADIUS));
  const j1 = Math.min(rect.j1, Math.floor(y + ERODE_RADIUS));
  let total = 0;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) total += Math.max(0, ERODE_RADIUS - Math.hypot(i - x, j - y));
  if (total <= 0) return;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const w = Math.max(0, ERODE_RADIUS - Math.hypot(i - x, j - y));
      if (w > 0) h[j * cols + i] += (amount * w) / total;
    }
  }
}

/**
 * A sample standing far above (or below) all four neighbours is a needle the
 * drops left, not landscape: it goes to its neighbours' mean
 */
function flattenSpikes(h: Float32Array, cols: number, rect: GridRect, cell: number): void {
  const limit = cell * 0.75;
  for (let j = rect.j0 + 1; j < rect.j1; j++) {
    for (let i = rect.i0 + 1; i < rect.i1; i++) {
      const k = j * cols + i;
      const a = h[k - 1];
      const b = h[k + 1];
      const c = h[k - cols];
      const d = h[k + cols];
      const v = h[k];
      const lo = Math.min(a, b, c, d);
      const hi = Math.max(a, b, c, d);
      if (v > hi + limit || v < lo - limit) h[k] = (a + b + c + d) / 4;
    }
  }
}
