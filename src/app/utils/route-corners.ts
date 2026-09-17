/**
 * The arcs enemies round the corners of a route on (MovementComponent), one
 * per group of knicks, sized once per path (getRouteProfile).
 *
 * Kept free of Angular and Three.js like route-corridor.ts, whose lateral
 * limits of the sharp route (SideLimits.node) every arc is checked against
 * (route-corner-check.ts).
 */
import type { RouteWaypoint } from '../models/game.types';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT } from './geo-utils';
import type { SideLimits } from './route-corridor';
import { ArcCheck, EPS, arcEnd, arcStart } from './route-corner-check';

/**
 * The arcs that round the corners of a route. An arc covers a group of
 * consecutive waypoints that turn (knicks): from a point on the segment into
 * the first to a point on the segment out of the last, it replaces the
 * sharp centre line by a circular arc tangent to both segments, turning by
 * the sum of the knicks. Each lane runs about the same centre. Progress
 * along the route stays the distance on the sharp centre line and maps
 * linearly onto the angle, so every lane crosses the corner in the same
 * time: an outer lane faster, an inner one slower.
 *
 * Lengths along the route are metres of the route profile (haversine),
 * lengths across (radius, lanes) the flat metres the lateral offset is
 * measured in.
 */
export interface RouteCorners {
  /** Per waypoint: the arc it lies on, an index into the per-arc arrays; -1 where the route does not turn or stays sharp. */
  arcOf: Int32Array;
  /**
   * Per segment: metres from its start that lie on the arc of its first
   * waypoint, at least the segment's length where the whole segment does;
   * 0 without.
   */
  arcIn: Float64Array;
  /** Per segment: metres before its end that lie on the arc of its last waypoint, as `arcIn`; 0 without. */
  arcOut: Float64Array;
  /** Per arc: where its stretch of route starts and ends, metres from path[0]. */
  from: Float64Array;
  to: Float64Array;
  /** Per arc: radius of the centre line's arc, metres. */
  radius: Float64Array;
  /** Per arc: angle the route turns through, radians, unsigned. */
  turn: Float64Array;
  /** Per arc: 1 where the route turns right (the inside of the turn on its right), -1 where it turns left. */
  inside: Float64Array;
  /**
   * Per arc: the most the lateral limit may be over its stretch, left and
   * right: on its inside the radius, on its outside the limit of the
   * outside of its knicks where it needs that, else Infinity.
   */
  capLeft: Float64Array;
  capRight: Float64Array;
  /**
   * Per arc: how much less than that the lanes take in its middle, left and
   * right, at most ARC_SHAVE_M: from its ends in by `taper` per metre, up to
   * this much. What lets an arc follow a curve of short pieces, whose chords
   * it leaves by a few centimetres.
   */
  shaveLeft: Float64Array;
  shaveRight: Float64Array;
  /** The lateral limits enemies that round the corners keep to, left and right of the direction of travel. */
  left: ArcLimits;
  right: ArcLimits;
  /** Per arc: where it starts, on the segment into its first waypoint, degrees. */
  startLat: Float64Array;
  startLon: Float64Array;
  /** Per arc: degrees per metre along the segment into its first waypoint. */
  alongLat: Float64Array;
  alongLon: Float64Array;
  /** Per arc: degrees per metre towards the inside of the turn, at a right angle to that segment. */
  insideLat: Float64Array;
  insideLon: Float64Array;
}

/**
 * The lateral limit on one side of a route for an enemy that rounds the
 * corners (MovementComponent). It is the limit of the sharp route
 * (SideLimits.node), at most the cap of each arc on that side
 * (RouteCorners.capLeft, capRight) at the arc's waypoints and ends, and
 * rising from there by at most `taper` per metre. The sharp route's limit
 * itself where no corner is rounded.
 */
export interface ArcLimits {
  /** Per waypoint. */
  arc: Float64Array;
  /**
   * Per segment: where its straight part starts, at the end of the arc of
   * its first waypoint (RouteCorners.arcIn) or at the waypoint, and where it
   * ends. Between the two the limit is
   * min(segment, entry + taper * metres from there, exit + taper * metres to there).
   */
  entry: Float64Array;
  exit: Float64Array;
}

