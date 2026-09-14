import type { MovementComponent } from '../../game-components/movement.component';
import type { TransformComponent } from '../../game-components/transform.component';
import type { RouteWaypoint } from '../../models/game.types';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT } from '../../utils/geo-utils';
import { RouteProfile, SideLimits, getRouteProfile } from '../../utils/route-corridor';

/**
 * Radius (m) the worm's body bends through a route corner with, where the
 * corridor and the segments either side leave room for it. The rings are
 * rigid, 2.5 m apart and 5.4 m wide: bent at a sharp waypoint two of them
 * meet at the whole corner angle and their ends gape on the outside (5.2 m
 * at 90 degrees, measured with the sway in worm-corner.spec.ts). A larger
 * radius spreads a flat turn over more rings; the sway bends the body on
 * top of the arc. At 20 m the gap stays under 0.4 m from 10 to 90 degrees
 * on the default corridor, where 90 degrees gets about 10 m.
 */
export const WORM_BEND_RADIUS_M = 20;

/** Turns flatter than this stay sharp; the waypoint is as good as straight. */
const MIN_TURN = 1e-4;
/** Turns sharper than this stay sharp: the route doubles back on itself. */
const MAX_TURN = Math.PI - 1e-3;

/** A point of the worm's curve, metres east and north of path[0], see WormPath.point() */
interface CurvePoint {
  e: number;
  n: number;
}

const paths = new WeakMap<readonly RouteWaypoint[], WormPath>();

/** The curve of `path`, computed on first use. The path must not change afterwards. */
export function wormPathOf(path: readonly RouteWaypoint[]): WormPath {
  let wormPath = paths.get(path);
  if (!wormPath) {
    wormPath = new WormPath(path);
    paths.set(path, wormPath);
  }
  return wormPath;
}

/**
 * The line a worm's body follows along a route: the centre line with its
 * corners rounded, each waypoint that turns replaced by an arc of up to
 * WORM_BEND_RADIUS_M, plus the place across the corridor (wormSway).
 *
 * Distances stay those of the centre line (MovementComponent), so targeting
 * order, the leak at the HQ, the chain's spacing and its sway read the same
 * numbers as before. Only where a segment stands and where it faces come
 * from this curve: an arc between two tangent points `tangent` m either side
 * of the waypoint, walked at an even rate, so the rings bunch up a little in
 * a corner (at 90 degrees the arc is 0.79 of the two legs it replaces). That
 * is what keeps them joined on the outside.
 *
 * The arc stays in the corridor: its radius is cut until the arc's deepest
 * point, `radius * (1 - cos(turn / 2))` inside the waypoint, lies within the
 * lateral limit on the inner side over the whole arc (the room an enemy has
 * there, see route-corridor.ts), and until the arcs of two waypoints fit on
 * the segment between them. A corner the corridor leaves no room at stays
 * sharp. Sway to the inside of an arc is cut to the room the arc leaves.
 */
export class WormPath {
  readonly profile: RouteProfile;
  private readonly lat0: number;
  private readonly lon0: number;
  private readonly metersPerDegLon: number;
  /** Waypoints, metres east and north of path[0] */
  private readonly e: Float64Array;
  private readonly n: Float64Array;
  /** Per segment: unit direction in those metres and length in them per metre of route distance */
  private readonly dirE: Float64Array;
  private readonly dirN: Float64Array;
  private readonly scale: Float64Array;
  /** Per waypoint: turn (rad, positive to the left), arc radius and tangent length (m, 0 where sharp) */
  private readonly turn: Float64Array;
  private readonly radius: Float64Array;
  private readonly tangent: Float64Array;
  private readonly p: CurvePoint = { e: 0, n: 0 };
  private readonly q: CurvePoint = { e: 0, n: 0 };

