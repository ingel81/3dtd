import { MathUtils, Quaternion, Vector3, type Matrix4 } from 'three';
import { EARTH_A, ecefOf, upOf, type LatLon } from './globe-geo';

/**
 * Where the globe's camera stands (docs/GLOBE_PLAN.md, Ablauf): above a
 * point of the earth at an altitude, looking between the earth's centre and
 * that point, the earth shifted sideways out from under the menu. Every
 * phase (drift, turn to a place, wait, dive) is a blend of these numbers.
 */
export interface GlobeShot {
  /** The point below the camera */
  over: LatLon;
  /** Metres above the ellipsoid */
  altitude: number;
  /** 0 looks at the earth's centre, 1 at the point below (straight down) */
  aim: number;
  /** Share of the canvas width the earth sits right of the middle */
  shift: number;
  /** 0 keeps north at the screen's top, 1 turns the top to `heading` */
  roll: number;
}

/** The globe camera's vertical field of view in every shot, degrees */
export const SHOT_FOV = 60;
/**
 * Height of the rim shell above the ellipsoid, metres: the air (the shaders'
 * RA - RP, 100 km) and the glow beyond it; the fit keeps it in view
 */
export const RIM_HEIGHT = 350_000;
/** The menu column on a wide canvas, CSS px from the left: its padding, width and a gap */
export const MENU_INSET = 90 + 320 + 40;
/** At most this width the menu fills the screen: the earth stands in the middle behind it */
const NARROW_WIDTH = 760;
/** Share of the free height, and of the free width, the earth with its rim spans */
const FILL_HEIGHT = 0.86;
const FILL_WIDTH = 0.9;

/** Altitude and sideways shift of the menu's shots for one canvas size */
export interface GlobeFrame {
  altitude: number;
  shift: number;
}

/**
 * The whole earth beside the menu, as large as the free room allows: the
 * canvas right of the menu column, the earth with its rim filling most of
 * its height or width, whichever is smaller, in its middle. The earth stays
 * on the camera's axis and the shift moves the picture (a film offset), so
 * it stays round.
 */
export function fitFrame(width: number, height: number): GlobeFrame {
  const w = Math.max(width, 1);
  const h = Math.max(height, 1);
  const inset = w > NARROW_WIDTH ? MENU_INSET : 0;
  const free = Math.max(w - inset, w * 0.4);
  const radiusPx = Math.min((FILL_HEIGHT * h) / 2, (FILL_WIDTH * free) / 2);
  // A sphere on the axis shows a disc of f * tan(angular radius), f the focal length in px
  const focal = h / 2 / Math.tan((SHOT_FOV / 2) * MathUtils.DEG2RAD);
  const angular = Math.atan(radiusPx / focal);
  const altitude = (EARTH_A + RIM_HEIGHT) / Math.sin(angular) - EARTH_A;
  const centre = w - free / 2;
  return { altitude, shift: (centre - w / 2) / w };
}

/** Degrees per second the idle earth turns */
export const IDLE_TURN_RATE = 1.5;

const _a = new Vector3();
const _b = new Vector3();
const _axis = new Vector3();
const _q = new Quaternion();
const _north = new Vector3(0, 0, 1);

/** Unit vector from the earth's centre through a latitude and longitude */
function dirOf(p: LatLon, target: Vector3): Vector3 {
  const la = p.lat * MathUtils.DEG2RAD;
  const lo = p.lon * MathUtils.DEG2RAD;
  return target.set(Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la));
}

function latLonOf(v: Vector3): LatLon {
  return {
    lat: Math.asin(MathUtils.clamp(v.z, -1, 1)) * MathUtils.RAD2DEG,
    lon: Math.atan2(v.y, v.x) * MathUtils.RAD2DEG,
  };
}

/** The point on the great circle from `a` to `b` at `t` */
export function slerpLatLon(a: LatLon, b: LatLon, t: number): LatLon {
  dirOf(a, _a);
  dirOf(b, _b);
  const angle = _a.angleTo(_b);
  if (angle < 1e-9) return { ...b };
  _axis.crossVectors(_a, _b);
  if (_axis.lengthSq() < 1e-12) _axis.set(0, 0, 1).cross(_a);
  _q.setFromAxisAngle(_axis.normalize(), angle * t);
  return latLonOf(_a.applyQuaternion(_q));
}

/** Degrees of arc between two places */
export function arcDegrees(a: LatLon, b: LatLon): number {
  return dirOf(a, _a).angleTo(dirOf(b, _b)) * MathUtils.RAD2DEG;
}

/**
 * The camera's position, look target and up vector for a shot. `heading`
 * (ECEF, tangent at the point below) is where the screen's top turns with
 * `roll`; without one the top stays north.
 */
export function shotPose(
  shot: GlobeShot,
  heading: Vector3 | null,
  out: { position: Vector3; target: Vector3; up: Vector3 },
): void {
  ecefOf(shot.over.lat, shot.over.lon, shot.altitude, out.position);
  ecefOf(shot.over.lat, shot.over.lon, 0, out.target).multiplyScalar(shot.aim);
  // North as the screen's top (lookAt flattens it onto the view's plane); the roll turns it
  // about the local vertical towards the heading, the shorter way
  out.up.copy(_north);
  if (!heading || shot.roll <= 0) return;
  const normal = upOf(shot.over.lat, shot.over.lon, _a);
  const north = _b.copy(_north).addScaledVector(normal, -_north.dot(normal));
  if (north.lengthSq() < 1e-12) north.copy(heading);
  north.normalize();
  const angle = Math.atan2(_axis.crossVectors(north, heading).dot(normal), north.dot(heading));
  out.up.copy(north).applyQuaternion(_q.setFromAxisAngle(normal, angle * shot.roll));
}

/** A shot on the way from `a` to `b` */
export function blendShot(a: GlobeShot, b: GlobeShot, t: number, logAltitude = true): GlobeShot {
  return {
    over: slerpLatLon(a.over, b.over, t),
    altitude: logAltitude
      ? Math.exp(MathUtils.lerp(Math.log(a.altitude), Math.log(b.altitude), t))
      : MathUtils.lerp(a.altitude, b.altitude, t),
    aim: MathUtils.lerp(a.aim, b.aim, t),
    shift: MathUtils.lerp(a.shift, b.shift, t),
    roll: MathUtils.lerp(a.roll, b.roll, t),
  };
}

/** The ECEF tangent the screen's top points to in a camera world matrix looking straight down */
export function headingFromMatrix(m: Matrix4, target: Vector3): Vector3 {
  return target.setFromMatrixColumn(m, 1).normalize();
}

/** Smooth start and end */
export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
