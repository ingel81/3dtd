/**
 * The numeric check of an arc of RouteCorners (route-corners.ts): whether
 * every lane of the arc, from factor -1 to 1, stays within the lateral limit
 * of the sharp route (SideLimits.node), and with `measure` how much its
 * lanes would have to give up in its middle to do so.
 */
import type { SideLimits } from './route-corridor';
import type { CornerWindow } from './route-corners';

/** Largest angle between two places an arc is checked at, radians (2 degrees). */
const SAMPLE_ANGLE = Math.PI / 90;
/** Largest step of the outermost lane between two of those places, metres. */
const SAMPLE_STEP_M = 0.5;
/** How close placesToCheck and addPass find where a lane crosses a line or two ends pass each other, metres along the route. */
const CROSSING_STEP_M = 1e-5;
/** How far either side of a crossing it is checked, metres along the route (addCrossing). */
const CROSSING_SIDE_M = 2e-4;
/** How far outside the lanes two ends of the intervals of the check may pass each other and still count, metres (findPasses). */
const PASS_SLACK_M = 1e-3;
/** What an end of the intervals passes besides another end, see passDistance. */
const PASS_OUTER = -3;
const PASS_INNER = -2;
const PASS_CENTRE = -1;
/** Numbers per place judgeNeeds reads: where, the inner and the outer lane's radius and lack of room. */
const NEED_STRIDE = 5;
/** Slack of the numeric checks, metres. */
export const EPS = 1e-6;

/** Where the arc of `window` with `tangent` starts along the route, metres from path[0]. */
export function arcStart(window: CornerWindow, tangent: number, cumulative: readonly number[]): number {
  return cumulative[window.a] - (tangent - window.p) / window.scaleIn;
}

/** Where the arc of `window` with `tangent` ends along the route, metres from path[0]. */
export function arcEnd(window: CornerWindow, tangent: number, cumulative: readonly number[]): number {
  return cumulative[window.b] + (tangent - window.q) / window.scaleOut;
}

/** The check, with the buffers it reuses from one arc to the next. */
export class ArcCheck {
  /**
   * What the lanes of the arc fits() checks give up in its middle, set by
   * the caller; with `measure`, what they would have to give up to fit
   * (needInner, needOuter); and whether what failed the check may pass with
   * the outer lane capped.
   */
  shaveInner = 0;
  shaveOuter = 0;
  needInner = 0;
  needOuter = 0;
  outerFailed = false;
  /** Reused [lo, hi] pairs of checkAt, and the interval bound() narrows. */
  private intervals = new Float64Array(64);
  private lo = 0;
  private hi = 0;
  /**
   * Reused places of placesToCheck; at each, the radius of the inner and
   * the outer lane and the sine and cosine of the arc's angle there
   * (crossings).
   */
  private places = new Float64Array(512);
  private atPlaces = new Float64Array(2048);
  /**
   * The ends of the intervals at the place before and at this one
   * (checkAt), with the lanes' limits at the place before, and the places
   * where two of them pass each other (findPasses).
   */
  private ends = new Float64Array(64);
  private between = new Int32Array(32);
  private previousInner = 0;
  private previousOuter = 0;
  private passes = new Float64Array(256);
  /**
   * What checkAt found at the places and at the passes, NEED_STRIDE numbers
   * each (keepNeeds), and at the place it checked last: how far the inner
   * and the outer lane reach beyond what holds them.
   */
  private needs = new Float64Array(512);
  private passNeeds = new Float64Array(256);
  private lackInner = 0;
  private lackOuter = 0;
  /** The lanes' limits laneLimits() found last. */
  private inner = 0;
  private outer = 0;
  /**
   * The arc fits() checks: its stretch of route, radius, angle per metre
   * along the route, outer cap, the unit normal towards its inside and its
   * centre.
   */
  private arcFrom = 0;
  private arcTo = 0;
  private arcRadius = 0;
  private arcRate = 0;
  private arcCap = Infinity;
  private arcNx = 0;
  private arcNz = 0;
  private arcCentreX = 0;
  private arcCentreZ = 0;

  /**
   * @param turns Signed turn at each waypoint, radians, positive to the left; 0 where it is no knick
   */
  constructor(
    private readonly lengths: readonly number[],
    private readonly cumulative: readonly number[],
    private readonly turns: Float64Array,
    private readonly left: SideLimits,
    private readonly right: SideLimits,
    private readonly taper: number,
  ) {}

