/**
 * Tunnels under buildings (docs/OSM_LANDMARKS_PLAN.md, decision 2 and its
 * finding of 2026-10-21): OSM tags more than `tunnel=building_passage` under
 * houses. Footways, squares, steps and the drives of underground car parks
 * run there as `tunnel=yes`, and a road tunnel got the concrete portal and
 * the hill over it (convert/tunnels.ts) in the middle of a town. Before the
 * graph is built each tunnel (its ways joined over shared nodes) is sorted:
 *
 * - an underground car park (every way `highway=service` below ground,
 *   `layer` < 0, a `parking_aisle` among them or a part under a building):
 *   only its entrances stay, each a ramp from the street down to the wall it
 *   meets (RAMP_MAX at most, without a wall it ends there, in the ground),
 *   and behind the wall a covered stub OPENING_STUB long: the opening's place,
 *   the door the building's own step will cut (the stub's ends are doors,
 *   path-graph.ts doorNodes, so the wall stays whole). The aisles under the
 *   ground go: a car park is no way through, the routes keep to the streets;
 * - a passage (PASSAGE_SHARE of its line under buildings or more): a covered
 *   road like `tunnel=building_passage`, without portal or hill;
 * - else a tunnel through the ground, as before (portals where it is long
 *   enough, roads.ts findTunnels).
 *
 * The ramps sink into the ground after the roads are levelled (sinkRamps).
 */
import { heightAt, sampleX, sampleY } from '../../../map-ops/grid';
import { nearestOnPolyline } from '../../../map-ops/path-graph';
import type { MapPoint, MapTerrain } from '../../custom-map/map-document';
import type { OsmFeatures, OsmWay } from '../osm-parse';
import type { RoadTags } from '../osm-tags';
import { SolidIndex } from './square-outlines';

/**
 * Share of a tunnel's line under buildings from which it is a passage through
 * them: OSM puts a passage's ends on or a few metres past the walls, where it
 * meets the street or the yard, so a short passage lies 60 to 100 % under the
 * house; a tunnel through the ground lies under none (Würzburg: the passages
 * 70 to 100 %, the road tunnel 0 %; the car parks' aisles, 8 to 47 %, are
 * sorted out before)
 */
export const PASSAGE_SHARE = 0.5;
/** Longest ramp of a car park's entrance, metres: from the street down to the wall it meets, without a wall it ends here */
export const RAMP_MAX = 30;
/** Metres the covered stub behind an entrance's wall reaches into the building: where its opening goes */
export const OPENING_STUB = 2;
/** Metres a ramp ends below the street: a storey's height under the ground at the wall */
export const RAMP_DEPTH = 2.6;
/** Steepest a ramp falls, per metre (a car park's drive) */
const RAMP_GRADE = 0.15;
/** Metres between the checks along a line for the buildings over it */
const STEP = 1;

export interface Road {
  way: OsmWay;
  tags: RoadTags;
}

/** A car park's entrance: its line from the street to its end (the wall, or where it ends in the ground) */
export interface Ramp {
  line: MapPoint[];
  wall: boolean;
  /** The road's width, m */
  width: number;
}

export interface UndergroundReport {
  passages: number;
  carParks: number;
  entrances: number;
  /** Ways covered for going on from a covered way under the same buildings (coverJoined) */
  joined: number;
}

/**
 * `roads` with their tunnels under buildings sorted out (see the file's
 * comment): passages covered, car parks' entrances as ramps and stubs (new
 * ways, their new nodes negative ids), their aisles gone; the ramps to sink
 */
