import { BufferAttribute, BufferGeometry, Mesh, type Material } from 'three';
import type { MapWater } from '../../map-document';
import type { HeightField } from '../height-field';

/**
 * Land beyond the map's edge, so a camera that looks past the border sees
 * hills fading into the fog instead of the void.
 *
 * Rings of growing rectangles around the map, one point per border sample.
 * The innermost ring sits exactly on the terrain's edge; further out the
 * border's height profile is blurred along the edge with a radius that
 * grows with the distance (a river valley at the border widens and fills
 * up, a ridge flattens) and drifts towards gentle noise hills a little
 * below the map. Water that leaves the map runs on over the same profile
 * (water-surface.ts, `ApronProfile`), so the river ends where its blurred
 * bed rises above the water. Where the border is under the main water, the
 * apron's floor stays below it: a coast or an island lies in the sea.
 *
 * Drawn with the terrain material (the shader paints it with the first
 * layer); not part of the map for line of sight or queries.
 */

/** Distances of the rings from the border, metres */
export const APRON_RINGS = [0, 12, 40, 100, 220, 450, 900, 1600, 3000];
/** Water may extend over the rings up to this distance */
export const RIVER_REACH = 220;

export class ApronProfile {
  /** Ring points as (side, fraction along the side), counter-clockwise from the south-west corner */
  readonly along: [number, number][] = [];
  private readonly heights: Float32Array;
  private readonly w: number;
  private readonly d: number;

  /** Share of the border that lies under the main water: above one half the map is an island or a coast */
  readonly wetShare: number;

  constructor(
    private readonly field: HeightField,
    water: MapWater | null = null,
  ) {
    this.w = (field.columns - 1) * field.cellSize;
    this.d = (field.rows - 1) * field.cellSize;
    for (let side = 0; side < 4; side++) {
      const n = side % 2 === 0 ? field.columns - 1 : field.rows - 1;
      for (let k = 0; k < n; k++) this.along.push([side, k / n]);
    }
    const n = this.along.length;
    const border = new Float64Array(n);
    let mean = 0;
    this.along.forEach(([side, f], k) => {
      const [x, y] = this.point(side, f, 0);
      border[k] = field.heightAt(x, y);
      mean += border[k] / n;
    });
    // Circular prefix sums for the growing blur along the edge
    const prefix = new Float64Array(n + 1);
    for (let k = 0; k < n; k++) prefix[k + 1] = prefix[k] + border[k];
    const sum = (lo: number, hi: number): number => prefix[hi + 1] - prefix[lo];
    const windowMean = (k: number, r: number): number => {
      if (r <= 0) return border[k];
      const a = k - r;
      const b = k + r;
      let s: number;
      if (a < 0) s = sum(n + a, n - 1) + sum(0, b);
      else if (b >= n) s = sum(a, n - 1) + sum(0, b - n);
      else s = sum(a, b);
      return s / (2 * r + 1);
    };
    // A coast or an island: where the border is under water, the sea goes on and its floor sinks away
    let wet = 0;
    const wetAt = new Uint8Array(n);
    if (water) {
      this.along.forEach(([side, f], k) => {
        const [x, y] = this.point(side, f, 0);
        const i = Math.round((x - field.originX) / field.cellSize);
        const j = Math.round((y - field.originY) / field.cellSize);
        if (water.mask[j * field.columns + i] && border[k] < water.level) {
          wetAt[k] = 1;
          wet++;
        }
      });
    }
    this.wetShare = n ? wet / n : 0;
    this.heights = new Float32Array(APRON_RINGS.length * n);
    APRON_RINGS.forEach((dist, r) => {
      const radius = Math.min(Math.floor(n / 4), Math.round((dist * 0.6) / field.cellSize));
      const keep = Math.exp(-dist / 300);
      this.along.forEach(([side, f], k) => {
        const [x, y] = this.point(side, f, dist);
        const hills = mean - 4 + (smoothNoise(x * 0.004, y * 0.004) - 0.5) * 40 * Math.min(1, dist / 600);
        let h = windowMean(k, radius) * keep + hills * (1 - keep);
        // Sea beyond a wet border (and everywhere around a mostly wet one): the floor falls off
        if (water && r > 0 && (wetAt[k] || this.wetShare > 0.5)) h = Math.min(h, water.level - 1.5 - dist * 0.01);
        this.heights[r * n + k] = h;
      });
    });
  }

  get count(): number {
    return this.along.length;
  }

  /** Height of ring r at point k */
  height(r: number, k: number): number {
    return this.heights[r * this.along.length + k];
  }

  /** Map position of point k on ring r */
  position(r: number, k: number): [number, number] {
    const [side, f] = this.along[k];
    return this.point(side, f, APRON_RINGS[r]);
  }

  /** Point at fraction f along a side of the map rectangle grown by `grow` metres */
  private point(side: number, f: number, grow: number): [number, number] {
    const ax = this.field.originX - grow;
    const ay = this.field.originY - grow;
    const W = this.w + 2 * grow;
    const D = this.d + 2 * grow;
    switch (side) {
      case 0:
        return [ax + f * W, ay];
      case 1:
        return [ax + W, ay + f * D];
      case 2:
        return [ax + W - f * W, ay + D];
      default:
        return [ax, ay + D - f * D];
    }
  }
}

export function buildTerrainApron(profile: ApronProfile, material: Material): Mesh {
  const n = profile.count;
  const pos = new Float32Array(APRON_RINGS.length * n * 3);
  for (let r = 0; r < APRON_RINGS.length; r++) {
    for (let k = 0; k < n; k++) {
      const [x, y] = profile.position(r, k);
      const v = (r * n + k) * 3;
      pos[v] = -x;
      pos[v + 1] = profile.height(r, k);
      pos[v + 2] = y;
    }
  }
  const index: number[] = [];
  for (let r = 0; r < APRON_RINGS.length - 1; r++) {
    for (let k = 0; k < n; k++) {
      const a = r * n + k;
      const b = r * n + ((k + 1) % n);
      const c = (r + 1) * n + k;
      const e = (r + 1) * n + ((k + 1) % n);
      // Points run counter-clockwise in map space; scene x is mirrored, so this winding faces up
      index.push(a, c, b, b, c, e);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const mesh = new Mesh(g, material);
  mesh.name = 'custom-map-apron';
  mesh.receiveShadow = true;
  mesh.userData['losTransparent'] = true;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/** Smooth value noise in 0..1 */
function smoothNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const r = (i: number, j: number): number => {
    const n = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  return (
    r(xi, yi) * (1 - u) * (1 - v) + r(xi + 1, yi) * u * (1 - v) + r(xi, yi + 1) * (1 - u) * v + r(xi + 1, yi + 1) * u * v
  );
}
