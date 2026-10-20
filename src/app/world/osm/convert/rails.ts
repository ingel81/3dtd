/**
 * The railway of an OSM world (docs/OSM_WORLD_PLAN.md, "Bahn und Straße",
 * TODO E238): the tracks joined into lines, where and how they meet the
 * roads, the ground under them and the pieces laid on it.
 *
 * Lines: track ways (TRACK_KINDS) joined end to end where just two meet;
 * at a switch the two running on most nearly straight (THROUGH_COS) go on as
 * one line, the others start there on its bed, their ends' profile brought
 * to its (a junction reads as one bed: no line ends in the open beside
 * another). A tunnel mouth or the end of the answer ends a line. A tunnel of
 * MIN_TUNNEL_M or more is left out and gets portals like a road's
 * (convert/tunnels.ts); a shorter one stays track.
 *
 * Where a line meets a road way, the data say how (planRails):
 * - at a node both share (`railway=level_crossing`, `railway=crossing`, or
 *   untagged): a level crossing. Panels carry the road over the rails, the
 *   track takes the road's height, and the node's `crossing:saltire`,
 *   `crossing:light` and `crossing:barrier` stand a St Andrew's cross,
 *   lights and a half barrier at each approach (a road without them: the
 *   cross; a footway: what its tags name);
 * - the track on a bridge (`bridge=*`): a rail bridge, the road passes under;
 * - the road on a bridge edge of the map: the track runs under it;
 * - the road in a tunnel the map keeps: nothing, it is not drawn;
 * - the road in a shorter tunnel (an underpass the map keeps as a road) or
 *   the track on a higher `layer`: the track crosses on a short bridge of
 *   its own, the road passes under;
 * - the track on a lower `layer` without a road bridge: panels only;
 * - otherwise (same layer, no shared node: the data miss the node): a level
 *   crossing.
 *
 * Ground (levelRails, after the roads are levelled): each line gets a height
 * profile, the ground along it averaged over SMOOTHING metres (twice that
 * on a way tagged `embankment` or `cutting`), carried straight over its
 * bridges. Where something passes under a bridge too low, the bridge and a
 * ramp on both sides rise (an embankment the heights did not know); where
 * a road bridge spans the track too low, the track sinks into a cutting
 * the same way; at a level crossing the track comes over CROSSING_RAMP
 * metres to CROSSING_SINK under the road's height (its rail heads flush with
 * the panels), following the road across it. The bed is levelled to the profile, its shoulders
 * falling about 1:1.5 into the ground; road bands, water and the ground
 * under the bridges stay as they are. Nowhere else does a bed stand over
 * the ground: the old pieces stood on the ground under their middles as
 * rigid 10 m slabs and lay across the roads at their ends like a dam.
 *
 * Pieces (railPieces): each line is cut on a LATTICE of 2.5 m into
 * stretches of bed, crossing and bridge, every stretch's ends snapped
 * outward to it, and each stretch is tiled exactly with its kit's 10 and
 * 2.5 m pieces (crossing panels in 2.5 m), each tilted to the profile
 * between its ends (`roll`). A crossing piece is a track piece with the
 * panels over it (the same ballast, sleepers and rails), so bed and crossing
 * join end to end; crossing and bridge pieces stand on the profile. Bridges
 * get an abutment at each end, under longer spans piers; so do the road
 * bridges over the track.
 */
import { heightAt } from '../../../map-ops/grid';
import { EdgeIndex } from '../../../map-ops/path-graph';
import { bridgeDecks, deckHeight, deckHeightAt } from '../../custom-map/bridge-decks';
import type { MapObject, MapPathEdge, MapPaths, MapPoint, MapTerrain } from '../../custom-map/map-document';
import { HeightField } from '../../custom-map/render/height-field';
import { bridgeWaterLevel } from '../../custom-map/render/paths/bridge-water';
import type { OsmFeatures, OsmWay } from '../osm-parse';
import { roadTags } from '../osm-tags';
import { findTunnels, paintBands, type PaintBand, type TunnelLine, type TunnelMouth } from './roads';

/** Railway kinds that get a track (no disused, abandoned or platform lines) */
export const TRACK_KINDS: ReadonlySet<string> = new Set(['rail', 'light_rail', 'tram', 'narrow_gauge', 'subway', 'funicular']);
/** Railway kinds whose level crossings with a road have a St Andrew's cross unless tagged otherwise (trams cross by traffic lights) */
const SALTIRE_KINDS: ReadonlySet<string> = new Set(['rail', 'narrow_gauge']);
/** Railway kinds whose overhead line (`electrified=contact_line`) gets masts beside the track (trams hang theirs on span wires) */
const MASTED_KINDS: ReadonlySet<string> = new Set(['rail', 'light_rail', 'narrow_gauge']);

/** The catalogue's railway models; the 10 m and 2.5 m pieces run along model X, the others face model -Y (glTF +Z) */
export const RAIL_ASSETS = {
  track: 'rail-track',
  trackShort: 'rail-track-short',
  trackWood: 'rail-track-wood',
  trackWoodShort: 'rail-track-wood-short',
  bridge: 'rail-bridge',
  bridgeShort: 'rail-bridge-short',
  crossing: 'rail-crossing',
  street: 'rail-street',
  saltire: 'crossing-saltire',
  signal: 'crossing-signal',
  barrier: 'crossing-barrier',
  abutment: 'bridge-abutment',
  pier: 'bridge-pier',
  mast: 'catenary-mast',
} as const;

/** Every asset the railway may place, for the catalogue's costs */
export const RAIL_ASSET_IDS: readonly string[] = Object.values(RAIL_ASSETS);

/** Metres of the lattice the stretches snap to: the short pieces' length */
export const LATTICE = 2.5;
/** Metres of a long piece */
const LONG = 10;
/** Half width of the levelled bed (the ballast's foot is 4.8 m wide), metres */
export const BED_HALF = 2.6;
/** Metres between the samples of a profile */
const PROFILE_STEP = 2;
/** Metres along the track the profile averages over, and on a way tagged `embankment` or `cutting` */
const SMOOTHING = 30;
const SMOOTHING_BUILT = 60;
/** Metres over which the track comes to a level crossing's height */
export const CROSSING_RAMP = 25;
/** Metres from the formation (a track piece's origin) to its rail heads, and from the road to a crossing panel's top (tools/map-assets/build_modern.py) */
export const RAIL_HEAD = 0.62;
export const PANEL_TOP = 0.08;
/**
 * Metres the formation lies under the road at a level crossing: the rail
 * heads flush with the panels, these a little over the road, the ballast
 * and sleepers under it, so bed and crossing pieces meet rail to rail
 */
export const CROSSING_SINK = RAIL_HEAD - PANEL_TOP;
/** Grade of the ramp up to a raised bridge or down into a cutting, and its shortest and longest run, metres */
const RAMP_GRADE = 0.025;
const RAMP_MIN = 20;
const RAMP_MAX = 200;
/** Metres past a road's edge within which a track's middle runs in the road (street running: embedded rails) */
const STREET_RUNNING = 0.4;
/** Metres the crossing panels reach past the road's edge, along the track */
const CROSSING_MARGIN = 0.75;
/** Least sine of the angle between track and road the spans are measured with (a crossing at 20 degrees) */
const MIN_SIN = 0.35;
/** Metres a track's own bridge over an underpass reaches past the road's edge */
const UNDERPASS_MARGIN = 3.5;
/** Headroom under a rail bridge, metres: over a road, a path, the water */
export const UNDER_CLEARANCE = { road: 4.7, path: 2.7, water: 1.5 } as const;
/** Headroom over the track under a road bridge, metres, and with an overhead line */
export const OVER_CLEARANCE = { plain: 4.9, electrified: 5.7 } as const;
/** Metres from a rail bridge's formation (the bed's level) to its underside, and from a road deck's top to its underside */
export const RAIL_DECK_DEPTH = 1.3;
const ROAD_DECK_DEPTH = 1.25;
/** The abutment and pier models: width (model X) and height at scale 1, origin at the foot; a pier's thickness */
const ABUTMENT = { width: 6.4, height: 10 };
const PIER = { width: 6, height: 12, thick: 1.6 };
/**
 * Metres an abutment's face stands inside its bridge's end: the ground the
 * bed is levelled to falls to the ground under the span within a cell or
 * so (2 m), behind the face
 */