export function sortUnderground(roads: readonly Road[], features: OsmFeatures): { roads: Road[]; ramps: Ramp[]; report: UndergroundReport } {
  const report: UndergroundReport = { passages: 0, carParks: 0, entrances: 0, joined: 0 };
  const tunnels = roads.filter((r) => r.tags.tunnel);
  if (!tunnels.length && !roads.some((r) => r.tags.covered)) return { roads: [...roads], ramps: [], report };
  const solids = new SolidIndex(features);
  // Nodes of the streets above: where a car park's entrance begins
  const street = new Set<number>();
  for (const r of roads) if (!r.tags.tunnel) for (const id of r.way.nodes) street.add(id);

  const replaced = new Map<Road, Road[]>();
  const ramps: Ramp[] = [];
  let fresh = 0;
  const newNode = () => -1_000_000_000 - ++fresh;
  for (const group of joined(tunnels)) {
    let length = 0;
    let under = 0;
    for (const r of group) {
      walk(points(r.way), (q, d) => {
        length += d;
        if (solids.inside(q)) under += d;
      });
    }
    const share = length > 0 ? under / length : 0;
    if (carPark(group, share)) {
      report.carParks++;
      for (const r of group) replaced.set(r, []);
      for (const r of group) {
        for (const end of [0, r.way.nodes.length - 1] as const) {
          if (!street.has(r.way.nodes[end])) continue;
          const line = end === 0 ? points(r.way) : points(r.way).reverse();
          const entrance = entranceOf(line, solids);
          if (!entrance) continue;
          report.entrances++;
          const plain = { ...r.tags, tunnel: false, covered: false, bridge: false };
          const out = replaced.get(r)!;
          const wallNode = newNode();
          // A ramp shorter than a metre is none: the street meets the wall
          const sloped = lineOf(entrance.ramp) >= 1;
          if (sloped) {
            out.push({ way: { id: r.way.id, tags: r.way.tags, nodes: [r.way.nodes[end], ...entrance.ramp.slice(1, -1).map(() => newNode()), wallNode], points: entrance.ramp }, tags: plain });
            ramps.push({ line: entrance.ramp, wall: entrance.stub !== null, width: r.tags.width });
          }
          if (entrance.stub) {
            const from = sloped ? wallNode : r.way.nodes[end];
            out.push({ way: { id: r.way.id, tags: r.way.tags, nodes: [from, newNode()], points: entrance.stub }, tags: { ...plain, covered: true } });
          }
        }
      }
      continue;
    }
    if (share >= PASSAGE_SHARE) {
      report.passages++;
      for (const r of group) replaced.set(r, [{ way: r.way, tags: { ...r.tags, tunnel: false, covered: true } }]);
    }
  }
  const out = roads.flatMap((r) => replaced.get(r) ?? [r]);
  report.joined = coverJoined(out, solids);
  return { roads: out, ramps, report };
}

/**
 * Ways that go on from a covered way under the same buildings, not tagged
 * as covered themselves (a pedestrian street whose passage OSM maps in
 * pieces, the steps and paths inside it): covered too, where PASSAGE_SHARE
 * of their line or more lies under buildings, joined on along the chain.
 * Changes `roads` in place; how many it covered
 */
function coverJoined(roads: Road[], solids: SolidIndex): number {
  const coveredAt = new Set<number>();
  for (const r of roads) if (r.tags.covered) for (const id of r.way.nodes) coveredAt.add(id);
  if (!coveredAt.size) return 0;
  let joined = 0;
  for (let grew = true; grew; ) {
    grew = false;
    for (let k = 0; k < roads.length; k++) {
      const r = roads[k];
      if (r.tags.covered || r.tags.tunnel || r.tags.bridge || !r.way.nodes.some((id) => coveredAt.has(id))) continue;
      let length = 0;
      let under = 0;
      walk(points(r.way), (q, d) => {
        length += d;
        if (solids.inside(q)) under += d;
      });
      if (length <= 0 || under / length < PASSAGE_SHARE) continue;
      roads[k] = { way: r.way, tags: { ...r.tags, covered: true } };
      for (const id of r.way.nodes) coveredAt.add(id);
      joined++;
      grew = true;
    }
  }
  return joined;
}

/** Whether a tunnel is an underground car park: all of it a service way below ground, an aisle among it or a part under a building */
function carPark(group: readonly Road[], share: number): boolean {
  const below = group.every((r) => r.way.tags['highway'] === 'service' && Number.parseFloat(r.way.tags['layer'] ?? '0') < 0);
  return below && (share > 0 || group.some((r) => r.way.tags['service'] === 'parking_aisle'));
}

/**
 * An entrance along `line` (from the street on): the ramp up to where it
 * meets a building's wall (the point on it to half a metre), RAMP_MAX at
 * most, and the covered stub behind the wall; without a wall the ramp
 * reaches RAMP_MAX or the way's end, no stub. Null for a line of no length
 */
function entranceOf(line: readonly MapPoint[], solids: SolidIndex): { ramp: MapPoint[]; stub: MapPoint[] | null } | null {
  if (line.length < 2) return null;
  const ramp: MapPoint[] = [line[0]];
  if (solids.inside(line[0])) return { ramp, stub: stubFrom(line[0], line[1]) };
  let walked = 0;
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1];
    const b = line[k];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(d / 0.5));
    for (let s = 1; s <= steps; s++) {
      const q = { x: a.x + ((b.x - a.x) * s) / steps, y: a.y + ((b.y - a.y) * s) / steps };
      walked += d / steps;
      if (solids.inside(q)) {
        ramp.push(round(q));
        return { ramp, stub: stubFrom(q, b) };
      }
      if (walked >= RAMP_MAX) {
        ramp.push(round(q));
        return { ramp, stub: null };
      }
    }
    if (k < line.length - 1) ramp.push(b);
  }
  ramp.push(line[line.length - 1]);
  return ramp.length >= 2 && walked > 0 ? { ramp, stub: null } : null;
}