/** Turns flatter than this are no knick: a lane steps sideways by the turn times its offset, under 1.5 mm. */
const MIN_TURN = 1e-4;
/** Arcs sharper than this stay sharp: the route doubles back on itself. */
const MAX_TURN = Math.PI - 1e-3;
/** Arcs with a shorter tangent stay sharp, flat metres. */
const MIN_TANGENT = 1e-3;
/** A group of knicks takes in a neighbour only where that lets the radius grow by more than this share. */
const GROWTH = 1e-3;
/** The most an arc may take off its lanes in its middle to fit, metres (RouteCorners.shaveLeft). */
export const ARC_SHAVE_M = 0.2;
/** Halvings in the search for the largest arc that fits, at most, and how close it gets: metres of radius, or that share of it. */
const SEARCH_STEPS = 6;
const SEARCH_PRECISION_M = 0.01;

/** An arc for the waypoints `a` to `b`, in the flat frame of path[a - 1]. */
interface Fit {
  a: number;
  b: number;
  radius: number;
  /** The most the lateral limit may be on the outside, Infinity for no cap. */
  outerCap: number;
  /** What the lanes give up in the middle of the arc, inside and outside (RouteCorners.shaveLeft). */
  shaveInner: number;
  shaveOuter: number;
  turn: number;
  inside: number;
  from: number;
  to: number;
  cos0: number;
  ux: number;
  uz: number;
}

/**
 * A group of knicks being grown: its waypoints `a` to `b` and their arc,
 * null where none fits; the next of the arcs it could grow to (0 both
 * sides, 1 before, 2 after) and the largest of them so far.
 */
interface Group {
  a: number;
  b: number;
  best: Fit | null;
  option: number;
  grown: Fit | null;
}

/** The two lines of a group of waypoints and where they meet, in the flat frame of path[a - 1]. */
export interface CornerWindow {
  a: number;
  b: number;
  cos0: number;
  /** Waypoints a - 1 .. b + 1, metres east and north of path[a - 1]. */
  xs: Float64Array;
  zs: Float64Array;
  /** Direction of the segment into waypoint a. */
  ux: number;
  uz: number;
  turn: number;
  inside: number;
  cot: number;
  /** Flat metres from waypoint a on to where the lines meet, and from there on to waypoint b. */
  p: number;
  q: number;
  /** Flat metres per metre of route on the segment into waypoint a and out of waypoint b. */
  scaleIn: number;
  scaleOut: number;
  /** The tangents (flat metres from where the lines meet) the free room before and after allows. */
  lo: number;
  hi: number;
  /**
   * Where the check of the lanes changes its slope, whatever the arc
   * (ArcCheck.placesToCheck): metres along the route, and lines a lane crossing
   * counts, as point, unit normal and the normal's angle from the first
   * segment (x, z, nx, nz, beta). Filled on first use.
   */
  kinks: Float64Array | null;
  lines: Float64Array | null;
  /**
   * Per segment a - 1 .. b: its direction (x, z), flat length and how much
   * the limit rises per flat metre along it by the taper.
   */
  segments: Float64Array;
}

