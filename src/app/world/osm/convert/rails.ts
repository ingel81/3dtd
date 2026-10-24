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
 * Ground (levelRails in rails-ground.ts, after the roads are levelled): each line gets a height
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
 * Pieces (railPieces in rails-pieces.ts): each line is cut on a LATTICE of 2.5 m into
 * stretches of bed, crossing and bridge, every stretch's ends snapped
 * outward to it, and each stretch is tiled exactly with its kit's 10 and
 * 2.5 m pieces (crossing panels in 2.5 m), each tilted to the profile
 * between its ends (`roll`). A crossing piece is a track piece with the
 * panels over it (the same ballast, sleepers and rails), so bed and crossing
 * join end to end; crossing and bridge pieces stand on the profile. Bridges
 * get an abutment at each end, under longer spans piers; so do the road
 * bridges over the track.
 *
 * Here the lines and how they meet the roads; the numbers in rails-config.ts,
 * the plan's shapes in rails-types.ts, positions along a line in
 * rails-lines.ts.
 */
import { EdgeIndex } from '../../../map-ops/path-graph';
import type { MapPaths, MapPoint } from '../../custom-map/map-document';
import type { OsmFeatures, OsmWay } from '../osm-parse';
import { roadTags } from '../osm-tags';
import { findTunnels } from './roads';
import { unit } from './geom';
import { CROSSING_MARGIN, EDGE_INSET, LATTICE, SALTIRE_KINDS, STREET_RUNNING, THROUGH_COS, TRACK_KINDS, TUNNEL_WIDTH, UNDER_CLEARANCE, UNDERPASS_MARGIN } from './rails-config';
import type { RailBridge, RailChain, RailCrossing, RailPlan, RailStreet, RailUnder } from './rails-types';
import { merged, outside, pointOn, spanHalf } from './rails-lines';
import { bridgeSpans, crossingSpans, latticeEnd } from './rails-pieces';

const isTunnel = (tags: Readonly<Record<string, string>>): boolean => !!tags['tunnel'] && tags['tunnel'] !== 'no' && tags['tunnel'] !== 'building_passage';
const isBridge = (tags: Readonly<Record<string, string>>): boolean => !!tags['bridge'] && tags['bridge'] !== 'no';
const layerOf = (tags: Readonly<Record<string, string>>): number => {
  const n = Number.parseInt(tags['layer'] ?? '', 10);
  return Number.isFinite(n) ? n : isBridge(tags) ? 1 : 0;
};

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
    streets: [],
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
      plan.crossings.push(crossing(c, ci, c.at[i], c.line[i], roadDir, width, edge?.sidewalk ?? 0, equipment(pointTags.get(n) ?? {}, foot, c.ways[Math.min(i, c.ways.length - 1)].tags['railway'])));
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
          plan.crossings.push(crossing(c, ci, along, at, roadDir, r.tags.width, edge?.sidewalk ?? 0, kit));
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
  plan.streets = streetSpans(plan, paths);
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

function crossing(c: RailChain, chain: number, along: number, at: MapPoint, roadDir: MapPoint, roadWidth: number, pavement: number, kit: Pick<RailCrossing, 'saltire' | 'light' | 'barrier'>): RailCrossing {
  // The panels carry the pavements over the line too
  const half = spanHalf(c, along, roadDir, roadWidth / 2 + pavement + CROSSING_MARGIN);
  return { chain, along, at: { x: at.x, y: at.y }, half, roadDir, roadWidth, pavement, ...kit };
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

/**
 * Where a line runs in a road (a tramway in the street, a siding in a yard):
 * each LATTICE piece whose middle lies within the road's half width and
 * STREET_RUNNING, off its bridges and crossings
 */
function streetSpans(plan: RailPlan, paths: MapPaths): RailStreet[] {
  const roads = new EdgeIndex({ nodes: paths.nodes, edges: paths.edges.filter((e) => !e.tunnel && e.kind !== 'bridge') });
  const out: RailStreet[] = [];
  plan.chains.forEach((c, ci) => {
    const end = latticeEnd(c);
    const inRoad: [number, number][] = [];
    for (let s = 0; s < end; s += LATTICE) {
      const hit = roads.nearest(pointOn(c, s + LATTICE / 2), 20);
      if (hit && hit.dist < hit.edge.width / 2 + STREET_RUNNING) inRoad.push([s, s + LATTICE]);
    }
    const bridges = bridgeSpans(plan, ci, end);
    const cuts = merged([...bridges, ...crossingSpans(plan, ci, end, bridges)]);
    for (const [from, to] of merged(inRoad).flatMap((s) => outside(s, cuts))) out.push({ chain: ci, from, to });
  });
  return out;
}

