import type { NearestStreetPoint, Street, StreetNetwork, StreetNode } from '../interfaces/street-network-provider.interface';
import { DEG_TO_RAD } from './geo-utils';
import { distanceToSegment } from './street-astar';

/**
 * A grid over the segments of a street network, for the lookup
 * `findNearestStreetPoint` does: the segment of any street nearest to a point.
 *
 * That lookup used to walk every segment of the network. A loaded box of a
 * city holds tens of thousands of them, and the spawn preview asks once per
 * cursor move (spawn-preview.perf.spec.ts). The grid holds each segment in the
 * cells its box touches, and a lookup walks rings of cells outwards from the
 * point until the nearest cell it has not opened lies farther away than the
 * best segment it holds. A grid and not a tree: the nodes of a box sit densely
 * and fairly evenly along its ways, the network is built once and asked many
 * times, and a flat array of cells needs no rebalancing.
 *
 * The answer is the one the flat loop gave, segment for segment. Segments are
 * numbered in the order that loop ran them (streets in order, nodes in order),
 * so on equal distances the lower number wins, which is what its
 * `dist < nearest.distance` kept.
 */

/**
 * Metres per degree of latitude as `haversineDistance` in street-astar.ts
 * measures them (earth radius 6371 km), not the 111320 of geo-utils: a bound
 * below must never come out larger than the distance it bounds, or the search
 * would prune away the segment it is looking for.
 */
const M_PER_DEG_LAT = (6371000 * Math.PI) / 180;

/**
 * How much of a cell bound the search trusts. The bound is flat, the distance
 * it bounds runs over the sphere, and `distanceToSegment` clamps the foot of
 * the perpendicular in a flat frame of its own; over a loaded box the three
 * agree to several digits. One percent of slack costs a ring of cells now and
 * then and keeps the answer exact.
 */
const BOUND_SLACK = 0.99;

/** Segments a cell holds on average; the grid picks its cell size for it. */
const SEGMENTS_PER_CELL = 2;

/** Most cells the grid has in one direction, so a long thin box stays small. */
const MAX_SIDE = 512;

/**
 * A segment whose box covers more cells than this goes into `wide` and is
 * measured on every lookup instead of being written into hundreds of cells.
 * A motorway with a kilometre between two nodes does that.
 */
const MAX_CELLS_PER_SEGMENT = 64;

/** The segments of a street network in a grid of cells, see the note above. */
export class StreetSegmentGrid {
  private readonly streets: readonly Street[];
  /** Index into `streets` per segment, segments numbered as the flat loop ran them. */
  private readonly segStreet: Int32Array;
  /** Index of the segment's first node inside its street. */
  private readonly segNode: Int32Array;
  /** Segments whose box covers too many cells; every lookup measures them. */
  private readonly wide: number[] = [];
  /** Start of each cell's run in `cellItems`, one entry longer than the cell count. */
  private readonly cellStart: Int32Array;
  private readonly cellItems: Int32Array;
  /** Which lookup last measured a segment, against the copies it has in several cells. */
  private readonly seen: Int32Array;
  private epoch = 0;

  private readonly cols: number;
  private readonly rows: number;
  private readonly minLat: number;
  private readonly maxLat: number;
  private readonly minLon: number;
  private readonly maxLon: number;
  private readonly latStep: number;
  private readonly lonStep: number;
  /** The grid's latitude farthest from the equator, for the longitude scale of a bound. */
  private readonly maxAbsLat: number;

