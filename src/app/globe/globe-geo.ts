import { MathUtils, Vector3 } from 'three';
import { WGS84_ELLIPSOID } from '3d-tiles-renderer';

/**
 * Geodesy and sky of the menu globe (docs/GLOBE_PLAN.md). The globe's scene
 * is in ECEF metres, Z through the north pole, on the same WGS84 ellipsoid as
 * the 3D tiles: a pose handed between the globe and the game camera lands on
 * the same ground.
 */

/** WGS84 semi-axes, metres */
export const EARTH_A = 6378137;
export const EARTH_B = 6356752.314245;

/** Latitude and longitude in degrees */
export interface LatLon {
  lat: number;
  lon: number;
}

const MS_PER_DAY = 86_400_000;
/** Julian date of the Unix epoch */
const JD_UNIX = 2440587.5;
/** Julian date of J2000.0 */
const JD_J2000 = 2451545.0;
/** Obliquity of the ecliptic, the sun's farthest from the equator */
export const MAX_DECLINATION = 23.44;

/** A point at `height` metres above the ellipsoid, in ECEF */
export function ecefOf(lat: number, lon: number, height: number, target: Vector3): Vector3 {
  return WGS84_ELLIPSOID.getCartographicToPosition(lat * MathUtils.DEG2RAD, lon * MathUtils.DEG2RAD, height, target);
}

/** The ellipsoid's surface normal (geodetic up) at a place, in ECEF */
export function upOf(lat: number, lon: number, target: Vector3): Vector3 {
  const la = lat * MathUtils.DEG2RAD;
  const lo = lon * MathUtils.DEG2RAD;
  return target.set(Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la));
}

/** Unit vector from the earth's centre through a latitude and longitude on a sphere */
export function directionOf(lat: number, lon: number, target: Vector3): Vector3 {
  return upOf(lat, lon, target);
}

/** Days since J2000.0 */
function daysSinceJ2000(date: Date): number {
  return date.getTime() / MS_PER_DAY + JD_UNIX - JD_J2000;
}

function wrap180(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

/** Greenwich mean sidereal time in radians: how far the earth has turned under the stars */
export function gmst(date: Date): number {
  const n = daysSinceJ2000(date);
  const deg = (280.46061837 + 360.98564736629 * n) % 360;
  return ((deg + 360) % 360) * MathUtils.DEG2RAD;
}

/**
 * The point where the sun stands straight overhead at `date` (NOAA's low
 * precision formula, about 0.01 degrees, plenty for a globe).
 */
export function subsolarPoint(date: Date): LatLon {
  const n = daysSinceJ2000(date);
  const meanLon = 280.46 + 0.9856474 * n;
  const anomaly = (357.528 + 0.9856003 * n) * MathUtils.DEG2RAD;
  const eclipticLon = (meanLon + 1.915 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly)) * MathUtils.DEG2RAD;
  const obliquity = (23.439 - 0.0000004 * n) * MathUtils.DEG2RAD;
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLon));
  const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(eclipticLon), Math.cos(eclipticLon));
  return {
    lat: declination * MathUtils.RAD2DEG,
    lon: wrap180(rightAscension * MathUtils.RAD2DEG - gmst(date) * MathUtils.RAD2DEG),
  };
}

/** How high the sun stands over a place, degrees (negative: below the horizon) */
export function sunElevation(place: LatLon, subsolar: LatLon): number {
  const up = upOf(place.lat, place.lon, new Vector3());
  const sun = directionOf(subsolar.lat, subsolar.lon, new Vector3());
  return Math.asin(MathUtils.clamp(up.dot(sun), -1, 1)) * MathUtils.RAD2DEG;
}

/** The sun stands at least this high over the place when the dive lands (D2) */
export const LANDING_SUN_ELEVATION = 30;
/** Morning: the sun this far east of the place when the dive has to bring it up */
const MORNING_LEAD_DEG = 40;

/**
 * Where the sun has to stand when the dive lands: as it is, if the place is
 * in day already; otherwise a morning sun over it, reached by running the
 * clock forward (the sun moves west). Decision D2 in docs/GLOBE_PLAN.md: the
 * tiles are always day pictures, the globe rises the sun into them.
 */
export function landingSun(place: LatLon, now: LatLon): LatLon {
  if (sunElevation(place, now) >= LANDING_SUN_ELEVATION) return now;
  return {
    lat: MathUtils.clamp(place.lat, -MAX_DECLINATION, MAX_DECLINATION),
    lon: wrap180(place.lon + MORNING_LEAD_DEG),
  };
}

/**
 * The sun on its way from `from` to `to` at `t` (0..1), always westward like
 * time running forward; the latitude follows straight.
 */
export function sweptSun(from: LatLon, to: LatLon, t: number): LatLon {
  // Westward distance, 0..360
  const west = (((from.lon - to.lon) % 360) + 360) % 360;
  return {
    lat: MathUtils.lerp(from.lat, to.lat, t),
    lon: wrap180(from.lon - west * t),
  };
}
