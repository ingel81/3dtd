/**
 * An Overpass answer of the world's query (osm-query.ts) as features in map
 * metres: ways as lines with their node ids (the street graph joins ways by
 * them), areas from closed ways and multipolygon relations (rings put
 * together from their member ways), tagged points. Map metres around the
 * map's centre, `x` east, `y` north, as the map document has them.
 *
 * The answer's geometry is cut at the query's box: a node outside it comes
 * as null. A line keeps its runs of points; a ring cut so keeps its runs as
 * chains (both ends outside the box), and every area is cut to the map's
 * square (square-clip.ts), so one that reaches past the map ends at its edge
 * and one around the whole map covers it. Where the chains leave open which
 * side of them the area lies, the buildings and roads say it for water.
 */
import { METERS_PER_DEGREE_LAT } from '../../utils/geo-utils';
import type { MapPoint } from '../custom-map/map-document';
import { landClassOf, waterClassOf } from './land-tags';
import type { OverpassResponse } from './overpass-client';
import { fillRings, texelGrid, type RasterGrid } from './convert/raster';
import { clipArea } from './square-clip';

/** The map's centre and its projection: flat metres, exact enough over a few kilometres */
export class OsmFrame {
  private readonly cosLat: number;

  constructor(
    readonly lat: number,
    readonly lon: number,
  ) {
    this.cosLat = Math.cos((lat * Math.PI) / 180);
  }

  x(lon: number): number {
    return (lon - this.lon) * this.cosLat * METERS_PER_DEGREE_LAT;
  }

  y(lat: number): number {
    return (lat - this.lat) * METERS_PER_DEGREE_LAT;
  }

  point(p: { lat: number; lon: number }): MapPoint {
    return { x: this.x(p.lon), y: this.y(p.lat) };
  }

  /** Latitude and longitude of a map point */
  geo(p: MapPoint): { lat: number; lon: number } {
    return { lat: this.lat + p.y / METERS_PER_DEGREE_LAT, lon: this.lon + p.x / (this.cosLat * METERS_PER_DEGREE_LAT) };
  }
}

/** A way: its tags, node ids and points (null where the answer cut the node off) */
export interface OsmWay {
  id: number;
  tags: Record<string, string>;
  nodes: number[];
  points: (MapPoint | null)[];
}

/** An area: outer and inner rings (closed, first point not repeated), cut to the map's square */
export interface OsmArea {
  id: number;
  from: 'way' | 'relation';
  tags: Record<string, string>;
  outer: MapPoint[][];
  inner: MapPoint[][];
  /** Square metres, outer less inner */
  area: number;
}

export interface OsmPoint {
  id: number;
  tags: Record<string, string>;
  x: number;
  y: number;
}

export interface OsmParseStats {
  elements: number;
  ways: number;
  relations: number;
  points: number;
  areas: number;
  /** Multipolygon relations whose rings did not close and were closed straight across */
  forcedRings: number;
  /** Areas with rings the answer cut at its box, closed around the map */
  cutAreas: number;
  /** Of those, water the buildings and roads put on the other side of its shores */
  turnedAreas: number;
  /** Areas that lay outside the map's square once cut */
  areasOutside: number;
}

export interface OsmFeatures {
  frame: OsmFrame;
  /** Half the map's side, metres: the square features are cut to */
  half: number;
  ways: OsmWay[];
  areas: OsmArea[];
  points: OsmPoint[];
  stats: OsmParseStats;
}

/** `natural` values that are lines or points, not areas */
const NATURAL_NOT_AREA = new Set(['coastline', 'tree_row', 'cliff', 'ridge', 'arete', 'valley', 'tree', 'peak', 'saddle', 'spring']);
/** `man_made` values that are lines */
const MAN_MADE_NOT_AREA = new Set(['embankment', 'cutline', 'pipeline', 'dyke', 'breakwater', 'groyne']);

