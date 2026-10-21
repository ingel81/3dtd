/**
 * HQ and spawns of an OSM world, as on the real places: the HQ on the road
 * nearest the place, the spawns drawn as a real place draws its random spawn
 * (StreetRouter.findRandomStreetPoint: a node 500 to 1000 m away on a
 * drivable street, with a route to the HQ, moved to a straight stretch), on
 * the map's own street network. Several, spread round the HQ; the first is
 * always open, the player may close the others before wave 1. Most of them
 * arrive where people do (convert/anchors.ts: a station, a harbour, a large
 * car park, a stop) and take its name; the rest are drawn on any street.
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
import type { SpawnAnchor } from './anchors';

/** Why a spawn cannot stand where the player dropped it; the frame words it (osm.dropReasons) */
export type SpawnDropReason = 'no-streets' | 'no-street-near' | 'edge' | 'near-hq' | 'far-hq' | 'tunnel' | 'no-route';

export interface LayoutOptions {
  /** Spawns wanted when none are given */
  spawns: number;
  /** Where the spawns go (map metres, the frame's choice); each lands on its street as `OsmLayout.at` drops it */
  at?: readonly MapPoint[];
  /** The place the HQ goes to (map metres); the map's middle when absent */
  place?: MapPoint;
  /** Where people arrive (convert/anchors.ts): drawn spawns prefer them, and a spawn near one takes its name */
  anchors?: readonly SpawnAnchor[];
  /** The dice of drawn spawns, 0..1; Math.random when absent (the frame rolls again for the player) */
  random?: () => number;
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
/** Farthest (m) an anchor reaches for its road (a station stands back from the street) */
const ANCHOR_ROAD_REACH = 120;
/** A spawn this close (m) to an anchor takes its name */
const ANCHOR_NAME_REACH = 60;
/**
 * Share of the drawn spawns that try an anchor first; the others are drawn
 * on any street, so a roll again finds new streets and not the same station
 */
const ANCHOR_SHARE = 0.75;
/** How much more likely each anchor tier comes first (stations, then harbours and car parks, then stops) */
const ANCHOR_TIER_WEIGHT = [4, 2, 1];

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
  /** The anchors in reach of a spawn, each on the foot of its road, once */
  private feet: { anchor: SpawnAnchor; foot: MapPoint; distance: number }[] | null = null;

  /**
   * `place`: where the HQ goes, map metres (the frame's square may stand off
   * it); the map's middle when absent. `anchors`: where people arrive.
   * `random`: the dice of `draw`; a stream seeded from the place makes the
   * same map from the same data (convertOsm)
   */
  constructor(
    map: StreetMap,
    private readonly names: ReadonlyMap<string, string>,
    place: MapPoint = { x: 0, y: 0 },
    private readonly anchors: readonly SpawnAnchor[] = [],
    private readonly random: () => number = Math.random,
  ) {
    const nodes = new Map(map.paths.nodes.map((n) => [n.id, n]));
    // A tunnel holds neither the HQ nor a spawn: both would stand in the hill
    this.lines = map.paths.edges.map((e) => ({ edgeId: e.id, kind: e.tunnel ? 'tunnel' : e.kind, line: [nodes.get(e.a)!, ...(e.via ?? []), nodes.get(e.b)!] }));
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
    const crowded = (p: MapPoint) => {
      const bearing = bearingOf(hqPoint, p);
      return taken.some((s) => {
        const turn = Math.abs(((bearing - bearingOf(hqPoint, s) + 540) % 360) - 180);
        return Math.hypot(s.x - p.x, s.y - p.y) < SPAWN_SPACING_M || turn < SPAWN_SPACING_DEG;
      });
    };
    const take = (laid: LaidSpawn | null): boolean => {
      if (!laid) return false;
      taken.push({ x: laid.x, y: laid.y });
      out.push(laid);
      return true;
    };
    const anchors = this.anchorOrder(hqPoint);
    for (let draw = 0; draw < count * DRAWS_PER_SPAWN && out.length < count; draw++) {
      // An anchor first for most spawns; the next one that stands apart from the others
      if (anchors.length && this.random() < ANCHOR_SHARE) {
        let placed = false;
        while (anchors.length && !placed) {
          const a = anchors.shift()!;
          if (!crowded(a.foot)) placed = take(this.laid(a.foot, a.distance, a.anchor.name));
        }
        if (placed) continue;
      }
      const found = this.streets.findRandomStreetPoint(this.network, hq.lat, hq.lon, MIN_SPAWN_DISTANCE, MAX_SPAWN_DISTANCE, coverage, this.random);
      if (!found) break;
      const p = geoToMap(found.lat, found.lon);
      if (crowded(p)) continue;
      take(this.laid(p, found.distance));
    }
    return out;
  }

