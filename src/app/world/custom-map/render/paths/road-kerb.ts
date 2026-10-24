/**
 * Kerbs of the road network: the corner where two roads' kerbs meet at a
 * junction, the curve round it, a kerb following an inner road, rounded
 * joints.
 */
import type { Chain, End } from './road-types';
import type { MapPoint } from '../../map-document';
import { endOf, pointAt, rayMeet, ribbonSpan, segmentCross, tangentAt } from './road-geometry';

/** Points per kerb curve and per half of a path's round end; a longer kerb curve a point every KERB_STEP m, up to KERB_POINTS */
export const CURVE_POINTS = 6;
const KERB_STEP = 1.25;
const KERB_POINTS = 24;

/**
 * Where road a's left kerb meets road b's right kerb (b the next road
 * counter-clockwise), as distances along each from its node; null when they
 * do not meet in front of both
 */
export function kerbCorner(a: End, b: End): { t: number; s: number; x: number; y: number } | null {
  const ha = a.chain.half;
  const hb = b.chain.half;
  // a's left kerb: pa + na * ha + da * t; b's right kerb: pb - nb * hb + db * s
  const nax = -a.dy;
  const nay = a.dx;
  const nbx = -b.dy;
  const nby = b.dx;
  const rx = b.x - nbx * hb - (a.x + nax * ha);
  const ry = b.y - nby * hb - (a.y + nay * ha);
  // da * t - db * s = r
  const det = a.dx * -b.dy - a.dy * -b.dx;
  if (Math.abs(det) < 1e-6) return null;
  const t = (rx * -b.dy - ry * -b.dx) / det;
  const s = (a.dx * ry - a.dy * rx) / det;
  if (t < -1e-6 || s < -1e-6) return null;
  return { t: Math.max(0, t), s: Math.max(0, s), x: a.x + nax * ha + a.dx * t, y: a.y + nay * ha + a.dy * t };
}

/**
 * The kerb's points between road ea's end section (its left point `a`) and the next road eb's (its right point `b`),
 * with how far along it each lies: a curve through where both kerbs would meet (lineMeet), else, the kerb lines
 * meeting behind the ends (the inside of a bend, a road going on at another width), a curve leaving each end along
 * its road (Hermite), so the kerb of a roundabout's island follows its circle through the junctions on it instead of
 * cutting across in a chord
 */
export function kerbCurve(a: MapPoint, ea: End, b: MapPoint, eb: End): (MapPoint & { t: number })[] {
  const cross = lineMeet(a, ea, b, eb);
  const span = Math.hypot(b.x - a.x, b.y - a.y);
  // As many points as its length wants: six over a long curve (a roundabout's mouth) made a polygon of the kerb
  const length = cross ? Math.hypot(cross.x - a.x, cross.y - a.y) + Math.hypot(b.x - cross.x, b.y - cross.y) : span * 1.5;
  const points = Math.max(CURVE_POINTS, Math.min(KERB_POINTS, Math.ceil(length / KERB_STEP)));
  const out: (MapPoint & { t: number })[] = [];
  for (let s = 1; s < points; s++) {
    const t = s / points;
    const u = 1 - t;
    if (cross) {
      out.push({ x: u * u * a.x + 2 * u * t * cross.x + t * t * b.x, y: u * u * a.y + 2 * u * t * cross.y + t * t * b.y, t });
      continue;
    }
    const h00 = 2 * t * t * t - 3 * t * t + 1;
    const h10 = t * t * t - 2 * t * t + t;
    const h01 = -2 * t * t * t + 3 * t * t;
    const h11 = t * t * t - t * t;
    out.push({ x: h00 * a.x - h10 * span * ea.dx + h01 * b.x + h11 * span * eb.dx, y: h00 * a.y - h10 * span * ea.dy + h01 * b.y + h11 * span * eb.dy, t });
  }
  return out;
}

/** How far past the kerb the junction's distance to the edge is the true one (its paint and gutter lie within), m */
export const KERB_BAND = 1.2;

/** Most a road may turn at a node of a junction (radians) for the kerb to follow it, not round a corner */
const KERB_TURN = Math.PI / 4;
/** Most the way through a junction's chains may turn at a node for a kerb to follow their edges (kerbAlong, `follow`) */
const FOLLOW_TURN = Math.PI / 2;