  /**
   * Whether every lane of the arc of `window` with `tangent` stays within the
   * lateral limit of the sharp route, see RouteCornerBuilder, the lanes less
   * shaveInner and shaveOuter. At each place checked the lanes lie on one
   * line across, `e` m inside the centre line from the outer to the inner
   * lane; each segment and the outside of each knick hold an interval of it,
   * and together they have to hold all of it (checkAt). Between two places
   * the ends of those intervals move smoothly, and the lanes can leave their
   * room only where two of them pass each other, or one passes a lane or the
   * centre line: where that happens between two places, the check looks there
   * as well (findPasses). Between the places after that what the lanes lack
   * of room changes smoothly, and judgeBetween bounds it.
   *
   * With `measure`, lanes the intervals do not hold all of do not fail the
   * check: needInner and needOuter get the most the inner and the outer lane
   * would have to give up, and the check fails only where the centre line
   * is not held or the sharp one lies too far off, or where the taper from
   * the arc's ends does not reach that much.
   */
  fits(window: CornerWindow, tangent: number, outerCap: number, measure: boolean): boolean {
    const { xs, zs, ux, uz, inside, turn } = window;
    const radius = tangent * window.cot;
    const from = arcStart(window, tangent, this.cumulative);
    const to = arcEnd(window, tangent, this.cumulative);
    this.arcFrom = from;
    this.arcTo = to;
    this.arcRadius = radius;
    this.arcRate = turn / (to - from);
    this.arcCap = outerCap;
    this.needInner = 0;
    this.needOuter = 0;
    this.outerFailed = false;
    // Towards the inside, at a right angle to the first segment; right of (ux, uz) is (uz, -ux)
    this.arcNx = uz * inside;
    this.arcNz = -ux * inside;
    this.arcCentreX = xs[1] - (tangent - window.p) * ux + radius * this.arcNx;
    this.arcCentreZ = zs[1] - (tangent - window.p) * uz + radius * this.arcNz;
    const count = this.placesToCheck(window);
    const slots = xs.length - 1 + window.b - window.a + 1;
    if (this.ends.length < 8 * slots) this.ends = new Float64Array(16 * slots);
    if (this.between.length < 2 * slots) this.between = new Int32Array(4 * slots);
    if (this.needs.length < NEED_STRIDE * count) this.needs = new Float64Array(2 * NEED_STRIDE * count);
    let passes = 0;
    for (let t = 0; t < count; t++) {
      if (!this.checkAt(window, this.places[t], t === 0 ? 0 : 1)) return false;
      this.keepNeeds(this.needs, t, this.places[t]);
      if (t > 0) passes = this.findPasses(window, passes, slots, this.places[t - 1], this.places[t]);
      this.previousInner = this.inner;
      this.previousOuter = this.outer;
    }
    passes = sortUnique(this.passes, passes);
    if (this.passNeeds.length < NEED_STRIDE * passes) this.passNeeds = new Float64Array(2 * NEED_STRIDE * passes);
    for (let t = 0; t < passes; t++) {
      if (!this.checkAt(window, this.passes[t], 2)) return false;
      this.keepNeeds(this.passNeeds, t, this.passes[t]);
    }
    return this.judgeNeeds(window, count, passes, measure);
  }

  /**
   * The places along the route the lanes of the arc fits() checks are
   * checked at, sorted into `places`; returns how many. Every
   * SAMPLE_ANGLE of the arc and every SAMPLE_STEP_M of its outermost lane;
   * where the lanes' limit changes its slope (a taper starts or ends, a cap
   * takes over, the shave stops rising); and just either side of where the
   * centre line, the inner or the outer lane crosses a line at which what
   * holds it changes (addCrossing, findKinks): at a right angle to a segment
   * through its ends and the points where the limit beside it changes its
   * slope, and the lines halving the angle at which the edges of the room of
   * the two segments of a knick meet, where a lane is as far beyond one edge
   * as beyond the other.
   */
  private placesToCheck(window: CornerWindow): number {
    const { a, b, turn } = window;
    const { lengths, cumulative, taper, left, right } = this;
    const { arcFrom: from, arcTo: to, arcRadius: radius, arcRate: rate, arcCap: outerCap, arcCentreX: centreX, arcCentreZ: centreZ } = this;
    if (window.kinks === null) this.findKinks(window);
    const kinks = window.kinks!;
    const lines = window.lines!;

    let count = 0;
    const outerSide = window.inside > 0 ? left : right;
    let widest = 0;
    for (let j = a - 1; j <= b; j++) widest = Math.max(widest, outerSide.segment[j]);
    // At least 4 and at most 256
    const even = Math.min(
      256,
      Math.max(4, Math.ceil(turn / SAMPLE_ANGLE), Math.ceil(((radius + widest) * turn) / SAMPLE_STEP_M)),
    );
    for (let t = 0; t <= even; t++) count = this.addPlace(count, from + ((to - from) * t) / even);
    count = this.addPlace(count, from);
    count = this.addPlace(count, to);
    for (const along of kinks) count = this.addPlace(count, along);
    // Where the shave stops rising from the arc's ends
    for (let lane = 0; lane < 2; lane++) {
      const shave = lane === 0 ? this.shaveInner : this.shaveOuter;
      if (shave > 0) {
        count = this.addPlace(count, from + shave / taper);
        count = this.addPlace(count, to - shave / taper);
      }
    }
    // Where the caps take over from a taper
    for (let j = a - 1; j <= b; j++) {
      for (let c = 0; c < 4; c++) {
        const side = c < 2 ? left : right;
        const cap = c % 2 === 0 ? radius : outerCap;
        const s0 = (cap - side.node[j]) / taper;
        const s1 = lengths[j] - (cap - side.node[j + 1]) / taper;
        if (s0 >= 0 && s0 <= lengths[j]) count = this.addPlace(count, cumulative[j] + s0);
        if (s1 >= 0 && s1 <= lengths[j]) count = this.addPlace(count, cumulative[j] + s1);
      }
    }
    // Between these places the lanes' radius changes linearly with the angle
    const known = sortUnique(this.places, count);
    count = known;
    if (this.atPlaces.length < 4 * known) this.atPlaces = new Float64Array(8 * known);
    const at = this.atPlaces;
    let widestInner = 0;
    let widestOuter = 0;
    for (let t = 0; t < known; t++) {
      this.laneLimits(window, this.places[t]);
      const phi = (this.places[t] - from) * rate;
      at[4 * t] = radius - this.inner;
      at[4 * t + 1] = radius + this.outer;
      at[4 * t + 2] = Math.sin(phi);
      at[4 * t + 3] = Math.cos(phi);
      widestInner = Math.max(widestInner, radius - this.inner);
      widestOuter = Math.max(widestOuter, radius + this.outer);
    }
    for (let l = 0; l < lines.length; l += 5) {
      const along = (lines[l] - centreX) * lines[l + 2] + (lines[l + 1] - centreZ) * lines[l + 3];
      if (Math.abs(along) > widestOuter) continue;
      const beta = lines[l + 4];
      // The centre line keeps its radius: where it crosses, directly
      if (Math.abs(along) <= radius) {
        const base = Math.asin(along / radius);
        count = this.addCrossing(count, from + wrap(beta + base) / rate);
        count = this.addCrossing(count, from + wrap(beta + Math.PI - base) / rate);
      }
      // A lane: where its distance along the normal changes sign between two places
      for (let lane = 0; lane < 2; lane++) {
        if (Math.abs(along) > (lane === 0 ? widestInner : widestOuter)) continue;
        count = this.crossings(count, known, lane, along, beta);
      }
    }
    return sortUnique(this.places, count);
  }