const ABUTMENT_SET = 2.5;
/** Metres the ground must lie under a road bridge's deck before its abutment stands there */
const ABUTMENT_HEADROOM = 1;
/** Spans longer than this get piers, about PIER_SPACING apart, metres */
const PIER_SPAN = 30;
const PIER_SPACING = 25;
/** Metres a pier keeps from a track's middle and beyond a road's edge */
const PIER_TRACK_CLEAR = 3.2;
const PIER_ROAD_CLEAR = 1;
/** Where a crossing's signals stand: metres from the track's middle (across it), past the road's edge; the barrier stands farther from the track */
const SIGNAL_FROM_TRACK = 3.6;
const SIGNAL_OUT = 0.9;
const BARRIER_BACK = 1.4;
const BARRIER_OUT = 0.6;
/** Overhead line masts: metres between, from the track's middle (the arm reaches back over it), from another track's middle */
const MAST_SPACING = 50;
const MAST_OFFSET = 3.2;
const MAST_CLEAR = 2.5;
/** Metres from another line's middle within which a line's end lies on it (a branch at a switch), and over which it comes to that line's height */
const BRANCH_REACH = 1;
const BRANCH_RAMP = 20;
/** Cosine of the sharpest bend a line takes through a switch (30 degrees off straight); the other ways branch off it */
const THROUGH_COS = Math.cos((30 * Math.PI) / 180);
/** Width a rail tunnel's mouth counts with (the portal's opening is a road's) */
const TUNNEL_WIDTH = 5;
/** Metres the lines stay inside the map's edge for their tunnels' portals */
const EDGE_INSET = 1;

/** A line of track: its ways joined end to end */
export interface RailChain {
  line: MapPoint[];
  /** Metres along the line at each point */
  at: number[];
  length: number;
  /** OSM node of each point (null where the way had none) */
  nodes: (number | null)[];
  /** The way of each segment (line[k] to line[k + 1]) */
  ways: OsmWay[];
  /** The ground's height every PROFILE_STEP metres along it as the bed is laid (levelRails), null before */
  profile: Float32Array | null;
}

/** Where a line crosses a road on its level */
export interface RailCrossing {
  chain: number;
  along: number;
  at: MapPoint;
  /** Half the length of track the panels cover, metres */
  half: number;
  /** Unit direction of the road and its width */
  roadDir: MapPoint;
  roadWidth: number;
  /** What stands at each approach */
  saltire: boolean;
  light: boolean;
  barrier: boolean;
}

/** What passes under a rail bridge: the ground there and the headroom it needs */
export interface RailUnder {
  along: number;
  at: MapPoint;
  clear: number;
}

/** A stretch of line on a bridge: one the data name, or the track's own over an underpass */
export interface RailBridge {
  chain: number;
  from: number;
  to: number;
  implicit: boolean;
  under: RailUnder[];
}

/** A road bridge over a line */
export interface RailOverpass {
  chain: number;
  along: number;
  at: MapPoint;
  /** Half the length of track under the deck, metres */
  half: number;
  edge: MapPathEdge;
}

export interface RailStats {
  lines: number;
  km: number;
  crossings: number;
  /** Of them, with a cross, lights, a barrier */
  saltires: number;
  lights: number;
  barriers: number;
  bridges: number;
  /** Of them, the track's own over an underpass */
  underpasses: number;
  overpasses: number;
  tunnels: number;
}

export interface RailPlan {
  chains: RailChain[];
  crossings: RailCrossing[];
  bridges: RailBridge[];
  overpasses: RailOverpass[];
  /** Tunnels of MIN_TUNNEL_M or more and their mouths, for buildTunnels */
  tunnels: TunnelLine[];
  mouths: TunnelMouth[];
  stats: RailStats;
}

/** What levelling the beds did */
export interface RailGroundReport {
  /** Ground samples levelled */
  samples: number;
  /** Most the profile rose over the ground's average for a bridge, and sank under it for a road bridge, metres */
  raisedM: number;
  loweredM: number;
}

const isTunnel = (tags: Readonly<Record<string, string>>): boolean => !!tags['tunnel'] && tags['tunnel'] !== 'no' && tags['tunnel'] !== 'building_passage';
const isBridge = (tags: Readonly<Record<string, string>>): boolean => !!tags['bridge'] && tags['bridge'] !== 'no';
const layerOf = (tags: Readonly<Record<string, string>>): number => {
  const n = Number.parseInt(tags['layer'] ?? '', 10);
  return Number.isFinite(n) ? n : isBridge(tags) ? 1 : 0;
};
const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * The railway of `features` against the map's road graph `paths` (made by
 * buildRoads from the same features): its lines, crossings, bridges, the
 * road bridges over it and its tunnels
 */
export function planRails(features: OsmFeatures, paths: MapPaths): RailPlan {
  const ways = features.ways.filter((w) => TRACK_KINDS.has(w.tags['railway'] ?? '') && w.nodes.length >= 2);
  const lim = features.half - EDGE_INSET;
  const { tunnels, mouths, short } = findTunnels(ways.map((way) => ({ way, tags: { tunnel: isTunnel(way.tags), width: TUNNEL_WIDTH } })), lim);
  const chains = joinChains(ways.filter((w) => !isTunnel(w.tags) || short.has(w)));
  const plan: RailPlan = {
    chains,
    crossings: [],
    bridges: [],
    overpasses: [],
    tunnels,
    mouths,
    stats: { lines: chains.length, km: 0, crossings: 0, saltires: 0, lights: 0, barriers: 0, bridges: 0, underpasses: 0, overpasses: 0, tunnels: tunnels.length },
  };

  // The bridges the data name: runs of segments on bridge ways
  chains.forEach((c, ci) => {
    plan.stats.km += c.length / 1000;
    for (let k = 0; k < c.ways.length; k++) {
      if (!isBridge(c.ways[k].tags)) continue;
      const from = c.at[k];
      while (k + 1 < c.ways.length && isBridge(c.ways[k + 1].tags)) k++;
      plan.bridges.push({ chain: ci, from, to: c.at[k + 1], implicit: false, under: [] });
    }
  });

  const roads = features.ways
    .filter((w) => w.nodes.length >= 2)
    .map((way) => ({ way, tags: roadTags(way.tags) }))
    .filter((r): r is { way: OsmWay; tags: NonNullable<ReturnType<typeof roadTags>> } => r.tags !== null);
  const edges = new EdgeIndex(paths);
  const mapEdgeAt = (p: MapPoint) => edges.nearest(p, 2)?.edge ?? null;

  // Level crossings at shared nodes, one per node however many road ways meet there
  const roadsAtNode = new Map<number, number[]>();
  roads.forEach((r, k) => {
    for (const n of r.way.nodes) {
      const at = roadsAtNode.get(n);
      if (at) at.push(k);
      else roadsAtNode.set(n, [k]);
    }
  });
  const pointTags = new Map(features.points.map((p) => [p.id, p.tags]));
  const sharedAt = new Map<number, number[]>();
  chains.forEach((c, ci) => {
    c.nodes.forEach((n, i) => {
      if (n === null || !roadsAtNode.has(n)) return;
      const edge = mapEdgeAt(c.line[i]);
      if (edge && (edge.tunnel || edge.kind === 'bridge')) return;
      const at = roadsAtNode.get(n)!.map((k) => roads[k]);
      const first = at[0];
      const j = first.way.nodes.indexOf(n);
      const a = first.way.points[Math.max(0, j - 1)];
      const b = first.way.points[Math.min(first.way.points.length - 1, j + 1)];
      if (!a || !b) return;
      const roadDir = unit({ x: b.x - a.x, y: b.y - a.y });
      const width = Math.max(...at.map((r) => r.tags.width));
      const foot = at.every((r) => r.tags.kind === 'path');
      plan.crossings.push(crossing(c, ci, c.at[i], c.line[i], roadDir, width, equipment(pointTags.get(n) ?? {}, foot, c.ways[Math.min(i, c.ways.length - 1)].tags['railway'])));
      sharedAt.set(ci, [...(sharedAt.get(ci) ?? []), c.at[i]]);
    });
  });

  // Where a line passes a road way between nodes: by bridge, tunnel and layer
  const cells = new SegmentCells(roads.map((r) => r.way));
  chains.forEach((c, ci) => {
    // A crossing on a point of the line comes up on both its segments: once
    const done: { way: number; along: number }[] = [];
    for (let k = 0; k + 1 < c.line.length; k++) {
      const p = c.line[k];
      const q = c.line[k + 1];
      for (const hit of cells.crossing(p, q)) {
        const r = roads[hit.way];
        const along = c.at[k] + hit.t * (c.at[k + 1] - c.at[k]);
        // A node the two share is a level crossing already
        if ((sharedAt.get(ci) ?? []).some((s) => Math.abs(s - along) < 1)) continue;
        if (done.some((d) => d.way === hit.way && Math.abs(d.along - along) < 1)) continue;
        done.push({ way: hit.way, along });
        const at = hit.at;
        const roadDir = unit({ x: hit.b.x - hit.a.x, y: hit.b.y - hit.a.y });
        const track = c.ways[k].tags;
        const edge = mapEdgeAt(at);
        if (edge?.tunnel) continue;
        const clear = r.tags.kind === 'path' ? UNDER_CLEARANCE.path : UNDER_CLEARANCE.road;
        if (edge?.kind === 'bridge' && !(isBridge(track) && layerOf(track) > layerOf(r.way.tags))) {
          plan.overpasses.push({ chain: ci, along, at, half: spanHalf(c, along, roadDir, edge.width / 2), edge });
        } else if (isBridge(track)) {
          plan.bridges.find((b) => b.chain === ci && along >= b.from - 0.5 && along <= b.to + 0.5)?.under.push({ along, at, clear });
        } else if (r.tags.tunnel || layerOf(track) > layerOf(r.way.tags)) {
          const half = spanHalf(c, along, roadDir, r.tags.width / 2 + UNDERPASS_MARGIN);
          addUnderpass(plan, ci, along - half, along + half, { along, at, clear });
        } else {
          const below = layerOf(track) < layerOf(r.way.tags);
          const kit = below ? { saltire: false, light: false, barrier: false } : equipment({}, r.tags.kind === 'path', track['railway']);
          plan.crossings.push(crossing(c, ci, along, at, roadDir, r.tags.width, kit));
        }
      }
    }
  });

  // A crossing on a bridge is none: the bridge carries the track over the road
  plan.crossings = plan.crossings.filter((x) => !plan.bridges.some((b) => b.chain === x.chain && x.along > b.from && x.along < b.to));
  plan.bridges.sort((a, b) => a.chain - b.chain || a.from - b.from);
  const s = plan.stats;
  s.km = Math.round(s.km * 100) / 100;
  s.crossings = plan.crossings.length;
  s.saltires = plan.crossings.filter((x) => x.saltire).length;
  s.lights = plan.crossings.filter((x) => x.light).length;
  s.barriers = plan.crossings.filter((x) => x.barrier).length;
  s.bridges = plan.bridges.length;
  s.underpasses = plan.bridges.filter((b) => b.implicit).length;
  s.overpasses = plan.overpasses.length;
  return plan;
}