  constructor(path: readonly RouteWaypoint[]) {
    const count = path.length;
    const segments = Math.max(0, count - 1);
    this.profile = getRouteProfile(path);
    this.lat0 = count > 0 ? path[0].lat : 0;
    this.lon0 = count > 0 ? path[0].lon : 0;
    this.metersPerDegLon = METERS_PER_DEGREE_LAT * Math.cos(this.lat0 * DEG_TO_RAD);
    this.e = new Float64Array(count);
    this.n = new Float64Array(count);
    this.dirE = new Float64Array(segments);
    this.dirN = new Float64Array(segments);
    this.scale = new Float64Array(segments);
    this.turn = new Float64Array(count);
    this.radius = new Float64Array(count);
    this.tangent = new Float64Array(count);

    for (let k = 0; k < count; k++) {
      this.e[k] = (path[k].lon - this.lon0) * this.metersPerDegLon;
      this.n[k] = (path[k].lat - this.lat0) * METERS_PER_DEGREE_LAT;
    }
    const length = new Float64Array(segments);
    for (let i = 0; i < segments; i++) {
      const de = this.e[i + 1] - this.e[i];
      const dn = this.n[i + 1] - this.n[i];
      length[i] = Math.hypot(de, dn);
      if (length[i] > 0) {
        this.dirE[i] = de / length[i];
        this.dirN[i] = dn / length[i];
      }
      const routeLength = this.profile.segmentLengths[i];
      this.scale[i] = routeLength > 0 ? length[i] / routeLength : 1;
    }

    // Tangent length each turning waypoint wants for the full radius
    const want = new Float64Array(count);
    for (let k = 1; k < count - 1; k++) {
      if (length[k - 1] === 0 || length[k] === 0) continue;
      const cross = this.dirE[k - 1] * this.dirN[k] - this.dirN[k - 1] * this.dirE[k];
      const dot = this.dirE[k - 1] * this.dirE[k] + this.dirN[k - 1] * this.dirN[k];
      const turn = Math.atan2(cross, dot);
      const angle = Math.abs(turn);
      if (angle < MIN_TURN || angle > MAX_TURN) continue;
      this.turn[k] = turn;
      want[k] = WORM_BEND_RADIUS_M * Math.tan(angle / 2);
    }

    for (let k = 1; k < count - 1; k++) {
      if (want[k] === 0) continue;
      const half = Math.tan(Math.abs(this.turn[k]) / 2);
      // Two arcs share the segment between their waypoints in the ratio of
      // what they want, so they never overlap; a straight neighbour leaves
      // the whole segment.
      let tangent = Math.min(
        want[k],
        (length[k - 1] * want[k]) / (want[k - 1] + want[k]),
        (length[k] * want[k]) / (want[k] + want[k + 1]),
      );
      // The deepest point of the arc within the room on the inner side
      const inner = this.turn[k] > 0 ? this.profile.left : this.profile.right;
      const room = Math.min(
        limitAt(this.profile, inner, k - 1, this.profile.segmentLengths[k - 1] - tangent / this.scale[k - 1]),
        inner.node[k],
        limitAt(this.profile, inner, k, tangent / this.scale[k]),
      );
      const radius = Math.min(tangent / half, Math.max(0, room) / (1 - Math.cos(Math.abs(this.turn[k]) / 2)));
      tangent = radius * half;
      if (tangent > 0) {
        this.radius[k] = radius;
        this.tangent[k] = tangent;
      }
    }
  }

  /** Arc radius at waypoint `k` (m), 0 where the corner stays sharp. */
  radiusAt(k: number): number {
    return this.radius[k];
  }

  /**
   * Place a worm segment `distance` m along the route, the distance its
   * movement was put at (MovementComponent.seekDistance), `lateral` across
   * the corridor (wormSway): on the curve, facing along the chord from
   * `half` m behind it to `half` m ahead of it (sway there `behind` and
   * `ahead`). A ring spans that chord, so neighbours meet where the curve
   * puts their ends, and the heading follows from the distance alone, the
   * same at any step length.
   */
  place(
    movement: MovementComponent,
    transform: TransformComponent,
    distance: number,
    lateral: number,
    behind: number,
    ahead: number,
    half: number,
  ): void {
    const i = movement.currentIndex;
    const p = this.p;
    const q = this.q;
    this.point(i, distance, lateral, p);
    transform.setPosition(this.lat0 + p.n / METERS_PER_DEGREE_LAT, this.lon0 + p.e / this.metersPerDegLon);

    this.point(this.locate(distance + half, i), distance + half, ahead, p);
    this.point(this.locate(distance - half, i), distance - half, behind, q);
    const de = p.e - q.e;
    const dn = p.n - q.n;
    // Heading as TransformComponent.lookAt measures it, in metres
    if (de * de + dn * dn > 1e-12) transform.setHeading(Math.atan2(-de, dn));
  }

