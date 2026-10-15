/**
 * An Overpass answer of the world's query (osm-query.ts) as features in map
 * metres: ways as lines with their node ids (the street graph joins ways by
 * them), areas from closed ways and multipolygon relations (rings put
 * together from their member ways), tagged points. Map metres around the
 * map's centre, `x` east, `y` north, as the map document has them.
 *
 * The answer's geometry is cut at the query's box: a node outside it comes
 * as null. A line keeps its runs of points; a ring drops the missing stretch
 * (the two points either side of it lie outside the box) and is then cut to
 * the map's square, so an area that reaches past the map ends at its edge.
 */
import { METERS_PER_DEGREE_LAT } from '../../utils/geo-utils';
import type { MapPoint } from '../custom-map/map-document';
import type { OverpassResponse } from './overpass-client';

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
  const stats: OsmParseStats = { elements: data.elements.length, ways: 0, relations: 0, points: 0, areas: 0, forcedRings: 0, areasOutside: 0 };
  const project = (g: { lat: number; lon: number } | null | undefined): MapPoint | null => (g ? frame.point(g) : null);

  const addArea = (id: number, from: OsmArea['from'], tags: Record<string, string>, outerRaw: MapPoint[][], innerRaw: MapPoint[][]) => {
    const outer = outerRaw.map((r) => clipRing(r, half)).filter((r) => r.length >= 3);
    if (!outer.length) {
      stats.areasOutside++;
      return;
    }
    const inner = innerRaw.map((r) => clipRing(r, half)).filter((r) => r.length >= 3);
    const area = outer.reduce((s, r) => s + Math.abs(ringArea(r)), 0) - inner.reduce((s, r) => s + Math.abs(ringArea(r)), 0);
    areas.push({ id, from, tags, outer, inner, area: Math.max(0, area) });
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
        const ring = pts.slice(0, -1).filter((p): p is MapPoint => p !== null);
        if (ring.length >= 3) addArea(element.id, 'way', tags, [ring], []);
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
      const outer = assembleRings(outerChains);
      const inner = assembleRings(innerChains);
      stats.forcedRings += outer.forced + inner.forced;
      addArea(element.id, 'relation', tags, outer.rings, inner.rings);
    }
  }
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

/**
 * Member ways put together into closed rings by their shared end points. A
 * chain that does not close (a member cut off by the box, or missing) is
 * joined to the chain whose start lies nearest to its end, and the last one
 * closed straight across (`forced` counts those).
 */
export function assembleRings(chains: readonly MapPoint[][]): { rings: MapPoint[][]; forced: number } {
  const rings: MapPoint[][] = [];
  const open: MapPoint[][] = [];
  for (const chain of chains) {
    if (chain.length >= 4 && key(chain[0]) === key(chain[chain.length - 1])) rings.push(chain.slice(0, -1));
    else open.push([...chain]);
  }
  let forced = 0;
  while (open.length) {
    let ring = open.pop()!;
    for (;;) {
      if (ring.length >= 3 && key(ring[0]) === key(ring[ring.length - 1])) {
        rings.push(ring.slice(0, -1));
        break;
      }
      const end = key(ring[ring.length - 1]);
      let k = open.findIndex((c) => key(c[0]) === end);
      let reverse = false;
      if (k < 0) {
        k = open.findIndex((c) => key(c[c.length - 1]) === end);
        reverse = k >= 0;
      }
      if (k < 0) {
        // Nothing continues it: the nearest start of another chain, else close it here
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
        continue;
      }
      const next = open.splice(k, 1)[0];
      if (reverse) next.reverse();
      ring = ring.concat(next.slice(1));
    }
  }
  return { rings, forced };
}

/** Signed area of a ring (counter-clockwise positive) */
export function ringArea(ring: readonly MapPoint[]): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j].x - ring[i].x) * (ring[j].y + ring[i].y);
  return s / 2;
}

/** A ring cut to the square |x|, |y| <= half (Sutherland-Hodgman; a concave ring may keep stretches along the edge) */
export function clipRing(ring: readonly MapPoint[], half: number): MapPoint[] {
  let out: MapPoint[] = [...ring];
  const edges: [(p: MapPoint) => number, 'x' | 'y', number][] = [
    [(p) => half - p.x, 'x', half],
    [(p) => p.x + half, 'x', -half],
    [(p) => half - p.y, 'y', half],
    [(p) => p.y + half, 'y', -half],
  ];
  for (const [inside, axis, value] of edges) {
    if (!out.length) break;
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      const ci = inside(cur);
      const pi = inside(prev);
      if (ci >= 0) {
        if (pi < 0) out.push(cross(prev, cur, axis, value));
        out.push(cur);
      } else if (pi >= 0) out.push(cross(prev, cur, axis, value));
    }
  }
  return out;
}

function cross(a: MapPoint, b: MapPoint, axis: 'x' | 'y', value: number): MapPoint {
  const t = (value - a[axis]) / (b[axis] - a[axis]);
  return axis === 'x' ? { x: value, y: a.y + (b.y - a.y) * t } : { x: a.x + (b.x - a.x) * t, y: value };
}
