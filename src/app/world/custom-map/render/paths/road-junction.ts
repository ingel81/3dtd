/**
 * Junctions of the road network: the roads' ends trimmed back, nearby
 * junctions clustered into one, the outline round them (kerbs, mouths,
 * no spikes or loops) and its surface triangulated with points inside.
 */
import type { MapPoint } from '../../map-document';
import type { Chain, End, RingPoint, Section, Vertex } from './road-types';
import { crosses, endSection, insideRibbon, orderOf, pointAt, segmentDistance, simpleRing, tangentAt } from './road-geometry';
import { KERB_BAND, kerbAlong, kerbCorner, kerbCurve } from './road-kerb';
import { roadStyle, type RoadStyle } from './road-style';
import { TileBuilder } from './road-tiles';
import { ShapeUtils, Vector2 } from 'three';

/**
 * A junction vertex's arm weight (0 to 1) rides in the fraction of its wear
 * (a whole number): from ARM_WEIGHT_BASE over ARM_WEIGHT_SPAN, well clear of
 * the whole numbers. Interpolated across a triangle, a weight of 0 laid on
 * the whole number itself came out a hair under it at some pixels, its
 * fraction then nearly 1: the road's texture and its wear flipped per pixel,
 * and every junction flickered with each move of the camera
 */
export const ARM_WEIGHT_BASE = 0.25;
/** Highest rank (RoadStyle.rank) that meets a kerbed road at a junction without kerbs of its own: service roads and paths */
const MOUTH_RANK = 2;
/** Metres past the kerb a mouth's edge reads (MOUTH_RANK): beyond the kerb and its gutter, so none is drawn there */
const MOUTH_EDGE = 0.8;
export const ARM_WEIGHT_SPAN = 0.5;

/**
 * Trim lengths of the roads meeting at a junction: past where each road's kerb meets the next, plus a kerb radius.
 * The ends in counter-clockwise order around `c` (a cluster's ends start at their own nodes). In a junction of
 * several nodes (`nodes`: the ends at each, the chains inside it too) a road whose end would lie on a chain inside it
 * is trimmed past the kerbs of the roads at its own node: seen from the junction's middle the kerbs of a side road and
 * of the next road out meet behind them, and its end lay on the carriageway of the road through
 */
export function trimJunction(c: MapPoint, list: End[], nodes: readonly (readonly End[])[] = []): void {
  const trims = wantedTrims(c, list);
  const widest = Math.max(...list.map((e) => e.chain.half));
  const outer = new Set(list);
  const inner = new Set(nodes.flat().filter((e) => !outer.has(e)).map((e) => e.chain));
  const set = (e: End, t: number) => {
    // A deck's stub ends at its node (bridgeStub)
    if (!e.chain.stub) e.chain.trim[e.start ? 0 : 1] = Math.max(0, Math.min(Math.min(e.chain.length * 0.45, widest * 4 + 6), t));
  };
  list.forEach((e, k) => set(e, trims[k]));
  if (inner.size) {
    for (const ends of nodes) {
      const on = ends.filter((e) => outer.has(e) && endSection(e).some((p) => [...inner].some((chain) => insideRibbon(chain, p))));
      if (!on.length) continue;
      const sorted = [...ends];
      const own = wantedTrims(ends[0], sorted);
      for (const e of on) set(e, Math.max(e.chain.trim[e.start ? 0 : 1], own[sorted.indexOf(e)]));
    }
  }
  // Two roads leaving side by side (a slip road beside the road it leaves, short between two junctions, its trim held
  // to its length) whose end sections still cross or reach onto the other's carriageway: both trimmed on, a step at a time, until they part, up to most of
  // their length. Crossed, the junction's outline folded and it fell apart into fans over each other
  const n = list.length;
  for (let round = 0; n > 1 && round < SPLAY_ROUNDS; round++) {
    let crossed = false;
    for (let k = 0; k < n; k++) {
      const a = list[k];
      const b = list[(k + 1) % n];
      // A footway beside a road (a pavement mapped of its own) runs along it, not across: no end of the two trimmed on
      if (a === b || a.chain.edge.kind === 'path' || b.chain.edge.kind === 'path') continue;
      const sa = endSection(a);
      const sb = endSection(b);
      const apart = !crosses(sa[0], sa[sa.length - 1], sb[0], sb[sb.length - 1]) && !sa.some((p) => insideRibbon(b.chain, p)) && !sb.some((p) => insideRibbon(a.chain, p));
      if (apart) continue;
      crossed = true;
      for (const e of [a, b]) {
        if (e.chain.stub) continue;
        const at = e.start ? 0 : 1;
        e.chain.trim[at] = Math.min(e.chain.length * SPLAY_SHARE, e.chain.trim[at] + SPLAY_STEP);
      }
    }
    if (!crossed) break;
  }
}