/**
 * What stands at a level crossing's approaches, from its node's tags: a
 * road's St Andrew's cross on a railway (`rail`, `narrow_gauge`) unless
 * `crossing:saltire=no`, a footway's or a tramway's only when tagged;
 * lights with `crossing:light=yes`; a barrier with a half or full one
 * (`crossing:barrier`)
 */
export function equipment(tags: Readonly<Record<string, string>>, foot: boolean, railway = 'rail'): Pick<RailCrossing, 'saltire' | 'light' | 'barrier'> {
  const saltire = tags['crossing:saltire'];
  return {
    saltire: foot || !SALTIRE_KINDS.has(railway) ? saltire === 'yes' : saltire !== 'no',
    light: tags['crossing:light'] === 'yes',
    barrier: /^(yes|half|full|double_half)$/.test(tags['crossing:barrier'] ?? ''),
  };
}

function crossing(c: RailChain, chain: number, along: number, at: MapPoint, roadDir: MapPoint, roadWidth: number, kit: Pick<RailCrossing, 'saltire' | 'light' | 'barrier'>): RailCrossing {
  const half = spanHalf(c, along, roadDir, roadWidth / 2 + CROSSING_MARGIN);
  return { chain, along, at: { x: at.x, y: at.y }, half, roadDir, roadWidth, ...kit };
}

/**
 * Half the length of track over which a band `reach` metres either side of
 * a road's middle (direction `roadDir`) and the bed's width overlap: the
 * band's own reach along the track, and the bed's corners at a slant
 */
function spanHalf(c: RailChain, along: number, roadDir: MapPoint, reach: number): number {
  const t = directionAt(c, along);
  const sin = Math.max(MIN_SIN, Math.abs(t.x * roadDir.y - t.y * roadDir.x));
  const cos = Math.abs(t.x * roadDir.x + t.y * roadDir.y);
  return reach / sin + (BED_HALF * cos) / sin;
}

/** Half the length of a line's middle inside a crossing's road */
function roadReach(c: RailChain, x: RailCrossing): number {
  const t = directionAt(c, x.along);
  const sin = Math.max(MIN_SIN, Math.abs(t.x * x.roadDir.y - t.y * x.roadDir.x));
  return x.roadWidth / 2 / sin;
}

/** A track's own bridge over an underpass, merged into the bridges it overlaps */
function addUnderpass(plan: RailPlan, chain: number, from: number, to: number, under: RailUnder): void {
  const over = plan.bridges.filter((b) => b.chain === chain && b.from <= to && b.to >= from);
  const merged: RailBridge = { chain, from: Math.min(from, ...over.map((b) => b.from)), to: Math.max(to, ...over.map((b) => b.to)), implicit: over.every((b) => b.implicit), under: [under, ...over.flatMap((b) => b.under)] };
  plan.bridges = [...plan.bridges.filter((b) => !over.includes(b)), merged];
}

/** The track ways' runs (cut where the answer has no point) joined end to end where just two meet */
function joinChains(ways: readonly OsmWay[]): RailChain[] {
  interface Run {
    way: OsmWay;
    points: MapPoint[];
    nodes: (number | null)[];
  }
  const runs: Run[] = [];
  for (const way of ways) {
    let cur: Run | null = null;
    way.points.forEach((p, k) => {
      if (!p) {
        cur = null;
        return;
      }
      if (!cur) runs.push((cur = { way, points: [], nodes: [] }));
      cur.points.push(p);
      cur.nodes.push(way.nodes[k] ?? null);
    });
  }
  const live = runs.filter((r) => r.points.length >= 2);
  // How often a node is used: a run's end once, an inner node twice
  const uses = new Map<number, number>();
  const endsAt = new Map<number, number[]>();
  live.forEach((r, k) => {
    r.nodes.forEach((n, i) => {
      if (n === null) return;
      const end = i === 0 || i === r.nodes.length - 1;
      uses.set(n, (uses.get(n) ?? 0) + (end ? 1 : 2));
      if (end) endsAt.set(n, [...(endsAt.get(n) ?? []), k]);
    });
  });
  // Which run each run's end at a node joins: of two ends, each other; at a switch (more ends, none passing through)
  // the two running on most nearly straight, the through line, the others branching off it
  const partner = new Map<string, number>();
  const key = (n: number, r: number) => `${n}:${r}`;
  const away = (r: Run, n: number): MapPoint => {
    const k = r.nodes[0] === n ? 1 : r.nodes.length - 2;
    const at = r.nodes[0] === n ? 0 : r.nodes.length - 1;
    return unit({ x: r.points[k].x - r.points[at].x, y: r.points[k].y - r.points[at].y });
  };
  for (const [n, ends] of endsAt) {
    if (ends.length < 2 || uses.get(n) !== ends.length || new Set(ends).size < ends.length) continue;
    let best: [number, number] | null = null;
    let straightest = ends.length === 2 ? Infinity : -THROUGH_COS;
    for (let i = 0; i < ends.length; i++) {
      for (let j = i + 1; j < ends.length; j++) {
        const a = away(live[ends[i]], n);
        const b = away(live[ends[j]], n);
        const dot = a.x * b.x + a.y * b.y;
        if (dot < straightest) {
          straightest = dot;
          best = [ends[i], ends[j]];
        }
      }
    }
    if (!best) continue;
    partner.set(key(n, best[0]), best[1]);
    partner.set(key(n, best[1]), best[0]);
  }
  const joined = (n: number | null, r: number): number | undefined => (n === null ? undefined : partner.get(key(n, r)));
  const otherEnd = (r: Run, n: number | null) => (r.nodes[0] === n ? r.nodes[r.nodes.length - 1] : r.nodes[0]);
  const used = new Uint8Array(live.length);
  const chains: RailChain[] = [];
  for (let k = 0; k < live.length; k++) {
    if (used[k]) continue;
    // Back from run k to the chain's free end, then forward from there
    let start = k;
    let head = live[k].nodes[0];
    const back = new Set([k]);
    for (;;) {
      const other = joined(head, start);
      if (other === undefined || back.has(other)) break;
      back.add(other);
      start = other;
      head = otherEnd(live[other], head);
    }
    const line: MapPoint[] = [];
    const nodes: (number | null)[] = [];
    const segWays: OsmWay[] = [];
    let cur = start;
    let from = head;
    for (;;) {
      used[cur] = 1;
      const r = live[cur];
      const flip = from !== null && r.nodes[0] !== from;
      const points = flip ? [...r.points].reverse() : r.points;
      const ids = flip ? [...r.nodes].reverse() : r.nodes;
      for (let i = line.length ? 1 : 0; i < points.length; i++) {
        line.push(points[i]);
        nodes.push(ids[i]);
        if (line.length > 1) segWays.push(r.way);
      }
      const tail = ids[ids.length - 1];
      const next = joined(tail, cur);
      if (next === undefined || used[next]) break;
      cur = next;
      from = tail;
    }
    const at = [0];
    for (let i = 1; i < line.length; i++) at.push(at[i - 1] + Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y));
    chains.push({ line, at, length: at[at.length - 1], nodes, ways: segWays, profile: null });
  }
  return chains;
}

