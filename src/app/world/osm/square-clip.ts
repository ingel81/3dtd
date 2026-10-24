/**
 * Lines and areas cut to the map's square |x|, |y| <= half.
 *
 * An area is cut as its rings' boundary: the stretches of its rings inside
 * the square (pieces, each from the square's edge to its edge) and the
 * stretches of the square's edge between them that lie inside the area. Along
 * the edge, inside and outside take turns at every place a ring crosses it,
 * so one fact decides them all: whether one stretch of the edge lies inside.
 *
 * For rings whose points are all known that fact is counted (even-odd). The
 * Overpass answer leaves out the nodes outside its box, though: a ring
 * reaching far past the map (a lake, a forest) comes as chains whose rest is
 * unknown, and the area may lie on either side of them. The rest then is
 * taken to run around the outside of the map, each gap along the shorter way
 * between the chains' ends (a lake's corner cut by the map: its shore goes
 * round the corner, not across the map), and a judge that knows more (the
 * buildings and roads say where the land is) may turn the answer round.
 */
import type { MapPoint } from '../custom-map/map-document';

/** The runs of a line inside the square |x|, |y| <= lim, each cut where it crosses the edge */
export function clipLine(line: readonly MapPoint[], lim: number): MapPoint[][] {
  const out: MapPoint[][] = [];
  let run: MapPoint[] = [];
  const inside = (p: MapPoint) => Math.abs(p.x) <= lim && Math.abs(p.y) <= lim;
  for (let k = 0; k < line.length; k++) {
    const p = line[k];
    if (k === 0) {
      if (inside(p)) run.push(p);
      continue;
    }
    const q = line[k - 1];
    const seg = clipSegment(q, p, lim);
    if (!seg) continue;
    const at = (t: number): MapPoint => ({ x: q.x + (p.x - q.x) * t, y: q.y + (p.y - q.y) * t });
    if (seg[0] > 0) {
      if (run.length >= 2) out.push(run);
      run = [at(seg[0])];
    }
    if (seg[1] < 1) {
      run.push(at(seg[1]));
      if (run.length >= 2) out.push(run);
      run = [];
    } else run.push(p);
  }
  if (run.length >= 2) out.push(run);
  return out;
}

/** The part of segment a-b inside the square, as parameters along it; null when none (Liang-Barsky) */
export function clipSegment(a: MapPoint, b: MapPoint, lim: number): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const [p, q] of [
    [-dx, a.x + lim],
    [dx, lim - a.x],
    [-dy, a.y + lim],
    [dy, lim - a.y],
  ] as const) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  return t0 <= t1 ? [t0, t1] : null;
}

/** Clockwise position along the square's edge from its north-west corner, 0 to 8 half */
export function perimeter(p: MapPoint, half: number): number {
  const e = 0.02;
  if (p.y >= half - e) return p.x + half;
  if (p.x >= half - e) return 2 * half + (half - p.y);
  if (p.y <= -half + e) return 4 * half + (half - p.x);
  return 6 * half + (p.y + half);
}

/** The corners of the square passed walking clockwise from edge position `from` to `to` */
export function cornersBetween(from: number, to: number, half: number): MapPoint[] {
  const corners: [number, MapPoint][] = [
    [2 * half, { x: half, y: half }],
    [4 * half, { x: half, y: -half }],
    [6 * half, { x: -half, y: -half }],
    [8 * half, { x: -half, y: half }],
  ];
  const out: MapPoint[] = [];
  for (let lap = 0; lap < 2; lap++) {
    for (const [s, p] of corners) {
      const at = s + lap * 8 * half;
      if (at > from && at < to) out.push(p);
    }
  }
  return out;
}

/** The point on the square's edge at clockwise position `t` */
function edgePoint(t: number, half: number): MapPoint {
  const s = ((t % (8 * half)) + 8 * half) % (8 * half);
  if (s <= 2 * half) return { x: s - half, y: half };
  if (s <= 4 * half) return { x: half, y: half - (s - 2 * half) };
  if (s <= 6 * half) return { x: half - (s - 4 * half), y: -half };
  return { x: -half, y: -half + (s - 6 * half) };
}