/**
 * The kerb between road ea and the next road eb counter-clockwise, along
 * the roads' own lines: the edge of the way from ea's end section in to its
 * node, on through the chains inside the junction (one of several nodes) to
 * eb's node and out along eb to its end section, each piece at its own half
 * width on the kerb's side (tapering where two widths meet), cut where one
 * piece's edge crosses the next (the inside of a bend; where they part, the
 * kerb lines meet in front, lineMeet). For a road going on
 * (turning at most KERB_TURN at each node of the way): straight or bending
 * through the junction, a roundabout's ring past its mouths, the island's
 * kerb then round as the ring. Points between the end sections, a metre
 * apart or closer, with the pavement there (`walk`) and whether they lie on
 * eb's side; null for a corner between two roads (rounded by lineMeet) or
 * without a way through the junction's chains
 */
export function kerbAlong(ea: End, eb: End, inner: readonly Chain[], follow = false): (MapPoint & { walk: number; second: boolean })[] | null {
  const nodeOf = (e: End) => e.chain.nodes[e.start ? 0 : 1];
  // The way through the junction's chains from ea's node to eb's (none for one node)
  const way: { chain: Chain; forward: boolean }[] = [];
  if (nodeOf(ea) !== nodeOf(eb)) {
    const from = new Map<string, { chain: Chain; forward: boolean; prev: string }>();
    const queue = [nodeOf(ea)];
    const seen = new Set(queue);
    while (queue.length && !from.has(nodeOf(eb))) {
      const node = queue.shift()!;
      for (const chain of inner) {
        const forward = chain.nodes[0] === node;
        if (!forward && chain.nodes[1] !== node) continue;
        const next = chain.nodes[forward ? 1 : 0];
        if (seen.has(next)) continue;
        seen.add(next);
        from.set(next, { chain, forward, prev: node });
        queue.push(next);
      }
    }
    if (!from.has(nodeOf(eb))) return null;
    for (let node = nodeOf(eb); node !== nodeOf(ea); ) {
      const step = from.get(node)!;
      way.unshift({ chain: step.chain, forward: step.forward });
      node = step.prev;
    }
  }
  // One road going on: at each node of the way it turns no more than KERB_TURN (a corner between two roads is rounded).
  // Following the chains inside (`follow`) no more than FOLLOW_TURN: the kerb runs on the right of the way, and where
  // it turned back on itself (a ring between two mouths into a slip road) that edge lay across the way, the outline
  // folded and the junction fell apart
  if (!follow || way.length) {
    const most = Math.cos(follow ? FOLLOW_TURN : KERB_TURN);
    let dx = -ea.dx;
    let dy = -ea.dy;
    for (const w of way) {
      const out = endOf(w.chain, w.forward);
      if (dx * out.dx + dy * out.dy < most) return null;
      const back = endOf(w.chain, !w.forward);
      dx = -back.dx;
      dy = -back.dy;
    }
    if (dx * eb.dx + dy * eb.dy < most) return null;
  } else return null;
  // The pieces of the way: chain distances from d0 to d1 (the joints between pieces at the nodes)
  // From the road's end section (its ribbon's, ribbonSpan: a road trimmed away between two junctions ends where they
  // meet) to its node
  const ends = (e: End): [number, number] => {
    const c = e.chain;
    const [from, to] = ribbonSpan(c);
    return e.start ? [from, c.at[0]] : [to, c.at[0] + c.length];
  };
  const [a0, a1] = ends(ea);
  const [b1, b0] = ends(eb);
  // Each with its way along the chain (forward: as its distance grows), also where it has no length (a road not trimmed)
  const spans: { chain: Chain; d0: number; d1: number; forward: boolean; second: boolean }[] = [{ chain: ea.chain, d0: a0, d1: a1, forward: !ea.start, second: false }];
  for (const w of way) spans.push({ chain: w.chain, d0: w.forward ? w.chain.at[0] : w.chain.at[0] + w.chain.length, d1: w.forward ? w.chain.at[0] + w.chain.length : w.chain.at[0], forward: w.forward, second: false });
  spans.push({ chain: eb.chain, d0: b0, d1: b1, forward: eb.start, second: true });
  // At a joint between two widths of a road going on (turning at most KERB_TURN there) the edge tapers over twice the
  // change and a metre to their mean (as trimJunction tapers a road of two ends), so the two edges meet there instead
  // of stepping; at a corner between two roads each keeps its width (tapered, a road's kerb came in short of its edge)
  const heading = (k: number, end: boolean): MapPoint => {
    const t = tangentAt(spans[k].chain, end ? spans[k].d1 : spans[k].d0);
    return spans[k].forward ? t : { x: -t.x, y: -t.y };
  };
  const toward = (k: number, other: number): { to: number; reach: number } | null => {
    if (other < 0 || other >= spans.length) return null;
    const [first, second] = other < k ? [other, k] : [k, other];
    const a = heading(first, true);
    const b = heading(second, false);
    if (a.x * b.x + a.y * b.y < Math.cos(KERB_TURN)) return null;
    const step = Math.abs(spans[k].chain.half - spans[other].chain.half);
    return step < 0.05 ? null : { to: (spans[k].chain.half + spans[other].chain.half) / 2, reach: step * 2 + 1 };
  };
  // Each piece's edge on the right of the way round the junction (counter-clockwise, the surface on the left)
  const pieces = spans.map(({ chain, d0, d1, forward, second }, k) => {
    const before = k > 0 ? toward(k, k - 1) : null;
    const after = k < spans.length - 1 ? toward(k, k + 1) : null;
    const steps = Math.max(1, Math.ceil(Math.abs(d1 - d0)));
    const sign = forward ? 1 : -1;
    const out: (MapPoint & { walk: number; second: boolean })[] = [];
    for (let s = 0; s <= steps; s++) {
      const d = d0 + ((d1 - d0) * s) / steps;
      let half = chain.half;
      if (before) half += (before.to - chain.half) * Math.max(0, 1 - Math.abs(d - d0) / before.reach);
      if (after) half += (after.to - chain.half) * Math.max(0, 1 - Math.abs(d1 - d) / after.reach);
      const p = pointAt(chain, d);
      const t = tangentAt(chain, d);
      // Right of the way: right of the chain's direction going forward, left going back
      out.push({ x: p.x + t.y * half * t.scale * sign, y: p.y - t.x * half * t.scale * sign, walk: chain.walk, second });
    }
    return out;
  });
  // Joined piece by piece where the edges cross (the inside of a bend; at a joint that tapers, at the node): the
  // latest crossing on the way in, the earliest on the way out, a corner of more than KERB_ROUND rounded off by the
  // narrower road's kerb radius. Edges that part (the outside of a bend): at one node no kerb along them, the kerb
  // lines meet in front (lineMeet); between nodes a curve from one edge to the next through where their lines meet
  type KerbPoint = MapPoint & { walk: number; second: boolean };
  let line = pieces[0];
  for (let k = 1; k < pieces.length; k++) {
    const next = pieces[k];
    const radius = Math.min(6, Math.max(0.5, Math.min(spans[k - 1].chain.half, spans[k].chain.half) * 0.8 + 1));
    let joined: KerbPoint[] | null = null;
    for (let i = line.length - 1; i > 0 && !joined; i--) {
      for (let j = 0; j + 1 < next.length; j++) {
        const x = segmentCross(line[i - 1], line[i], next[j], next[j + 1]);
        if (!x) continue;
        const corner = { ...x, walk: line[i - 1].walk, second: line[i - 1].second };
        joined = follow ? roundJoint(line.slice(0, i), corner, next.slice(j + 1), radius) : [...line.slice(0, i), corner, ...next.slice(j + 1)];
        break;
      }
    }
    if (!joined && follow) {
      const p = line[line.length - 1];
      const q = next[0];
      let meet = line.length > 1 && next.length > 1 ? rayMeet(line[line.length - 2], p, q, next[1]) : null;
      // Not far beyond either (edges nearly parallel): straight across
      if (meet && Math.hypot(meet.x - p.x, meet.y - p.y) + Math.hypot(meet.x - q.x, meet.y - q.y) > Math.hypot(q.x - p.x, q.y - p.y) * 3 + 2) meet = null;
      const curve: KerbPoint[] = [];
      for (let s = 1; meet && s < CURVE_POINTS; s++) {
        const t = s / CURVE_POINTS;
        const u = 1 - t;
        const from = t < 0.5 ? p : q;
        curve.push({ x: u * u * p.x + 2 * u * t * meet.x + t * t * q.x, y: u * u * p.y + 2 * u * t * meet.y + t * t * q.y, walk: from.walk, second: from.second });
      }
      joined = [...line, ...curve, ...next];
    }
    if (!joined) return null;
    line = joined;
  }
  // Between the end sections (theirs are the ring's own points)
  return line.slice(1, -1);
}