/**
 * Sizes the arcs of a path and the lateral limits enemies keep to with them,
 * a group of knicks at a time (step), so a caller can spread the work over
 * frames (RouteProfile.corners, sizeRouteCorners in route-corridor.ts).
 *
 * **Groups.** Knicks are taken largest first. Each starts a group of its own
 * and takes in the waypoint before, the one after or both, as long as that
 * lets its arc's radius grow: the waypoints of a corner the band lays with
 * short pieces and small wiggles around it, the knicks of a curve. The arc
 * of a group is tangent to the segment into its first and out of its last
 * waypoint and turns by the sum of its knicks; waypoints that do not turn
 * one way overall (an S-bend, a loop) fit no arc. The stretch of an arc stays
 * off the stretches of the groups already placed, and leaves a knick not yet
 * placed at the other end of a segment what an arc of its own would take by
 * knickBound, at most half the segment.
 *
 * **Lanes.** A lane keeps the lateral limit at its place along the route, as
 * on a straight stretch, on the inside of the arc at most the radius
 * (further in it would run backwards). On the outside it runs past a knick
 * through the round end of the cells there, whose room is the limit at the
 * knick; where the limit rises away from the knick (the street after it
 * wider than the one before), the outside of the arc is capped at the
 * smallest limit of the outside of its knicks, if that is what lets it fit.
 * Where the lanes' edges miss their room by no more than ARC_SHAVE_M, they
 * give that up in the middle of the arc, rising from its ends by the taper.
 *
 * **Radius.** The largest for which every lane (factor -1 to 1) stays within
 * the lateral limit of the sharp route (SideLimits.node).
 * - For a single knick with the same limit before and after, that limit is
 *   the radius, up to what the shave gives: a lane `e` m inside stands
 *   `R - (R - e) cos(phi)` inside the segment into the corner, over a point at
 *   most the tangent before the waypoint, so at most `R` inside, and a larger
 *   radius puts the inner lanes past the point where the inner edges of the
 *   two segments' lanes meet, outside the room of both. An outer lane stands
 *   at most its offset outside a segment, and past the waypoint within that
 *   of it, inside the round end of the cells there (jointCap in
 *   route-grid-builder.ts).
 * - Every arc is checked (ArcCheck.fits, route-corner-check.ts): at each place, the whole line across
 *   from the outer to the inner lane has to lie beside one of the group's
 *   segments within the limit there on its side, or past a knick within the
 *   limit of its outside; and the sharp centre line at the same place along
 *   the route has to lie within the room of the sharp route there (its wider
 *   side) from the arc's centre line, so an arc does not cut across a bend
 *   whose two legs lie within each other's room (a hairpin of a narrow
 *   street), where an enemy would stand still for the length of the bend.
 *   The places are every 2 degrees of the arc and every 0.5 m of its
 *   outermost lane; where the limit a lane keeps changes its slope; just
 *   either side of where a lane or the centre line crosses a line at which
 *   what holds it changes (placesToCheck); and where the edges of what holds
 *   the lanes pass each other (findPasses). Between the places the check
 *   bounds how far a lane can bulge out and looks again where that bound
 *   leaves it beyond its room (judgeBetween).
 * - The largest tangent the room allows is tried first, then (for a single
 *   knick from knickBound) a search for the largest that passes. On a curve
 *   the radius can be far more than the limit, where the arc follows the
 *   centre line.
 */
export class RouteCornerBuilder {
  private readonly count: number;
  /** Signed turn at each waypoint, radians, positive to the left; 0 where it is no knick. */
  private readonly turns: Float64Array;
  /** Metres of route each knick's arc of its own would take before and after it, without other arcs. */
  private readonly wantBefore: Float64Array;
  private readonly wantAfter: Float64Array;
  /** The group each waypoint belongs to, -1 for none yet. */
  private readonly owner: Int32Array;
  private readonly fits: Fit[] = [];
  /** The knicks, largest first, the next of them to start a group from, and the group being grown (step). */
  private readonly seeds: number[] = [];
  private nextSeed = 0;
  private growing: Group | null = null;
  private readonly check: ArcCheck;
  /** The cap and shaves of the last arc fitsAt() let fit. */
  private fitCap = Infinity;
  private fitShaveInner = 0;
  private fitShaveOuter = 0;

  constructor(
    private readonly path: readonly RouteWaypoint[],
    private readonly lengths: readonly number[],
    private readonly cumulative: readonly number[],
    private readonly left: SideLimits,
    private readonly right: SideLimits,
    private readonly taper: number,
  ) {
    this.count = path.length;
    this.turns = new Float64Array(this.count);
    this.wantBefore = new Float64Array(this.count);
    this.wantAfter = new Float64Array(this.count);
    this.owner = new Int32Array(this.count).fill(-1);
    this.check = new ArcCheck(lengths, cumulative, this.turns, left, right, taper);
    for (let k = 1; k < this.count - 1; k++) {
      const window = this.window(k, k, false);
      if (!window) continue;
      this.turns[k] = -window.inside * window.turn;
      const tangent = this.knickBound(window);
      this.wantBefore[k] = Math.max(0, tangent / window.scaleIn);
      this.wantAfter[k] = Math.max(0, tangent / window.scaleOut);
    }
    for (let k = 1; k < this.count - 1; k++) if (this.turns[k] !== 0) this.seeds.push(k);
    this.seeds.sort((i, j) => Math.abs(this.turns[j]) - Math.abs(this.turns[i]) || i - j);
  }