  /** Adds `along` to `places`, if it lies on the arc's stretch. */
  private addPlace(count: number, along: number): number {
    if (!(along >= this.arcFrom && along <= this.arcTo)) return count;
    if (count === this.places.length) {
      const grown = new Float64Array(count * 2);
      grown.set(this.places);
      this.places = grown;
    }
    this.places[count] = along;
    return count + 1;
  }

  /**
   * The places just either side of where a lane crosses a line: there a
   * segment can stop holding it, and what holds it on the other side can
   * fall short by as much as where it crosses.
   */
  private addCrossing(count: number, along: number): number {
    count = this.addPlace(count, along - CROSSING_SIDE_M);
    return this.addPlace(count, along + CROSSING_SIDE_M);
  }

  /**
   * Adds where the inner (`lane` 0) or the outer (1) lane of the arc crosses
   * a line `along` m from the arc's centre along its unit normal, whose
   * direction from the arc's first segment is `beta`: a lane of radius r
   * stands r sin(phi - beta) along the normal at angle phi. Between two of
   * the first `known` places (atPlaces) the radius changes linearly; where
   * the distance to the line changes sign, up to four steps of regula falsi
   * find the crossing.
   */
  private crossings(count: number, known: number, lane: number, along: number, beta: number): number {
    const { atPlaces: at, arcFrom: from, arcRate: rate } = this;
    const cosBeta = Math.cos(beta);
    const sinBeta = Math.sin(beta);
    const beyond = (place: number, r: number): number => {
      const phi = (place - from) * rate;
      return r * (Math.sin(phi) * cosBeta - Math.cos(phi) * sinBeta) - along;
    };
    let before = at[lane] * (at[2] * cosBeta - at[3] * sinBeta) - along;
    for (let t = 1; t < known; t++) {
      const after = at[4 * t + lane] * (at[4 * t + 2] * cosBeta - at[4 * t + 3] * sinBeta) - along;
      if (before < 0 !== after < 0) {
        const a0 = this.places[t - 1];
        const a1 = this.places[t];
        const r0 = at[4 * (t - 1) + lane];
        const r1 = at[4 * t + lane];
        let lo = a0;
        let hi = a1;
        let fLo = before;
        let fHi = after;
        let mid = lo;
        for (let step = 0; step < 4 && hi - lo > CROSSING_STEP_M; step++) {
          mid = lo + ((hi - lo) * fLo) / (fLo - fHi);
          const f = beyond(mid, r0 + ((r1 - r0) * (mid - a0)) / (a1 - a0));
          if (f < 0 === fLo < 0) {
            lo = mid;
            fLo = f;
          } else {
            hi = mid;
            fHi = f;
          }
        }
        count = this.addCrossing(count, mid);
      }
      before = after;
    }
    return count;
  }

