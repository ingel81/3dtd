import type { MapPaths, MapPoint } from '../../custom-map/map-document';
import { PAVED_SURFACES } from '../../custom-map/render/paths/road-style';
import type { OsmArea, OsmFeatures } from '../osm-parse';
import { SIDEWALK_WIDTH } from '../osm-tags';
import { insideRings } from '../square-clip';

/**
 * The pavements of an OSM world's streets (MapPathEdge.sidewalk), drawn by
 * the road surface beyond the carriageway behind a kerb. As the way tags
 * them (sidewalkTag); a way that says nothing has one where streets have
 * them in German towns: residential streets and main roads inside a
 * settlement (their middle within residential, retail or commercial land,
 * or among houses: TOWN_HOUSES buildings within TOWN_REACH), none out in
 * the country. Narrowed where a building stands closer, so a pavement
 * never runs under a house: the road surface would cover its walls' feet;
 * none where less than MIN_WIDTH is left.
 */

/** Street types with a pavement inside a settlement where their way says nothing */
const IN_TOWN = new Set(['residential', 'primary', 'secondary', 'tertiary', 'unclassified', 'primary_link', 'secondary_link', 'tertiary_link']);
/** Buildings within TOWN_REACH metres of a street's middle that make it a street among houses */
const TOWN_HOUSES = 4;
const TOWN_REACH = 40;
/** Land that makes a settlement */
const TOWN_LAND = new Set(['residential', 'retail', 'commercial']);
/** Metres left between a pavement and a wall */
const WALL_GAP = 0.2;
/** Narrowest pavement drawn, metres */
const MIN_WIDTH = 0.8;
/** Metres between the points of a street tested against the buildings */
const STEP = 2;
/** Metres a side of the index's cells */
const CELL = 16;

export interface PavementStats {
  /** Road edges with a pavement, by why: tagged, assumed (the way said nothing), narrowed by a building */
  tagged: number;
  assumed: number;
  narrowed: number;
  /** Edges whose pavement a building left no room for */
  dropped: number;
}

/** Sets `sidewalk` on the paved road edges of `paths` from what their ways say (RoadBuild.pavements) and the place */
export function layPavements(paths: MapPaths, said: ReadonlyMap<string, number | null>, features: OsmFeatures): PavementStats {
  const stats: PavementStats = { tagged: 0, assumed: 0, narrowed: 0, dropped: 0 };
  const town = new AreaIndex(features.areas.filter((a) => TOWN_LAND.has(a.tags['landuse'] ?? '')));
  const buildings = features.areas.filter((a) => !!a.tags['building']);
  const walls = new WallIndex(buildings);
  const houses = new AreaIndex(buildings);
  const nodes = new Map(paths.nodes.map((n) => [n.id, n]));
  for (const e of paths.edges) {
    const tag = said.get(e.id);
    if (tag === undefined || e.kind !== 'road' || e.area || e.tunnel || !e.surface || !PAVED_SURFACES.has(e.surface)) continue;
    const a = nodes.get(e.a);
    const b = nodes.get(e.b);
    if (!a || !b) continue;
    const line = [a, ...(e.via ?? []), b];
    const type = e.street ?? '';
    let width = tag;
    if (width === null) {
      const middle = middleOf(line);
      width = IN_TOWN.has(type) && (town.contains(middle) || houses.near(middle, TOWN_REACH) >= TOWN_HOUSES) ? SIDEWALK_WIDTH : 0;
    }
    if (width <= 0) continue;
    const room = walls.room(line, e.width / 2) - WALL_GAP;
    if (room < MIN_WIDTH) {
      stats.dropped++;
      continue;
    }
    if (room < width) stats.narrowed++;
    if (tag === null) stats.assumed++;
    else stats.tagged++;
    e.sidewalk = Math.round(Math.min(width, room) * 10) / 10;
  }
  return stats;
}

/** The point halfway along a line */
function middleOf(line: readonly MapPoint[]): MapPoint {
  let total = 0;
  for (let k = 1; k < line.length; k++) total += Math.hypot(line[k].x - line[k - 1].x, line[k].y - line[k - 1].y);
  let left = total / 2;
  for (let k = 1; k < line.length; k++) {
    const l = Math.hypot(line[k].x - line[k - 1].x, line[k].y - line[k - 1].y);
    if (left <= l && l > 0) return { x: line[k - 1].x + ((line[k].x - line[k - 1].x) * left) / l, y: line[k - 1].y + ((line[k].y - line[k - 1].y) * left) / l };
    left -= l;
  }
  return line[line.length - 1];
}

