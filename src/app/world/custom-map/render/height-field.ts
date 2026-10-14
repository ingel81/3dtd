import type { Ray, Vector3 } from 'three';
import type { MapHeightGrid } from '../map-document';

/**
 * Height queries on a map's height grid, in map space.
 *
 * The terrain mesh splits every grid cell into two triangles along the
 * diagonal `cellSplit` picks from its four corner heights, and `heightAt`
 * interpolates on those same two triangles (`cellHeight`), so a query lands
 * exactly on the surface the finest LOD shows. Points outside the grid take
 * the height of the nearest edge.
 *
 * Reads `grid.heights` live: after the editor changes heights, queries see
 * them at once.
 */
/**
 * Whether a cell splits along its main diagonal, sample (i, j) to
 * (i + 1, j + 1), rather than (i + 1, j) to (i, j + 1): along the diagonal
 * whose ends differ less in height, the main one on a tie. A pure function
 * of the four corner heights, shared by the mesh, the shaders, the sim and
 * the shore cut.
 *
 * Why: with one fixed diagonal, a wall rising inside a cell (a pit, a
 * cliff) gets a notch at every other sample of its edge, where the odd
 * corner shares a triangle with its neighbours or not: saw teeth. The
 * shorter diagonal always cuts the odd corner off on its own triangle, so
 * the edge runs as an even chamfer from cell to cell.
 */
export function cellSplit(h00: number, h10: number, h01: number, h11: number): boolean {
  return Math.abs(h00 - h11) <= Math.abs(h10 - h01);
}

/**
 * Height inside a cell at (u, v) in [0, 1] (u along i, v along j), on the
 * two triangles `cellSplit` picks.
 */
export function cellHeight(h00: number, h10: number, h01: number, h11: number, u: number, v: number): number {
  if (Math.abs(h00 - h11) <= Math.abs(h10 - h01)) {
    return u >= v ? h00 + u * (h10 - h00) + v * (h11 - h10) : h00 + v * (h01 - h00) + u * (h11 - h01);
  }
  return u + v <= 1 ? h00 + u * (h10 - h00) + v * (h01 - h00) : h11 + (1 - u) * (h01 - h11) + (1 - v) * (h10 - h11);
}

export class HeightField {
  readonly columns: number;
  readonly rows: number;
  readonly cellSize: number;
  /** Map position of sample (0, 0) */
  readonly originX: number;
  readonly originY: number;

  constructor(
    readonly grid: MapHeightGrid,
    width: number,
    depth: number,
  ) {
    this.columns = grid.columns;
    this.rows = grid.rows;
    this.cellSize = grid.cellSize;
    this.originX = -width / 2;
    this.originY = -depth / 2;
  }

  /** Height of sample (i, j), clamped to the grid */
  sample(i: number, j: number): number {
    const ci = i < 0 ? 0 : i >= this.columns ? this.columns - 1 : i;
    const cj = j < 0 ? 0 : j >= this.rows ? this.rows - 1 : j;
    return this.grid.heights[cj * this.columns + ci];
  }

  /** Surface height at map point (x, y); allocation-free */
  heightAt(x: number, y: number): number {
    const h = this.grid.heights;
    const cols = this.columns;
    let fx = (x - this.originX) / this.cellSize;
    let fy = (y - this.originY) / this.cellSize;
    const maxX = cols - 1;
    const maxY = this.rows - 1;
    fx = fx < 0 ? 0 : fx > maxX ? maxX : fx;
    fy = fy < 0 ? 0 : fy > maxY ? maxY : fy;
    let i = Math.floor(fx);
    let j = Math.floor(fy);
    if (i >= maxX) i = maxX - 1;
    if (j >= maxY) j = maxY - 1;
    const u = fx - i;
    const v = fy - j;
    const k = j * cols + i;
    return cellHeight(h[k], h[k + 1], h[k + cols], h[k + cols + 1], u, v);
  }

  /**
   * Smooth surface normal at map point (x, y) in map space (x east, y north,
   * z up), from central differences over one cell. `target` gets x, y, z.
   */
  normalAt(x: number, y: number, target: { x: number; y: number; z: number }): typeof target {
    const d = this.cellSize;
    const dx = this.heightAt(x + d, y) - this.heightAt(x - d, y);
    const dy = this.heightAt(x, y + d) - this.heightAt(x, y - d);
    const nx = -dx;
    const ny = -dy;
    const nz = 2 * d;
    const len = Math.hypot(nx, ny, nz);
    target.x = nx / len;
    target.y = ny / len;
    target.z = nz / len;
    return target;
  }