/** The trims a junction's ends want (trimJunction, before the limits), the list sorted counter-clockwise around `c` */
function wantedTrims(c: MapPoint, list: End[]): number[] {
  // Around the centre by a point some metres out along each road: ends from nodes a few metres apart sort as seen
  for (const e of list) e.angle = Math.atan2(e.y + e.dy * 8 - c.y, e.x + e.dx * 8 - c.x);
  list.sort((a, b) => a.angle - b.angle);
  const n = list.length;
  const trims = list.map(() => 0);
  for (let k = 0; k < n; k++) {
    const a = list[k];
    const b = list[(k + 1) % n];
    let gap = Math.atan2(b.dy, b.dx) - Math.atan2(a.dy, a.dx);
    if (gap <= 0) gap += Math.PI * 2;
    // Nearly straight on, or the outside of a bend: the kerbs meet at the node. A road going on at another width
    // tapers instead: both trimmed by twice the change and a metre, the junction's straight kerbs run across
    // (they stepped at the node, a tooth in the kerb at every change of width)
    if (n > 1 && gap > Math.PI * 0.94) {
      const taper = Math.abs(a.chain.half - b.chain.half);
      if (taper > 0.3) {
        trims[k] = Math.max(trims[k], taper * 2 + 1);
        trims[(k + 1) % n] = Math.max(trims[(k + 1) % n], taper * 2 + 1);
      }
      continue;
    }
    if (gap > Math.PI * 0.94 || n === 1) continue;
    const corner = kerbCorner(a, b);
    if (!corner) continue;
    const radius = Math.min(6, Math.max(0.5, Math.min(a.chain.half, b.chain.half) * 0.8 + (a.chain.edge.kind === 'path' ? 0 : 1)));
    trims[k] = Math.max(trims[k], corner.t + radius);
    trims[(k + 1) % n] = Math.max(trims[(k + 1) % n], corner.s + radius);
  }
  return trims;
}

/** Trimming on of two ends whose sections cross (trimJunction): metres a step, steps at most, share of a road's length at most */
const SPLAY_STEP = 0.75;
const SPLAY_ROUNDS = 12;
const SPLAY_SHARE = 0.9;

/** Longest chain between two junctions that may join them into one */
const CLUSTER_CHAIN = 16;
/** Most a chain may turn from end to end to be inside a junction of several nodes, radians */
const CLUSTER_TURN = Math.PI / 6;
/** Widest a junction of several nodes may grow (its nodes' box, metres) */
const CLUSTER_SPAN = 24;

/**
 * The junctions to lay at `lay`'s nodes: a node alone, or several a short
 * chain joins (nearly straight, CLUSTER_TURN) where their junctions want more room than the chain has
 * (their trims together past nine tenths of it, wantedTrims): a ribbon
 * there would be a sliver, the two junctions' kerbs crossing each other's
 * surface. Grows over such chains to nodes beyond `lay`; shortest chains
 * first, a cluster no wider than CLUSTER_SPAN. Each list sorted
 */
