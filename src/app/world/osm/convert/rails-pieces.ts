/**
 * The railways' objects (rails.ts, phase 3): track kits along each chain
 * cut at bridges, crossings and streets, signals and barriers at the
 * crossings, abutments and piers under the bridges and overpasses, and a
 * lookup of the track lines.
 */
import type { MapObject, MapPathEdge, MapPaths, MapPoint, MapTerrain } from '../../custom-map/map-document';
import { ABUTMENT, ABUTMENT_HEADROOM, ABUTMENT_SET, BARRIER_BACK, BARRIER_OUT, BED_HALF, LATTICE, LONG, MAST_CLEAR, MAST_OFFSET, MAST_SPACING, MASTED_KINDS, MIN_SIN, PIER, PIER_ROAD_CLEAR, PIER_SPACING, PIER_SPAN, PIER_TRACK_CLEAR, RAIL_ASSETS, RAIL_DECK_DEPTH, ROAD_DECK_DEPTH, SIGNAL_FROM_TRACK, SIGNAL_OUT } from './rails-config';
import type { RailBridge, RailChain, RailCrossing, RailPlan } from './rails-types';
import { heightAt } from '../../../map-ops/grid';
import { EdgeIndex, pointSegmentDistance } from '../../../map-ops/path-graph';
import { crossingSpan, directionAt, LineIndex, merged, outside, pointOn, profileAt, segmentAt } from './rails-lines';
import { round2, round3, unit, wrapAngle } from './geom';
import { HeightField } from '../../custom-map/render/height-field';
import { bridgeDecks, deckHeight, deckHeightAt } from '../../custom-map/bridge-decks';

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
  const trackIndex = new LineIndex(plan.chains);
  plan.chains.forEach((c, ci) => {
    const group = `osm-w${c.ways[0].id}`;
    const stretches = stretchesOf(c, ci, plan);
    for (const st of stretches) {
      const kit = st.kind === 'bed' && timberSleepers(c.ways[segmentAt(c, (st.from + st.to) / 2)].tags) ? TIMBER_KIT : KITS[st.kind];
      const source = st.kind === 'bed' || st.kind === 'street' ? 'track' : st.kind === 'bridge' ? 'rail bridge' : 'crossing';
      for (const [from, len] of tile(st.from, st.to, kit[0] === kit[1] ? 0 : LONG)) {
        const a = pointOn(c, from);
        const b = pointOn(c, from + len);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const rotation = wrapAngle(Math.atan2(-(b.x - a.x), b.y - a.y) + Math.PI / 2);
        // Model +X points back to `a`: tilted so it rises with the profile from b to a
        const roll = Math.atan2(profileAt(c, from, terrain) - profileAt(c, from + len, terrain), len);
        // Bridges, crossings and street track stand on the profile (under a road the formation lies under it, the ballast hidden), the bed on the ground levelled to it
        const z = st.kind === 'bed' ? 0 : profileAt(c, from + len / 2, terrain) - ground(mid);
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
        const rotation = wrapAngle(Math.atan2(-d.x, d.y) + Math.PI / 2);
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
function stretchesOf(c: RailChain, ci: number, plan: RailPlan): Stretch[] {
  const end = latticeEnd(c);
  const bridges = bridgeSpans(plan, ci, end);
  const crossings = crossingSpans(plan, ci, end, bridges);
  const street = plan.streets.filter((x) => x.chain === ci).map((x): [number, number] => [x.from, x.to]);
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

/** Where a line's lattice ends: its length rounded to it */
export function latticeEnd(c: RailChain): number {
  return Math.max(LATTICE, Math.round(c.length / LATTICE) * LATTICE);
}

/** A line's bridges snapped outward to its lattice, joined where they overlap */
export function bridgeSpans(plan: RailPlan, ci: number, end: number): [number, number][] {
  return merged(plan.bridges.filter((b) => b.chain === ci).map((b) => [Math.max(0, Math.floor(b.from / LATTICE) * LATTICE), Math.min(end, Math.ceil(b.to / LATTICE) * LATTICE)]));
}

/** A line's crossings' panels on its lattice (crossingSpan), off its bridges: a bridge wins */
export function crossingSpans(plan: RailPlan, ci: number, end: number, bridges: readonly [number, number][]): [number, number][] {
  return merged(
    plan.crossings.filter((x) => x.chain === ci).map((x) => {
      const [from, to] = crossingSpan(x);
      return [Math.max(0, from), Math.min(end, to)];
    }),
  ).flatMap((s) => outside(s, bridges));
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
    const facing = wrapAngle(Math.atan2(-side * x.roadDir.x, side * x.roadDir.y));
    const place = (fromTrack: number, out_: number) => {
      const d = fromTrack / sin;
      const edge = x.roadWidth / 2 + x.pavement + out_;
      return { x: x.at.x + side * x.roadDir.x * d + right.x * edge, y: x.at.y + side * x.roadDir.y * d + right.y * edge };
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
      if (pointSegmentDistance(q, a, b) < edge.width / 2 + PIER_ROAD_CLEAR + PIER.thick / 2) return true;
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
  return { asset, x: round2(p.x), y: round2(p.y), z: round2(top - height * s - ground), rotation: round3(wrapAngle(Math.atan2(-f.x, f.y))), scale: round3(s) };
}

/** Whether `p` lies on a track bed of `plan` (within its levelled width): other furniture keeps off */
export function onTrackBed(plan: RailPlan, reach = BED_HALF): (p: MapPoint) => boolean {
  const index = new LineIndex(plan.chains);
  return (p) => index.near(p, reach);
}