/** Whether `p` lies inside an odd number of the rings */
export function insideRings(p: MapPoint, rings: readonly (readonly MapPoint[])[]): boolean {
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[i];
      const b = r[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}

/** Signed area of a ring (counter-clockwise positive) */
export function ringArea(ring: readonly MapPoint[]): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[j].x - ring[i].x) * (ring[j].y + ring[i].y);
  return s / 2;
}

/** Chebyshev distance from the map's centre: over `half` outside the square */
const reach = (p: MapPoint): number => Math.max(Math.abs(p.x), Math.abs(p.y));

/** An area cut to the square: outer rings and the holes in them (closed, first point not repeated) */
export interface ClippedArea {
  outer: MapPoint[][];
  inner: MapPoint[][];
  /** Square metres, outer less inner */
  area: number;
}

/**
 * An area's rings cut to the square of half side `half`, null when nothing
 * of it lies inside. `outer` and `inner` are rings with all their points;
 * `chains` the known stretches of rings the answer cut (both ends outside the
 * square). An area wholly inside keeps its rings as they are; else its
 * rings are put together anew (even-odd: inner rings and rings inside rings
 * are holes). Where chains decide the area, the known rings settle which
 * side of them it lies (roleVote); when they do not, `turn` hears the
 * guessed area's rings and says whether the area is the rest of the square
 * instead.
 */
export function clipArea(
  outer: readonly MapPoint[][],
  inner: readonly MapPoint[][],
  chains: readonly MapPoint[][],
  half: number,
  turn?: (rings: MapPoint[][]) => boolean,
): ClippedArea | null {
  const rings = [...outer, ...inner];
  if (!chains.length && rings.every((r) => r.every((p) => reach(p) <= half))) {
    if (!outer.length) return null;
    const area = outer.reduce((s, r) => s + Math.abs(ringArea(r)), 0) - inner.reduce((s, r) => s + Math.abs(ringArea(r)), 0);
    return { outer: [...outer], inner: [...inner], area: Math.max(0, area) };
  }
  // The pieces inside the square, and the rings that stay whole
  const whole: MapPoint[][] = [];
  const pieces: MapPoint[][] = [];
  for (const r of rings) {
    const out = r.findIndex((p) => reach(p) > half);
    if (out < 0) {
      whole.push(r);
      continue;
    }
    const from = [...r.slice(out), ...r.slice(0, out), r[out]];
    pieces.push(...clipLine(from, half));
  }
  for (const c of chains) pieces.push(...clipLine(c, half));

  // Which stretches of the edge lie inside: counted on the known rings and the chains closed around the map
  const guess = chains.length ? closeOutside(chains, half) : [];
  const counted = [...rings, ...guess];
  const ends = pieces.flatMap((p, k) => [
    { t: perimeter(p[0], half), piece: k, last: false },
    { t: perimeter(p[p.length - 1], half), piece: k, last: true },
  ]);
  ends.sort((a, b) => a.t - b.t || (a.piece - b.piece) || Number(a.last) - Number(b.last));
  let refInside: boolean;
  let ref = 0;
  if (!ends.length) refInside = insideRings({ x: -half, y: half }, counted);
  else {
    // The longest stretch between two crossings: its middle lies clear of them
    let longest = -1;
    ends.forEach((e, k) => {
      const next = k + 1 < ends.length ? ends[k + 1].t : ends[0].t + 8 * half;
      if (next - e.t > longest) {
        longest = next - e.t;
        ref = k;
      }
    });
    refInside = insideRings(edgePoint(ends[ref].t + longest / 2, half), counted);
  }
  let result = stitch(whole, pieces, ends, ref, refInside, half);
  if (chains.length) {
    // The known rings say it first (an island lies in its lake), then the judge
    const vote = roleVote(result, outer, inner, half);
    if (vote < 0 || (vote === 0 && turn?.(result))) result = stitch(whole, pieces, ends, ref, !refInside, half);
  }
  return result.length ? nest(result) : null;
}