export function clusterJunctions(lay: ReadonlySet<string>, endsOf: (node: string) => End[]): string[][] {
  const wanted = new Map<string, Map<End, number>>();
  const wants = (node: string): Map<End, number> => {
    let m = wanted.get(node);
    if (!m) {
      const list = endsOf(node);
      m = new Map();
      if (list.length > 1) {
        const sorted = [...list];
        const trims = wantedTrims(list[0], sorted);
        sorted.forEach((e, k) => m!.set(e, trims[k]));
      }
      wanted.set(node, m);
    }
    return m;
  };
  // The short chains reachable from the nodes to lay, each once, shortest first
  const short: { chain: Chain; a: string; b: string }[] = [];
  const seen = new Set<Chain>();
  const nodes = new Set(lay);
  const queue = [...lay];
  while (queue.length) {
    const node = queue.pop()!;
    for (const e of endsOf(node)) {
      const c = e.chain;
      if (seen.has(c)) continue;
      seen.add(c);
      const [a, b] = c.nodes;
      if (a === b || c.length > CLUSTER_CHAIN) continue;
      const ea = endsOf(a).find((x) => x.chain === c && x.start);
      const eb = endsOf(b).find((x) => x.chain === c && !x.start);
      if (!ea || !eb || endsOf(a).length < 2 || endsOf(b).length < 2) continue;
      // A chain that bends (a roundabout's ring between two of its mouths) keeps its ribbon: a junction's kerb across
      // it would cut its curve off in a chord
      if (ea.dx * eb.dx + ea.dy * eb.dy > -Math.cos(CLUSTER_TURN)) continue;
      if ((wants(a).get(ea) ?? 0) + (wants(b).get(eb) ?? 0) <= c.length * 0.9) continue;
      short.push({ chain: c, a, b });
      for (const n of [a, b]) {
        if (nodes.has(n)) continue;
        nodes.add(n);
        queue.push(n);
      }
    }
  }
  short.sort((p, q) => p.chain.length - q.chain.length);
  // Union, keeping each cluster's box within the span
  const parent = new Map<string, string>();
  const box = new Map<string, [number, number, number, number]>();
  const root = (n: string): string => {
    let r = n;
    while (parent.get(r) !== undefined && parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  const point = (n: string): MapPoint => {
    for (const e of endsOf(n)) return { x: e.x, y: e.y };
    return { x: 0, y: 0 };
  };
  for (const n of nodes) {
    parent.set(n, n);
    const p = point(n);
    box.set(n, [p.x, p.y, p.x, p.y]);
  }
  for (const { a, b } of short) {
    const ra = root(a);
    const rb = root(b);
    if (ra === rb) continue;
    const p = box.get(ra)!;
    const q = box.get(rb)!;
    const joined: [number, number, number, number] = [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[2], q[2]), Math.max(p[3], q[3])];
    if (Math.hypot(joined[2] - joined[0], joined[3] - joined[1]) > CLUSTER_SPAN) continue;
    parent.set(rb, ra);
    box.set(ra, joined);
  }
  const groups = new Map<string, string[]>();
  for (const n of nodes) {
    const r = root(n);
    const g = groups.get(r);
    if (g) g.push(n);
    else groups.set(r, [n]);
  }
  return [...groups.values()].map((g) => g.sort());
}

/**
 * Whether a junction's outline (its roads' end sections in order, sorted by
 * trimJunction) runs once round its middle, counter-clockwise: a fan from
 * the middle covers it without a fold
 */
export function outlineAround(c: MapPoint, list: readonly End[]): boolean {
  const ring: MapPoint[] = [];
  for (const e of list) {
    const chain = e.chain;
    const d = e.start ? chain.at[0] + chain.trim[0] : chain.at[0] + chain.length - chain.trim[1];
    const p = pointAt(chain, d);
    // Right, then left, looking away from the node
    const s = e.start ? 1 : -1;
    const t = tangentAt(chain, d);
    ring.push({ x: p.x + t.y * chain.half * s, y: p.y - t.x * chain.half * s }, { x: p.x - t.y * chain.half * s, y: p.y + t.x * chain.half * s });
  }
  let turn = 0;
  for (let k = 0; k < ring.length; k++) {
    const p = ring[k];
    const q = ring[(k + 1) % ring.length];
    if ((p.x - c.x) * (q.y - c.y) - (p.y - c.y) * (q.x - c.x) <= 0) return false;
    turn += Math.atan2((p.x - c.x) * (q.y - c.y) - (p.y - c.y) * (q.x - c.x), (p.x - c.x) * (q.x - c.x) + (p.y - c.y) * (q.y - c.y));
  }
  return Math.abs(turn - Math.PI * 2) < 0.01;
}

/** The middle of a junction's nodes */
export function clusterCentre(points: readonly MapPoint[]): MapPoint {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

/**
 * A junction's outline, counter-clockwise: the roads' end sections (`sides`, right to left seen from the node, the
 * ends in order as trimJunction sorted them), each followed by the kerb to the next road. `gutter`: the junction's
 * look has kerbs; `follow`: a kerb between two of its nodes that would cut across a chain between them follows the
 * chains' edges instead
 */
export function junctionOutline(list: readonly End[], sides: readonly Section[], inner: readonly Chain[], gutter: boolean, follow = true): RingPoint[] {
  // The ring: each road's end section, then the kerb to the next road (a curve through where both kerbs would meet,
  // else straight); a point of a section belongs to its road, a kerb point to the nearer of the two
  const ring: RingPoint[] = [];
  const n = list.length;
  // A kerb between two roads without one gets none: its points lie past the gutter's width from the edge
  const kerbs = list.map((e) => roadStyle(e.chain.edge).gutter);
  // A driveway or a path (no kerb of its own, a lower rank than a road with one here, MOUTH_RANK at most) meets the
  // carriageway without one: the kerbs either side end in the corner curves towards it. Kerbed round its own edges, the
  // kerb ran into the junction along one side of it and back out along the other, a notch in the pavement
  const ranks = list.map((e) => roadStyle(e.chain.edge).rank);
  const top = Math.max(-1, ...ranks.filter((_, k) => kerbs[k]));
  const mouth = list.map((_, k) => gutter && !kerbs[k] && ranks[k] <= MOUTH_RANK && ranks[k] < top);
  for (let k = 0; k < n; k++) {
    const j = (k + 1) % n;
    const kerbEdge = gutter && !kerbs[k] && !kerbs[j] && !mouth[k] && !mouth[j] ? 0.6 : 0;
    const side = sides[k];
    for (const v of side) ring.push({ x: v.x, y: v.y, edge: mouth[k] ? v.edge + MOUTH_EDGE : v.edge, arm: k, side: true });
    const a = side[side.length - 1];
    const b = sides[j][0];
    // The outline runs round the pavements: from one road's to the next's
    const walkA = mouth[k] ? -MOUTH_EDGE : list[k].chain.walk;
    const walkB = mouth[j] ? -MOUTH_EDGE : list[j].chain.walk;
    // Two roads wide apart (a road going on through the junction, bending or not): the kerb follows their own lines;
    // so does a kerb between two nodes of the junction that would cut across a chain between them (the ground grey
    // where its surface should be). Not into a mouth: the kerb crosses it
    const ea = list[k];
    const eb = list[j];
    const crossing = mouth[k] || mouth[j];
    let along = crossing ? null : kerbAlong(ea, eb, inner);
    const curve = along ? [] : kerbCurve(a, ea, b, eb);
    if (!along && !crossing && follow && inner.some((c) => curve.some((p) => insideRibbon(c, p)))) along = kerbAlong(ea, eb, inner, true);
    if (along) along.forEach((p) => ring.push({ x: p.x, y: p.y, edge: kerbEdge - p.walk, arm: p.second ? (k + 1) % n : k, side: false }));
    else curve.forEach((p) => ring.push({ x: p.x, y: p.y, edge: kerbEdge - (walkA * (1 - p.t) + walkB * p.t), arm: p.t * 2 <= 1 ? k : (k + 1) % n, side: false }));
  }
  return untangle(ring);
}

/** Sharpest turn back an outline may take at a kerb point (cosine of the angle between the way in and out) */
const SPIKE_COS = -0.5;

/**
 * A junction's outline without spikes and loops of kerb: a kerb point where
 * the outline turns back on itself (more than 120 degrees) goes, and where
 * two stretches of it cross, the kerb points between them (the loop) go.
 * The kerbs between two ends met wherever the lines of the roads beside them
 * took them: at a narrow mouth, a taper or a corner cut close they ran past
 * each other and back, a spike or a zigzag of kerb into the carriageway.
 * The roads' end sections stay (other surfaces share their points)
 */
function untangle(ring: RingPoint[]): RingPoint[] {
  const out = [...ring];
  for (let round = 0; round < out.length + 8; round++) {
    let changed = false;
    const n = out.length;
    if (n < 4) break;
    for (let k = 0; k < n && !changed; k++) {
      const p = out[k];
      if (p.side) continue;
      const a = out[(k + n - 1) % n];
      const b = out[(k + 1) % n];
      const ax = p.x - a.x;
      const ay = p.y - a.y;
      const bx = b.x - p.x;
      const by = b.y - p.y;
      const la = Math.hypot(ax, ay);
      const lb = Math.hypot(bx, by);
      // A point on top of the one before, or a turn back
      if (la < 1e-4 || lb < 1e-4 || (ax * bx + ay * by) / (la * lb) < SPIKE_COS) {
        out.splice(k, 1);
        changed = true;
      }
    }
    if (changed) continue;
    // A loop: two sides that cross; the shorter run of kerb points between them goes
    for (let i = 0; i < n && !changed; i++) {
      for (let j = i + 2; j < n && !changed; j++) {
        if (i === 0 && j === n - 1) continue;
        if (!crosses(out[i], out[(i + 1) % n], out[j], out[(j + 1) % n])) continue;
        const inner = out.slice(i + 1, j + 1);
        const outer = [...out.slice(j + 1), ...out.slice(0, i + 1)];
        const loop = inner.length <= outer.length ? inner : outer;
        if (loop.some((q) => q.side)) continue;
        for (const q of loop) out.splice(out.indexOf(q), 1);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return out;
}

/** The surface between the ends of the roads at a junction: the polygon its outline is, else fanned from its node */
/** The surface between the ends of the roads at a junction; its outline (where its surface hides the ground), null when none is laid */
export function emitJunction(c: MapPoint, list: End[], inner: readonly Chain[], out: TileBuilder, styleOf: (s: RoadStyle) => number): MapPoint[] | null {
  // The ends in counter-clockwise order (trimJunction sorted them), each with its cross section seen from the node:
  // right to left looking away from it
  const sides = list.map((e) => {
    const s = e.chain.ends[e.start ? 0 : 1];
    if (!s) return null;
    return e.start ? s : [...s].reverse();
  });
  if (sides.some((s) => !s)) return null;
  // The widest road's texture runs on over the junction; its kerbs go round the corners where any road has them
  let main = 0;
  for (let k = 1; k < list.length; k++) if (list[k].chain.half > list[main].chain.half) main = k;
  const m = list[main];
  const look = roadStyle(m.chain.edge, true);
  look.gutter ||= list.some((e) => roadStyle(e.chain.edge).gutter);
  const style = styleOf(look) + orderOf(`j${c.x},${c.y}`);
  // Each road's frame at its end: the middle of its end section and its direction there (the ribbon's own)
  const frames = sides.map((side) => side![(side!.length - 1) / 2]);
  const wears = list.map((e) => Math.round(roadStyle(e.chain.edge).wear * 31));
  const at = (x: number, y: number, f: Vertex): [number, number] => [(x - f.x) * -f.dy + (y - f.y) * f.dx, f.along + (x - f.x) * f.dx + (y - f.y) * f.dy];
  const mf = frames[main];
  const vertex = (p: RingPoint, arm: number, weight: number): Vertex => {
    const [across, along] = at(p.x, p.y, mf);
    const f = frames[arm];
    const [armAcross, armAlong] = at(p.x, p.y, f);
    return {
      x: p.x,
      y: p.y,
      across,
      along,
      edge: p.edge,
      style,
      dx: mf.dx,
      dy: mf.dy,
      arm: [armAcross, armAlong, Math.atan2(f.dy, f.dx) - Math.atan2(mf.dy, mf.dx), wears[arm] + ARM_WEIGHT_BASE + weight * ARM_WEIGHT_SPAN],
    };
  };
  for (const side of sides) out.share(side!);
  // The node lies on the widest road, its kerbs that road's half carriageway away: the distance to the edge runs from
  // there to the ring, so the kerbs cross the junction where that road's run. A narrower way's half (a footway
  // joining) pulled them in towards the node, the pavement bulging into the carriageway on both sides of each
  // junction like the teeth of a saw
  const centre: RingPoint = { x: c.x, y: c.y, edge: m.chain.half - m.chain.walk, arm: main, side: false };
  // A second ring inside the kerb's: each kerb point moved in square to the outline by its pavement and KERB_BAND,
  // less where the kerb curves tighter or the node is near; a road's end section is its own. Between the two rings
  // the distance to the edge is the true one, so pavement, kerb and gutter run parallel to the outline round the
  // junction; fanned from the node it only grew with the distance from the node, the kerb wide where the outline lies
  // far out and thin where it comes close
  const left = (p: MapPoint, q: MapPoint, r: MapPoint): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  // An outline that is a polygon is triangulated as one, its band parallel to it all round. Fanned from the node the
  // band had to stay in the wedge of each stretch of outline: links and slip roads beside a junction or a junction of
  // several nodes whose roads leave side by side folded the fan over the node, its triangles over each other's and the
  // kerbs across the carriageway, and a kerb running slantwise past the node (along a chain inside the junction) had
  // its band cut back at every other point, the kerb in steps. An outline that is no polygon (roads crossing each
  // other's ends) keeps the fan and its single ring, its kerbs between nodes straight across the chains between them,
  // not along them
  const runsAround = (r: readonly RingPoint[]) => r.every((p, k) => left(c, p, r[(k + 1) % r.length]) > 0);
  let ring = junctionOutline(list, sides as Section[], inner, look.gutter);
  let around = runsAround(ring);
  // An outline round the node is a polygon (its points seen in turn from there)
  const fan = !around && !simpleRing(ring);
  if (fan && inner.length) {
    ring = junctionOutline(list, sides as Section[], inner, look.gutter, false);
    around = runsAround(ring);
  }
  const count = ring.length;
  const normals = ring.map((p, k) => {
    const prev = ring[(k + count - 1) % count];
    const next = ring[(k + 1) % count];
    const tl = Math.hypot(next.x - prev.x, next.y - prev.y);
    if (p.side || tl < 1e-6) return null;
    // Counter-clockwise round the node: inside is on the left
    let d = p.edge < 0 ? KERB_BAND - p.edge : KERB_BAND;
    if (fan) d = Math.min(d, Math.hypot(p.x - c.x, p.y - c.y) * 0.45);
    // Where the outline turns left (towards the inside), no further in than most of the radius of its turn
    const ax = p.x - prev.x;
    const ay = p.y - prev.y;
    const bx = next.x - p.x;
    const by = next.y - p.y;
    const turn = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
    if (turn > 1e-3) d = Math.min(d, (0.8 * Math.min(Math.hypot(ax, ay), Math.hypot(bx, by))) / turn);
    return { nx: -(next.y - prev.y) / tl, ny: (next.x - prev.x) / tl, d };
  });
  const inward = (k: number, d: number): RingPoint => {
    const p = ring[k];
    const n = normals[k];
    return !n || d <= 0 ? p : { x: p.x + n.nx * d, y: p.y + n.ny * d, edge: p.edge + d, arm: p.arm, side: false };
  };
  const depth = normals.map((n) => n?.d ?? 0);
  const inside: RingPoint[] = [];
  // No fold: where the band between two points or the fan beyond it would turn over (a kerb meeting a road's end at a
  // sharp angle, a tight curve, the node close by), both points come out halfway, at last back onto the outline
  const folds = (k: number): boolean => {
    const j = (k + 1) % count;
    const [p, q, pi, qi] = [ring[k], ring[j], inside[k], inside[j]];
    if (left(p, q, qi) < -1e-9 || left(p, qi, pi) < -1e-9) return true;
    // The band and the fan stay in the wedge of their stretch of outline: no triangle over the next one's
    if (fan) return left(c, pi, qi) <= 0 || left(c, p, qi) <= 0 || left(c, pi, q) <= 0;
    // The inner ring crosses neither itself nor the outline (a narrow neck between two roads side by side)
    for (let i = 0; i < count; i++) {
      const l = (i + 1) % count;
      if (i !== k && crosses(pi, qi, ring[i], ring[l])) return true;
      if (i !== k && i !== j && l !== k && crosses(pi, qi, inside[i], inside[l])) return true;
    }
    return false;
  };
  if (!around && fan) depth.fill(0);
  for (let k = 0; k < count; k++) inside[k] = inward(k, depth[k]);
  for (let round = 0; round < 8; round++) {
    let folded = false;
    for (let k = 0; k < count; k++) {
      if (!folds(k)) continue;
      folded = true;
      for (const i of [k, (k + 1) % count]) {
        depth[i] = round < 7 ? depth[i] / 2 : 0;
        inside[i] = inward(i, depth[i]);
      }
    }
    if (!folded) break;
  }
  // Each triangle in one road's frame: near a road's end its texture takes over from the junction's (the weight, 1 on
  // the end section, 0 at the node and on the kerbs), so no seam shows at any end
  const verts: Vertex[] = [];
  const tris: number[] = [];
  const triangle = (p: RingPoint, q: RingPoint, r: RingPoint, arm: number): void => {
    // Skip slivers the wrong way round (an outline that is no polygon, roads crossing each other's ends) and the empty
    // ones
    if (left(p, q, r) <= 1e-9) return;
    const base = verts.length;
    const weight = (v: RingPoint) => (v.side && v.arm === arm ? 1 : 0);
    verts.push(vertex(p, arm, weight(p)), vertex(q, arm, weight(q)), vertex(r, arm, weight(r)));
    tris.push(base, base + 1, base + 2);
  };
  for (let k = 0; k < ring.length; k++) {
    const p = ring[k];
    const q = ring[(k + 1) % ring.length];
    const pi = inside[k];
    const qi = inside[(k + 1) % ring.length];
    const arm = p.side ? p.arm : q.side ? q.arm : p.arm;
    // The band between the rings, then the fan from the node to the inner ring
    triangle(p, q, qi, arm);
    if (pi !== p) triangle(p, qi, pi, arm);
    if (fan) triangle(centre, pi, qi, arm);
  }
  if (!fan) {
    // The inner ring as a polygon (earcut), each point once; a triangle in the frame of the road whose end it touches
    const poly: RingPoint[] = [];
    for (const p of inside) if (p !== poly[poly.length - 1] && p !== poly[0]) poly.push(p);
    // Where the inner ring could not move in all round (a narrow neck between two slip roads), points inside it on a
    // grid, each with its true distance to the edge (fieldPoints): between the inner ring's points alone the distance
    // ran linearly from kerb to kerb, and the junction read as pavement across
    const all: RingPoint[] = [...poly];
    const faces = ShapeUtils.triangulateShape(
      poly.map((p) => new Vector2(p.x, p.y)),
      [],
    ).map((f) => (left(poly[f[0]], poly[f[1]], poly[f[2]]) > 0 ? f : [f[0], f[2], f[1]]));
    restoreDropped(poly, faces);
    if (poly.some((p) => !p.side && p.edge < KERB_BAND - 0.05)) insertPoints(all, faces, fieldPoints(c, ring, poly, centre.edge));
    for (const t of faces) {
      const [a, b, d] = t.map((i) => all[i]);
      const arm = a.side ? a.arm : b.side ? b.arm : d.side ? d.arm : a.arm;
      if (left(a, b, d) > 0) triangle(a, b, d, arm);
      else triangle(a, d, b, arm);
    }
  }
  out.add(verts, tris);
  return ring.map((p) => ({ x: p.x, y: p.y }));
}

/** Metres between the points a junction's surface takes inside its inner ring (fieldPoints), and their least gap to it */
const FIELD_STEP = 1.5;
const FIELD_GAP = 0.6;
/** Most passes of flips after the points went in (insertPoints) */
const FLIP_PASSES = 200;

/**
 * Points on a grid of FIELD_STEP round node `c` inside polygon `poly` (a
 * junction's inner ring), FIELD_GAP and more off its sides, each with its
 * distance to the edge as the outline gives it (`ring`, its points'
 * distances): the least over the outline's sides of the side's distance
 * where the point lies square to it plus the metres to it. The arm of the
 * outline point nearest. No more than `most` (the widest road's middle); each
 * point a little off the grid by a hash of it, so no three lie on a line
 * (the triangulation drew a side through the middle one)
 */
function fieldPoints(c: MapPoint, ring: readonly RingPoint[], poly: readonly RingPoint[], most: number): RingPoint[] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of poly) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  const out: RingPoint[] = [];
  const n = poly.length;
  for (let i = Math.ceil((x0 - c.x) / FIELD_STEP); c.x + i * FIELD_STEP < x1; i++) {
    for (let j = Math.ceil((y0 - c.y) / FIELD_STEP); c.y + j * FIELD_STEP < y1; j++) {
      const h = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453;
      const q = { x: c.x + (i + (h - Math.floor(h) - 0.5) * 0.3) * FIELD_STEP, y: c.y + (j + (((h * 7.31) % 1) + 1) % 1 * 0.3 - 0.15) * FIELD_STEP };
      let inside = false;
      let gap = Infinity;
      for (let k = 0, l = n - 1; k < n; l = k++) {
        const a = poly[k];
        const b = poly[l];
        if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
        gap = Math.min(gap, segmentDistance(q, a, b).d);
      }
      if (!inside || gap < FIELD_GAP) continue;
      let edge = Infinity;
      let arm = 0;
      let near = Infinity;
      for (let k = 0; k < ring.length; k++) {
        const a = ring[k];
        const b = ring[(k + 1) % ring.length];
        const s = segmentDistance(q, a, b);
        const e = a.edge + (b.edge - a.edge) * s.t + s.d;
        if (e < edge) edge = e;
        if (s.d < near) {
          near = s.d;
          arm = s.t < 0.5 ? a.arm : b.arm;
        }
      }
      out.push({ x: q.x, y: q.y, edge: Math.min(edge, most), arm, side: false });
    }
  }
  return out;
}

/**
 * The points of polygon `pts` its triangulation (`faces`, counter-clockwise)
 * left out or put only into flat triangles (dropped), each into the triangle
 * whose side it lies on, split there: the triangulation drops a point in a
 * straight run of the outline where it gets stuck, and the side spanning it
 * met the band's two triangles at it (a crack)
 */
function restoreDropped(pts: readonly MapPoint[], faces: number[][]): void {
  const flat = (f: number[]) => Math.abs((pts[f[1]].x - pts[f[0]].x) * (pts[f[2]].y - pts[f[0]].y) - (pts[f[1]].y - pts[f[0]].y) * (pts[f[2]].x - pts[f[0]].x)) <= 1e-9;
  for (let f = faces.length - 1; f >= 0; f--) if (flat(faces[f])) faces.splice(f, 1);
  const used = new Set(faces.flat());
  for (let k = 0; k < pts.length; k++) {
    if (used.has(k)) continue;
    const q = pts[k];
    for (let f = 0; f < faces.length; f++) {
      const face = faces[f];
      const e = [0, 1, 2].find((s) => {
        const a = pts[face[s]];
        const b = pts[face[(s + 1) % 3]];
        const along = (q.x - a.x) * (b.x - a.x) + (q.y - a.y) * (b.y - a.y);
        const len = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
        return along > 0 && along < len && Math.abs((b.x - a.x) * (q.y - a.y) - (b.y - a.y) * (q.x - a.x)) < 1e-6 * Math.sqrt(len);
      });
      if (e === undefined) continue;
      const [a, b, c] = [face[e], face[(e + 1) % 3], face[(e + 2) % 3]];
      faces[f] = [a, k, c];
      faces.push([k, b, c]);
      break;
    }
  }
}

/**
 * Points into a triangulation of `pts` (`faces`, counter-clockwise; both
 * grow): each splits the triangle it lies in, then sides inside it are
 * flipped where the triangles beside them are not Delaunay, so no long side
 * runs from kerb to kerb across the points (the distance along it only that
 * of its ends). Sides on the outline stay. A point on a side or outside every
 * triangle is left out
 */
function insertPoints(pts: MapPoint[], faces: number[][], add: readonly MapPoint[]): void {
  const area = (a: MapPoint, b: MapPoint, c: MapPoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  for (const q of add) {
    const f = faces.findIndex(([a, b, c]) => area(pts[a], pts[b], q) > 1e-6 && area(pts[b], pts[c], q) > 1e-6 && area(pts[c], pts[a], q) > 1e-6);
    if (f < 0) continue;
    const [a, b, c] = faces[f];
    const k = pts.length;
    pts.push(q);
    faces[f] = [a, b, k];
    faces.push([b, c, k], [c, a, k]);
  }
  // Lawson's flips: a side is flipped where the far corner of one triangle lies in the other's circumcircle
  const inCircle = (a: MapPoint, b: MapPoint, c: MapPoint, d: MapPoint): boolean => {
    const ax = a.x - d.x;
    const ay = a.y - d.y;
    const bx = b.x - d.x;
    const by = b.y - d.y;
    const cx = c.x - d.x;
    const cy = c.y - d.y;
    return (ax * ax + ay * ay) * (bx * cy - cx * by) - (bx * bx + by * by) * (ax * cy - cx * ay) + (cx * cx + cy * cy) * (ax * by - bx * ay) > 1e-9;
  };
  // Passes over all sides, each triangle flipped once a pass, until none is
  for (let pass = 0; pass < FLIP_PASSES; pass++) {
    const sides = new Map<string, [number, number]>();
    for (let f = 0; f < faces.length; f++) for (let e = 0; e < 3; e++) sides.set(`${faces[f][e]},${faces[f][(e + 1) % 3]}`, [f, e]);
    const touched = new Set<number>();
    for (let f = 0; f < faces.length; f++) {
      if (touched.has(f)) continue;
      for (let e = 0; e < 3; e++) {
        const a = faces[f][e];
        const b = faces[f][(e + 1) % 3];
        const c = faces[f][(e + 2) % 3];
        const other = sides.get(`${b},${a}`);
        if (!other || touched.has(other[0])) continue;
        const [g, h] = other;
        const d = faces[g][(h + 2) % 3];
        if (!inCircle(pts[a], pts[b], pts[c], pts[d])) continue;
        // Only a convex pair turns: both new triangles counter-clockwise
        if (area(pts[c], pts[a], pts[d]) <= 1e-6 || area(pts[d], pts[b], pts[c]) <= 1e-6) continue;
        faces[f] = [c, a, d];
        faces[g] = [d, b, c];
        touched.add(f).add(g);
        break;
      }
    }
    if (!touched.size) break;
  }
}
