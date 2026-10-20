import type { BufferGeometry } from 'three';
import type { CatalogRoof } from '../../object-roof';

/**
 * Where a model stands at one height, on the cells of its top grid
 * (object-roof.ts): its horizontal section there, for the floors inside a
 * ruin (ruin-slabs.ts). The top grid alone is the outline seen from above,
 * which a battlement or eaves reach out past the walls below them; the
 * section is the walls themselves. Each row of cells is crossed at its
 * middle by the triangles' cuts through the height, and a cell lies inside
 * between the first and the last crossing, less a wall's thickness: what
 * stands inside (stairs, beams, a ruin's rubble) does not split a row, a
 * window or a breach only where both sides of the row are open.
 */

/** Taken off each end of a row's span, m (model, scale 1): the wall the outer faces enclose */
const WALL_THICKNESS = 0.3;

/** 1 per cell (row by row along +z, as the grid) inside the model's section at model height `y`, 0 outside */
export function modelSection(geometries: readonly BufferGeometry[], roof: CatalogRoof, y: number): Uint8Array {
  const { columns, rows, cell } = roof;
  // The cuts through the height: segments (x0, z0, x1, z1)
  const cuts: number[] = [];
  const at: number[] = [];
  for (const g of geometries) {
    const p = g.getAttribute('position');
    if (!p) continue;
    const index = g.index;
    const n = index ? index.count : p.count;
    for (let t = 0; t + 2 < n; t += 3) {
      at.length = 0;
      for (let e = 0; e < 3; e++) {
        const a = index ? index.getX(t + e) : t + e;
        const b = index ? index.getX(t + ((e + 1) % 3)) : t + ((e + 1) % 3);
        const ya = p.getY(a);
        const yb = p.getY(b);
        if (ya <= y === yb <= y) continue;
        const k = (y - ya) / (yb - ya);
        at.push(p.getX(a) + (p.getX(b) - p.getX(a)) * k, p.getZ(a) + (p.getZ(b) - p.getZ(a)) * k);
      }
      if (at.length === 4) cuts.push(at[0], at[1], at[2], at[3]);
    }
  }
  const out = new Uint8Array(columns * rows);
  const xs: number[] = [];
  for (let j = 0; j < rows; j++) {
    const z = roof.z + (j + 0.5) * cell;
    xs.length = 0;
    for (let s = 0; s < cuts.length; s += 4) {
      const z0 = cuts[s + 1];
      const z1 = cuts[s + 3];
      if (z0 <= z === z1 <= z) continue;
      xs.push(cuts[s] + ((cuts[s + 2] - cuts[s]) * (z - z0)) / (z1 - z0));
    }
    if (xs.length < 2) continue;
    let lo = Infinity;
    let hi = -Infinity;
    for (const x of xs) {
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
    const i0 = Math.max(0, Math.ceil((lo + WALL_THICKNESS - roof.x) / cell - 0.5));
    const i1 = Math.min(columns - 1, Math.floor((hi - WALL_THICKNESS - roof.x) / cell - 0.5));
    for (let i = i0; i <= i1; i++) out[j * columns + i] = 1;
  }
  return out;
}