  /** Segment of route distance `s`, searched from segment `hint`; the first or last one off the ends. */
  private locate(s: number, hint: number): number {
    const cumulative = this.profile.cumulativeLength;
    const last = this.profile.segmentLengths.length - 1;
    let i = Math.min(Math.max(0, hint), last);
    while (i < last && s >= cumulative[i + 1]) i++;
    while (i > 0 && s < cumulative[i]) i--;
    return i;
  }

  /** The curve at route distance `s` on segment `i`, `lateral` across the corridor, into `out`. */
  private point(i: number, s: number, lateral: number, out: CurvePoint): void {
    const profile = this.profile;
    if (i < 0 || i >= this.dirE.length) {
      // A path of fewer than two waypoints
      out.e = 0;
      out.n = 0;
      return;
    }
    const segLen = profile.segmentLengths[i];
    const segS = Math.min(Math.max(0, s - profile.cumulativeLength[i]), segLen);
    const along = segS * this.scale[i];
    const length = segLen * this.scale[i];
    let e = this.e[i] + this.dirE[i] * along;
    let n = this.n[i] + this.dirN[i] * along;
    let te = this.dirE[i];
    let tn = this.dirN[i];

    // The arc of the waypoint at either end of the segment, if the point is
    // on it: `x` from the waypoint along the centre line, negative before it
    let k = -1;
    let x = 0;
    if (along < this.tangent[i]) {
      k = i;
      x = along;
    } else if (length - along < this.tangent[i + 1]) {
      k = i + 1;
      x = along - length;
    }
    let depth = 0;
    let insideSign = 0;
    if (k >= 0) {
      const tangent = this.tangent[k];
      const radius = this.radius[k];
      const turn = this.turn[k];
      const angle = Math.abs(turn);
      insideSign = turn > 0 ? 1 : -1;
      // Walked at an even rate from one tangent point to the other
      const u = (x + tangent) / (2 * tangent);
      const phi = u * angle;
      const cos = Math.cos(phi);
      const sin = Math.sin(phi);
      // Frame of the leg into the waypoint: along it, and towards the inside of the turn
      const ae = this.dirE[k - 1];
      const an = this.dirN[k - 1];
      const ie = -an * insideSign;
      const inN = ae * insideSign;
      const a = -tangent + radius * sin;
      const b = radius * (1 - cos);
      e = this.e[k] + ae * a + ie * b;
      n = this.n[k] + an * a + inN * b;
      te = ae * cos + ie * sin;
      tn = an * cos + inN * sin;
      // How far inside the leg it is on
      depth = radius * (1 - Math.cos(angle * Math.min(u, 1 - u)));
    }

    if (lateral !== 0) {
      // Right of the direction of travel, as MovementComponent.advance() offsets
      const side = lateral < 0 ? profile.left : profile.right;
      const limit = limitAt(profile, side, i, segS);
      let offset = lateral * limit;
      // A left turn has its inside on the left, where the factor is negative
      if (insideSign !== 0 && offset * insideSign < 0) {
        const room = Math.max(0, limit - depth);
        if (Math.abs(offset) > room) offset = -insideSign * room;
      }
      e += tn * offset;
      n -= te * offset;
    }
    out.e = e;
    out.n = n;
  }
}

/**
 * Lateral limit on `side` at `s` m into segment `i`: the envelope
 * MovementComponent.advance() keeps enemies in, the segment's own limit or
 * less on the taper towards a narrower stretch (SideLimits).
 */
function limitAt(profile: RouteProfile, side: SideLimits, i: number, s: number): number {
  const segLen = profile.segmentLengths[i];
  return Math.min(side.segment[i], side.node[i] + profile.taper * s, side.node[i + 1] + profile.taper * (segLen - s));
}
