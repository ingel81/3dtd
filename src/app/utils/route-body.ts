import { Vector3 } from 'three';
import type { RouteWaypoint } from '../models/game.types';
import type { CoordinateSync } from '../three-engine/renderers';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT } from './geo-utils';
import { getRouteProfile, lateralLimit, segmentLeft, segmentRight } from './route-corridor';

/**
 * A body that lies along a route instead of standing on it (the ooze): the
 * stretch of the route between `tailM` and `tipM` metres from path[0], as
 * wide as the corridor. Radius queries (splash, abilities) test the body
 * instead of a point, towers aim at its nearest point and the renderer draws
 * it from the stations of its path.
 */

/** Spacing of the stations along a route (m), one route cell. */
export const ROUTE_BODY_STATION_M = 2;

/** Share of the corridor half width the body covers on each side. */
export const ROUTE_BODY_COVER = 0.9;

/**
 * Points every ROUTE_BODY_STATION_M along a path, on its centre line, with
 * what bodies on that path need at each: local and geo position, the
 * direction across, the corridor half widths and where on the path it is.
 * Built once per path array (routeBodyStations), like the route profile.
 */
export class RouteBodyStations {
  readonly count: number;
  /** Route length (m), the profile's */
  readonly length: number;
  /** Metres from path[0] */
  readonly s: Float64Array;
  /** Centre line, geo */
  readonly lat: Float64Array;
  readonly lon: Float64Array;
  /** Centre line, local */
  readonly x: Float64Array;
  readonly z: Float64Array;
  /** Unit vector to the right of the direction of travel, local */
  readonly rightX: Float64Array;
  readonly rightZ: Float64Array;
  /** Geo degrees per metre to the right */
  readonly latPerRight: Float64Array;
  readonly lonPerRight: Float64Array;
  /** Corridor half width left and right of the direction of travel (m) */
  readonly left: Float64Array;
  readonly right: Float64Array;
  /** Segment of the path and the progress on it, see MovementComponent.setPath() */
  readonly segment: Int32Array;
  readonly progress: Float64Array;

  /**
   * @param originHeight Geo height of the local frame's origin: a local y
   *   plus this is the geo height (EnemyManager.spawn)
   */
  constructor(
    readonly path: readonly RouteWaypoint[],
    sync: Pick<CoordinateSync, 'geoToLocalSimpleInto'>,
    readonly originHeight: number,
  ) {
    const profile = getRouteProfile(path);
    this.length = profile.totalLength;
    const count = Math.max(1, Math.ceil(this.length / ROUTE_BODY_STATION_M) + 1);
    this.count = count;
    this.s = new Float64Array(count);
    this.lat = new Float64Array(count);
    this.lon = new Float64Array(count);
    this.x = new Float64Array(count);
    this.z = new Float64Array(count);
    this.rightX = new Float64Array(count);
    this.rightZ = new Float64Array(count);
    this.latPerRight = new Float64Array(count);
    this.lonPerRight = new Float64Array(count);
    this.left = new Float64Array(count);
    this.right = new Float64Array(count);
    this.segment = new Int32Array(count);
    this.progress = new Float64Array(count);

    const centre = new Vector3();
    const aside = new Vector3();
    const segments = profile.segmentLengths.length;
    let seg = 0;
    for (let k = 0; k < count; k++) {
      const s = Math.min(k * ROUTE_BODY_STATION_M, this.length);
      while (seg < segments - 1 && profile.cumulativeLength[seg + 1] <= s) seg++;
      const a = path[Math.min(seg, path.length - 1)];
      const b = path[Math.min(seg + 1, path.length - 1)];
      const segLen = segments > 0 ? profile.segmentLengths[seg] : 0;
      const t = segLen > 0 ? Math.min(1, Math.max(0, (s - profile.cumulativeLength[seg]) / segLen)) : 0;
      const lat = a.lat + (b.lat - a.lat) * t;
      const lon = a.lon + (b.lon - a.lon) * t;
      this.s[k] = s;
      this.lat[k] = lat;
      this.lon[k] = lon;
      this.segment[k] = seg;
      this.progress[k] = t;
      this.left[k] = segmentLeft(a);
      this.right[k] = segmentRight(a);

      // Right of the direction of travel as MovementComponent offsets a lane:
      // metres east and north, only the longitude scaled by cos(lat)
      const cosLat = Math.cos(a.lat * DEG_TO_RAD);
      const east = (b.lon - a.lon) * cosLat;
      const north = b.lat - a.lat;
      const len = Math.sqrt(east * east + north * north);
      if (len > 0) {
        this.latPerRight[k] = -east / len / METERS_PER_DEGREE_LAT;
        this.lonPerRight[k] = north / len / (METERS_PER_DEGREE_LAT * cosLat);
      } else if (k > 0) {
        this.latPerRight[k] = this.latPerRight[k - 1];
        this.lonPerRight[k] = this.lonPerRight[k - 1];
      }

      sync.geoToLocalSimpleInto(lat, lon, 0, centre);
      sync.geoToLocalSimpleInto(lat + this.latPerRight[k], lon + this.lonPerRight[k], 0, aside);
      this.x[k] = centre.x;
      this.z[k] = centre.z;
      const rx = aside.x - centre.x;
      const rz = aside.z - centre.z;
      const rLen = Math.sqrt(rx * rx + rz * rz);
      this.rightX[k] = rLen > 0 ? rx / rLen : k > 0 ? this.rightX[k - 1] : 1;
      this.rightZ[k] = rLen > 0 ? rz / rLen : k > 0 ? this.rightZ[k - 1] : 0;
    }
  }