  /**
   * The places the check of `window` changes its slope at whatever the arc:
   * `kinks`, metres along the route where the limit beside a segment does,
   * and `lines`, through the points of the segments there and at their ends
   * at a right angle to the segment, and the lines halving the angle where
   * the edges of the room of two segments meet at a knick, on either side.
   */
  private findKinks(window: CornerWindow): void {
    const { a, b, xs, zs } = window;
    const { lengths, cumulative, taper, left, right } = this;
    const kinks: number[] = [];
    const lines: number[] = [];
    // Direction of a normal from the arc's first segment, towards its inside positive
    const beta = (dx: number, dz: number): number =>
      Math.atan2(window.inside * (window.uz * dx - window.ux * dz), window.ux * dx + window.uz * dz);
    for (let j = a - 1; j <= b; j++) {
      const length = lengths[j];
      const x0 = xs[j - a + 1];
      const z0 = zs[j - a + 1];
      const flat = Math.hypot(xs[j - a + 2] - x0, zs[j - a + 2] - z0);
      if (flat === 0) continue;
      const sx = (xs[j - a + 2] - x0) / flat;
      const sz = (zs[j - a + 2] - z0) / flat;
      const point = (s: number): void => {
        if (!(s >= 0 && s <= length)) return;
        kinks.push(cumulative[j] + s);
        lines.push(x0 + (sx * flat * s) / length, z0 + (sz * flat * s) / length, sx, sz, beta(sx, sz));
      };
      point(0);
      point(length);
      for (const side of [left, right]) {
        const [seg, n0, n1] = [side.segment[j], side.node[j], side.node[j + 1]];
        point((seg - n0) / taper);
        point(length - (seg - n1) / taper);
        point((n1 - n0 + taper * length) / (2 * taper));
      }
    }
    for (let k = a; k <= b; k++) {
      const j = k - a + 1;
      const inLength = Math.hypot(xs[j] - xs[j - 1], zs[j] - zs[j - 1]);
      const outLength = Math.hypot(xs[j + 1] - xs[j], zs[j + 1] - zs[j]);
      if (inLength === 0 || outLength === 0) continue;
      const iux = (xs[j] - xs[j - 1]) / inLength;
      const iuz = (zs[j] - zs[j - 1]) / inLength;
      const oux = (xs[j + 1] - xs[j]) / outLength;
      const ouz = (zs[j + 1] - zs[j]) / outLength;
      for (const sign of [-1, 1]) {
        const side = sign > 0 ? right : left;
        // Limit and its change per flat metre at the end of the segment
        // into the knick and at the start of the one out of it
        const step = Math.min(0.01, lengths[k - 1], lengths[k]);
        const inEnd = this.limitAt(side, k - 1, lengths[k - 1]);
        const inSlope = ((inEnd - this.limitAt(side, k - 1, lengths[k - 1] - step)) / step) * (lengths[k - 1] / inLength);
        const outStart = this.limitAt(side, k, 0);
        const outSlope = ((this.limitAt(side, k, step) - outStart) / step) * (lengths[k] / outLength);
        // The edges, each through its point at the knick; right of (x, z) is (z, -x)
        const ax = xs[j] + inEnd * sign * iuz;
        const az = zs[j] - inEnd * sign * iux;
        const adx = iux + inSlope * sign * iuz;
        const adz = iuz - inSlope * sign * iux;
        const bx = xs[j] + outStart * sign * ouz;
        const bz = zs[j] - outStart * sign * oux;
        const bdx = oux + outSlope * sign * ouz;
        const bdz = ouz - outSlope * sign * oux;
        const det = adx * bdz - adz * bdx;
        if (Math.abs(det) < 1e-9) continue;
        const t = ((bx - ax) * bdz - (bz - az) * bdx) / det;
        const al = Math.hypot(adx, adz);
        const bl = Math.hypot(bdx, bdz);
        for (const halving of [1, -1]) {
          const hx = adx / al + halving * (bdx / bl);
          const hz = adz / al + halving * (bdz / bl);
          const h = Math.hypot(hx, hz);
          // The halving line through the meeting point, by its normal
          if (h > EPS) lines.push(ax + t * adx, az + t * adz, -hz / h, hx / h, beta(-hz / h, hx / h));
        }
      }
    }
    window.kinks = Float64Array.from(kinks);
    window.lines = Float64Array.from(lines);
  }

