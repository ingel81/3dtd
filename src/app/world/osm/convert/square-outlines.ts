/**
 * The outlines of squares off the walls (docs/OSM_LANDMARKS_PLAN.md, L1). OSM
 * draws a square (`highway=pedestrian`, `area=yes`) along the fronts of the
 * houses round it, its nodes often a little inside them: a castle's
 * courtyard, a market place. Its outline is an edge the routes walk
 * (`edge.area`, not drawn), as wide as the street. It holds no building off
 * (convert/buildings.ts, the editor's check); instead its points are pulled
 * out of the buildings beside it here, half its width and a little more
 * from the nearest wall, so the enemies walking it keep out of the houses.
 *
 * A node the outline shares with a road or a bridge stays: the road is where
 * OSM has it. One it shares with a footway or a passage goes with it (a door
 * of a passage on the courtyard's wall: the passage reaches a little into the
 * courtyard, the footway starts there). A point that no place clears (a lane narrower than the outline
 * between two houses) goes to the first place outside the buildings it
 * finds, else stays.
 */
import type { MapPaths, MapPoint } from '../../custom-map/map-document';
import { isGroundBuilding } from '../building-tags';
import type { OsmFeatures } from '../osm-parse';
import { pointInRing } from './raster';

/** Metres an outline keeps from a wall beyond its half width */
const OUTLINE_GUARD = 0.5;
/** Tries per point: a push off one wall may land at another */
const PULL_TRIES = 4;
/** Cell of the buildings' grid, m */
const CELL = 32;