/** Whether a closed way with these tags is an area (the usual OSM rules, as far as the world reads them) */
export function isAreaTags(tags: Record<string, string>): boolean {
  if (tags['area'] === 'no') return false;
  if (tags['area'] === 'yes') return true;
  if (tags['highway'] || tags['barrier']) return false;
  if (tags['building'] || tags['landuse'] || tags['leisure'] || tags['amenity'] || tags['water']) return true;
  if (tags['natural']) return !NATURAL_NOT_AREA.has(tags['natural']);
  if (tags['man_made']) return !MAN_MADE_NOT_AREA.has(tags['man_made']);
  if (tags['waterway']) return tags['waterway'] === 'riverbank' || tags['waterway'] === 'dock';
  if (tags['railway']) return tags['railway'] === 'platform';
  return false;
}

/** The answer's elements as features around `frame`, areas cut to the square of half side `half` */
export function parseOsm(data: OverpassResponse, frame: OsmFrame, half: number): OsmFeatures {
  const ways: OsmWay[] = [];
  const areas: OsmArea[] = [];
  const points: OsmPoint[] = [];
  const stats: OsmParseStats = {
    elements: data.elements.length,
    ways: 0,
    relations: 0,
    points: 0,
    areas: 0,
    forcedRings: 0,
    cutAreas: 0,
    turnedAreas: 0,
    areasOutside: 0,
  };
  const project = (g: { lat: number; lon: number } | null | undefined): MapPoint | null => (g ? frame.point(g) : null);

  // Areas are cut once all ways are read: the land a cut lake is judged by comes from them
  const pending: (() => void)[] = [];
  let land: DryLand | null = null;
  const addArea = (id: number, from: OsmArea['from'], tags: Record<string, string>, outer: Ringset, inner: Ringset) => {
    stats.forcedRings += outer.forced + inner.forced;
    const chains = [...outer.open, ...inner.open];
    if (chains.length) stats.cutAreas++;
    const wet = !!waterClassOf(tags) || landClassOf(tags) === 'wetland';
    const turn = wet
      ? (rings: MapPoint[][]) => {
          land ??= new DryLand(ways, half);
          const turned = land.turns(rings);
          if (turned) stats.turnedAreas++;
          return turned;
        }
      : undefined;
    const cut = clipArea(outer.rings, inner.rings, chains, half, turn);
    if (!cut) {
      stats.areasOutside++;
      return;
    }
    areas.push({ id, from, tags, ...cut });
  };

  for (const element of data.elements) {
    const tags = element.tags ?? {};
    if (element.type === 'node') {
      if (element.lat === undefined || element.lon === undefined || !element.tags) continue;
      const p = frame.point({ lat: element.lat, lon: element.lon });
      if (Math.abs(p.x) > half || Math.abs(p.y) > half) continue;
      points.push({ id: element.id, tags, x: p.x, y: p.y });
    } else if (element.type === 'way') {
      const nodes = element.nodes ?? [];
      const geometry = element.geometry ?? [];
      // Geometry aligned with the node list, as `out geom` gives it; anything else is read as points only
      const aligned = geometry.length === nodes.length;
      const pts = geometry.map(project);
      ways.push({ id: element.id, tags, nodes: aligned ? nodes : [], points: pts });
      const closed = nodes.length >= 4 && nodes[0] === nodes[nodes.length - 1];
      if (closed && isAreaTags(tags)) {
        const ring = pts.slice(0, -1);
        // Cut by the box: the runs from one gap round to the next
        const gap = ring.indexOf(null);
        const outer: Ringset | null =
          gap >= 0 ? assembleRings(runs([...ring.slice(gap), ...ring.slice(0, gap)]), half) : ring.length >= 3 ? { rings: [ring as MapPoint[]], open: [], forced: 0 } : null;
        if (outer) pending.push(() => addArea(element.id, 'way', tags, outer, NO_RINGS));
      }
    } else if (element.type === 'relation') {
      stats.relations++;
      if (tags['type'] !== 'multipolygon' || !element.members) continue;
      const outerChains: MapPoint[][] = [];
      const innerChains: MapPoint[][] = [];
      for (const m of element.members) {
        if (m.type !== 'way' || !m.geometry) continue;
        const target = m.role === 'inner' ? innerChains : outerChains;
        target.push(...runs(m.geometry.map(project)));
      }
      let outer = assembleRings(outerChains, half);
      const inner = assembleRings(innerChains, half);
      // Islands without a shore in the answer: the lake's outer ring lies past the box all round
      if (!outer.rings.length && !outer.open.length && (inner.rings.length || inner.open.length)) outer = { rings: [aroundAll(half)], open: [], forced: 0 };
      pending.push(() => addArea(element.id, 'relation', tags, outer, inner));
    }
  }
  for (const add of pending) add();
  stats.ways = ways.length;
  stats.points = points.length;
  stats.areas = areas.length;
  return { frame, half, ways, areas, points, stats };
}