  /** The station nearest to `s` metres along the route. */
  nearestIndex(s: number): number {
    return Math.max(0, Math.min(this.count - 1, Math.round(s / ROUTE_BODY_STATION_M)));
  }

  /** How far off the centre line the lateral limit lets a point on station `k` go, to the side of `offset` (route-corridor.ts). */
  lateralLimitAt(k: number, offset: number): number {
    return lateralLimit(offset < 0 ? this.left[k] : this.right[k]);
  }
}

const stationsByPath = new WeakMap<readonly RouteWaypoint[], RouteBodyStations>();

/** The stations of `path`, built on first use. The path must not change afterwards. */
export function routeBodyStations(
  path: readonly RouteWaypoint[],
  sync: Pick<CoordinateSync, 'geoToLocalSimpleInto'>,
  originHeight: number,
): RouteBodyStations {
  let stations = stationsByPath.get(path);
  if (!stations || stations.originHeight !== originHeight) {
    stations = new RouteBodyStations(path, sync, originHeight);
    stationsByPath.set(path, stations);
  }
  return stations;
}

/** Nearest point of a body to a spot, see RouteBody.nearest(). */
export interface RouteBodyContact {
  /** Station of the point */
  station: number;
  /** Metres across the corridor from the centre line, negative to the left */
  offset: number;
  /** Metres from the spot to the point, 0 inside the body up to half a station */
  distance: number;
}

/** A body on the route between tailM and tipM, see the file comment. */
export class RouteBody {
  /** Rear end and tip, metres from path[0]. tailM <= tipM. */
  tailM = 0;
  tipM = 0;

  /**
   * Where the hit being dealt lands on the body, geo; height on the ground.
   * The damage paths write it right before they deal damage (setHit), and
   * the hit effects read it (enemyHitSpot). A radius query that takes the
   * body in writes the point it touched.
   */
  readonly hit = { lat: 0, lon: 0, height: 0 };

  constructor(readonly stations: RouteBodyStations) {}

  get lengthM(): number {
    return this.tipM - this.tailM;
  }

  /** First and last station of the body; a body shorter than a station still has one. */
  firstStation(): number {
    return this.stations.nearestIndex(this.tailM);
  }

  lastStation(): number {
    return this.stations.nearestIndex(this.tipM);
  }

  /** Whether station `k` lies on the body. */
  covers(k: number): boolean {
    return k >= this.firstStation() && k <= this.lastStation();
  }

  /**
   * The point of the body nearest to local (x, z): a station of the body,
   * moved across toward the spot by at most ROUTE_BODY_COVER of the half
   * width on that side. O(stations of the body).
   */
  nearest(x: number, z: number, out: RouteBodyContact): RouteBodyContact {
    const st = this.stations;
    const last = this.lastStation();
    let bestSq = Infinity;
    for (let k = this.firstStation(); k <= last; k++) {
      const dx = x - st.x[k];
      const dz = z - st.z[k];
      const across = dx * st.rightX[k] + dz * st.rightZ[k];
      const limit = (across < 0 ? st.left[k] : st.right[k]) * ROUTE_BODY_COVER;
      const offset = across < -limit ? -limit : across > limit ? limit : across;
      const ex = dx - st.rightX[k] * offset;
      const ez = dz - st.rightZ[k] * offset;
      const dSq = ex * ex + ez * ez;
      if (dSq < bestSq) {
        bestSq = dSq;
        out.station = k;
        out.offset = offset;
      }
    }
    out.distance = Math.sqrt(bestSq);
    return out;
  }

  /** Whether any point of the body lies within `radius` of local (x, z); `out` gets the nearest. */
  touches(x: number, z: number, radius: number, out: RouteBodyContact): boolean {
    return this.nearest(x, z, out).distance <= radius;
  }

  /** The hit lands `offset` metres across from station `k`, on ground at local y `groundY`. */
  setHit(k: number, offset: number, groundY: number): void {
    const st = this.stations;
    this.hit.lat = st.lat[k] + st.latPerRight[k] * offset;
    this.hit.lon = st.lon[k] + st.lonPerRight[k] * offset;
    this.hit.height = groundY + st.originHeight;
  }
}