  constructor(network: StreetNetwork) {
    this.streets = network.streets;

    let count = 0;
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;
    for (const street of this.streets) {
      if (street.nodes.length < 2) continue;
      count += street.nodes.length - 1;
      for (const node of street.nodes) {
        if (node.lat < minLat) minLat = node.lat;
        if (node.lat > maxLat) maxLat = node.lat;
        if (node.lon < minLon) minLon = node.lon;
        if (node.lon > maxLon) maxLon = node.lon;
      }
    }
    if (count === 0) {
      minLat = maxLat = minLon = maxLon = 0;
    }

    this.minLat = minLat;
    this.maxLat = maxLat;
    this.minLon = minLon;
    this.maxLon = maxLon;
    this.maxAbsLat = Math.max(Math.abs(minLat), Math.abs(maxLat));

    // A cell holding SEGMENTS_PER_CELL segments on average, square in metres
    // so that a ring of cells is a ring in the world as well.
    const latSpan = Math.max(maxLat - minLat, 1e-9);
    const lonSpan = Math.max(maxLon - minLon, 1e-9);
    const lonScale = Math.max(Math.cos(this.maxAbsLat * DEG_TO_RAD), 1e-6) * M_PER_DEG_LAT;
    const latSpanM = latSpan * M_PER_DEG_LAT;
    const lonSpanM = lonSpan * lonScale;
    const cellM = Math.sqrt((latSpanM * lonSpanM * SEGMENTS_PER_CELL) / Math.max(count, 1));
    this.cols = count === 0 ? 1 : Math.min(MAX_SIDE, Math.max(1, Math.ceil(lonSpanM / cellM)));
    this.rows = count === 0 ? 1 : Math.min(MAX_SIDE, Math.max(1, Math.ceil(latSpanM / cellM)));
    this.latStep = latSpan / this.rows;
    this.lonStep = lonSpan / this.cols;

    this.segStreet = new Int32Array(count);
    this.segNode = new Int32Array(count);
    this.seen = new Int32Array(count);

    // First pass: the cells each segment falls into, and how many segments a
    // cell gets. The second writes them into one flat array behind those counts.
    const boxX0 = new Int32Array(count);
    const boxX1 = new Int32Array(count);
    const boxY0 = new Int32Array(count);
    const boxY1 = new Int32Array(count);
    const starts = new Int32Array(this.cols * this.rows + 1);
    let seg = 0;
    for (let s = 0; s < this.streets.length; s++) {
      const nodes = this.streets[s].nodes;
      if (nodes.length < 2) continue;
      for (let i = 0; i < nodes.length - 1; i++, seg++) {
        this.segStreet[seg] = s;
        this.segNode[seg] = i;
        const a = nodes[i];
        const b = nodes[i + 1];
        const x0 = this.colOf(Math.min(a.lon, b.lon));
        const x1 = this.colOf(Math.max(a.lon, b.lon));
        const y0 = this.rowOf(Math.min(a.lat, b.lat));
        const y1 = this.rowOf(Math.max(a.lat, b.lat));
        if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_CELLS_PER_SEGMENT) {
          boxX0[seg] = -1;
          this.wide.push(seg);
          continue;
        }
        boxX0[seg] = x0;
        boxX1[seg] = x1;
        boxY0[seg] = y0;
        boxY1[seg] = y1;
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) starts[y * this.cols + x + 1]++;
        }
      }
    }
    for (let c = 0; c < starts.length - 1; c++) starts[c + 1] += starts[c];
    this.cellStart = starts;
    this.cellItems = new Int32Array(starts[starts.length - 1]);
    const cursor = Int32Array.from(starts.subarray(0, starts.length - 1));
    for (let i = 0; i < count; i++) {
      if (boxX0[i] < 0) continue;
      for (let y = boxY0[i]; y <= boxY1[i]; y++) {
        for (let x = boxX0[i]; x <= boxX1[i]; x++) this.cellItems[cursor[y * this.cols + x]++] = i;
      }
    }
  }

  /**
   * The segment of any street nearest to the point, or null without one.
   * `accept` skips a segment by its first node, as the flat loop did.
   */
  nearest(lat: number, lon: number, accept?: (node: StreetNode) => boolean): NearestStreetPoint | null {
    if (this.segStreet.length === 0) return null;

    const stamp = this.nextEpoch();
    let bestSeg = -1;
    let bestDistance = Infinity;
    const measure = (candidate: number): void => {
      const nodes = this.streets[this.segStreet[candidate]].nodes;
      const i = this.segNode[candidate];
      const a = nodes[i];
      if (accept && !accept(a)) return;
      const b = nodes[i + 1];
      const dist = distanceToSegment(lat, lon, a.lat, a.lon, b.lat, b.lon);
      // On a tie the lower segment number wins: that is the one the flat loop
      // reached first and kept.
      if (dist < bestDistance || (dist === bestDistance && candidate < bestSeg)) {
        bestDistance = dist;
        bestSeg = candidate;
      }
    };
    const openCell = (cell: number): void => {
      for (let k = this.cellStart[cell]; k < this.cellStart[cell + 1]; k++) {
        const candidate = this.cellItems[k];
        if (this.seen[candidate] === stamp) continue;
        this.seen[candidate] = stamp;
        measure(candidate);
      }
    };

    for (const candidate of this.wide) measure(candidate);

    // Rings around the point's cell, the point clamped into the grid when it
    // lies outside. Ring r opens what the block of rings up to r-1 left out.
    const cx = this.colOf(lon);
    const cy = this.rowOf(lat);
    const maxRing = this.cols + this.rows;
    for (let r = 0; r <= maxRing; r++) {
      const c0 = Math.max(0, cx - r);
      const c1 = Math.min(this.cols - 1, cx + r);
      const r0 = Math.max(0, cy - r);
      const r1 = Math.min(this.rows - 1, cy + r);
      for (let y = r0; y <= r1; y++) {
        if (y === cy - r || y === cy + r) {
          for (let x = c0; x <= c1; x++) openCell(y * this.cols + x);
        } else {
          if (cx - r >= 0) openCell(y * this.cols + cx - r);
          if (r > 0 && cx + r < this.cols) openCell(y * this.cols + cx + r);
        }
      }
      if (bestDistance === 0) break;
      const bound = this.boundOutside(lat, lon, c0, c1, r0, r1);
      if (bound === Infinity) break; // the block covers the grid
      if (bound * BOUND_SLACK > bestDistance) break;
    }

    if (bestSeg < 0) return null;
    return {
      street: this.streets[this.segStreet[bestSeg]],
      nodeIndex: this.segNode[bestSeg],
      distance: bestDistance,
    };
  }

  private colOf(lon: number): number {
    return Math.min(this.cols - 1, Math.max(0, Math.floor((lon - this.minLon) / this.lonStep)));
  }

  private rowOf(lat: number): number {
    return Math.min(this.rows - 1, Math.max(0, Math.floor((lat - this.minLat) / this.latStep)));
  }

  /**
   * How far the point is at least from everything the block of cells leaves
   * out, metres. The rest of the grid is four strips around the block, and the
   * nearest of them bounds every cell not opened yet. Infinity once the block
   * is the whole grid.
   */
  private boundOutside(lat: number, lon: number, c0: number, c1: number, r0: number, r1: number): number {
    const blockMinLat = this.minLat + r0 * this.latStep;
    const blockMaxLat = r1 === this.rows - 1 ? this.maxLat : this.minLat + (r1 + 1) * this.latStep;
    const blockMinLon = this.minLon + c0 * this.lonStep;
    const blockMaxLon = c1 === this.cols - 1 ? this.maxLon : this.minLon + (c1 + 1) * this.lonStep;
    let bound = Infinity;
    if (r0 > 0) bound = Math.min(bound, this.rectDistance(lat, lon, this.minLat, blockMinLat, this.minLon, this.maxLon));
    if (r1 < this.rows - 1) bound = Math.min(bound, this.rectDistance(lat, lon, blockMaxLat, this.maxLat, this.minLon, this.maxLon));
    if (c0 > 0) bound = Math.min(bound, this.rectDistance(lat, lon, blockMinLat, blockMaxLat, this.minLon, blockMinLon));
    if (c1 < this.cols - 1) bound = Math.min(bound, this.rectDistance(lat, lon, blockMinLat, blockMaxLat, blockMaxLon, this.maxLon));
    return bound;
  }

  /** Distance from the point to a lat/lon box, metres, flat and never above the sphere's. */
  private rectDistance(lat: number, lon: number, minLat: number, maxLat: number, minLon: number, maxLon: number): number {
    const dLat = lat < minLat ? minLat - lat : lat > maxLat ? lat - maxLat : 0;
    const dLon = lon < minLon ? minLon - lon : lon > maxLon ? lon - maxLon : 0;
    if (dLat === 0 && dLon === 0) return 0;
    const scale = Math.max(0, Math.cos(Math.max(this.maxAbsLat, Math.abs(lat)) * DEG_TO_RAD)) * M_PER_DEG_LAT;
    return Math.hypot(dLat * M_PER_DEG_LAT, dLon * scale);
  }

  /** A number no earlier lookup used, for the `seen` marks. */
  private nextEpoch(): number {
    this.epoch++;
    if (this.epoch === 0x7fffffff) {
      this.seen.fill(0);
      this.epoch = 1;
    }
    return this.epoch;
  }
}

/**
 * One grid per street network, built on its first lookup. A network is never
 * written into after it is built (parseOverpassResponse, mergeStreets and
 * filterStreetsNearRoutes each return a fresh object), so a load of new
 * streets brings a new object and with it a new grid; the old one goes when
 * the network does.
 */
const grids = new WeakMap<StreetNetwork, StreetSegmentGrid>();

/** The segment of `network` nearest to the point, over the network's grid. */
export function nearestStreetSegment(
  network: StreetNetwork,
  lat: number,
  lon: number,
  accept?: (node: StreetNode) => boolean
): NearestStreetPoint | null {
  let grid = grids.get(network);
  if (!grid) {
    grid = new StreetSegmentGrid(network);
    grids.set(network, grid);
  }
  return grid.nearest(lat, lon, accept);
}
