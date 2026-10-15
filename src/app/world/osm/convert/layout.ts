/**
 * HQ and spawns of an OSM world, as on the real places: the HQ on the road
 * nearest the place, the spawns drawn as a real place draws its random spawn
 * (StreetRouter.findRandomStreetPoint: a node 500 to 1000 m away on a
 * drivable street, with a route to the HQ, moved to a straight stretch), on
 * the map's own street network. Several, spread round the HQ; the first is
 * always open, the player may close the others before wave 1.
 *
 * The frame before the making (components/osm-frame) draws them with
 * `OsmLayout.draw` and drops a dragged one on its street with `OsmLayout.at`,
 * as a spawn dropped on a real place lands (MapPlacementService.checkSpawn);
 * `layOut` puts what the frame chose into the map. The editor moves them
 * afterwards like any map's.
 */
import { MAX_MANUAL_SPAWN_DISTANCE, MAX_SPAWN_DISTANCE, MIN_MANUAL_SPAWN_DISTANCE, MIN_SPAWN_DISTANCE } from '../../../configs/map-constants.config';
import type { StreetNetwork } from '../../../interfaces/street-network-provider.interface';
import { CustomMapStreets, type StreetMap } from '../../custom-map/custom-map-streets';
import { geoToMap, mapToGeo, type CustomMapDocument, type MapPoint, type MapSpawn } from '../../custom-map/map-document';

export interface LayoutOptions {
  /** Spawns wanted when none are given */
  spawns: number;
  /** Where the spawns go (map metres, the frame's choice); each lands on its street as `OsmLayout.at` drops it */
  at?: readonly MapPoint[];
}

export interface LayoutReport {
  /** How far the HQ moved from the place onto the road, metres */
  hqShiftM: number;
  wanted: number;
  spawns: { name: string; distanceM: number; routeM: number }[];
}

/** A spawn as the frame shows it: where it stands, its name and its route to the HQ */
export interface LaidSpawn {
  name: string;
  x: number;
  y: number;
  /** Straight from the HQ, metres */
  distanceM: number;
  routeM: number;
  /** The route to the HQ, thinned for a drawing */
  route: MapPoint[];
}

/** Farthest (m) the HQ looks for a road before it takes a path */
const HQ_ROAD_REACH = 250;
/** Two spawns stand at least this far apart (m) and this far apart in bearing (degrees) seen from the HQ */
const SPAWN_SPACING_M = 250;
const SPAWN_SPACING_DEG = 40;
/** Draws per wanted spawn before the layout gives up on more */
const DRAWS_PER_SPAWN = 8;
/** Farthest (m) a dropped spawn reaches for its street: the frame's map is coarser than the game's flag */
const DROP_STREET_REACH = 100;
/** A spawn keeps this far (m) from the map's edge, room for its portal */
const EDGE_ROOM = 40;
/** Points of a route kept for the frame's drawing */
const ROUTE_POINTS = 160;

const COMPASS = ['North', 'North-east', 'East', 'South-east', 'South', 'South-west', 'West', 'North-west'];

/** The HQ and the spawns of a map's paths; `names` gives the way name per edge id (a spawn takes its street's name, as on a real place) */
export class OsmLayout {
  /** Where the HQ stands, null for a map without paths */
  readonly hq: MapPoint | null;
  /** How far the HQ moved from the place onto the road, metres */
  readonly hqShiftM: number;
  private readonly streets: CustomMapStreets;
  private readonly network: StreetNetwork;
  private readonly lines: { edgeId: string; kind: string; line: MapPoint[] }[];
  private readonly half: number;