/**
 * How far the guessed area `rings` agrees with the rings whose points are
 * all known: the land just inside an outer ring is in the area, just outside
 * an inner ring too (an island lies in its lake). Each such ring within the
 * square counts one for or against; the other guess is the rest of the
 * square, so it scores the opposite.
 */
function roleVote(rings: readonly MapPoint[][], outer: readonly MapPoint[][], inner: readonly MapPoint[][], half: number): number {
  let vote = 0;
  for (const [list, into] of [
    [outer, true],
    [inner, false],
  ] as const) {
    for (const r of list) {
      const probe = beside(r, into, half);
      if (probe) vote += insideRings(probe, rings) ? 1 : -1;
    }
  }
  return vote;
}

/**
 * The pieces joined along the edge into closed rings, given whether the
 * stretch of the edge after crossing `ref` (in clockwise order) lies inside;
 * with the rings that stay whole, and the whole square when no piece crosses
 * and its edge lies inside
 */
function stitch(whole: readonly MapPoint[][], pieces: readonly MapPoint[][], ends: readonly { t: number; piece: number; last: boolean }[], ref: number, refInside: boolean, half: number): MapPoint[][] {
  const rings = [...whole];
  if (!ends.length) {
    if (refInside) rings.push([{ x: -half, y: half }, { x: half, y: half }, { x: half, y: -half }, { x: -half, y: -half }]);
    return rings;
  }
  const m = ends.length;
  // The stretch from crossing k to crossing k + 1 lies inside when it is an even number of crossings from ref's and ref's does
  const stretchInside = (k: number) => (((k - ref) % m) + m) % 2 === 0 === refInside;
  // Where each piece's ends sit in the sorted list
  const at = new Int32Array(pieces.length * 2);
  ends.forEach((e, k) => (at[e.piece * 2 + (e.last ? 1 : 0)] = k));
  const used = new Uint8Array(pieces.length);
  for (let first = 0; first < pieces.length; first++) {
    if (used[first]) continue;
    const ring: MapPoint[] = [];
    let piece = first;
    let forward = true;
    for (let guard = 0; guard <= pieces.length; guard++) {
      used[piece] = 1;
      const p = pieces[piece];
      ring.push(...(forward ? p : [...p].reverse()));
      // Along the edge from where the piece ends to the next crossing, the way that lies inside
      const k: number = at[piece * 2 + (forward ? 1 : 0)];
      const ahead = stretchInside(k);
      const j: number = ahead ? (k + 1) % m : (k + m - 1) % m;
      const from = ends[k].t;
      let to = ends[j].t;
      if (ahead) {
        if (j <= k) to += 8 * half;
        ring.push(...cornersBetween(from, to, half));
      } else {
        if (j >= k) to -= 8 * half;
        const lap = to < 0 ? 8 * half : 0;
        ring.push(...cornersBetween(to + lap, from + lap, half).reverse());
      }
      const next: { t: number; piece: number; last: boolean } = ends[j];
      if (next.piece === first && used[next.piece]) break;
      piece = next.piece;
      forward = !next.last;
      if (used[piece]) break;
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

/**
 * The chains closed into rings around the outside of the map: their ends
 * pushed out onto a square past all of them, and each joined along it to
 * the end next to it, pairing the ends the way that takes the shorter
 * stretches of that square
 */
function closeOutside(chains: readonly MapPoint[][], half: number): MapPoint[][] {
  let big = half;
  for (const c of chains) big = Math.max(big, reach(c[0]), reach(c[c.length - 1]));
  big += 1;
  const push = (p: MapPoint): MapPoint => (Math.abs(p.x) >= Math.abs(p.y) ? { x: Math.sign(p.x || 1) * big, y: p.y } : { x: p.x, y: Math.sign(p.y || 1) * big });
  const ends = chains.flatMap((c, k) => [
    { chain: k, last: false, p: push(c[0]) },
    { chain: k, last: true, p: push(c[c.length - 1]) },
  ]).map((e) => ({ ...e, t: perimeter(e.p, big) }));
  ends.sort((a, b) => a.t - b.t);
  const m = ends.length;
  const gap = (k: number) => (ends[(k + 1) % m].t - ends[k].t + 8 * big) % (8 * big);
  let even = 0;
  for (let k = 0; k < m; k += 2) even += gap(k);
  const shift = even <= 8 * big - even ? 0 : 1;
  // Each end's partner, and whether the way to it runs clockwise (from the first of a pair)
  const partner = new Int32Array(m);
  const clockwise = new Uint8Array(m);
  for (let k = shift; k < m + shift; k += 2) {
    partner[k % m] = (k + 1) % m;
    partner[(k + 1) % m] = k % m;
    clockwise[k % m] = 1;
  }
  const slot = new Int32Array(m);
  ends.forEach((e, k) => (slot[e.chain * 2 + (e.last ? 1 : 0)] = k));
  const used = new Uint8Array(chains.length);
  const rings: MapPoint[][] = [];
  for (let first = 0; first < chains.length; first++) {
    if (used[first]) continue;
    const ring: MapPoint[] = [];
    let chain = first;
    let forward = true;
    for (let guard = 0; guard <= chains.length && !used[chain]; guard++) {
      used[chain] = 1;
      const c = chains[chain];
      ring.push(...(forward ? c : [...c].reverse()));
      const k: number = slot[chain * 2 + (forward ? 1 : 0)];
      const j: number = partner[k];
      ring.push(ends[k].p);
      if (clockwise[k]) ring.push(...cornersBetween(ends[k].t, ends[k].t + gap(k), big));
      else ring.push(...cornersBetween(ends[j].t, ends[j].t + gap(j), big).reverse());
      ring.push(ends[j].p);
      chain = ends[j].chain;
      forward = !ends[j].last;
    }
    rings.push(ring);
  }
  return rings;
}

/** Rings that cut holes (even-odd) sorted into outer rings and holes by how deep each lies in the others */
function nest(rings: MapPoint[][]): ClippedArea {
  const outer: MapPoint[][] = [];
  const inner: MapPoint[][] = [];
  let area = 0;
  for (const r of rings) {
    const a = ringArea(r);
    const probe = Math.abs(a) < 1e-6 ? null : beside(r, true);
    if (!probe) continue;
    const depth = rings.filter((o) => o !== r && insideRings(probe, [o])).length;
    if (depth % 2 === 0) {
      outer.push(r);
      area += Math.abs(a);
    } else {
      inner.push(r);
      area -= Math.abs(a);
    }
  }
  return { outer, inner, area: Math.max(0, area) };
}

/**
 * A point a hair inside (`inside`) or outside a ring beside its longest side,
 * of the sides within the square of half side `within` when given; null
 * without such a side
 */
function beside(r: readonly MapPoint[], inside: boolean, within = Infinity): MapPoint | null {
  const a = ringArea(r);
  let best = -1;
  let len = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i];
    const q = r[(i + 1) % r.length];
    if (reach(p) >= within || reach(q) >= within) continue;
    const l = Math.hypot(q.x - p.x, q.y - p.y);
    if (l > len) {
      len = l;
      best = i;
    }
  }
  if (best < 0 || !a) return null;
  const p = r[best];
  const q = r[(best + 1) % r.length];
  // The left of a side is inside a ring turning counter-clockwise
  const side = (a > 0) === inside ? 1 : -1;
  const e = Math.min(0.01, len / 4);
  return { x: (p.x + q.x) / 2 - (side * (q.y - p.y) * e) / len, y: (p.y + q.y) / 2 + (side * (q.x - p.x) * e) / len };
}