  /**
   * The check of fits() at `along` m along the route: false where the
   * centre line is not held, or the sharp one lies beyond the room of the
   * sharp route from it.
   * Leaves in lackInner and lackOuter how far the inner and the outer lane
   * reach beyond what holds them, negative for room to spare. Keeps the ends of
   * the interval each segment and knick holds (NaN where it holds none) in
   * row `row` of `ends`: 0 or 1 for the places in turn, the one before and
   * this one, 3 for a place between them (addPass), 2 for none.
   */
  private checkAt(window: CornerWindow, along: number, row: number): boolean {
    const { a, b, xs, zs, ux, uz } = window;
    const { arcFrom: from, arcRadius: radius, arcNx: nx, arcNz: nz } = this;
    const j = this.laneLimits(window, along);
    const { inner, outer } = this;
    const phi = (along - from) * this.arcRate;
    const sin = Math.sin(phi);
    const cos = Math.cos(phi);
    // Out from the centre; the lane `e` m inside stands at q - e * out
    const outX = sin * ux - cos * nx;
    const outZ = sin * uz - cos * nz;
    const qx = this.arcCentreX + radius * outX;
    const qz = this.arcCentreZ + radius * outZ;
    // The sharp centre line at the same place along the route lies within
    // the room of the sharp route there, its wider side, from the arc's
    // centre line
    const segment = j - (a - 1);
    const s = Math.min(this.lengths[j], Math.max(0, along - this.cumulative[j]));
    const f = this.lengths[j] > 0 ? s / this.lengths[j] : 0;
    const sharpX = xs[segment] + (xs[segment + 1] - xs[segment]) * f;
    const sharpZ = zs[segment] + (zs[segment + 1] - zs[segment]) * f;
    const room = Math.max(this.limitAt(this.left, j, s), this.limitAt(this.right, j, s));
    if (Math.hypot(sharpX - qx, sharpZ - qz) > room + EPS) {
      this.outerFailed = false;
      return false;
    }
    const slots = xs.length - 1 + b - a + 1;
    const ends = this.ends;
    const base = row === 2 ? -1 : 2 * slots * row;
    let held = 0;
    for (let slot = 0; slot < slots; slot++) {
      const seg = slot + a - 1;
      const holds =
        slot < xs.length - 1
          ? this.besideSegment(seg, window.segments, slot, xs[slot], zs[slot], qx, qz, -outX, -outZ, held)
          : this.turns[slot - xs.length + 1 + a] !== 0 &&
            this.pastKnick(slot - xs.length + 1 + a, xs, zs, slot - xs.length + 2, qx, qz, -outX, -outZ, held);
      if (base >= 0) {
        ends[base + 2 * slot] = holds ? this.intervals[2 * held] : NaN;
        ends[base + 2 * slot + 1] = holds ? this.intervals[2 * held + 1] : NaN;
      }
      if (holds) held++;
    }
    const up = reach(this.intervals, held, 0, 1);
    if (Number.isNaN(up)) return false;
    this.lackInner = inner - up;
    this.lackOuter = outer + reach(this.intervals, held, 0, -1);
    return true;
  }

  /**
   * The limits of the inner and the outer lane of the arc fits() checks at
   * `along` m along the route, into `inner` and `outer`: the sharp route's,
   * the inner at most its radius, the outer at most its cap, less their
   * shave (shaveInner, shaveOuter) as far as the taper from the arc's ends
   * (arcFrom, arcTo) reaches. Returns the segment that place lies on.
   */
  private laneLimits(window: CornerWindow, along: number): number {
    const { a, b, inside } = window;
    let j = a - 1;
    while (j < b && along > this.cumulative[j + 1]) j++;
    const s = Math.min(this.lengths[j], Math.max(0, along - this.cumulative[j]));
    const fromEnd = this.taper * Math.max(0, Math.min(along - this.arcFrom, this.arcTo - along));
    const inner = Math.min(this.arcRadius, this.limitAt(inside > 0 ? this.right : this.left, j, s));
    const outer = Math.min(this.arcCap, this.limitAt(inside > 0 ? this.left : this.right, j, s));
    this.inner = Math.max(0, inner - Math.min(this.shaveInner, fromEnd));
    this.outer = Math.max(0, outer - Math.min(this.shaveOuter, fromEnd));
    return j;
  }

  /** The lateral limit of the sharp route on `side`, `s` m into segment `j`. */
  private limitAt(side: SideLimits, j: number, s: number): number {
    return Math.min(side.segment[j], side.node[j] + this.taper * s, side.node[j + 1] + this.taper * (this.lengths[j] - s));
  }

  /**
   * The interval of `e` for which q + e * d lies beside segment `seg` (from
   * x0, z0; entry `slot` of `segments`, see CornerWindow), over a point of it,
   * within its lateral limit there on its side; written as entry `held`,
   * false where it is empty.
   */
  private besideSegment(
    seg: number, segments: Float64Array, slot: number, x0: number, z0: number, qx: number, qz: number, dx: number, dz: number,
    held: number,
  ): boolean {
    const flat = segments[4 * slot + 2];
    if (flat === 0) return false;
    const sx = segments[4 * slot];
    const sz = segments[4 * slot + 1];
    // Along the segment and to its right, each linear in e
    const along0 = (qx - x0) * sx + (qz - z0) * sz;
    const along1 = dx * sx + dz * sz;
    this.lo = -Infinity;
    this.hi = Infinity;
    this.bound(-along0, -along1);
    this.bound(along0 - flat, along1);
    if (!(this.lo <= this.hi)) return false;
    const right0 = (qx - x0) * sz - (qz - z0) * sx;
    const right1 = dx * sz - dz * sx;
    // How much the limit rises per flat metre along the segment
    const k = segments[4 * slot + 3];
    const { left, right } = this;
    this.bound(right0 - right.segment[seg], right1);
    this.bound(right0 - right.node[seg] - k * along0, right1 - k * along1);
    this.bound(right0 - right.node[seg + 1] - k * (flat - along0), right1 + k * along1);
    this.bound(-right0 - left.segment[seg], -right1);
    this.bound(-right0 - left.node[seg] - k * along0, -right1 - k * along1);
    this.bound(-right0 - left.node[seg + 1] - k * (flat - along0), -right1 + k * along1);
    return this.hold(held);
  }

