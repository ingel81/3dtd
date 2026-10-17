/**
 * The top of an object a tower can stand on: a house's roof, a wall's walk,
 * a castle tower's platform. The catalogue holds it per model as a grid of
 * heights over the model's bounds at scale 1 (`roof`, measured straight down
 * by tools/map-assets/measure_roofs.mjs); placed on the map it turns, scales
 * and stands where the renderer seats the model (object-seat.ts). The game's
 * columns, cursor pick and build rules read it (CustomMapSurface), so a
 * tower stands on a map's buildings as it does on the roofs of the 3D tiles.
 */
import { toModel } from './object-ground';

/** A model's top surface at scale 1 as the catalogue holds it */
export interface CatalogRoof {
  /** Model x and z of the grid's corner, m */
  x: number;
  z: number;
  /** Side of a cell, m */
  cell: number;
  columns: number;
  rows: number;
  /** Metres per unit of `heights` */
  step: number;
  /** One byte per cell, row by row along +z, base64; 0 where nothing carries (open ground, a floor) */
  heights: string;
}

const decoded = new WeakMap<CatalogRoof, Float32Array>();

/** The roof's heights at scale 1, m, NaN where nothing carries; decoded once per catalogue entry */
export function roofHeights(roof: CatalogRoof): Float32Array {
  let heights = decoded.get(roof);
  if (!heights) {
    const bytes = atob(roof.heights);
    heights = new Float32Array(roof.columns * roof.rows);
    for (let k = 0; k < heights.length; k++) {
      const v = k < bytes.length ? bytes.charCodeAt(k) : 0;
      heights[k] = v === 0 ? NaN : v * roof.step;
    }
    decoded.set(roof, heights);
  }
  return heights;
}

/** Bisection steps of a ray's hit: a cell of 0.5 m to under a millimetre */
const REFINE_STEPS = 12;

/**
 * A roof placed on the map: the model's grid turned by `rotation`, scaled
 * and lifted to `baseY` (the seat plus the object's own z). Map space
 * throughout: x, y on the ground, heights up.
 */
export class PlacedRoof {
  private readonly heights: Float32Array;
  private readonly cos: number;
  private readonly sin: number;
  /** Highest point at scale 1 */
  private readonly highest: number;
  /** Middle of the grid on the map and the radius round it that holds the whole grid */
  readonly cx: number;
  readonly cy: number;
  readonly radius: number;

  constructor(
    readonly roof: CatalogRoof,
    readonly x: number,
    readonly y: number,
    rotation: number,
    readonly scale: number,
    readonly baseY: number,
  ) {
    this.heights = roofHeights(roof);
    this.cos = Math.cos(rotation);
    this.sin = Math.sin(rotation);
    let highest = 0;
    for (const h of this.heights) if (h > highest) highest = h;
    this.highest = highest;
    // Model (x, z) to the map: the inverse of toModel
    const mx = (roof.x + (roof.columns * roof.cell) / 2) * scale;
    const mz = (roof.z + (roof.rows * roof.cell) / 2) * scale;
    this.cx = x - (mx * this.cos + mz * this.sin);
    this.cy = y - mx * this.sin + mz * this.cos;
    this.radius = (Math.hypot(roof.columns * roof.cell, roof.rows * roof.cell) / 2) * scale;
  }

  /** Highest point on the map, m */
  get top(): number {
    return this.baseY + this.highest * this.scale;
  }

  /** The roof's height over map (x, y), m; NaN where it has none */
  heightAt(x: number, y: number): number {
    // toModel, inline: the build rules ask per footprint probe and the editor's build areas per cell
    const dx = x - this.x;
    const dy = y - this.y;
    const h = this.modelHeight((-dx * this.cos - dy * this.sin) / this.scale, (-dx * this.sin + dy * this.cos) / this.scale);
    return Number.isNaN(h) ? NaN : this.baseY + h * this.scale;
  }

  /**
   * Where a map-space ray (origin ox, oy at height oh, direction dx, dy, dh)
   * first meets the roof, as its parameter t; -1 for a miss or beyond `far`.
   * Meeting the side of the grid under the roof (a facade) counts as a hit
   * at the roof's edge.
   */
  raycast(ox: number, oy: number, oh: number, dx: number, dy: number, dh: number, far: number): number {
    const s = this.scale;
    const o = toModel(ox - this.x, oy - this.y, this.cos, this.sin);
    const d = toModel(dx, dy, this.cos, this.sin);
    const ax = o.x / s;
    const az = o.z / s;
    const ah = (oh - this.baseY) / s;
    const bx = d.x / s;
    const bz = d.z / s;
    const bh = dh / s;
    const r = this.roof;
    let t0 = 0;
    let t1 = far;
    const clip = (a: number, b: number, lo: number, hi: number): boolean => {
      if (Math.abs(b) < 1e-12) return a >= lo && a <= hi;
      let u = (lo - a) / b;
      let v = (hi - a) / b;
      if (u > v) [u, v] = [v, u];
      if (u > t0) t0 = u;
      if (v < t1) t1 = v;
      return t0 <= t1;
    };
    if (!clip(ax, bx, r.x, r.x + r.columns * r.cell) || !clip(az, bz, r.z, r.z + r.rows * r.cell) || !clip(ah, bh, 0, this.highest + 0.01)) {
      return -1;
    }
    // Above the roof is positive; nothing to carry counts as far above
    const above = (t: number): number => {
      const h = this.modelHeight(ax + bx * t, az + bz * t);
      return Number.isNaN(h) ? Infinity : ah + bh * t - h;
    };
    if (above(t0) <= 0) return t0;
    // Half a cell across the ground per step; a ray straight down crosses no cells and needs only its ends
    const across = Math.hypot(bx, bz);
    const dt = across > 1e-9 ? (r.cell * 0.5) / across : t1 - t0;
    let prev = t0;
    for (let t = t0 + dt; ; t += dt) {
      const tc = Math.min(t, t1);
      if (above(tc) <= 0) {
        let lo = prev;
        let hi = tc;
        for (let n = 0; n < REFINE_STEPS; n++) {
          const mid = (lo + hi) / 2;
          if (above(mid) > 0) lo = mid;
          else hi = mid;
        }
        return hi;
      }
      if (tc >= t1) return -1;
      prev = tc;
    }
  }

  /**
   * Height at model (x, z), scale 1: between the four nearest cell middles
   * where all four carry, else the cell's own (NaN where it has none or
   * outside the grid)
   */
  private modelHeight(x: number, z: number): number {
    const r = this.roof;
    const fx = (x - r.x) / r.cell;
    const fz = (z - r.z) / r.cell;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= r.columns || j >= r.rows) return NaN;
    const own = this.heights[j * r.columns + i];
    if (Number.isNaN(own)) return NaN;
    const gx = fx - 0.5;
    const gz = fz - 0.5;
    const i0 = Math.floor(gx);
    const j0 = Math.floor(gz);
    if (i0 < 0 || j0 < 0 || i0 + 1 >= r.columns || j0 + 1 >= r.rows) return own;
    const k = j0 * r.columns + i0;
    const h00 = this.heights[k];
    const h10 = this.heights[k + 1];
    const h01 = this.heights[k + r.columns];
    const h11 = this.heights[k + r.columns + 1];
    // A NaN corner fails the sum: the edge of the roof keeps its own height
    if (Number.isNaN(h00 + h10 + h01 + h11)) return own;
    const u = gx - i0;
    const v = gz - j0;
    return (h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v;
  }
}