/** Road way segments in a grid of 32 m cells, for the ones a track segment crosses */
class SegmentCells {
  private readonly cells = new Map<number, { way: number; a: MapPoint; b: MapPoint }[]>();
  private static readonly CELL = 32;

  constructor(ways: readonly OsmWay[]) {
    ways.forEach((w, k) => {
      for (let i = 0; i + 1 < w.points.length; i++) {
        const a = w.points[i];
        const b = w.points[i + 1];
        if (!a || !b) continue;
        for (const key of this.keys(a, b)) {
          let list = this.cells.get(key);
          if (!list) this.cells.set(key, (list = []));
          list.push({ way: k, a, b });
        }
      }
    });
  }

  /** The road segments segment p-q crosses: the way, the point, its share along p-q, the road segment's ends */
  crossing(p: MapPoint, q: MapPoint): { way: number; at: MapPoint; t: number; a: MapPoint; b: MapPoint }[] {
    const out: { way: number; at: MapPoint; t: number; a: MapPoint; b: MapPoint }[] = [];
    const seen = new Set<{ way: number; a: MapPoint; b: MapPoint }>();
    for (const key of this.keys(p, q)) {
      for (const s of this.cells.get(key) ?? []) {
        if (seen.has(s)) continue;
        seen.add(s);
        const hit = intersect(p, q, s.a, s.b);
        if (hit) out.push({ way: s.way, at: hit.at, t: hit.t, a: s.a, b: s.b });
      }
    }
    return out;
  }

  private keys(a: MapPoint, b: MapPoint): number[] {
    const c = SegmentCells.CELL;
    const out: number[] = [];
    for (let j = Math.floor(Math.min(a.y, b.y) / c); j <= Math.floor(Math.max(a.y, b.y) / c); j++) {
      for (let i = Math.floor(Math.min(a.x, b.x) / c); i <= Math.floor(Math.max(a.x, b.x) / c); i++) out.push((i + 100_000) * 200_003 + (j + 100_000));
    }
    return out;
  }
}

/** Where segments p-q and a-b cross (both ends counted), with the share along p-q; null when they do not */
function intersect(p: MapPoint, q: MapPoint, a: MapPoint, b: MapPoint): { at: MapPoint; t: number } | null {
  const rx = q.x - p.x;
  const ry = q.y - p.y;
  const sx = b.x - a.x;
  const sy = b.y - a.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((a.x - p.x) * sy - (a.y - p.y) * sx) / den;
  const u = ((a.x - p.x) * ry - (a.y - p.y) * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { at: { x: p.x + rx * t, y: p.y + ry * t }, t };
}

const unit = (v: MapPoint): MapPoint => {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
};

/** The segment of `c` that `along` falls on */
function segmentAt(c: RailChain, along: number): number {
  let lo = 0;
  let hi = c.at.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (c.at[mid] <= along) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, lo);
}

