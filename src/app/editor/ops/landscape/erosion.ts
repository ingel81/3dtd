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
      // Spread the change over the four corners of the cell left behind
      h[k] += change * (1 - u) * (1 - v);
      h[k + 1] += change * u * (1 - v);
      h[k + cols] += change * (1 - u) * v;
      h[k + cols + 1] += change * u * v;
      speed = Math.sqrt(Math.max(0, speed * speed - drop));
      water *= 1 - EVAPORATE;
      x = nx;
      y = ny;
    }
  }
  return rect;
}
