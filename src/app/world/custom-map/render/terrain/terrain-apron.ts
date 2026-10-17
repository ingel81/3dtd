import { BufferAttribute, BufferGeometry, Mesh, type Material } from 'three';
import type { MapBiome, MapWater } from '../../map-document';
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
 * Further out a range of mountains rises (`backdrop` metres high at most,
 * by the map's look, BACKDROP_HEIGHT), so no map visibly ends in flat land:
 * from BACKDROP_FROM to BACKDROP_FULL metres beyond the border, ridged
 * noise along it. Not over the sea, whose floor falls away.
 *
 * Drawn with the terrain material (the shader paints it with the border's
 * natural ground, apron-paint.ts); not part of the map for line of sight or
 * queries.
 */

/**
 * Distances of the rings from the border, metres: dense where the backdrop
 * range stands (every 80 to 160 m), so its ridges and gullies have flanks
 * the light can shade instead of three facets from foot to crest
 */
export const APRON_RINGS = [0, 12, 40, 100, 220, 300, 380, 460, 540, 620, 700, 790, 880, 980, 1090, 1210, 1340, 1480, 1640, 2200, 3000];
/** Water may extend over the rings up to this distance */
export const RIVER_REACH = 220;
/**
 * A wet stretch of the border at least this long (metres) is a coast whose sea goes on; a shorter one is a river's
 * mouth: its water runs on over the blurred profile and ends where the bed rises above it, the valley fills up and
 * the backdrop range closes over it, instead of a slot as wide as the river cut through the apron to the horizon
 */
export const SEA_RUN = 160;
/** Metres beyond the border where the backdrop range starts to rise, and where it reaches its height */
const BACKDROP_FROM = 250;
const BACKDROP_FULL = 900;

/** Height of the backdrop range by the map's look, metres: high peaks round a mountain map, low hills round a swamp */
export const BACKDROP_HEIGHT: Record<MapBiome, number> = {
  temperate: 160,
  mountain: 420,
  arctic: 260,
  desert: 140,
  swamp: 40,
  city: 90,
  hell: 220,
  apocalypse: 100,
  moon: 80,
  mars: 200,
};

/** The height terms of an apron that come from its points' places (ApronProfile.shape), for one map size and backdrop */
interface ApronShape {
  key: string;
  hills: Float64Array;
  ridges: Float64Array | null;
}
/** The last map's shape: the editor's map and the game's, one at a time */
let shapeCache: ApronShape | null = null;

export class ApronProfile {
  /** Ring points as (side, fraction along the side), counter-clockwise from the south-west corner */
  readonly along: [number, number][] = [];
  private readonly heights: Float32Array;
  private readonly w: number;
  private readonly d: number;

  /** Height the backdrop range rises from: the apron's hills, a little below the border's mean */
  readonly base: number;

  /** Share of the border that lies under the main water: above one half the map is an island or a coast */
  readonly wetShare: number;
  /** Border points under the main water, and its level (null: no water) */
  private readonly wet: Uint8Array;
  private readonly waterLevel: number | null;

  constructor(
    private readonly field: HeightField,
    water: MapWater | null = null,
    /** Highest the backdrop range rises, metres (BACKDROP_HEIGHT); 0 none */
    backdrop = 0,
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
    this.base = mean - 4;
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
    const sea = seaStretches(wetAt, Math.ceil(SEA_RUN / field.cellSize));
    this.wet = wetAt;
    this.waterLevel = water ? water.level : null;
    this.heights = new Float32Array(APRON_RINGS.length * n);
    const shape = this.shape(backdrop);
    APRON_RINGS.forEach((dist, r) => {
      const radius = Math.min(Math.floor(n / 4), Math.round((dist * 0.6) / field.cellSize));
      const keep = Math.exp(-dist / 300);
      for (let k = 0; k < n; k++) {
        const hills = this.base + shape.hills[r * n + k];
        let h = windowMean(k, radius) * keep + hills * (1 - keep);
        if (shape.ridges) h += shape.ridges[r * n + k];
        // Sea beyond a coast (and everywhere around a mostly wet border): the floor falls off; a river's mouth keeps the profile
        if (water && r > 0 && (sea[k] || this.wetShare > 0.5)) h = Math.min(h, water.level - 1.5 - dist * 0.01);
        this.heights[r * n + k] = h;
      }
    });
  }

  /**
   * What the heights take from where the points lie, not from the border:
   * the hills' noise and the backdrop range, by ring and point. The same for
   * every profile of a map size and backdrop, so kept for the next (a brush
   * at the border makes a profile each frame of its stroke; the noise was
   * most of its 27 ms on a 1024 m map)
   */
  private shape(backdrop: number): ApronShape {
    const n = this.along.length;
    const key = `${this.w}|${this.d}|${n}|${backdrop}`;
    if (shapeCache?.key === key) return shapeCache;
    const hills = new Float64Array(APRON_RINGS.length * n);
    const ridges = backdrop > 0 ? new Float64Array(APRON_RINGS.length * n) : null;
    APRON_RINGS.forEach((dist, r) => {
      this.along.forEach(([side, f], k) => {
        const [x, y] = this.point(side, f, dist);
        hills[r * n + k] = (smoothNoise(x * 0.004, y * 0.004) - 0.5) * 40 * Math.min(1, dist / 600);
        if (!ridges) return;
        // Ridges along the border at three scales, the peaks where they crest; the finest cuts spurs and
        // gullies into the flanks
        const ridge = (f: number) => 1 - Math.abs(2 * smoothNoise(x * f + 17.3, y * f - 4.1) - 1);
        const crest = Math.pow(0.58 * ridge(1 / 350) + 0.3 * ridge(1 / 140) + 0.12 * ridge(1 / 60), 1.5);
        ridges[r * n + k] = backdrop * smoothstepRange(BACKDROP_FROM, BACKDROP_FULL, dist) * (0.3 + 0.7 * crest);
      });
    });
    shapeCache = { key, hills, ridges };
    return shapeCache;
  }

  get count(): number {
    return this.along.length;
  }

  /** Height of ring r at point k */
  height(r: number, k: number): number {
    return this.heights[r * this.along.length + k];
  }

  /**
   * Height of the apron at a map point beyond the border (the map's own
   * height inside it): between the two rings around its distance, along the
   * side it lies off
   */
  heightAt(x: number, y: number): number {
    const f = this.field;
    const x0 = f.originX;
    const y0 = f.originY;
    const ex = Math.max(x0 - x, x - (x0 + this.w));
    const ey = Math.max(y0 - y, y - (y0 + this.d));
    const dist = Math.max(ex, ey);
    if (dist <= 0) return f.heightAt(x, y);
    const side = ey >= ex ? (y < y0 ? 0 : 2) : x > x0 + this.w ? 1 : 3;
    let r = 0;
    while (r < APRON_RINGS.length - 2 && APRON_RINGS[r + 1] < dist) r++;
    const t = Math.min(1, (dist - APRON_RINGS[r]) / (APRON_RINGS[r + 1] - APRON_RINGS[r]));
    return this.onRing(r, side, x, y) * (1 - t) + this.onRing(r + 1, side, x, y) * t;
  }

  /**
   * Whether the main water covers a point beyond the border, as the water
   * surface runs it on (water-surface.ts): off a wet stretch of the border,
   * or anywhere round a map that is mostly sea, where the apron's ground
   * lies below the level plus `margin`. False inside the map
   */
  underWater(x: number, y: number, margin = 0): boolean {
    if (this.waterLevel === null) return false;
    const f = this.field;
    const ex = Math.max(f.originX - x, x - (f.originX + this.w));
    const ey = Math.max(f.originY - y, y - (f.originY + this.d));
    if (Math.max(ex, ey) <= 0) return false;
    const side = ey >= ex ? (y < f.originY ? 0 : 2) : x > f.originX + this.w ? 1 : 3;
    const k = Math.round(this.alongIndex(0, side, x, y)) % this.along.length;
    if (this.wetShare <= 0.5 && !this.wet[k]) return false;
    return this.heightAt(x, y) < this.waterLevel + margin;
  }

  /** Height of ring r off `side` at the point of it across from map (x, y) */
  private onRing(r: number, side: number, x: number, y: number): number {
    const n = this.along.length;
    const at = this.alongIndex(r, side, x, y);
    const k = Math.floor(at);
    const u = at - k;
    return this.height(r, k % n) * (1 - u) + this.height(r, (k + 1) % n) * u;
  }

  /** Index (with fraction) along the rings of the point of ring r off `side` across from map (x, y) */
  private alongIndex(r: number, side: number, x: number, y: number): number {
    const grow = APRON_RINGS[r];
    const W = this.w + 2 * grow;
    const D = this.d + 2 * grow;
    const ax = this.field.originX - grow;
    const ay = this.field.originY - grow;
    // Fraction along the side as point() runs it
    const f = side === 0 ? (x - ax) / W : side === 1 ? (y - ay) / D : side === 2 ? (ax + W - x) / W : (ay + D - y) / D;
    const cols = this.field.columns - 1;
    const rows = this.field.rows - 1;
    const start = side === 0 ? 0 : side === 1 ? cols : side === 2 ? cols + rows : 2 * cols + rows;
    const count = side % 2 === 0 ? cols : rows;
    return start + Math.min(1, Math.max(0, f)) * count;
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
  const g = new BufferGeometry();
  writeApronGeometry(g, profile);
  const mesh = new Mesh(g, material);
  mesh.name = 'custom-map-apron';
  mesh.receiveShadow = true;
  mesh.userData['losTransparent'] = true;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

/**
 * Writes `profile`'s rings into `g`: positions, normals and bounds, in place
 * when `g` holds as many points (a brush at the border rebuilds the apron
 * every frame of its stroke; a new geometry, its index and three's
 * computeVertexNormals over some 170 000 triangles cost a 1024 m map 25 ms
 * of each), a new layout otherwise. The normals as computeVertexNormals
 * makes them, straight on the arrays.
 */
export function writeApronGeometry(g: BufferGeometry, profile: ApronProfile): void {
  const n = profile.count;
  const rings = APRON_RINGS.length;
  let position = g.getAttribute('position') as BufferAttribute | undefined;
  let normal = g.getAttribute('normal') as BufferAttribute | undefined;
  if (!position || !normal || position.count !== rings * n) {
    position = new BufferAttribute(new Float32Array(rings * n * 3), 3);
    normal = new BufferAttribute(new Float32Array(rings * n * 3), 3);
    g.setAttribute('position', position);
    g.setAttribute('normal', normal);
    g.setIndex(new BufferAttribute(apronIndex(n, rings), 1));
  }
  const pos = position.array as Float32Array;
  for (let r = 0; r < rings; r++) {
    for (let k = 0; k < n; k++) {
      const [x, y] = profile.position(r, k);
      const v = (r * n + k) * 3;
      pos[v] = -x;
      pos[v + 1] = profile.height(r, k);
      pos[v + 2] = y;
    }
  }
  // three's computeVertexNormals on the arrays: each face's normal, area weighted, summed at its corners
  const nor = normal.array as Float32Array;
  nor.fill(0);
  const index = g.getIndex()!.array;
  for (let t = 0; t < index.length; t += 3) {
    const ia = index[t] * 3;
    const ib = index[t + 1] * 3;
    const ic = index[t + 2] * 3;
    const ux = pos[ic] - pos[ib];
    const uy = pos[ic + 1] - pos[ib + 1];
    const uz = pos[ic + 2] - pos[ib + 2];
    const wx = pos[ia] - pos[ib];
    const wy = pos[ia + 1] - pos[ib + 1];
    const wz = pos[ia + 2] - pos[ib + 2];
    const nx = uy * wz - uz * wy;
    const ny = uz * wx - ux * wz;
    const nz = ux * wy - uy * wx;
    nor[ia] += nx;
    nor[ia + 1] += ny;
    nor[ia + 2] += nz;
    nor[ib] += nx;
    nor[ib + 1] += ny;
    nor[ib + 2] += nz;
    nor[ic] += nx;
    nor[ic + 1] += ny;
    nor[ic + 2] += nz;
  }
  for (let v = 0; v < nor.length; v += 3) {
    const len = Math.sqrt(nor[v] * nor[v] + nor[v + 1] * nor[v + 1] + nor[v + 2] * nor[v + 2]) || 1;
    nor[v] /= len;
    nor[v + 1] /= len;
    nor[v + 2] /= len;
  }
  position.needsUpdate = true;
  normal.needsUpdate = true;
  g.computeBoundingSphere();
}

/** The apron's triangles: between each ring and the next, two per point, counter-clockwise in map space */
function apronIndex(n: number, rings: number): Uint16Array | Uint32Array {
  const index = rings * n > 65535 ? new Uint32Array((rings - 1) * n * 6) : new Uint16Array((rings - 1) * n * 6);
  let q = 0;
  for (let r = 0; r < rings - 1; r++) {
    for (let k = 0; k < n; k++) {
      const a = r * n + k;
      const b = r * n + ((k + 1) % n);
      const c = (r + 1) * n + k;
      const e = (r + 1) * n + ((k + 1) % n);
      // Points run counter-clockwise in map space; scene x is mirrored, so this winding faces up
      index[q++] = a;
      index[q++] = c;
      index[q++] = b;
      index[q++] = b;
      index[q++] = c;
      index[q++] = e;
    }
  }
  return index;
}

/** 0 below `a`, 1 above `b`, smooth between */
function smoothstepRange(a: number, b: number, v: number): number {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
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

/** The wet border points that belong to a run of at least `length` wet points (the border is a closed ring) */
function seaStretches(wet: Uint8Array, length: number): Uint8Array {
  const n = wet.length;
  const out = new Uint8Array(n);
  const start = wet.indexOf(0);
  if (start < 0) return out.fill(1);
  // From a dry point once round the ring: each run of wet points is marked when it ends
  let run = 0;
  for (let i = 1; i <= n; i++) {
    const k = (start + i) % n;
    if (wet[k]) {
      run++;
      continue;
    }
    if (run >= length) for (let j = 1; j <= run; j++) out[(k - j + n) % n] = 1;
    run = 0;
  }
  return out;
}
