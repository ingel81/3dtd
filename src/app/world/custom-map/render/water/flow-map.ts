import type { MapWater } from '../../map-document';
import type { HeightField } from '../height-field';

/**
 * Baked flow of an area water body, one RG byte pair per height sample:
 * where its surface drifts, in scene x and z (127.5 is still,
 * FLOW_MAP_MAX m/s at 0 and 255). The water material moves its waves along
 * it in two phases that cross-fade (water-material.ts), so nothing is
 * simulated.
 *
 * - Water, sea and swamp circulate along their banks: the flow runs along
 *   the shore's contour (across the gradient of the distance to the shore),
 *   still right at the bank where the water piles up, fastest a few cells
 *   out, slow in open water; narrows speed up (the distance field is
 *   steep there), islands get a current around them.
 * - Lava turns over in convection cells (a divergence-free field of cells
 *   about 30 m wide, wobbled by noise), slowing towards its banks.
 *
 * Baked from the mask and the heights on load and whenever the body is
 * set again (the editor's pool brush); a 513² grid takes a few ms.
 */

/** Flow speed at the ends of the byte range, m/s */
export const FLOW_MAP_MAX = 1.2;

export function bakeFlowMap(field: HeightField, water: MapWater, out?: Uint8Array): Uint8Array {
  const cols = field.columns;
  const rows = field.rows;
  const n = cols * rows;
  const flow = out && out.length === n * 2 ? out : new Uint8Array(n * 2);
  const lava = water.kind === 'lava';
  // Distance to the shore in cells (chamfer 3-4 over the wet samples)
  const dist = new Float32Array(n);
  const big = 1e9;
  for (let k = 0; k < n; k++) {
    const i = k % cols;
    const j = (k / cols) | 0;
    dist[k] = water.mask[k] && field.sample(i, j) < water.level ? big : 0;
  }
  const relax = (k: number, other: number, step: number): void => {
    const d = dist[other] + step;
    if (d < dist[k]) dist[k] = d;
  };
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      if (!dist[k]) continue;
      if (i > 0) relax(k, k - 1, 3);
      if (j > 0) {
        relax(k, k - cols, 3);
        if (i > 0) relax(k, k - cols - 1, 4);
        if (i < cols - 1) relax(k, k - cols + 1, 4);
      }
    }
  }
  for (let j = rows - 1; j >= 0; j--) {
    for (let i = cols - 1; i >= 0; i--) {
      const k = j * cols + i;
      if (!dist[k]) continue;
      if (i < cols - 1) relax(k, k + 1, 3);
      if (j < rows - 1) {
        relax(k, k + cols, 3);
        if (i < cols - 1) relax(k, k + cols + 1, 4);
        if (i > 0) relax(k, k + cols - 1, 4);
      }
    }
  }
  // Water reaching the grid's edge goes on beyond it: no shore there
  for (let k = 0; k < n; k++) dist[k] = dist[k] >= big ? 60 : dist[k] / 3;
  const at = (i: number, j: number): number => dist[Math.min(rows - 1, Math.max(0, j)) * cols + Math.min(cols - 1, Math.max(0, i))];
  const cell = field.cellSize;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      let fx = 0;
      let fy = 0;
      const d = dist[k];
      if (d > 0) {
        // Metres from the bank: still right at it, then a current
        const m = d * cell;
        if (lava) {
          // Convection cells: the curl of a field of bumps about 30 m apart, so the crust neither gathers nor tears
          const x = field.originX + i * cell;
          const y = field.originY + j * cell;
          const w = 0.6 * Math.sin(x * 0.013 + y * 0.021);
          const kx = (2 * Math.PI) / 30;
          // psi = sin(kx (x + w)) sin(kx (y - w)); flow = (dpsi/dy, -dpsi/dx)
          const sx = Math.sin(kx * (x + w * 8));
          const cx = Math.cos(kx * (x + w * 8));
          const sy = Math.sin(kx * (y - w * 8));
          const cy = Math.cos(kx * (y - w * 8));
          fx = sx * cy * 0.35;
          fy = -cx * sy * 0.35;
          const near = Math.min(1, m / 6);
          fx *= near;
          fy *= near;
        } else {
          // Along the bank's contour: across the gradient of the distance to the shore
          const gx = (at(i + 1, j) - at(i - 1, j)) / 2;
          const gy = (at(i, j + 1) - at(i, j - 1)) / 2;
          const g = Math.hypot(gx, gy);
          if (g > 1e-4) {
            const speed = 0.45 * Math.min(1, m / 4) * Math.exp(-m / 40) * Math.min(1.6, g * 1.3);
            fx = (-gy / g) * speed;
            fy = (gx / g) * speed;
          }
        }
      }
      // Scene x is map -x
      flow[k * 2] = encode(-fx);
      flow[k * 2 + 1] = encode(fy);
    }
  }
  return flow;
}

function encode(v: number): number {
  return Math.max(0, Math.min(255, Math.round(127.5 + (v / FLOW_MAP_MAX) * 127.5)));
}

/** The flow a byte pair stands for (scene x, z), m/s; the shader decodes the same way */
export function decodeFlow(r: number, g: number): [number, number] {
  return [((r - 127.5) / 127.5) * FLOW_MAP_MAX, ((g - 127.5) / 127.5) * FLOW_MAP_MAX];
}