/** The runs of points between the gaps (nulls) of a list, each at least two long */
export function runs(points: readonly (MapPoint | null)[]): MapPoint[][] {
  const out: MapPoint[][] = [];
  let current: MapPoint[] = [];
  for (const p of points) {
    if (p) current.push(p);
    else {
      if (current.length >= 2) out.push(current);
      current = [];
    }
  }
  if (current.length >= 2) out.push(current);
  return out;
}

const key = (p: MapPoint): string => `${p.x.toFixed(3)},${p.y.toFixed(3)}`;

/** Rings put together from ways: the closed ones, the chains the answer's box cut (both ends outside the map), how many were forced shut */
export interface Ringset {
  rings: MapPoint[][];
  open: MapPoint[][];
  forced: number;
}

const NO_RINGS: Ringset = { rings: [], open: [], forced: 0 };

/**
 * Member ways put together into closed rings by their shared end points,
 * turning one round where it runs the other way. A chain whose ends both lie
 * outside the square of half side `half` is a ring the box cut: it stays
 * open. One that ends inside the map does not close (a member missing): it
 * is joined to the chain whose start lies nearest to its end, and the last
 * one closed straight across (`forced` counts those).
 */
export function assembleRings(chains: readonly MapPoint[][], half: number): Ringset {
  const rings: MapPoint[][] = [];
  const cut: MapPoint[][] = [];
  const open: MapPoint[][] = [];
  for (const chain of chains) {
    if (chain.length >= 4 && key(chain[0]) === key(chain[chain.length - 1])) rings.push(chain.slice(0, -1));
    else open.push([...chain]);
  }
  const outside = (p: MapPoint) => Math.max(Math.abs(p.x), Math.abs(p.y)) > half;
  /** The chain that goes on from `at`: its index and whether it runs the other way */
  const from = (at: string, ends: boolean): { k: number; reverse: boolean } => {
    let k = open.findIndex((c) => key(ends ? c[c.length - 1] : c[0]) === at);
    if (k >= 0) return { k, reverse: false };
    k = open.findIndex((c) => key(ends ? c[0] : c[c.length - 1]) === at);
    return { k, reverse: k >= 0 };
  };
  let forced = 0;
  while (open.length) {
    let ring = open.pop()!;
    for (;;) {
      if (ring.length >= 3 && key(ring[0]) === key(ring[ring.length - 1])) {
        rings.push(ring.slice(0, -1));
        break;
      }
      const after = from(key(ring[ring.length - 1]), false);
      if (after.k >= 0) {
        const next = open.splice(after.k, 1)[0];
        if (after.reverse) next.reverse();
        ring = ring.concat(next.slice(1));
        continue;
      }
      // Nothing goes on from its end: something may still lead into its start
      const before = from(key(ring[0]), true);
      if (before.k >= 0) {
        const prev = open.splice(before.k, 1)[0];
        if (before.reverse) prev.reverse();
        ring = prev.concat(ring.slice(1));
        continue;
      }
      if (outside(ring[0]) && outside(ring[ring.length - 1])) {
        cut.push(ring);
        break;
      }
      // A member missing: the nearest start of another chain, else close it here
      const last = ring[ring.length - 1];
      let best = -1;
      let bestDist = Math.hypot(ring[0].x - last.x, ring[0].y - last.y);
      open.forEach((c, i) => {
        const d = Math.hypot(c[0].x - last.x, c[0].y - last.y);
        if (d < bestDist) {
          best = i;
          bestDist = d;
        }
      });
      forced++;
      if (best < 0) {
        if (ring.length >= 3) rings.push(ring);
        break;
      }
      ring = ring.concat(open.splice(best, 1)[0]);
    }
  }
  return { rings, open: cut, forced };
}