  constructor(
    map: StreetMap,
    private readonly names: ReadonlyMap<string, string>,
  ) {
    const nodes = new Map(map.paths.nodes.map((n) => [n.id, n]));
    // A tunnel holds neither the HQ nor a spawn: both would stand in the hill
    this.lines = map.paths.edges.map((e) => ({ edgeId: e.id, kind: e.tunnel ? 'tunnel' : e.kind, line: [nodes.get(e.a)!, ...(e.via ?? []), nodes.get(e.b)!] }));
    const place = { x: 0, y: 0 };
    const onRoad = this.nearest(place, (k) => k === 'road');
    const hit = onRoad && onRoad.dist <= HQ_ROAD_REACH ? onRoad : (this.nearest(place, (k) => k !== 'tunnel') ?? onRoad);
    this.hq = hit ? { x: round2(hit.point.x), y: round2(hit.point.y) } : null;
    this.hqShiftM = Math.round(hit?.dist ?? 0);
    this.streets = new CustomMapStreets(map);
    this.network = this.streets.network;
    this.half = Math.min(map.terrain.width, map.terrain.depth) / 2;
  }

  /**
   * `count` spawns drawn as on a real place, apart from each other and from
   * `keep` (spawns already standing); fewer where the streets give no more
   */
  draw(count: number, keep: readonly MapPoint[] = []): LaidSpawn[] {
    const hqPoint = this.hq;
    if (!hqPoint || count <= 0) return [];
    const hq = mapToGeo(hqPoint);
    const coverage = { center: { lat: 0, lon: 0 }, radiusM: this.half };
    const taken = keep.map((p) => ({ x: p.x, y: p.y }));
    const out: LaidSpawn[] = [];
    for (let draw = 0; draw < count * DRAWS_PER_SPAWN && out.length < count; draw++) {
      const found = this.streets.findRandomStreetPoint(this.network, hq.lat, hq.lon, MIN_SPAWN_DISTANCE, MAX_SPAWN_DISTANCE, coverage);
      if (!found) break;
      const p = geoToMap(found.lat, found.lon);
      const bearing = bearingOf(hqPoint, p);
      const crowded = taken.some((s) => {
        const turn = Math.abs(((bearing - bearingOf(hqPoint, s) + 540) % 360) - 180);
        return Math.hypot(s.x - p.x, s.y - p.y) < SPAWN_SPACING_M || turn < SPAWN_SPACING_DEG;
      });
      if (crowded) continue;
      const laid = this.laid(p, found.distance);
      if (!laid) continue;
      taken.push(p);
      out.push(laid);
    }
    return out;
  }

  /**
   * A spawn dropped at `p`: on the foot of the nearest street, as a spawn
   * dropped on a real place lands, with its route; or why it may not stand
   * there
   */
  at(p: MapPoint): LaidSpawn | { reason: string } {
    const hqPoint = this.hq;
    if (!hqPoint) return { reason: 'This place has no streets' };
    const geo = mapToGeo(p);
    const nearest = this.streets.findNearestStreetPoint(this.network, geo.lat, geo.lon);
    if (!nearest || nearest.distance > DROP_STREET_REACH) return { reason: 'No street near here' };
    const a = geoToMap(nearest.street.nodes[nearest.nodeIndex].lat, nearest.street.nodes[nearest.nodeIndex].lon);
    const b = geoToMap(nearest.street.nodes[nearest.nodeIndex + 1].lat, nearest.street.nodes[nearest.nodeIndex + 1].lon);
    const foot = closest(a, b, p);
    const lim = this.half - EDGE_ROOM;
    if (Math.abs(foot.x) > lim || Math.abs(foot.y) > lim) return { reason: 'Too close to the edge of the map' };
    const distance = Math.hypot(foot.x - hqPoint.x, foot.y - hqPoint.y);
    if (distance < MIN_MANUAL_SPAWN_DISTANCE) return { reason: 'Too close to the HQ' };
    if (distance > MAX_MANUAL_SPAWN_DISTANCE) return { reason: 'Too far from the HQ' };
    if (this.inTunnel(foot)) return { reason: 'Inside a tunnel' };
    return this.laid({ x: round2(foot.x), y: round2(foot.y) }, distance) ?? { reason: 'No route to the HQ from here' };
  }