  /**
   * The anchors a spawn may stand at, each on the foot of its road, in the
   * order they are tried: a draw weighted by tier (the earlier tiers more
   * likely first), so a roll again may find another
   */
  private anchorOrder(hq: MapPoint): { anchor: SpawnAnchor; foot: MapPoint; distance: number }[] {
    this.feet ??= this.anchorFeet(hq);
    return this.feet
      .map((f) => ({ ...f, key: Math.pow(this.random(), 1 / (ANCHOR_TIER_WEIGHT[f.anchor.tier] ?? 1)) }))
      .sort((a, b) => b.key - a.key);
  }

  /**
   * The anchors a spawn may stand at on the foot of their road: in the
   * spawns' distance from the HQ and off the map's edge. The roads go into
   * a grid first, so a city's hundreds of stops do not each read every road
   */
  private anchorFeet(hq: MapPoint): { anchor: SpawnAnchor; foot: MapPoint; distance: number }[] {
    const near = this.anchors.filter((a) => {
      const d = Math.hypot(a.x - hq.x, a.y - hq.y);
      return d >= MIN_SPAWN_DISTANCE - ANCHOR_ROAD_REACH && d <= MAX_SPAWN_DISTANCE + ANCHOR_ROAD_REACH;
    });
    if (!near.length) return [];
    const cell = ANCHOR_ROAD_REACH;
    const grid = new Map<string, [MapPoint, MapPoint][]>();
    for (const { kind, line } of this.lines) {
      if (kind !== 'road') continue;
      for (let s = 0; s + 1 < line.length; s++) {
        const a = line[s];
        const b = line[s + 1];
        for (let i = Math.floor(Math.min(a.x, b.x) / cell); i <= Math.floor(Math.max(a.x, b.x) / cell); i++) {
          for (let j = Math.floor(Math.min(a.y, b.y) / cell); j <= Math.floor(Math.max(a.y, b.y) / cell); j++) {
            const key = `${i},${j}`;
            const list = grid.get(key);
            if (list) list.push([a, b]);
            else grid.set(key, [[a, b]]);
          }
        }
      }
    }
    const lim = this.half - EDGE_ROOM;
    const out: { anchor: SpawnAnchor; foot: MapPoint; distance: number }[] = [];
    for (const anchor of near) {
      let best: MapPoint | null = null;
      let bestD = ANCHOR_ROAD_REACH;
      const ci = Math.floor(anchor.x / cell);
      const cj = Math.floor(anchor.y / cell);
      for (let i = ci - 1; i <= ci + 1; i++) {
        for (let j = cj - 1; j <= cj + 1; j++) {
          for (const [a, b] of grid.get(`${i},${j}`) ?? []) {
            const q = closest(a, b, anchor);
            const d = Math.hypot(q.x - anchor.x, q.y - anchor.y);
            if (d <= bestD) {
              best = q;
              bestD = d;
            }
          }
        }
      }
      if (!best) continue;
      const foot = { x: round2(best.x), y: round2(best.y) };
      if (Math.abs(foot.x) > lim || Math.abs(foot.y) > lim) continue;
      const distance = Math.hypot(foot.x - hq.x, foot.y - hq.y);
      if (distance >= MIN_SPAWN_DISTANCE && distance <= MAX_SPAWN_DISTANCE) out.push({ anchor, foot, distance });
    }
    return out;
  }