/** A ring far round the map and the box */
function aroundAll(half: number): MapPoint[] {
  const far = half * 1000;
  return [{ x: -far, y: far }, { x: far, y: far }, { x: far, y: -far }, { x: -far, y: -far }];
}

/** Cells per side of the grid the land is counted on */
const LAND_CELLS = 256;
/** Land marks a cut water area must hold before they may turn it round */
const TURN_MIN_MARKS = 8;
/** Land marks per square metre over which an area reads as built land (50 per km²; open water holds a few piers) */
const TURN_MIN_DENSITY = 50e-6;
/** The rest of the square must hold at most this share of the area's density of land marks */
const TURN_CONTRAST = 0.25;

/**
 * Where the land of the map is, from the ways: the middle of every building
 * and the points of every road on the ground (not bridges, tunnels or piers),
 * counted on a coarse grid. Water lies where they are not.
 */
class DryLand {
  private readonly grid: RasterGrid;
  private readonly marks: Uint16Array;
  private readonly total: number;

  constructor(ways: readonly OsmWay[], half: number) {
    this.grid = texelGrid(2 * half, LAND_CELLS);
    const n = LAND_CELLS;
    const marks = new Uint16Array(n * n);
    let total = 0;
    const mark = (x: number, y: number) => {
      if (Math.abs(x) >= half || Math.abs(y) >= half) return;
      const i = Math.floor(((x + half) / (2 * half)) * n);
      const j = Math.floor(((y + half) / (2 * half)) * n);
      if (marks[j * n + i] < 65535) marks[j * n + i]++;
      total++;
    };
    for (const w of ways) {
      const t = w.tags;
      if (t['building'] && w.nodes.length >= 4 && w.nodes[0] === w.nodes[w.nodes.length - 1] && w.points.every((p) => p)) {
        let x = 0;
        let y = 0;
        for (let k = 1; k < w.points.length; k++) {
          x += w.points[k]!.x;
          y += w.points[k]!.y;
        }
        mark(x / (w.points.length - 1), y / (w.points.length - 1));
      } else if (t['highway'] && !onWater(t)) for (const p of w.points) if (p) mark(p.x, p.y);
    }
    this.marks = marks;
    this.total = total;
  }

  /**
   * Whether water guessed as `rings` holds the land and the rest of the
   * square is clear of it: then the water is the rest
   */
  turns(rings: readonly MapPoint[][]): boolean {
    let inMarks = 0;
    let inCells = 0;
    const n = LAND_CELLS;
    fillRings(rings, this.grid, (i, j) => {
      inMarks += this.marks[j * n + i];
      inCells++;
    });
    const outCells = n * n - inCells;
    if (inMarks < TURN_MIN_MARKS || !inCells || !outCells) return false;
    const cell = this.grid.step * this.grid.step;
    const inside = inMarks / (inCells * cell);
    const outside = (this.total - inMarks) / (outCells * cell);
    return inside >= TURN_MIN_DENSITY && outside <= inside * TURN_CONTRAST;
  }
}

/** A road that may cross water: a bridge, a ferry's way, a pier, or under it */
function onWater(tags: Record<string, string>): boolean {
  const yes = (v: string | undefined) => !!v && v !== 'no';
  return yes(tags['bridge']) || yes(tags['tunnel']) || tags['man_made'] === 'pier' || tags['highway'] === 'ferry' || tags['area'] === 'yes';
}