/** The point `along` metres down the line (clamped to it) */
export function pointOn(c: RailChain, along: number): MapPoint {
  const k = segmentAt(c, along);
  const a = c.line[k];
  const b = c.line[k + 1];
  const len = c.at[k + 1] - c.at[k];
  const t = len > 0 ? Math.max(0, Math.min(1, (along - c.at[k]) / len)) : 0;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Unit direction of the line at `along` */
function directionAt(c: RailChain, along: number): MapPoint {
  const k = segmentAt(c, along);
  return unit({ x: c.line[k + 1].x - c.line[k].x, y: c.line[k + 1].y - c.line[k].y });
}

/** Height of the line's profile at `along` (the ground there when it has none) */
export function profileAt(c: RailChain, along: number, terrain: MapTerrain): number {
  if (!c.profile) {
    const p = pointOn(c, along);
    return heightAt(terrain, p.x, p.y);
  }
  const f = Math.max(0, Math.min(c.profile.length - 1, along / PROFILE_STEP));
  const k = Math.min(c.profile.length - 2, Math.floor(f));
  if (k < 0) return c.profile[0];
  const s = f - k;
  return c.profile[k] * (1 - s) + c.profile[k + 1] * s;
}

/**
 * The profile of every line (RailChain.profile) and the ground levelled to
 * it under the beds (after the roads are levelled and the water carved).
 * `keep`: ground samples left alone (the road bands and the water); by
 * default the road bands of `paths`
 */
export function levelRails(terrain: MapTerrain, plan: RailPlan, paths: MapPaths, keep?: (k: number) => boolean): RailGroundReport {
  const report: RailGroundReport = { samples: 0, raisedM: 0, loweredM: 0 };
  const field = new HeightField(terrain.grid, terrain.width, terrain.depth);
  const decks = plan.overpasses.length ? bridgeDecks(paths, terrain, field) : [];
  plan.chains.forEach((c, ci) => {
    const bridges = plan.bridges.filter((b) => b.chain === ci);
    const base = groundProfile(c, terrain, bridges);
    const out = Float32Array.from(base);
    const n = base.length;
    const sAt = (k: number) => Math.min(c.length, k * PROFILE_STEP);
    const baseAt = (s: number) => {
      const f = Math.max(0, Math.min(n - 1, s / PROFILE_STEP));
      const k = Math.min(n - 2, Math.floor(f));
      return k < 0 ? base[0] : base[k] + (base[k + 1] - base[k]) * (f - k);
    };
    // A bump of `d` metres over [from, to], ramped out on both sides
    const bump = (from: number, to: number, d: number) => {
      const ramp = Math.max(RAMP_MIN, Math.min(RAMP_MAX, Math.abs(d) / RAMP_GRADE));
      for (let k = 0; k < n; k++) {
        const s = sAt(k);
        const off = s < from ? from - s : s > to ? s - to : 0;
        if (off < ramp) out[k] += d * (1 - smooth(off / ramp));
      }
    };
    for (const b of bridges) {
      const hA = baseAt(b.from);
      const hB = baseAt(b.to);
      const deck = (s: number) => hA + ((hB - hA) * (s - b.from)) / Math.max(1e-6, b.to - b.from);
      let d = 0;
      for (const u of b.under) d = Math.max(d, heightAt(terrain, u.at.x, u.at.y) + u.clear + RAIL_DECK_DEPTH - deck(u.along));
      const water = bridgeWaterLevel(slice(c, b.from, b.to), terrain, field);
      if (Number.isFinite(water)) d = Math.max(d, water + UNDER_CLEARANCE.water + RAIL_DECK_DEPTH - Math.min(hA, hB));
      if (d > 0.01) {
        bump(b.from, b.to, d);
        report.raisedM = Math.max(report.raisedM, d);
      }
    }
    const electrified = c.ways.some((w) => w.tags['electrified'] === 'contact_line');
    for (const o of plan.overpasses.filter((x) => x.chain === ci)) {
      const top = deckHeightAt(decks, o.at.x, o.at.y);
      if (!Number.isFinite(top)) continue;
      const d = top - ROAD_DECK_DEPTH - (electrified ? OVER_CLEARANCE.electrified : OVER_CLEARANCE.plain) - baseAt(o.along);
      if (d < -0.01) {
        bump(o.along - o.half, o.along + o.half, d);
        report.loweredM = Math.max(report.loweredM, -d);
      }
    }
    // Last: CROSSING_SINK under the road at each level crossing, the road's height read on its middle (it is level
    // across) where the line crosses it, held from its edges on: a graded road climbs across a slanted crossing
    for (const x of plan.crossings.filter((x) => x.chain === ci)) {
      const reach = roadReach(c, x);
      for (let k = 0; k < n; k++) {
        const s = sAt(k);
        const off = Math.max(0, Math.abs(s - x.along) - x.half);
        if (off >= CROSSING_RAMP) continue;
        const p = pointOn(c, Math.max(x.along - reach, Math.min(x.along + reach, s)));
        const d = (p.x - x.at.x) * x.roadDir.x + (p.y - x.at.y) * x.roadDir.y;
        const h = heightAt(terrain, x.at.x + x.roadDir.x * d, x.at.y + x.roadDir.y * d) - CROSSING_SINK;
        out[k] = h + (out[k] - h) * smooth(off / CROSSING_RAMP);
      }
    }
    c.profile = out;
  });
  // A line starting or ending on another (a branch at a switch) takes that line's height there, over BRANCH_RAMP
  const lines = new LineIndex(plan.chains);
  const ends = plan.chains.map((c) =>
    [0, c.length].map((s) => {
      const on = lines.nearest(pointOn(c, s), BRANCH_REACH, c);
      if (!on || plan.bridges.some((b) => b.chain === plan.chains.indexOf(on.chain) && on.along > b.from && on.along < b.to)) return NaN;
      const there = profileAt(on.chain, on.along, terrain);
      // Two ends meeting (a bend too sharp for a through line): halfway, so both come to the same height
      return on.along < BRANCH_REACH || on.along > on.chain.length - BRANCH_REACH ? (there + profileAt(c, s, terrain)) / 2 : there;
    }),
  );
  plan.chains.forEach((c, ci) => {
    const out = c.profile!;
    const [h0, h1] = ends[ci];
    const d0 = h0 === h0 ? h0 - out[0] : 0;
    const d1 = h1 === h1 ? h1 - out[out.length - 1] : 0;
    if (!d0 && !d1) return;
    for (let k = 0; k < out.length; k++) {
      const s = Math.min(c.length, k * PROFILE_STEP);
      out[k] += d0 * (1 - smooth(s / BRANCH_RAMP)) + d1 * (1 - smooth((c.length - s) / BRANCH_RAMP));
    }
  });
  report.raisedM = Math.round(report.raisedM * 100) / 100;
  report.loweredM = Math.round(report.loweredM * 100) / 100;
  report.samples = levelBeds(terrain, plan, paths, keep);
  return report;
}

/**
 * The ground along a line every PROFILE_STEP metres, straight over its
 * bridges, averaged over SMOOTHING metres (SMOOTHING_BUILT on ways tagged
 * `embankment` or `cutting`); toward its ends over less, evenly either side,
 * so a line ends on the ground there (lines meeting at a switch agree) and
 * a grade stays a grade
 */
function groundProfile(c: RailChain, terrain: MapTerrain, bridges: readonly RailBridge[]): Float32Array {
  const n = Math.max(2, Math.ceil(c.length / PROFILE_STEP) + 1);
  const raw = new Float64Array(n);
  const wide = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const s = Math.min(c.length, k * PROFILE_STEP);
    const p = pointOn(c, s);
    raw[k] = heightAt(terrain, p.x, p.y);
    const t = c.ways[segmentAt(c, s)].tags;
    wide[k] = t['embankment'] === 'yes' || t['cutting'] === 'yes' ? 1 : 0;
  }
  // Over a bridge, straight from end to end: the ground under it is no part of the line
  for (const b of bridges) {
    const k0 = Math.max(0, Math.floor(b.from / PROFILE_STEP));
    const k1 = Math.min(n - 1, Math.ceil(b.to / PROFILE_STEP));
    for (let k = k0 + 1; k < k1; k++) raw[k] = raw[k0] + ((raw[k1] - raw[k0]) * (k - k0)) / (k1 - k0);
  }
  const sum = new Float64Array(n + 1);
  for (let k = 0; k < n; k++) sum[k + 1] = sum[k] + raw[k];
  const out = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const half = Math.min(Math.round((wide[k] ? SMOOTHING_BUILT : SMOOTHING) / PROFILE_STEP / 2), k, n - 1 - k);
    out[k] = (sum[k + half + 1] - sum[k - half]) / (2 * half + 1);
  }
  return out;
}

/** The points of the line from `from` to `to` metres */
function slice(c: RailChain, from: number, to: number): MapPoint[] {
  const out = [pointOn(c, from)];
  for (let k = 0; k < c.line.length; k++) if (c.at[k] > from && c.at[k] < to) out.push(c.line[k]);
  out.push(pointOn(c, to));
  return out;
}

/** Most metres a bed's shoulder reaches past its levelled width (1:1.5 down a high embankment) */
const SHOULDER_MAX = 12;
const SHOULDER_MIN = 1.5;
const SHOULDER_SLOPE = 1.5;

/**
 * Levels the ground under the beds to the lines' profiles: the nearest
 * line's, flat over BED_HALF, the shoulder fading over 1.5 times the step
 * it makes; under a level crossing's panels past the road CROSSING_SINK
 * higher, at the road's level (the panels lie in the ground as on the road,
 * the bed's ground falls to the formation where they end); the bridges'
 * ground and what `keep` names untouched (by default the road bands).
 * Returns the samples changed.
 */
function levelBeds(terrain: MapTerrain, plan: RailPlan, paths: MapPaths, keep?: (k: number) => boolean): number {
  const g = terrain.grid;
  const cs = g.cellSize;
  const ox = -terrain.width / 2;
  const oy = -terrain.depth / 2;
  const reach = BED_HALF + SHOULDER_MAX;
  // Per sample the nearest line's distance and its profile there (NaN: over a bridge); the samples touched in order
  const dist = new Float32Array(g.columns * g.rows).fill(Infinity);
  const target = new Float32Array(g.columns * g.rows);
  const touched: number[] = [];
  plan.chains.forEach((c, ci) => {
    if (!c.profile) return;
    const bridges = plan.bridges.filter((b) => b.chain === ci);
    const panels = plan.crossings.filter((x) => x.chain === ci).map(crossingSpan);
    for (let k = 0; k + 1 < c.line.length; k++) {
      const a = c.line[k];
      const b = c.line[k + 1];
      const len = c.at[k + 1] - c.at[k];
      if (len <= 0) continue;
      const dx = (b.x - a.x) / len;
      const dy = (b.y - a.y) / len;
      const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - reach - ox) / cs));
      const i1 = Math.min(g.columns - 1, Math.ceil((Math.max(a.x, b.x) + reach - ox) / cs));
      const j0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - reach - oy) / cs));
      const j1 = Math.min(g.rows - 1, Math.ceil((Math.max(a.y, b.y) + reach - oy) / cs));
      for (let j = j0; j <= j1; j++) {
        const y = oy + j * cs;
        for (let i = i0; i <= i1; i++) {
          const x = ox + i * cs;
          const t = Math.max(0, Math.min(len, (x - a.x) * dx + (y - a.y) * dy));
          const d = Math.hypot(a.x + dx * t - x, a.y + dy * t - y);
          const key = j * g.columns + i;
          if (d >= reach || d >= dist[key]) continue;
          if (dist[key] === Infinity) touched.push(key);
          dist[key] = d;
          const along = c.at[k] + t;
          target[key] = bridges.some((br) => along > br.from - 0.5 && along < br.to + 0.5)
            ? NaN
            : profileAt(c, along, terrain) + (panels.some(([from, to]) => along > from && along < to) ? CROSSING_SINK : 0);
        }
      }
    }
  });
  let onRoad = keep;
  if (!onRoad) {
    const roads = new EdgeIndex({ nodes: paths.nodes, edges: paths.edges.filter((e) => e.kind !== 'bridge' && !e.tunnel) });
    onRoad = (key) => {
      const hit = roads.nearest({ x: ox + (key % g.columns) * cs, y: oy + Math.floor(key / g.columns) * cs }, 20);
      return !!hit && hit.dist < hit.edge.width / 2 + 0.25;
    };
  }
  let changed = 0;
  for (const key of touched) {
    const h = target[key];
    const d = dist[key];
    if (h !== h) continue;
    const cur = g.heights[key];
    const shoulder = Math.max(SHOULDER_MIN, Math.min(SHOULDER_MAX, Math.abs(h - cur) * SHOULDER_SLOPE));
    if (d >= BED_HALF + shoulder || onRoad(key)) continue;
    const w = d <= BED_HALF ? 1 : 1 - smooth((d - BED_HALF) / shoulder);
    g.heights[key] = cur + (h - cur) * w;
    changed++;
  }
  return changed;
}