  /**
   * Sizes arcs until `timeUp` says so, checked after each arc tried: the
   * arc of the knick a group starts from, or one of the arcs it could grow
   * to. The arcs once every knick lies in a group or fits none, else null.
   */
  step(timeUp: () => boolean): RouteCorners | null {
    for (;;) {
      const group = this.growing;
      if (!group) {
        if (this.nextSeed === this.seeds.length) return this.corners();
        const seed = this.seeds[this.nextSeed++];
        if (this.owner[seed] >= 0) continue;
        this.growing = { a: seed, b: seed, best: this.fit(seed, seed), option: 0, grown: null };
      } else if (!this.grow(group)) {
        this.growing = null;
        const { best } = group;
        if (best) {
          for (let k = best.a; k <= best.b; k++) this.owner[k] = this.fits.length;
          this.fits.push(best);
        }
      }
      if (timeUp()) return !this.growing && this.nextSeed === this.seeds.length ? this.corners() : null;
    }
  }

  /**
   * One step of growing `group`: tries the next arc it could grow to, by the
   * waypoint before, the one after or both. After the last, it takes the one
   * that lets its radius grow most by more than GROWTH and starts over; false
   * where none does.
   */
  private grow(group: Group): boolean {
    const { a, b } = group;
    for (; group.option < 3; group.option++) {
      const na = group.option === 2 ? a : a - 1;
      const nb = group.option === 1 ? b : b + 1;
      if (na < 1 || nb > this.count - 2 || this.owner[na] >= 0 || this.owner[nb] >= 0) continue;
      const radius = group.best ? group.best.radius : 0;
      const fit = this.fit(na, nb, Math.max(radius * (1 + GROWTH) + EPS, group.grown ? group.grown.radius : 0));
      if (fit && (!group.grown || fit.radius > group.grown.radius)) group.grown = fit;
      group.option++;
      return true;
    }
    const { grown } = group;
    if (!grown) return false;
    group.best = grown;
    group.a = grown.a;
    group.b = grown.b;
    group.option = 0;
    group.grown = null;
    return true;
  }

  /**
   * The largest arc for the waypoints `a` to `b`, null where none fits or,
   * with `beat`, none with a larger radius than that.
   */
  private fit(a: number, b: number, beat = 0): Fit | null {
    const window = this.window(a, b, true);
    if (!window || !(window.hi > 0) || window.lo > window.hi || !(window.hi * window.cot > beat)) return null;
    let tangent = window.hi;
    if (!this.fitsAt(window, tangent)) {
      // A single knick with no arc at all is the sharp corner, which fits;
      // its bound (knickBound) usually does. The arc fitsAt() last let fit
      // is the one at `good`, if any did.
      let good = a === b ? 0 : window.lo;
      let found = false;
      if (beat / window.cot > good) {
        // Where the arc that would have to be beaten does not fit, a larger one will not either
        good = beat / window.cot;
        if (!this.fitsAt(window, good)) return null;
        found = true;
      } else if (a === b) {
        const bound = Math.min(window.hi, this.knickBound(window));
        if (bound > 0 && this.fitsAt(window, bound)) {
          good = bound;
          found = true;
        }
      } else if (this.fitsAt(window, good)) {
        found = true;
      } else {
        good = (window.lo + window.hi) / 2;
        if (!this.fitsAt(window, good)) return null;
        found = true;
      }
      let bad = window.hi;
      for (let i = 0; i < SEARCH_STEPS; i++) {
        // Down to a centimetre of radius, or a hundredth of it
        if ((bad - good) * window.cot < Math.max(SEARCH_PRECISION_M, SEARCH_PRECISION_M * good * window.cot)) break;
        const mid = (good + bad) / 2;
        if (this.fitsAt(window, mid)) {
          good = mid;
          found = true;
        } else {
          bad = mid;
        }
      }
      if (!found) return null;
      tangent = good;
    }
    if (!(tangent >= MIN_TANGENT)) return null;
    return {
      a, b, radius: tangent * window.cot, outerCap: this.fitCap, shaveInner: this.fitShaveInner, shaveOuter: this.fitShaveOuter,
      turn: window.turn, inside: window.inside, from: arcStart(window, tangent, this.cumulative), to: arcEnd(window, tangent, this.cumulative),
      cos0: window.cos0, ux: window.ux, uz: window.uz,
    };
  }