  /** The spawn at `p` with its name and route, null without a route */
  private laid(p: MapPoint, distanceM: number): LaidSpawn | null {
    const hq = mapToGeo(this.hq!);
    const from = mapToGeo(p);
    const route = this.streets.findPath(this.network, from.lat, from.lon, hq.lat, hq.lon);
    if (route.length < 2 || this.inTunnel(p)) return null;
    let routeM = 0;
    for (let k = 1; k < route.length; k++) routeM += this.streets.haversineDistance(route[k - 1].lat, route[k - 1].lon, route[k].lat, route[k].lon);
    const street = this.nearest(p, () => true);
    const name = (street && this.names.get(street.edgeId)) || COMPASS[Math.round(((bearingOf(this.hq!, p) + 360) % 360) / 45) % 8];
    const step = Math.max(1, Math.ceil(route.length / ROUTE_POINTS));
    const line = route.filter((_, k) => k % step === 0 || k === route.length - 1).map((n) => roundPoint(geoToMap(n.lat, n.lon)));
    return { name, x: round2(p.x), y: round2(p.y), distanceM: Math.round(distanceM), routeM: Math.round(routeM), route: line };
  }

  /** `p` lies on a tunnel edge rather than on the road it meets at the mouth */
  private inTunnel(p: MapPoint): boolean {
    const street = this.nearest(p, () => true);
    return street?.kind === 'tunnel' && street.dist < 0.5 && (this.nearest(p, (k) => k !== 'tunnel')?.dist ?? Infinity) >= 0.5;
  }

  private nearest(p: MapPoint, accept: (kind: string) => boolean): { point: MapPoint; dist: number; edgeId: string; kind: string } | null {
    let best: { point: MapPoint; dist: number; edgeId: string; kind: string } | null = null;
    for (const { edgeId, kind, line } of this.lines) {
      if (!accept(kind)) continue;
      for (let s = 0; s + 1 < line.length; s++) {
        const q = closest(line[s], line[s + 1], p);
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (!best || d < best.dist) best = { point: q, dist: d, edgeId, kind };
      }
    }
    return best;
  }
}

/**
 * Sets `doc.hq` and `doc.spawns` on the paths of `doc`: the spawns at
 * `options.at` where given (a point that may not hold one is left out),
 * else drawn
 */
export function layOut(doc: CustomMapDocument, names: ReadonlyMap<string, string>, options: LayoutOptions): LayoutReport {
  const layout = new OsmLayout(doc, names);
  doc.hq = layout.hq ?? { x: 0, y: 0 };
  const wanted = options.at?.length ?? options.spawns;
  const report: LayoutReport = { hqShiftM: layout.hqShiftM, wanted, spawns: [] };
  doc.spawns = [];
  const laid = options.at
    ? options.at.map((p) => layout.at(p)).filter((s): s is LaidSpawn => !('reason' in s))
    : layout.draw(options.spawns);
  const taken = new Set<string>();
  for (const s of laid) {
    let name = s.name;
    for (let n = 2; taken.has(name); n++) name = `${s.name} ${n}`;
    taken.add(name);
    const spawn: MapSpawn = { id: `s${doc.spawns.length + 1}`, name, x: s.x, y: s.y };
    if (doc.spawns.length > 0) spawn.optional = true;
    doc.spawns.push(spawn);
    report.spawns.push({ name, distanceM: s.distanceM, routeM: s.routeM });
  }
  return report;
}

/** Bearing of `p` seen from `from`, degrees from north */
function bearingOf(from: MapPoint, p: MapPoint): number {
  return (Math.atan2(p.x - from.x, p.y - from.y) * 180) / Math.PI;
}

function closest(a: MapPoint, b: MapPoint, p: MapPoint): MapPoint {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return { x: a.x + dx * t, y: a.y + dy * t };
}

const round2 = (v: number): number => Math.round(v * 100) / 100;
const roundPoint = (p: MapPoint): MapPoint => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 });