  /**
   * The interval of `e` for which q + e * d lies past knick `k` (point `j`
   * of the window), beyond the end of the segment into it and before the
   * start of the one out of it, within the lateral limit of its outside from
   * it: the round end of the cells there. Written as entry `held`, false
   * where it is empty.
   */
  private pastKnick(
    k: number, xs: Float64Array, zs: Float64Array, j: number, qx: number, qz: number, dx: number, dz: number, held: number,
  ): boolean {
    // A left turn (positive) has its outside on the right
    const limit = (this.turns[k] > 0 ? this.right : this.left).node[k];
    if (!(limit > 0)) return false;
    const wx = qx - xs[j];
    const wz = qz - zs[j];
    const half = wx * dx + wz * dz;
    const disc = half * half - (wx * wx + wz * wz - limit * limit);
    if (disc < 0) return false;
    this.lo = -half - Math.sqrt(disc);
    this.hi = -half + Math.sqrt(disc);
    // Beyond the end of the segment into it: (w + e d) . in >= 0; before the start of the one out: (w + e d) . out <= 0
    const inX = xs[j] - xs[j - 1];
    const inZ = zs[j] - zs[j - 1];
    const outX = xs[j + 1] - xs[j];
    const outZ = zs[j + 1] - zs[j];
    this.bound(-(wx * inX + wz * inZ), -(dx * inX + dz * inZ));
    this.bound(wx * outX + wz * outZ, dx * outX + dz * outZ);
    return this.hold(held);
  }

  /** Narrows [lo, hi] to where c0 + c1 * e <= EPS. */
  private bound(c0: number, c1: number): void {
    if (Math.abs(c1) < 1e-12) {
      if (c0 > EPS) this.hi = -Infinity;
    } else if (c1 > 0) {
      this.hi = Math.min(this.hi, (EPS - c0) / c1);
    } else {
      this.lo = Math.max(this.lo, (EPS - c0) / c1);
    }
  }

  /** Keeps [lo, hi] as entry `held` of the intervals if it is not empty. */
  private hold(held: number): boolean {
    if (!(this.lo <= this.hi)) return false;
    if (2 * held + 2 > this.intervals.length) {
      const grown = new Float64Array(this.intervals.length * 2);
      grown.set(this.intervals);
      this.intervals = grown;
    }
    this.intervals[2 * held] = this.lo;
    this.intervals[2 * held + 1] = this.hi;
    return true;
  }

  /**
   * Adds to `passes` where, between the places `a0` and `a1` (rows 0 and 1
   * of `ends`, the lanes' limits in previousInner, previousOuter and inner,
   * outer), two ends of the intervals pass each other, or one passes the
   * centre line or a lane (addPass). Swaps the rows. Returns the count.
   */
  private findPasses(window: CornerWindow, count: number, slots: number, a0: number, a1: number): number {
    const ends = this.ends;
    const next = 2 * slots;
    // The ends that are not beyond the same lane at both places: one that
    // is passes nothing between the lanes
    const between = this.between;
    let n = 0;
    for (let i = 0; i < 2 * slots; i++) {
      const v0 = ends[i];
      const v1 = ends[next + i];
      if (!Number.isFinite(v0) || !Number.isFinite(v1)) continue;
      if (v0 > this.previousInner + PASS_SLACK_M && v1 > this.inner + PASS_SLACK_M) continue;
      if (v0 < -this.previousOuter - PASS_SLACK_M && v1 < -this.outer - PASS_SLACK_M) continue;
      between[n++] = i;
    }
    // What the check at the passes changes
    const { inner, outer, lackInner, lackOuter } = this;
    for (let m = 0; m < n; m++) {
      const i = between[m];
      for (let other = PASS_OUTER; other < 0; other++) count = this.addPass(window, count, slots, i, other, a0, a1);
      for (let o = m + 1; o < n; o++) count = this.addPass(window, count, slots, i, between[o], a0, a1);
    }
    this.inner = inner;
    this.outer = outer;
    this.lackInner = lackInner;
    this.lackOuter = lackOuter;
    ends.copyWithin(0, next, 2 * next);
    return count;
  }