  /**
   * Whether the arc of `window` with `tangent` fits, into fitCap and
   * fitShaveInner, fitShaveOuter how: as it is, with its lanes giving up
   * at most ARC_SHAVE_M in its middle, or both again with its outside
   * capped at the limit of the outside of its knicks (outsideOfKnicks).
   */
  private fitsAt(window: CornerWindow, tangent: number): boolean {
    for (let attempt = 0; attempt < 2; attempt++) {
      const cap = attempt === 0 ? Infinity : this.outsideOfKnicks(window);
      if (attempt === 1 && !(cap < Infinity)) break;
      this.check.shaveInner = 0;
      this.check.shaveOuter = 0;
      // The cap only changes the outer lane: where that is not what failed, it cannot help
      if (!this.check.fits(window, tangent, cap, true)) {
        if (this.check.outerFailed) continue;
        break;
      }
      const { needInner, needOuter } = this.check;
      if (needInner > ARC_SHAVE_M) break;
      if (needOuter > ARC_SHAVE_M) continue;
      if (needInner > 0 || needOuter > 0) {
        // A tenth of a millimetre more than it measured, for the places that move with the shave
        this.check.shaveInner = needInner > 0 ? needInner + 1e-4 : 0;
        this.check.shaveOuter = needOuter > 0 ? needOuter + 1e-4 : 0;
        if (!this.check.fits(window, tangent, cap, false)) continue;
      }
      this.fitCap = cap;
      this.fitShaveInner = this.check.shaveInner;
      this.fitShaveOuter = this.check.shaveOuter;
      return true;
    }
    return false;
  }

  /** The smallest limit of the sharp route at the knicks of `window` that turn its way, on its outside. */
  private outsideOfKnicks(window: CornerWindow): number {
    const outer = window.inside > 0 ? this.left : this.right;
    let smallest = Infinity;
    for (let k = window.a; k <= window.b; k++) {
      // A turn to the right (negative) has its inside on the right, as the window's
      if (this.turns[k] !== 0 && Math.sign(-this.turns[k]) === window.inside) smallest = Math.min(smallest, outer.node[k]);
    }
    return smallest;
  }

  /**
   * The tangent of the single knick of `window` with the inner limit as its
   * radius, see RouteCornerBuilder: at the waypoint, and at the ends of the
   * arc, where the limit rises from the waypoint before or after.
   */
  private knickBound(window: CornerWindow): number {
    const k = window.a;
    const inner = window.inside > 0 ? this.right : this.left;
    const { cot, scaleIn, scaleOut } = window;
    return Math.min(
      inner.node[k] / cot,
      (inner.node[k - 1] + this.taper * this.lengths[k - 1]) / (cot + this.taper / scaleIn),
      (inner.node[k + 1] + this.taper * this.lengths[k]) / (cot + this.taper / scaleOut),
    );
  }