/** OPENING_STUB from `p` toward `toward` */
function stubFrom(p: MapPoint, toward: MapPoint): MapPoint[] {
  const d = Math.hypot(toward.x - p.x, toward.y - p.y) || 1;
  return [round(p), round({ x: p.x + ((toward.x - p.x) / d) * OPENING_STUB, y: p.y + ((toward.y - p.y) / d) * OPENING_STUB })];
}

/**
 * The car parks' ramps sunk into the ground, after the roads are levelled:
 * from the street (0) down to RAMP_DEPTH at the wall (at most RAMP_GRADE),
 * the road's width and a metre beside it, the sides falling off 1:1 (the
 * ramp's retaining walls). Changes `terrain`; the samples lowered
 */
export function sinkRamps(terrain: MapTerrain, ramps: readonly Ramp[]): number {
  let sunk = 0;
  const g = terrain.grid;
  for (const ramp of ramps) {
    const total = lineOf(ramp.line);
    if (total < 1) continue;
    const depth = Math.min(RAMP_DEPTH, total * RAMP_GRADE);
    const half = ramp.width / 2 + 1;
    const top = heightAt(terrain, ramp.line[0].x, ramp.line[0].y);
    const pad = half + depth;
    const xs = ramp.line.map((p) => p.x);
    const ys = ramp.line.map((p) => p.y);
    const i0 = Math.max(0, Math.floor((Math.min(...xs) - pad + terrain.width / 2) / g.cellSize));
    const i1 = Math.min(g.columns - 1, Math.ceil((Math.max(...xs) + pad + terrain.width / 2) / g.cellSize));
    const j0 = Math.max(0, Math.floor((Math.min(...ys) - pad + terrain.depth / 2) / g.cellSize));
    const j1 = Math.min(g.rows - 1, Math.ceil((Math.max(...ys) + pad + terrain.depth / 2) / g.cellSize));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const q = { x: sampleX(terrain, i), y: sampleY(terrain, j) };
        const hit = nearestOnPolyline(ramp.line, q);
        if (!hit || hit.dist >= pad) continue;
        // Not past the street's end of the ramp: the street there keeps its height
        if (hit.along <= 0 && hit.dist > 0.01) continue;
        const floor = top - depth * Math.min(1, hit.along / total);
        const want = floor + Math.max(0, hit.dist - half);
        const k = j * g.columns + i;
        if (want < g.heights[k] - 0.01) {
          g.heights[k] = want;
          sunk++;
        }
      }
    }
  }
  return sunk;
}

/** The tunnel ways joined where they share a node */
function joined(tunnels: readonly Road[]): Road[][] {
  const parent = tunnels.map((_, k) => k);
  const find = (k: number): number => (parent[k] === k ? k : (parent[k] = find(parent[k])));
  const byNode = new Map<number, number>();
  tunnels.forEach((r, k) => {
    for (const id of r.way.nodes) {
      const seen = byNode.get(id);
      if (seen === undefined) byNode.set(id, k);
      else parent[find(seen)] = find(k);
    }
  });
  const groups = new Map<number, Road[]>();
  tunnels.forEach((r, k) => {
    const root = find(k);
    const list = groups.get(root);
    if (list) list.push(r);
    else groups.set(root, [r]);
  });
  return [...groups.values()];
}

function points(way: OsmWay): MapPoint[] {
  return way.points.filter((p): p is MapPoint => p !== null);
}

/** Calls `f` with the middle of each STEP-long piece of `line` and its length */
function walk(line: readonly MapPoint[], f: (q: MapPoint, d: number) => void): void {
  for (let k = 1; k < line.length; k++) {
    const a = line[k - 1];
    const b = line[k];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(d / STEP));
    for (let s = 0; s < n; s++) f({ x: a.x + ((b.x - a.x) * (s + 0.5)) / n, y: a.y + ((b.y - a.y) * (s + 0.5)) / n }, d / n);
  }
}

function lineOf(line: readonly MapPoint[]): number {
  let s = 0;
  for (let k = 1; k < line.length; k++) s += Math.hypot(line[k].x - line[k - 1].x, line[k].y - line[k - 1].y);
  return s;
}

const round = (p: MapPoint): MapPoint => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 });