/** A building's ground: its outer ring and courtyards, and their bounds */
interface Solid {
  outer: readonly MapPoint[];
  holes: readonly (readonly MapPoint[])[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Pulls the outlines of `paths` (edges with `area`) off the buildings of `features`; the points moved */
export function pullOutlines(paths: MapPaths, features: OsmFeatures): number {
  const outlines = paths.edges.filter((e) => e.area);
  if (!outlines.length) return 0;
  const solids = new SolidIndex(features);
  // A node a road or a bridge uses stays where OSM has it
  const fixed = new Set<string>();
  for (const e of paths.edges) {
    if (e.area || e.covered || e.kind === 'path') continue;
    fixed.add(e.a);
    fixed.add(e.b);
  }
  const nodes = new Map(paths.nodes.map((n) => [n.id, n]));
  const done = new Set<string>();
  let moved = 0;
  const pull = (p: MapPoint, clear: number): boolean => {
    const to = pulledOff(p, clear, solids);
    if (!to) return false;
    p.x = round2(to.x);
    p.y = round2(to.y);
    return true;
  };
  for (const e of outlines) {
    const clear = e.width / 2 + OUTLINE_GUARD;
    for (const id of [e.a, e.b]) {
      const n = nodes.get(id);
      if (!n || fixed.has(id) || done.has(id)) continue;
      done.add(id);
      if (pull(n, clear)) moved++;
    }
    for (const v of e.via ?? []) if (pull(v, clear)) moved++;
  }
  return moved;
}

/**
 * Pulls the ends of roads and paths that end at a building (a lane up to a
 * church's portal, a drive into a garage) off its wall, and the nodes of
 * footways and pedestrian streets that OSM puts inside a building (the ways
 * across a square meeting at a church's corner), as far as the outlines
 * keep: the map's wider way would stand in the wall, and the building would
 * be cut back along the way's whole line or shrunk (building-mass.ts
 * clipOffRoads; the Würzburg Dom lost its west front so). An end is a node
 * only one edge uses. A passage's door (a `covered` edge's end), a node of
 * a tunnel, a bridge or a road for cars inside a building stay, and so does
 * a node that would leave the map's square (|x|, |y| up to `lim`). The
 * nodes moved
 */
export function pullDeadEnds(paths: MapPaths, features: OsmFeatures, lim = Infinity): number {
  const uses = new Map<string, number>();
  // Nodes that stay where OSM has them, wherever they are: a passage's, a tunnel's, a bridge's
  const fixed = new Set<string>();
  // Nodes of roads for cars: they move only as an end
  const roads = new Set<string>();
  for (const e of paths.edges) {
    uses.set(e.a, (uses.get(e.a) ?? 0) + 1);
    uses.set(e.b, (uses.get(e.b) ?? 0) + 1);
    if (e.covered || e.tunnel || e.kind === 'bridge') {
      fixed.add(e.a);
      fixed.add(e.b);
    } else if (e.kind === 'road' && !e.area && !FOOT_STREETS.has(e.street ?? '')) {
      roads.add(e.a);
      roads.add(e.b);
    }
  }
  const nodes = new Map(paths.nodes.map((n) => [n.id, n]));
  let solids: SolidIndex | null = null;
  const done = new Set<string>();
  let moved = 0;
  for (const e of paths.edges) {
    if (e.area || e.covered) continue;
    for (const id of [e.a, e.b]) {
      const n = nodes.get(id);
      if (!n || fixed.has(id) || done.has(id)) continue;
      const end = uses.get(id) === 1;
      // A way cut at the map's edge leaves it there
      if ((!end && roads.has(id)) || Math.abs(n.x) >= lim - 0.5 || Math.abs(n.y) >= lim - 0.5) continue;
      solids ??= new SolidIndex(features);
      if (!end && !solids.inside(n)) continue;
      done.add(id);
      const to = pulledOff(n, e.width / 2 + OUTLINE_GUARD, solids);
      // Not off the map: an end at its edge is where the way leaves it
      if (!to || Math.abs(to.x) > lim || Math.abs(to.y) > lim) continue;
      n.x = round2(to.x);
      n.y = round2(to.y);
      moved++;
    }
  }
  return moved;
}

/** Street types (MapPathEdge.street) of the roads people walk on: their nodes leave a building like a footway's */
const FOOT_STREETS: ReadonlySet<string> = new Set(['pedestrian', 'living_street', 'footway', 'path', 'steps', 'cycleway', 'track']);

/** Where `p` goes to keep `clear` m off every building, null to stay (clear already, or nowhere better) */
function pulledOff(p: MapPoint, clear: number, solids: SolidIndex): MapPoint | null {
  let at = p;
  let outside: MapPoint | null = null;
  for (let k = 0; k < PULL_TRIES; k++) {
    const hit = solids.nearestWall(at, clear);
    if (!hit) return at === p ? null : at;
    if (!hit.inside && k > 0) outside ??= at;
    // Off the wall: out of the building, or farther away beside it
    const dx = hit.inside ? hit.q.x - at.x : at.x - hit.q.x;
    const dy = hit.inside ? hit.q.y - at.y : at.y - hit.q.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return outside;
    at = { x: hit.q.x + (dx / len) * clear, y: hit.q.y + (dy / len) * clear };
  }
  return solids.nearestWall(at, clear) ? (outside ?? (solids.inside(at) ? null : at)) : at;
}

/** The ground buildings of the features in a grid of cells by their bounds */
class SolidIndex {
  private readonly cells = new Map<number, Solid[]>();

  constructor(features: OsmFeatures) {
    for (const area of features.areas) {
      if (!area.tags['building'] || !isGroundBuilding(area.tags)) continue;
      for (const outer of area.outer) {
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const q of outer) {
          minX = Math.min(minX, q.x);
          maxX = Math.max(maxX, q.x);
          minY = Math.min(minY, q.y);
          maxY = Math.max(maxY, q.y);
        }
        const solid: Solid = { outer, holes: area.inner.filter((r) => pointInRing(r[0], outer)), minX, maxX, minY, maxY };
        for (let j = Math.floor(minY / CELL); j <= Math.floor(maxY / CELL); j++) {
          for (let i = Math.floor(minX / CELL); i <= Math.floor(maxX / CELL); i++) {
            const key = (i + 4096) * 8192 + (j + 4096);
            let list = this.cells.get(key);
            if (!list) this.cells.set(key, (list = []));
            list.push(solid);
          }
        }
      }
    }
  }

  /** The buildings whose bounds come within `reach` of `p` */
  private near(p: MapPoint, reach: number): Set<Solid> {
    const out = new Set<Solid>();
    for (let j = Math.floor((p.y - reach) / CELL); j <= Math.floor((p.y + reach) / CELL); j++) {
      for (let i = Math.floor((p.x - reach) / CELL); i <= Math.floor((p.x + reach) / CELL); i++) {
        for (const s of this.cells.get((i + 4096) * 8192 + (j + 4096)) ?? []) {
          if (p.x >= s.minX - reach && p.x <= s.maxX + reach && p.y >= s.minY - reach && p.y <= s.maxY + reach) out.add(s);
        }
      }
    }
    return out;
  }

  /** Whether `p` lies on a building's ground */
  inside(p: MapPoint): boolean {
    for (const s of this.near(p, 0)) if (onGround(s, p)) return true;
    return false;
  }

  /**
   * The wall nearest to `p` of a building `p` stands in, else of one nearer
   * than `clear`: the point on it and whether `p` is inside; null for none
   */
  nearestWall(p: MapPoint, clear: number): { q: MapPoint; inside: boolean } | null {
    let best: { q: MapPoint; d: number; inside: boolean } | null = null;
    for (const s of this.near(p, clear)) {
      const inside = onGround(s, p);
      for (const ring of [s.outer, ...s.holes]) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const q = nearestOn(p, ring[j], ring[i]);
          const d = Math.hypot(q.x - p.x, q.y - p.y);
          if (!inside && d >= clear) continue;
          // Inside a building beats near one: get out first
          if (!best || (inside && !best.inside) || (inside === best.inside && d < best.d)) best = { q, d, inside };
        }
      }
    }
    return best && { q: best.q, inside: best.inside };
  }
}

/** Whether `p` lies in a building's outer ring and in none of its courtyards */
function onGround(s: Solid, p: MapPoint): boolean {
  return pointInRing(p, s.outer) && !s.holes.some((h) => pointInRing(p, h));
}

/** The point of segment a to b nearest to `p` */
function nearestOn(p: MapPoint, a: MapPoint, b: MapPoint): MapPoint {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return { x: a.x + t * dx, y: a.y + t * dy };
}

const round2 = (v: number): number => Math.round(v * 100) / 100;