  /**
   * How far end `i` of the intervals lies beyond `other` in row `row` of
   * `ends`: another end, or the centre line (PASS_CENTRE), the inner
   * (PASS_INNER) or the outer lane (PASS_OUTER) at their limits `inner`,
   * `outer`.
   */
  private passDistance(row: number, slots: number, i: number, other: number, inner: number, outer: number): number {
    const base = 2 * slots * row;
    const w = other === PASS_CENTRE ? 0 : other === PASS_INNER ? inner : other === PASS_OUTER ? -outer : this.ends[base + other];
    return this.ends[base + i] - w;
  }

  /**
   * Adds where end `i` of the intervals passes `other` (passDistance)
   * between the places `a0` and `a1`, if it does so between the outer and
   * the inner lane: where their distance changes its sign, found by linear
   * interpolation and, since the ends do not move linearly, a few steps of
   * regula falsi (two) with the check at the place found (row 3 of `ends`).
   */
  private addPass(window: CornerWindow, count: number, slots: number, i: number, other: number, a0: number, a1: number): number {
    const d0 = this.passDistance(0, slots, i, other, this.previousInner, this.previousOuter);
    const d1 = this.passDistance(1, slots, i, other, this.inner, this.outer);
    if (d0 < 0 === d1 < 0 || d0 === d1) return count;
    const share = d0 / (d0 - d1);
    const value = this.ends[i] + (this.ends[2 * slots + i] - this.ends[i]) * share;
    const inner = this.previousInner + (this.inner - this.previousInner) * share;
    const outer = this.previousOuter + (this.outer - this.previousOuter) * share;
    if (value > inner + PASS_SLACK_M || value < -outer - PASS_SLACK_M) return count;
    let lo = a0;
    let hi = a1;
    let dLo = d0;
    let dHi = d1;
    let at = a0 + (a1 - a0) * share;
    for (let step = 0; step < 2 && hi - lo > CROSSING_STEP_M; step++) {
      if (!this.checkAt(window, at, 3)) break;
      const d = this.passDistance(3, slots, i, other, this.inner, this.outer);
      if (!Number.isFinite(d)) break;
      if (d < 0 === dLo < 0) {
        lo = at;
        dLo = d;
      } else {
        hi = at;
        dHi = d;
      }
      at = lo + ((hi - lo) * dLo) / (dLo - dHi);
    }
    if (count === this.passes.length) {
      const grown = new Float64Array(count * 2);
      grown.set(this.passes);
      this.passes = grown;
    }
    this.passes[count] = at;
    return count + 1;
  }

  /** Keeps what checkAt found at `along` as entry `t` of `needs`: the place, the lanes' radii and what they lack of room. */
  private keepNeeds(needs: Float64Array, t: number, along: number): void {
    const k = NEED_STRIDE * t;
    needs[k] = along;
    needs[k + 1] = this.arcRadius - this.inner;
    needs[k + 2] = this.arcRadius + this.outer;
    needs[k + 3] = this.lackInner;
    needs[k + 4] = this.lackOuter;
  }

  /**
   * Whether what the lanes lack of room at the `count` places and the
   * `passes` places checked, in order along the route, and between each two
   * of them (judgeBetween), is nothing, or with `measure` no more than their
   * shave can give where it rises from the arc's ends; the most into
   * needInner and needOuter.
   */
  private judgeNeeds(window: CornerWindow, count: number, passes: number, measure: boolean): boolean {
    const { needs, passNeeds } = this;
    let t = 0;
    let p = 0;
    let before = -1;
    let beforeNeeds = needs;
    while (t < count || p < passes) {
      const fromPasses = t >= count || (p < passes && passNeeds[NEED_STRIDE * p] < needs[NEED_STRIDE * t]);
      const list = fromPasses ? passNeeds : needs;
      const k = NEED_STRIDE * (fromPasses ? p++ : t++);
      for (let lane = 0; lane < 2; lane++) {
        if (!this.judgeLack(list[k], list[k + 3 + lane], lane, measure)) return false;
        if (before < 0) continue;
        const a0 = beforeNeeds[before];
        const lack0 = beforeNeeds[before + 3 + lane];
        const radius = Math.max(beforeNeeds[before + 1 + lane], list[k + 1 + lane]);
        if (!this.judgeBetween(window, lane, a0, lack0, list[k], list[k + 3 + lane], radius, measure, 3)) {
          return false;
        }
      }
      before = k;
      beforeNeeds = list;
    }
    return true;
  }