/** The ground beside a bed: gravel over its foot and a strip past it, fading into the land */
export const RAIL_GROUND = { material: 'gravel', half: BED_HALF + 0.6, soft: 1.4 } as const;

/** The ground materials paintRails lays for `plan` (none without track) */
export function railPaintMaterials(plan: RailPlan): Set<string> {
  return new Set(plan.chains.length ? [RAIL_GROUND.material] : []);
}

/**
 * The ground beside the beds painted (after the land, before the roads, so
 * a road over a crossing keeps its surface): RAIL_GROUND along every line
 * off its bridges. Returns the materials that got a layer
 */
export function paintRails(terrain: MapTerrain, plan: RailPlan): string[] {
  const bands: PaintBand[] = [];
  plan.chains.forEach((c, ci) => {
    const cuts = merged(plan.bridges.filter((b) => b.chain === ci).map((b) => [b.from, b.to]));
    for (const [from, to] of outside([0, c.length], cuts)) {
      if (to - from < 0.5) continue;
      bands.push({ line: slice(c, from, to), material: RAIL_GROUND.material, half: RAIL_GROUND.half, soft: RAIL_GROUND.soft });
    }
  });
  return paintBands(terrain, bands);
}

/** One piece of the railway as furniture places it */
export interface RailPiece {
  o: Omit<MapObject, 'id'>;
  source: 'track' | 'crossing' | 'crossing signal' | 'rail bridge' | 'abutment' | 'pier' | 'catenary';
  /** The line's group (its first way), for the editor */
  group: string;
  /** Checks furniture leaves out for this piece: it stands on a road or over water by design */
  onRoad?: boolean;
  overWater?: boolean;
}

/** The long and short piece of each kind of stretch (a kit of one piece is tiled in 2.5 m) */
const KITS: Record<Stretch['kind'], readonly [string, string]> = {
  bed: [RAIL_ASSETS.track, RAIL_ASSETS.trackShort],
  bridge: [RAIL_ASSETS.bridge, RAIL_ASSETS.bridgeShort],
  crossing: [RAIL_ASSETS.crossing, RAIL_ASSETS.crossing],
  street: [RAIL_ASSETS.street, RAIL_ASSETS.street],
};

/** The bed's kit on timber sleepers */
const TIMBER_KIT = [RAIL_ASSETS.trackWood, RAIL_ASSETS.trackWoodShort] as const;

/**
 * Whether a track lies on timber sleepers: narrow gauge, and sidings, yards
 * and spurs (`service`, `usage=industrial`), where old timber lasts; main
 * lines and tramways on concrete
 */
export function timberSleepers(tags: Readonly<Record<string, string>>): boolean {
  return tags['railway'] === 'narrow_gauge' || /^(siding|yard|spur)$/.test(tags['service'] ?? '') || tags['usage'] === 'industrial';
}

interface Stretch {
  from: number;
  to: number;
  kind: 'bed' | 'crossing' | 'street' | 'bridge';
}

/**
 * The pieces of `plan` on `terrain` (after levelRails; without it the lines
 * lie on the ground as it is): the tracks tiled on their lattice, crossing
 * panels and signals, bridges with abutments and piers, the overhead line's
 * masts, and the abutments and piers of the road bridges over the track
 */
export function railPieces(plan: RailPlan, terrain: MapTerrain, paths: MapPaths): RailPiece[] {
  const out: RailPiece[] = [];
  const ground = (p: MapPoint) => heightAt(terrain, p.x, p.y);
  const roads = new EdgeIndex({ nodes: paths.nodes, edges: paths.edges.filter((e) => !e.tunnel) });
  const groundRoads = new EdgeIndex({ nodes: paths.nodes, edges: paths.edges.filter((e) => !e.tunnel && e.kind !== 'bridge') });
  const trackIndex = new LineIndex(plan.chains);
  plan.chains.forEach((c, ci) => {
    const group = `osm-w${c.ways[0].id}`;
    const stretches = stretchesOf(c, ci, plan, groundRoads);
    for (const st of stretches) {
      const kit = st.kind === 'bed' && timberSleepers(c.ways[segmentAt(c, (st.from + st.to) / 2)].tags) ? TIMBER_KIT : KITS[st.kind];
      const source = st.kind === 'bed' || st.kind === 'street' ? 'track' : st.kind === 'bridge' ? 'rail bridge' : 'crossing';
      for (const [from, len] of tile(st.from, st.to, kit[0] === kit[1] ? 0 : LONG)) {
        const a = pointOn(c, from);
        const b = pointOn(c, from + len);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const rotation = wrap(Math.atan2(-(b.x - a.x), b.y - a.y) + Math.PI / 2);
        // Model +X points back to `a`: tilted so it rises with the profile from b to a
        const roll = Math.atan2(profileAt(c, from, terrain) - profileAt(c, from + len, terrain), len);
        // Bridges and crossings stand on the profile (a crossing's formation under the road, its ballast hidden by it), the bed on the ground levelled to it
        const z = st.kind === 'bridge' || st.kind === 'crossing' ? profileAt(c, from + len / 2, terrain) - ground(mid) : 0;
        const o: Omit<MapObject, 'id'> = { asset: len >= LONG ? kit[0] : kit[1], x: round2(mid.x), y: round2(mid.y), z: round2(z), rotation: round3(rotation), scale: 1 };
        if (Math.abs(roll) > 1e-4) o.roll = round3(roll);
        out.push({ o, source, group, onRoad: st.kind !== 'bed', overWater: st.kind === 'bridge' });
      }
    }
    // Overhead line masts beside the bed, none on a crossing or bridge, none on a neighbouring track
    if (c.ways.some((w) => w.tags['electrified'] === 'contact_line' && MASTED_KINDS.has(w.tags['railway']))) {
      const n = Math.max(1, Math.round(c.length / MAST_SPACING));
      for (let k = 0; k < n; k++) {
        const s0 = (k * c.length) / n;
        const s1 = ((k + 1) * c.length) / n;
        const sm = (s0 + s1) / 2;
        if (!stretches.some((st) => st.kind === 'bed' && sm > st.from + 2 && sm < st.to - 2)) continue;
        const a = pointOn(c, s0);
        const b = pointOn(c, s1);
        const d = unit({ x: b.x - a.x, y: b.y - a.y });
        const mid = pointOn(c, sm);
        // On the left of the line (the arm, model back, over the track)
        const p = { x: mid.x - d.y * MAST_OFFSET, y: mid.y + d.x * MAST_OFFSET };
        if (trackIndex.near(p, MAST_CLEAR)) continue;
        const rotation = wrap(Math.atan2(-d.x, d.y) + Math.PI / 2);
        out.push({ o: { asset: RAIL_ASSETS.mast, x: round2(p.x), y: round2(p.y), z: 0, rotation: round3(rotation), scale: 1 }, source: 'catenary', group });
      }
    }
  });
  for (const x of plan.crossings) out.push(...signals(plan.chains[x.chain], x, `osm-w${plan.chains[x.chain].ways[0].id}`));
  for (const b of plan.bridges) out.push(...bridgeSupports(plan.chains[b.chain], b, terrain, roads, trackIndex));
  out.push(...overpassSupports(plan, terrain, paths, roads, trackIndex));
  return out;
}