  /**
   * The lines of the waypoints `a` to `b`: the segment into `a` and out of
   * `b`, the angle between them, where they meet, and with `room` the
   * tangents the free room allows. Null where those segments have no length,
   * the lines turn less than MIN_TURN or more than MAX_TURN, or the waypoints
   * do not turn one way overall.
   */
  private window(a: number, b: number, room: boolean): CornerWindow | null {
    const { path, lengths } = this;
    if (a < 1 || b > this.count - 2 || !(lengths[a - 1] > 0 && lengths[b] > 0)) return null;
    const origin = path[a - 1];
    const cos0 = Math.cos(origin.lat * DEG_TO_RAD);
    const n = b - a + 3;
    const xs = new Float64Array(n);
    const zs = new Float64Array(n);
    for (let j = 0; j < n; j++) {
      const w = path[a - 1 + j];
      xs[j] = (w.lon - origin.lon) * cos0 * METERS_PER_DEGREE_LAT;
      zs[j] = (w.lat - origin.lat) * METERS_PER_DEGREE_LAT;
    }
    const flatIn = Math.hypot(xs[1] - xs[0], zs[1] - zs[0]);
    const flatOut = Math.hypot(xs[n - 1] - xs[n - 2], zs[n - 1] - zs[n - 2]);
    if (flatIn === 0 || flatOut === 0) return null;
    const ux = (xs[1] - xs[0]) / flatIn;
    const uz = (zs[1] - zs[0]) / flatIn;
    const vx = (xs[n - 1] - xs[n - 2]) / flatOut;
    const vz = (zs[n - 1] - zs[n - 2]) / flatOut;
    const cross = ux * vz - uz * vx;
    const signed = Math.atan2(cross, ux * vx + uz * vz);
    const turn = Math.abs(signed);
    if (turn < MIN_TURN || turn > MAX_TURN) return null;
    let p = 0;
    let q = 0;
    if (a !== b) {
      let sum = 0;
      for (let k = a; k <= b; k++) sum += this.turns[k];
      if (Math.abs(sum - signed) > 1e-3) return null;
      // Where the lines meet: waypoint a + p along the first, waypoint b - q along the second
      const dx = xs[n - 2] - xs[1];
      const dz = zs[n - 2] - zs[1];
      p = (dx * vz - dz * vx) / cross;
      q = (ux * dz - uz * dx) / cross;
      if (p < -EPS || q < -EPS) return null;
    }
    const scaleIn = flatIn / lengths[a - 1];
    const scaleOut = flatOut / lengths[b];
    const segments = new Float64Array(4 * (n - 1));
    for (let j = 0; j + 1 < n; j++) {
      const flat = Math.hypot(xs[j + 1] - xs[j], zs[j + 1] - zs[j]);
      if (flat === 0) continue;
      segments[4 * j] = (xs[j + 1] - xs[j]) / flat;
      segments[4 * j + 1] = (zs[j + 1] - zs[j]) / flat;
      segments[4 * j + 2] = flat;
      segments[4 * j + 3] = (this.taper * lengths[a - 1 + j]) / flat;
    }
    const window: CornerWindow = {
      a, b, cos0, xs, zs, ux, uz, turn, inside: signed < 0 ? 1 : -1, cot: 1 / Math.tan(turn / 2),
      p: Math.max(0, p), q: Math.max(0, q), scaleIn, scaleOut, lo: 0, hi: 0, kinks: null, lines: null, segments,
    };
    if (room) {
      window.lo = Math.max(window.p, window.q);
      window.hi = Math.min(window.p + this.roomBefore(a) * scaleIn, window.q + this.roomAfter(b) * scaleOut);
    }
    return window;
  }

  /**
   * Metres of the segment into waypoint `a` an arc from `a` on may take:
   * up to the arc placed at its other end, or leaving a knick not yet placed
   * there what an arc of its own would take, at most half.
   */
  private roomBefore(a: number): number {
    const length = this.lengths[a - 1];
    const w = a - 1;
    if (w === 0) return length;
    const other = this.owner[w];
    if (other >= 0) return Math.max(0, length - (this.fits[other].to - this.cumulative[w]));
    return length - Math.min(length / 2, this.wantAfter[w]);
  }

  /** Metres of the segment out of waypoint `b` an arc up to `b` may take, as roomBefore. */
  private roomAfter(b: number): number {
    const length = this.lengths[b];
    const w = b + 1;
    if (w === this.count - 1) return length;
    const other = this.owner[w];
    if (other >= 0) return Math.max(0, length - (this.cumulative[w] - this.fits[other].from));
    return length - Math.min(length / 2, this.wantBefore[w]);
  }