/** Least turn (radians) of a kerb at a joint of kerbAlong's pieces that is rounded off */
const KERB_ROUND = Math.PI / 12;

/**
 * A kerb's corner at `x` (the line `before` comes in, `after` goes on)
 * rounded off: a curve from `radius` before it to `radius` after it (less where
 * a side is shorter), through the corner as its control point
 */
function roundJoint<T extends MapPoint & { walk: number; second: boolean }>(before: T[], x: T, after: T[], radius: number): T[] {
  const into = before[before.length - 1];
  const out = after[0];
  if (!into || !out) return [...before, x, ...after];
  const ax = x.x - into.x;
  const ay = x.y - into.y;
  const bx = out.x - x.x;
  const by = out.y - x.y;
  if (Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by)) < KERB_ROUND) return [...before, x, ...after];
  // Back along the incoming line and on along the outgoing one by the radius (at most two fifths of either)
  const walk = (points: T[], from: MapPoint, reach: number): { at: MapPoint; rest: T[] } => {
    let prev: MapPoint = from;
    for (let k = 0; k < points.length; k++) {
      const l = Math.hypot(points[k].x - prev.x, points[k].y - prev.y);
      if (l >= reach) {
        const t = reach / (l || 1);
        return { at: { x: prev.x + (points[k].x - prev.x) * t, y: prev.y + (points[k].y - prev.y) * t }, rest: points.slice(k) };
      }
      reach -= l;
      prev = points[k];
    }
    return { at: prev, rest: [] };
  };
  const length = (points: readonly MapPoint[], from: MapPoint) => points.reduce((s, p, k) => s + Math.hypot(p.x - (k ? points[k - 1] : from).x, p.y - (k ? points[k - 1] : from).y), 0);
  const back = [...before].reverse();
  const r = Math.min(radius, length(back, x) * 0.4, length(after, x) * 0.4);
  if (r < 0.05) return [...before, x, ...after];
  const s0 = walk(back, x, r);
  const s1 = walk(after, x, r);
  const curve: T[] = [];
  for (let s = 0; s <= CURVE_POINTS; s++) {
    const t = s / CURVE_POINTS;
    const u = 1 - t;
    curve.push({ ...(t < 0.5 ? into : out), x: u * u * s0.at.x + 2 * u * t * x.x + t * t * s1.at.x, y: u * u * s0.at.y + 2 * u * t * x.y + t * t * s1.at.y });
  }
  return [...s0.rest.reverse(), ...curve, ...s1.rest];
}

/**
 * Where the kerb line through `a` (along road ea, back towards the node) meets
 * the one through `b` (along eb): the control point of the kerb curve; null
 * when they meet behind either end or not at all
 */
function lineMeet(a: MapPoint, ea: End, b: MapPoint, eb: End): MapPoint | null {
  // a - ea.d * p = b - eb.d * q
  const det = -ea.dx * eb.dy + ea.dy * eb.dx;
  if (Math.abs(det) < 1e-4) return null;
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  // -ea.d * p + eb.d * q = r
  const p = (rx * eb.dy - ry * eb.dx) / det;
  const q = (-ea.dx * ry + ea.dy * rx) / det;
  if (p < 0 || q < 0) return null;
  // Far behind both (roads nearly parallel, from nodes of a junction metres apart): no curve out of the junction
  const reach = Math.hypot(rx, ry) * 3 + 2;
  if (p > reach && q > reach) return null;
  return { x: a.x - ea.dx * p, y: a.y - ea.dy * p };
}