/**
 * A line's stretches of bed, crossing, street and bridge, on its lattice,
 * covering it end to end. Where a line runs in a road (a tramway in the
 * street, a siding in a yard) its rails lie in the road's asphalt
 */
function stretchesOf(c: RailChain, ci: number, plan: RailPlan, roads: EdgeIndex): Stretch[] {
  const snapDown = (s: number) => Math.max(0, Math.floor(s / LATTICE) * LATTICE);
  const end = Math.max(LATTICE, Math.round(c.length / LATTICE) * LATTICE);
  const snapUp = (s: number) => Math.min(end, Math.ceil(s / LATTICE) * LATTICE);
  const bridges = merged(plan.bridges.filter((b) => b.chain === ci).map((b) => [snapDown(b.from), snapUp(b.to)]));
  // Bridges win: a crossing keeps what lies off them
  const inRoad: [number, number][] = [];
  for (let s = 0; s < end; s += LATTICE) {
    const hit = roads.nearest(pointOn(c, s + LATTICE / 2), 20);
    if (hit && hit.dist < hit.edge.width / 2 + STREET_RUNNING) inRoad.push([s, s + LATTICE]);
  }
  const crossings = merged(
    plan.crossings.filter((x) => x.chain === ci).map((x) => {
      const [from, to] = crossingSpan(x);
      return [Math.max(0, from), Math.min(end, to)];
    }),
  ).flatMap((s) => outside(s, bridges));
  const street = merged(inRoad).flatMap((s) => outside(s, merged([...bridges, ...crossings])));
  const spans: Stretch[] = [
    ...bridges.map(([from, to]) => ({ from, to, kind: 'bridge' as const })),
    ...crossings.map(([from, to]) => ({ from, to, kind: 'crossing' as const })),
    ...street.map(([from, to]) => ({ from, to, kind: 'street' as const })),
  ].sort((a, b) => a.from - b.from);
  const out: Stretch[] = [];
  let at = 0;
  for (const s of spans) {
    if (s.from > at) out.push({ from: at, to: s.from, kind: 'bed' });
    out.push(s);
    at = s.to;
  }
  if (at < end) out.push({ from: at, to: end, kind: 'bed' });
  return out;
}

/** The stretch of line a crossing's panels cover: their half length either side, snapped outward to the lattice */
function crossingSpan(x: RailCrossing): [number, number] {
  return [Math.floor((x.along - x.half) / LATTICE) * LATTICE, Math.ceil((x.along + x.half) / LATTICE) * LATTICE];
}

/** Spans [from, to] with the overlapping ones joined, in order */
function merged(spans: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [from, to] of [...spans].sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else if (to > from) out.push([from, to]);
  }
  return out;
}

/** The parts of span `s` outside all of `cuts` (in order, not overlapping) */
function outside(s: [number, number], cuts: readonly [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  let from = s[0];
  for (const [a, b] of cuts) {
    if (b <= from || a >= s[1]) continue;
    if (a > from) out.push([from, a]);
    from = Math.max(from, b);
  }
  if (from < s[1]) out.push([from, s[1]]);
  return out;
}

/**
 * Pieces from `from` to `to` (a whole number of LATTICE): long ones where
 * `long` is given, the short ones split between the two ends; [start, length]
 */
function tile(from: number, to: number, long: number): [number, number][] {
  const total = Math.round((to - from) / LATTICE);
  const longs = long > 0 ? Math.floor((total * LATTICE) / long) : 0;
  const shorts = total - (longs * long) / LATTICE;
  const lead = Math.ceil(shorts / 2);
  const out: [number, number][] = [];
  let s = from;
  for (let k = 0; k < lead; k++, s += LATTICE) out.push([s, LATTICE]);
  for (let k = 0; k < longs; k++, s += long) out.push([s, long]);
  for (let k = lead; k < shorts; k++, s += LATTICE) out.push([s, LATTICE]);
  return out;
}

/**
 * The St Andrew's crosses, lights and barriers of a level crossing: on the
 * right of each approach (driving on the right), facing the traffic, where
 * the road is SIGNAL_FROM_TRACK from the track's middle; the barrier a
 * little farther back
 */
function signals(c: RailChain, x: RailCrossing, group: string): RailPiece[] {
  if (!x.saltire && !x.light && !x.barrier) return [];
  const t = directionAt(c, x.along);
  const sin = Math.max(MIN_SIN, Math.abs(t.x * x.roadDir.y - t.y * x.roadDir.x));
  const out: RailPiece[] = [];
  for (const side of [1, -1]) {
    // Traffic from this side drives toward the crossing, along -side * roadDir
    const v = { x: -side * x.roadDir.x, y: -side * x.roadDir.y };
    const right = { x: v.y, y: -v.x };
    // The front (model -Y) toward the traffic coming
    const facing = wrap(Math.atan2(-side * x.roadDir.x, side * x.roadDir.y));
    const place = (fromTrack: number, out_: number) => {
      const d = fromTrack / sin;
      return { x: x.at.x + side * x.roadDir.x * d + right.x * (x.roadWidth / 2 + out_), y: x.at.y + side * x.roadDir.y * d + right.y * (x.roadWidth / 2 + out_) };
    };
    if (x.saltire || x.light) {
      const p = place(SIGNAL_FROM_TRACK, SIGNAL_OUT);
      out.push({ o: { asset: x.light ? RAIL_ASSETS.signal : RAIL_ASSETS.saltire, x: round2(p.x), y: round2(p.y), z: 0, rotation: round3(facing), scale: 1 }, source: 'crossing signal', group });
    }
    if (x.barrier) {
      const p = place(SIGNAL_FROM_TRACK + BARRIER_BACK, BARRIER_OUT);
      out.push({ o: { asset: RAIL_ASSETS.barrier, x: round2(p.x), y: round2(p.y), z: 0, rotation: round3(facing), scale: 1 }, source: 'crossing signal', group });
    }
  }
  return out;
}

/** The abutments at a rail bridge's ends (faces toward the span) and piers under a long span */
function bridgeSupports(c: RailChain, b: RailBridge, terrain: MapTerrain, roads: EdgeIndex, tracks: LineIndex): RailPiece[] {
  const group = `osm-w${c.ways[0].id}`;
  const out: RailPiece[] = [];
  const top = (s: number) => profileAt(c, s, terrain) - RAIL_DECK_DEPTH;
  const set = Math.max(0, Math.min(ABUTMENT_SET, (b.to - b.from) / 2 - 1));
  for (const [s, into] of [[b.from + set, 1], [b.to - set, -1]] as const) {
    const p = pointOn(c, s);
    const d = directionAt(c, s);
    const f = { x: d.x * into, y: d.y * into };
    const o = support(RAIL_ASSETS.abutment, p, f, top(s), heightAt(terrain, p.x, p.y), 1, ABUTMENT.height);
    if (o) out.push({ o, source: 'abutment', group, onRoad: true, overWater: true });
  }
  for (const s of pierStations(b.from, b.to)) {
    const p = pointOn(c, s);
    const along = directionAt(c, s);
    // Wide across the track
    if (blocked(p, { x: -along.y, y: along.x }, roads, tracks, c)) continue;
    const o = support(RAIL_ASSETS.pier, p, along, top(s), heightAt(terrain, p.x, p.y), 1, PIER.height);
    if (o) out.push({ o, source: 'pier', group, onRoad: true, overWater: true });
  }
  return out;
}

/** The abutments at the ends of each road bridge over the track, and its piers between the tracks */
function overpassSupports(plan: RailPlan, terrain: MapTerrain, paths: MapPaths, roads: EdgeIndex, tracks: LineIndex): RailPiece[] {
  const out: RailPiece[] = [];
  const field = new HeightField(terrain.grid, terrain.width, terrain.depth);
  const decks = bridgeDecks(paths, terrain, field);
  for (const edge of new Set(plan.overpasses.map((o) => o.edge))) {
    const deck = decks.find((d) => d.edge === edge);
    if (!deck) continue;
    const group = `osm-bridge-${edge.id}`;
    const scale = Math.max(1, (edge.width + 1) / ABUTMENT.width);
    const line = deck.line;
    const at = (s: number) => {
      const k = Math.max(0, Math.min(line.length - 2, deck.at.findIndex((a) => a > s) - 1));
      const t = Math.max(0, Math.min(1, (s - deck.at[k]) / Math.max(1e-6, deck.at[k + 1] - deck.at[k])));
      const a = line[k];
      const b = line[k + 1];
      return { p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, dir: unit({ x: b.x - a.x, y: b.y - a.y }) };
    };
    // From each end inward, where the ground first falls ABUTMENT_HEADROOM under the deck: the face holds the embankment behind it
    const free = (s: number) => {
      const { p } = at(s);
      return deckHeight(deck, s / deck.total) - ROAD_DECK_DEPTH - heightAt(terrain, p.x, p.y) >= ABUTMENT_HEADROOM;
    };
    const steps = Math.floor(deck.total);
    let from = -1;
    let to = -1;
    for (let s = 0; s <= steps && from < 0; s++) if (free(s)) from = s;
    for (let s = steps; s >= 0 && to < 0; s--) if (free(s)) to = s;
    if (from >= 0 && to - from >= 4) {
      for (const [s, into] of [[from, 1], [to, -1]] as const) {
        const { p, dir } = at(s);
        const o = support(RAIL_ASSETS.abutment, p, { x: dir.x * into, y: dir.y * into }, deckHeight(deck, s / deck.total) - ROAD_DECK_DEPTH, heightAt(terrain, p.x, p.y), scale, ABUTMENT.height);
        if (o) out.push({ o, source: 'abutment', group, onRoad: true, overWater: true });
      }
    }
    if (deck.total < PIER_SPAN) continue;
    for (const s of pierStations(0, deck.total)) {
      const k = Math.max(0, deck.at.findIndex((a) => a > s) - 1);
      const a = line[k];
      const b = line[Math.min(line.length - 1, k + 1)];
      const t = (s - deck.at[k]) / Math.max(1e-6, deck.at[k + 1] - deck.at[k]);
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const along = unit({ x: b.x - a.x, y: b.y - a.y });
      const scale = Math.max(1, edge.width / PIER.width);
      if (blocked(p, { x: -along.y * scale, y: along.x * scale }, roads, tracks, null, edge)) continue;
      const h = deckHeightAt([deck], p.x, p.y);
      const o = support(RAIL_ASSETS.pier, p, along, h - ROAD_DECK_DEPTH, heightAt(terrain, p.x, p.y), scale, PIER.height);
      if (o) out.push({ o, source: 'pier', group, onRoad: true, overWater: true });
    }
  }
  return out;
}

/** Stations of the piers under a span from `from` to `to`, about PIER_SPACING apart; none under a short one */
function pierStations(from: number, to: number): number[] {
  const span = to - from;
  if (span < PIER_SPAN) return [];
  const n = Math.round(span / PIER_SPACING);
  return Array.from({ length: n - 1 }, (_, k) => from + ((k + 1) * span) / n);
}

/**
 * Whether a pier at `p`, its width along `across` (a unit vector times its
 * scale), would stand on a road (other than the bridge it carries) or a
 * track bed (other than the line it carries): five points along its width
 */
function blocked(p: MapPoint, across: MapPoint, roads: EdgeIndex, tracks: LineIndex, own: RailChain | null, ownEdge?: MapPathEdge): boolean {
  for (let k = -2; k <= 2; k++) {
    const q = { x: p.x + (across.x * PIER.width * k) / 4, y: p.y + (across.y * PIER.width * k) / 4 };
    for (const { edge, a, b } of roads.segmentsNear(q, 25)) {
      if (edge === ownEdge || edge.kind === 'bridge') continue;
      if (distance(q, a, b) < edge.width / 2 + PIER_ROAD_CLEAR + PIER.thick / 2) return true;
    }
    if (tracks.near(q, PIER_TRACK_CLEAR + PIER.thick / 2, own)) return true;
  }
  return false;
}

/**
 * An abutment or pier (origin at its foot, `height` tall at scale 1) whose
 * top is at `top`, facing `f`: sunk into the ground, scaled up where the
 * top is higher over the ground than the model; null where the top is
 * under the ground
 */
function support(asset: string, p: MapPoint, f: MapPoint, top: number, ground: number, scale: number, height: number): Omit<MapObject, 'id'> | null {
  if (top <= ground + 0.3) return null;
  const s = Math.max(scale, (top - ground + 1) / height);
  return { asset, x: round2(p.x), y: round2(p.y), z: round2(top - height * s - ground), rotation: round3(wrap(Math.atan2(-f.x, f.y))), scale: round3(s) };
}

const distance = (p: MapPoint, a: MapPoint, b: MapPoint): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y);
};