  /**
   * judgeNeeds between two places `a0` and `a1` m along the route, where
   * lane `lane` (0 inner, 1 outer, of radius at most `radius`) lacks `lack0`
   * and `lack1` of room.
   *
   * Between them the lack can rise above the straight line between those
   * two by at most k x (d - x) / 2, `x` m from the first of places `d` m
   * apart, where k bounds how fast its slope falls. A lane of radius r
   * stands at C + r u(phi) about the arc's centre C, its limit changing by
   * e' per radian, here the change between the two places: its second
   * derivative by the angle, 2 e' u' - r u, is at most r + 2 |e'| long. What
   * it lacks beyond the edge of the room of a segment, a line that rises by
   * the taper, changes by at most sqrt(1 + taper^2) times that; the round
   * end of a knick bends the other way. Per metre of route squared, and a
   * fifth more for the line across meeting an edge at a slant:
   * k = 1.2 sqrt(1 + taper^2) (r rate^2 + 2 |e'| rate).
   *
   * Where that bound leaves the lane more than EPS beyond its room (at its
   * highest, or highest over the room either end of the arc leaves), the
   * check looks there and judges both halves again, `depth` times (three
   * from judgeNeeds); then the bound counts.
   */
  private judgeBetween(
    window: CornerWindow, lane: number, a0: number, lack0: number, a1: number, lack1: number, radius: number,
    measure: boolean, depth: number,
  ): boolean {
    const d = a1 - a0;
    if (!(d > 0) || !Number.isFinite(lack0) || !Number.isFinite(lack1)) return true;
    const { taper, arcRate: rate } = this;
    const change = Math.abs(this.limitChange(window, lane, a0, a1)) / d;
    const bend = 1.2 * Math.sqrt(1 + taper * taper) * (radius * rate * rate + 2 * change * rate);
    if (!(bend * d * d > 1e-12)) return true;
    let worst = -1;
    for (let rise = -1; rise <= 1; rise++) {
      const x = Math.min(d, Math.max(0, d / 2 + (lack1 - lack0 + rise * taper * d) / (bend * d)));
      const lack = lack0 + ((lack1 - lack0) * x) / d + (bend * x * (d - x)) / 2;
      const room = measure ? taper * Math.max(0, Math.min(a0 + x - this.arcFrom, this.arcTo - a0 - x)) : 0;
      if (lack > EPS && (!measure || lack > room || lack > (lane === 0 ? this.needInner : this.needOuter))) {
        worst = rise === 0 || worst < 0 ? x : worst;
      }
    }
    if (worst < 0) return true;
    if (depth === 0) {
      const lack = lack0 + ((lack1 - lack0) * worst) / d + (bend * worst * (d - worst)) / 2;
      return this.judgeLack(a0 + worst, lack, lane, measure);
    }
    // Look where the bound is worst, away from the places themselves
    const middle = a0 + Math.min(0.9 * d, Math.max(0.1 * d, worst));
    if (!this.checkAt(window, middle, 2)) return false;
    const lack = lane === 0 ? this.lackInner : this.lackOuter;
    const r = this.arcRadius + (lane === 0 ? -this.inner : this.outer);
    if (!this.judgeLack(middle, lack, lane, measure)) return false;
    return (
      this.judgeBetween(window, lane, a0, lack0, middle, lack, Math.max(radius, r), measure, depth - 1) &&
      this.judgeBetween(window, lane, middle, lack, a1, lack1, Math.max(radius, r), measure, depth - 1)
    );
  }

  /** How much the limit of lane `lane` (0 inner, 1 outer) changes from `a0` to `a1` m along the route. */
  private limitChange(window: CornerWindow, lane: number, a0: number, a1: number): number {
    this.laneLimits(window, a0);
    const at0 = lane === 0 ? this.inner : this.outer;
    this.laneLimits(window, a1);
    return (lane === 0 ? this.inner : this.outer) - at0;
  }

  /** judgeNeeds for one lane (0 inner, 1 outer) lacking `lack` m of room `along` m along the route. */
  private judgeLack(along: number, lack: number, lane: number, measure: boolean): boolean {
    if (!(lack > EPS)) return true;
    const room = this.taper * Math.max(0, Math.min(along - this.arcFrom, this.arcTo - along));
    if (!measure || lack > room) {
      this.outerFailed = lane === 1 || !measure;
      return false;
    }
    if (lane === 0) this.needInner = Math.max(this.needInner, lack);
    else this.needOuter = Math.max(this.needOuter, lack);
    return true;
  }
}

/** Sorts the first `count` places of `places`, without places closer than a tenth of a millimetre; returns how many are left. */
function sortUnique(places: Float64Array, count: number): number {
  const sorted = places.subarray(0, count).sort();
  let kept = 0;
  for (let i = 0; i < count; i++) {
    if (kept === 0 || sorted[i] - sorted[kept - 1] > 1e-4) sorted[kept++] = sorted[i];
  }
  return kept;
}

/** An angle in [0, 2 pi). */
function wrap(phi: number): number {
  return ((phi % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

/**
 * How far the `held` intervals of `intervals` hold, from `start` on in the
 * direction `sign` without a gap: the far end; NaN where none holds `start`.
 */
function reach(intervals: Float64Array, held: number, start: number, sign: number): number {
  let at = start;
  let holds = false;
  for (;;) {
    let far = at;
    for (let i = 0; i < held; i++) {
      const lo = intervals[2 * i];
      const hi = intervals[2 * i + 1];
      if (lo > at + EPS || hi < at - EPS) continue;
      holds = true;
      far = sign > 0 ? Math.max(far, hi) : Math.min(far, lo);
    }
    if (!holds) return NaN;
    if (Math.abs(far - at) <= EPS) return far;
    at = far;
  }
}
