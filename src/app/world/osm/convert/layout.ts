/**
 * HQ and spawns of an OSM world, as on the real places: the HQ on the road
 * nearest the place, the spawns drawn as a real place draws its random spawn
 * (StreetRouter.findRandomStreetPoint: a node 500 to 1000 m away on a
 * drivable street, with a route to the HQ, moved to a straight stretch), on
 * the map's own street network. Several, spread round the HQ; the first is
 * always open, the player may close the others before wave 1. The editor
 * moves them afterwards like any map's.
 */
import { MAX_SPAWN_DISTANCE, MIN_SPAWN_DISTANCE } from '../../../configs/map-constants.config';
import { CustomMapStreets } from '../../custom-map/custom-map-streets';
import { geoToMap, mapToGeo, type CustomMapDocument, type MapPoint, type MapSpawn } from '../../custom-map/map-document';

export interface LayoutOptions {
  /** Spawns wanted */
  spawns: number;
}

export interface LayoutReport {
  /** How far the HQ moved from the place onto the road, metres */
  hqShiftM: number;
  wanted: number;
  spawns: { name: string; distanceM: number; routeM: number }[];
}

/** Farthest (m) the HQ looks for a road before it takes a path */
const HQ_ROAD_REACH = 250;
/** Two spawns stand at least this far apart (m) and this far apart in bearing (degrees) seen from the HQ */
const SPAWN_SPACING_M = 250;
const SPAWN_SPACING_DEG = 40;
/** Draws per wanted spawn before the layout gives up on more */
const DRAWS_PER_SPAWN = 8;

const COMPASS = ['North', 'North-east', 'East', 'South-east', 'South', 'South-west', 'West', 'North-west'];

/**
 * Sets `doc.hq` and `doc.spawns` on the paths of `doc`; `names` gives the
 * way name per edge id for the spawns' names (the street, as on a real
 * place, else the direction)
 */
export function layOut(doc: CustomMapDocument, names: ReadonlyMap<string, string>, options: LayoutOptions): LayoutReport {
  const nodes = new Map(doc.paths.nodes.map((n) => [n.id, n]));
  const lines = doc.paths.edges.map((e) => ({ edge: e, line: [nodes.get(e.a)!, ...(e.via ?? []), nodes.get(e.b)!] }));
  const nearest = (p: MapPoint, accept: (kind: string) => boolean) => {
    let best: { point: MapPoint; dist: number; edgeId: string } | null = null;
    for (const { edge, line } of lines) {
      if (!accept(edge.kind)) continue;
      for (let s = 0; s + 1 < line.length; s++) {
        const q = closest(line[s], line[s + 1], p);
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (!best || d < best.dist) best = { point: q, dist: d, edgeId: edge.id };
      }
    }
    return best;
  };

  const place = { x: 0, y: 0 };
  const onRoad = nearest(place, (k) => k === 'road');
  const hit = onRoad && onRoad.dist <= HQ_ROAD_REACH ? onRoad : (nearest(place, () => true) ?? onRoad);
  doc.hq = hit ? { x: round2(hit.point.x), y: round2(hit.point.y) } : { ...place };
  const report: LayoutReport = { hqShiftM: Math.round(hit?.dist ?? 0), wanted: options.spawns, spawns: [] };
  doc.spawns = [];
  if (!hit || options.spawns <= 0) return report;

  const streets = new CustomMapStreets(doc);
  const network = streets.network;
  const hq = mapToGeo(doc.hq);
  const half = Math.min(doc.terrain.width, doc.terrain.depth) / 2;
  const coverage = { center: { lat: 0, lon: 0 }, radiusM: half };
  const taken = new Set<string>();
  for (let draw = 0; draw < options.spawns * DRAWS_PER_SPAWN && doc.spawns.length < options.spawns; draw++) {
    const found = streets.findRandomStreetPoint(network, hq.lat, hq.lon, MIN_SPAWN_DISTANCE, MAX_SPAWN_DISTANCE, coverage);
    if (!found) break;
    const p = geoToMap(found.lat, found.lon);
    const bearing = (Math.atan2(p.x - doc.hq.x, p.y - doc.hq.y) * 180) / Math.PI;
    const crowded = doc.spawns.some((s) => {
      const b = (Math.atan2(s.x - doc.hq.x, s.y - doc.hq.y) * 180) / Math.PI;
      const turn = Math.abs(((bearing - b + 540) % 360) - 180);
      return Math.hypot(s.x - p.x, s.y - p.y) < SPAWN_SPACING_M || turn < SPAWN_SPACING_DEG;
    });
    if (crowded) continue;
    const route = streets.findPath(network, found.lat, found.lon, hq.lat, hq.lon);
    let routeM = 0;
    for (let k = 1; k < route.length; k++) routeM += streets.haversineDistance(route[k - 1].lat, route[k - 1].lon, route[k].lat, route[k].lon);
    const street = nearest(p, () => true);
    const named = (street && names.get(street.edgeId)) || COMPASS[Math.round(((bearing + 360) % 360) / 45) % 8];
    let name = named;
    for (let n = 2; taken.has(name); n++) name = `${named} ${n}`;
    taken.add(name);
    const spawn: MapSpawn = { id: `s${doc.spawns.length + 1}`, name, x: round2(p.x), y: round2(p.y) };
    if (doc.spawns.length > 0) spawn.optional = true;
    doc.spawns.push(spawn);
    report.spawns.push({ name, distanceM: Math.round(found.distance), routeM: Math.round(routeM) });
  }
  return report;
}

function closest(a: MapPoint, b: MapPoint, p: MapPoint): MapPoint {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return { x: a.x + dx * t, y: a.y + dy * t };
}

const round2 = (v: number): number => Math.round(v * 100) / 100;