/** Whether `p` lies on a track bed of `plan` (within its levelled width): other furniture keeps off */
export function onTrackBed(plan: RailPlan, reach = BED_HALF): (p: MapPoint) => boolean {
  const index = new LineIndex(plan.chains);
  return (p) => index.near(p, reach);
}

/** The lines' segments in a grid of 16 m cells, for the nearest track to a point */
class LineIndex {
  private readonly cells = new Map<number, { chain: RailChain; k: number; a: MapPoint; b: MapPoint }[]>();
  private static readonly CELL = 16;

  constructor(chains: readonly RailChain[]) {
    for (const chain of chains) {
      for (let k = 0; k + 1 < chain.line.length; k++) {
        const a = chain.line[k];
        const b = chain.line[k + 1];
        const c = LineIndex.CELL;
        for (let j = Math.floor(Math.min(a.y, b.y) / c); j <= Math.floor(Math.max(a.y, b.y) / c); j++) {
          for (let i = Math.floor(Math.min(a.x, b.x) / c); i <= Math.floor(Math.max(a.x, b.x) / c); i++) {
            const key = (i + 100_000) * 200_003 + (j + 100_000);
            let list = this.cells.get(key);
            if (!list) this.cells.set(key, (list = []));
            list.push({ chain, k, a, b });
          }
        }
      }
    }
  }

  /** Whether a track's middle (of a line other than `except`) lies within `r` of `p` */
  near(p: MapPoint, r: number, except: RailChain | null = null): boolean {
    const c = LineIndex.CELL;
    for (let j = Math.floor((p.y - r) / c); j <= Math.floor((p.y + r) / c); j++) {
      for (let i = Math.floor((p.x - r) / c); i <= Math.floor((p.x + r) / c); i++) {
        for (const s of this.cells.get((i + 100_000) * 200_003 + (j + 100_000)) ?? []) {
          if (s.chain !== except && distance(p, s.a, s.b) < r) return true;
        }
      }
    }
    return false;
  }

  /** The nearest track's middle within `r` of `p` (of a line other than `except`): its line and the metres along it */
  nearest(p: MapPoint, r: number, except: RailChain | null = null): { chain: RailChain; along: number } | null {
    const c = LineIndex.CELL;
    let best: { chain: RailChain; along: number } | null = null;
    let bestD = r;
    for (let j = Math.floor((p.y - r) / c); j <= Math.floor((p.y + r) / c); j++) {
      for (let i = Math.floor((p.x - r) / c); i <= Math.floor((p.x + r) / c); i++) {
        for (const s of this.cells.get((i + 100_000) * 200_003 + (j + 100_000)) ?? []) {
          if (s.chain === except) continue;
          const d = distance(p, s.a, s.b);
          if (d >= bestD) continue;
          const len = s.chain.at[s.k + 1] - s.chain.at[s.k];
          const t = len > 0 ? Math.max(0, Math.min(len, ((p.x - s.a.x) * (s.b.x - s.a.x) + (p.y - s.a.y) * (s.b.y - s.a.y)) / len)) : 0;
          bestD = d;
          best = { chain: s.chain, along: s.chain.at[s.k] + t };
        }
      }
    }
    return best;
  }
}

const wrap = (r: number): number => ((r % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
const round2 = (v: number): number => Math.round(v * 100) / 100;
const round3 = (v: number): number => Math.round(v * 1000) / 1000;