  /**
   * A spawn dropped at `p`: on the foot of the nearest street, as a spawn
   * dropped on a real place lands, with its route; or why it may not stand
   * there
   */
  at(p: MapPoint): LaidSpawn | { reason: SpawnDropReason } {
    const hqPoint = this.hq;
    if (!hqPoint) return { reason: 'no-streets' };
    const geo = mapToGeo(p);
    const nearest = this.streets.findNearestStreetPoint(this.network, geo.lat, geo.lon);
    if (!nearest || nearest.distance > DROP_STREET_REACH) return { reason: 'no-street-near' };
    const a = geoToMap(nearest.street.nodes[nearest.nodeIndex].lat, nearest.street.nodes[nearest.nodeIndex].lon);
    const b = geoToMap(nearest.street.nodes[nearest.nodeIndex + 1].lat, nearest.street.nodes[nearest.nodeIndex + 1].lon);
    const foot = closest(a, b, p);
    const lim = this.half - EDGE_ROOM;
    if (Math.abs(foot.x) > lim || Math.abs(foot.y) > lim) return { reason: 'edge' };
    const distance = Math.hypot(foot.x - hqPoint.x, foot.y - hqPoint.y);
    if (distance < MIN_MANUAL_SPAWN_DISTANCE) return { reason: 'near-hq' };
    if (distance > MAX_MANUAL_SPAWN_DISTANCE) return { reason: 'far-hq' };
    if (this.inTunnel(foot)) return { reason: 'tunnel' };
    return this.laid({ x: round2(foot.x), y: round2(foot.y) }, distance) ?? { reason: 'no-route' };
  }

  /**
   * The spawn at `p` with its name and route, null without a route. Its name:
   * `name` when given, else the anchor near it, else its street's, else the
   * bearing from the HQ
   */
  private laid(p: MapPoint, distanceM: number, name?: string): LaidSpawn | null {
    const hq = mapToGeo(this.hq!);
    const from = mapToGeo(p);
    const route = this.streets.findPath(this.network, from.lat, from.lon, hq.lat, hq.lon);
    if (route.length < 2 || this.inTunnel(p)) return null;
    let routeM = 0;
    for (let k = 1; k < route.length; k++) routeM += this.streets.haversineDistance(route[k - 1].lat, route[k - 1].lon, route[k].lat, route[k].lon);
    const street = this.nearest(p, () => true);
    name ||= this.anchorNear(p)?.name || (street && this.names.get(street.edgeId)) || COMPASS[Math.round(((bearingOf(this.hq!, p) + 360) % 360) / 45) % 8];
    const step = Math.max(1, Math.ceil(route.length / ROUTE_POINTS));
    const line = route.filter((_, k) => k % step === 0 || k === route.length - 1).map((n) => roundPoint(geoToMap(n.lat, n.lon)));
    return { name, x: round2(p.x), y: round2(p.y), distanceM: Math.round(distanceM), routeM: Math.round(routeM), route: line };
  }

  /** The anchor nearest `p` within ANCHOR_NAME_REACH, the earlier tier first */
  private anchorNear(p: MapPoint): SpawnAnchor | null {
    let best: SpawnAnchor | null = null;
    let bestD = ANCHOR_NAME_REACH;
    for (const a of this.anchors) {
      const d = Math.hypot(a.x - p.x, a.y - p.y) + a.tier * 10;
      if (d <= bestD) {
        best = a;
        bestD = d;
      }
    }
    return best;
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
  const layout = new OsmLayout(doc, names, options.place, options.anchors, options.random);
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