  private corners(): RouteCorners {
    const { path, count, lengths, cumulative, fits, owner } = this;
    const arcs = fits.length;
    const segments = Math.max(0, count - 1);
    const corners: RouteCorners = {
      arcOf: new Int32Array(count),
      arcIn: new Float64Array(segments),
      arcOut: new Float64Array(segments),
      from: new Float64Array(arcs),
      to: new Float64Array(arcs),
      radius: new Float64Array(arcs),
      turn: new Float64Array(arcs),
      inside: new Float64Array(arcs),
      capLeft: new Float64Array(arcs),
      capRight: new Float64Array(arcs),
      shaveLeft: new Float64Array(arcs),
      shaveRight: new Float64Array(arcs),
      left: this.arcLimits(this.left, -1),
      right: this.arcLimits(this.right, 1),
      startLat: new Float64Array(arcs),
      startLon: new Float64Array(arcs),
      alongLat: new Float64Array(arcs),
      alongLon: new Float64Array(arcs),
      insideLat: new Float64Array(arcs),
      insideLon: new Float64Array(arcs),
    };
    corners.arcOf.set(owner);
    fits.forEach((fit, g) => {
      corners.from[g] = fit.from;
      corners.to[g] = fit.to;
      corners.radius[g] = fit.radius;
      corners.turn[g] = fit.turn;
      corners.inside[g] = fit.inside;
      corners.capLeft[g] = fit.inside > 0 ? fit.outerCap : fit.radius;
      corners.capRight[g] = fit.inside > 0 ? fit.radius : fit.outerCap;
      corners.shaveLeft[g] = fit.inside > 0 ? fit.shaveOuter : fit.shaveInner;
      corners.shaveRight[g] = fit.inside > 0 ? fit.shaveInner : fit.shaveOuter;
      // Where the straight stretch before it puts the centre line
      const a = path[fit.a - 1];
      const w = path[fit.a];
      const t = (fit.from - cumulative[fit.a - 1]) / lengths[fit.a - 1];
      corners.startLat[g] = a.lat + (w.lat - a.lat) * t;
      corners.startLon[g] = a.lon + (w.lon - a.lon) * t;
      corners.alongLat[g] = fit.uz / METERS_PER_DEGREE_LAT;
      corners.alongLon[g] = fit.ux / (METERS_PER_DEGREE_LAT * fit.cos0);
      // Right of (ux, uz) is (uz, -ux) in east and north
      corners.insideLat[g] = (-fit.ux * fit.inside) / METERS_PER_DEGREE_LAT;
      corners.insideLon[g] = (fit.uz * fit.inside) / (METERS_PER_DEGREE_LAT * fit.cos0);
    });
    for (let i = 0; i < segments; i++) {
      if (owner[i] >= 0) corners.arcIn[i] = fits[owner[i]].to - cumulative[i];
      if (owner[i + 1] >= 0) corners.arcOut[i] = cumulative[i + 1] - fits[owner[i + 1]].from;
    }
    return corners;
  }

  /**
   * ArcLimits on the side `sign` (-1 left, 1 right): the sharp route's limit
   * at every waypoint, and at the start and end of every arc, no more than
   * the arc's cap on that side (then also at its waypoints), followed by a
   * min-plus distance transform along the route, one pass each way, so the
   * limit rises by at most `taper` per metre from there.
   */
  private arcLimits(side: SideLimits, sign: number): ArcLimits {
    const { count, fits, owner, cumulative } = this;
    const segments = Math.max(0, count - 1);
    if (fits.length === 0) return { arc: side.node, entry: side.node, exit: side.node.subarray(1) };
    const at: number[] = [];
    const values: number[] = [];
    const waypoint = new Int32Array(count);
    const start = new Int32Array(count).fill(-1);
    const end = new Int32Array(count).fill(-1);
    const add = (position: number, value: number): number => {
      at.push(position);
      values.push(value);
      return at.length - 1;
    };
    for (let k = 0; k < count; k++) {
      const g = owner[k];
      const cap = g < 0 ? Infinity : fits[g].inside === sign ? fits[g].radius : fits[g].outerCap;
      if (g >= 0 && fits[g].a === k) start[k] = add(fits[g].from, cap);
      waypoint[k] = add(cumulative[k], Math.min(side.node[k], cap));
      if (g >= 0 && fits[g].b === k) end[k] = add(fits[g].to, cap);
    }
    for (let p = 1; p < values.length; p++) values[p] = Math.min(values[p], values[p - 1] + this.taper * (at[p] - at[p - 1]));
    for (let p = values.length - 2; p >= 0; p--) values[p] = Math.min(values[p], values[p + 1] + this.taper * (at[p + 1] - at[p]));

    const arc = new Float64Array(count);
    for (let k = 0; k < count; k++) arc[k] = values[waypoint[k]];
    const entry = new Float64Array(segments);
    const exit = new Float64Array(segments);
    for (let i = 0; i < segments; i++) {
      const inside = owner[i] >= 0 && owner[i] === owner[i + 1];
      entry[i] = end[i] >= 0 ? values[end[i]] : inside ? arc[i + 1] : arc[i];
      exit[i] = start[i + 1] >= 0 ? values[start[i + 1]] : inside ? arc[i] : arc[i + 1];
    }
    return { arc, entry, exit };
  }
}