  /** Slope at map point (x, y) in degrees */
  slopeAt(x: number, y: number): number {
    const d = this.cellSize;
    const dx = (this.heightAt(x + d, y) - this.heightAt(x - d, y)) / (2 * d);
    const dy = (this.heightAt(x, y + d) - this.heightAt(x, y - d)) / (2 * d);
    return (Math.atan(Math.hypot(dx, dy)) * 180) / Math.PI;
  }

  /**
   * A point on the surface ahead of scene-space `origin` along the
   * horizontal part of `direction`, into `target` (may be `origin`): about
   * one and a half times the height above the ground away (50 to 600 m),
   * no further than where the look leaves the map, and on the map. For when
   * a view ray misses the surface: on a small map a lowered camera often
   * looks past the far edge, and the camera itself is no ground to centre
   * the sun's shadow box on.
   */
  groundAhead(origin: Vector3, direction: Vector3, target: Vector3): void {
    const minX = this.originX;
    const maxX = this.originX + (this.columns - 1) * this.cellSize;
    const minY = this.originY;
    const maxY = this.originY + (this.rows - 1) * this.cellSize;
    const ox = -origin.x;
    const oy = origin.z;
    let distance = Math.min(600, Math.max(50, (origin.y - this.heightAt(ox, oy)) * 1.5));
    const length = Math.hypot(direction.x, direction.z);
    const dx = length > 1e-6 ? -direction.x / length : 0;
    const dy = length > 1e-6 ? direction.z / length : 0;
    if (ox >= minX && ox <= maxX && oy >= minY && oy <= maxY) {
      const exitX = dx > 0 ? (maxX - ox) / dx : dx < 0 ? (minX - ox) / dx : Infinity;
      const exitY = dy > 0 ? (maxY - oy) / dy : dy < 0 ? (minY - oy) / dy : Infinity;
      distance = Math.min(distance, exitX, exitY);
    }
    const x = Math.min(maxX, Math.max(minX, ox + dx * distance));
    const y = Math.min(maxY, Math.max(minY, oy + dy * distance));
    target.set(-x, this.heightAt(x, y), y);
  }

  /**
   * First hit of a scene-space ray with the surface, or null. Marches in
   * steps of half a cell inside the map and refines the crossing by
   * bisection; `maxDistance` limits the march.
   */
  raycast(ray: Ray, target: Vector3, maxDistance = 20000): number | null {
    const o = ray.origin;
    const dir = ray.direction;
    // Clip the ray to the map's box in x/z (scene x = -map x)
    const minX = -(this.originX + (this.columns - 1) * this.cellSize);
    const maxX = -this.originX;
    const minZ = this.originY;
    const maxZ = this.originY + (this.rows - 1) * this.cellSize;
    let t0 = 0;
    let t1 = maxDistance;
    const clip = (origin: number, d: number, lo: number, hi: number): boolean => {
      if (Math.abs(d) < 1e-12) return origin >= lo && origin <= hi;
      let a = (lo - origin) / d;
      let b = (hi - origin) / d;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
      return t0 <= t1;
    };
    if (!clip(o.x, dir.x, minX, maxX) || !clip(o.z, dir.z, minZ, maxZ)) return null;

    const above = (t: number): number => o.y + dir.y * t - this.heightAt(-(o.x + dir.x * t), o.z + dir.z * t);
    const step = this.cellSize * 0.5;
    let prevT = t0;
    if (above(prevT) < 0) return null; // starts below the surface
    for (let t = t0 + step; ; t += step) {
      const tc = Math.min(t, t1);
      const cur = above(tc);
      if (cur <= 0) {
        let lo = prevT;
        let hi = tc;
        for (let n = 0; n < 24; n++) {
          const mid = (lo + hi) / 2;
          if (above(mid) > 0) lo = mid;
          else hi = mid;
        }
        ray.at(hi, target);
        return hi;
      }
      if (tc >= t1) return null;
      prevT = tc;
    }
  }
}