/** Areas by the cells their boxes cover, for whether a point lies in one */
class AreaIndex {
  private readonly cells = new Map<number, OsmArea[]>();

  constructor(areas: readonly OsmArea[]) {
    for (const area of areas) {
      const pts = area.outer.flat();
      if (!pts.length) continue;
      forCells(Math.min(...pts.map((p) => p.x)), Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.y)), (key) => {
        const list = this.cells.get(key);
        if (list) list.push(area);
        else this.cells.set(key, [area]);
      });
    }
  }

  /** Areas with a point of their outline within `r` metres of `p` (by their outline's first point, near enough for houses) */
  near(p: MapPoint, r: number): number {
    const seen = new Set<OsmArea>();
    forCells(p.x - r, p.y - r, p.x + r, p.y + r, (key) => {
      for (const area of this.cells.get(key) ?? []) {
        const q = area.outer[0]?.[0];
        if (q && Math.hypot(q.x - p.x, q.y - p.y) <= r) seen.add(area);
      }
    });
    return seen.size;
  }

  contains(p: MapPoint): boolean {
    for (const area of this.cells.get(cellKey(p.x, p.y)) ?? []) if (insideRings(p, area.outer) && !insideRings(p, area.inner)) return true;
    return false;
  }
}

interface Wall {
  a: MapPoint;
  b: MapPoint;
  /** The building's outline, for a point inside it */
  outer: readonly MapPoint[][];
}

/** The buildings' walls by cell, for how far a street's pavement may reach */
class WallIndex {
  private readonly cells = new Map<number, Wall[]>();

  constructor(buildings: readonly OsmArea[]) {
    for (const building of buildings) {
      for (const ring of building.outer) {
        for (let k = 0; k < ring.length; k++) {
          const wall = { a: ring[k], b: ring[(k + 1) % ring.length], outer: building.outer };
          forCells(Math.min(wall.a.x, wall.b.x), Math.min(wall.a.y, wall.b.y), Math.max(wall.a.x, wall.b.x), Math.max(wall.a.y, wall.b.y), (key) => {
            const list = this.cells.get(key);
            if (list) list.push(wall);
            else this.cells.set(key, [wall]);
          });
        }
      }
    }
  }

  /**
   * Metres of room beyond a street's half width `half` before the nearest
   * wall along its line (tested every STEP metres); 0 where its middle runs
   * through a building, at most 8 m
   */
  room(line: readonly MapPoint[], half: number): number {
    const reach = half + 8;
    let room = 8;
    for (let k = 1; k < line.length; k++) {
      const p = line[k - 1];
      const q = line[k];
      const l = Math.hypot(q.x - p.x, q.y - p.y);
      const n = Math.max(1, Math.ceil(l / STEP));
      for (let s = 0; s <= n; s++) {
        const at = { x: p.x + ((q.x - p.x) * s) / n, y: p.y + ((q.y - p.y) * s) / n };
        let near = reach;
        let nearest: Wall | null = null;
        forCells(at.x - reach, at.y - reach, at.x + reach, at.y + reach, (key) => {
          for (const w of this.cells.get(key) ?? []) {
            const d = pointSegment(at, w.a, w.b);
            if (d < near) {
              near = d;
              nearest = w;
            }
          }
        });
        // Inside a building the nearest wall is its own
        if (nearest && insideRings(at, (nearest as Wall).outer)) return 0;
        room = Math.min(room, Math.max(0, near - half));
        if (room <= 0) return 0;
      }
    }
    return room;
  }
}

function cellKey(x: number, y: number): number {
  return (Math.floor(x / CELL) + 32768) * 65536 + Math.floor(y / CELL) + 32768;
}

function forCells(x0: number, y0: number, x1: number, y1: number, visit: (key: number) => void): void {
  for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) {
    for (let j = Math.floor(y0 / CELL); j <= Math.floor(y1 / CELL); j++) visit((i + 32768) * 65536 + j + 32768);
  }
}

function pointSegment(p: MapPoint, a: MapPoint, b: MapPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}
