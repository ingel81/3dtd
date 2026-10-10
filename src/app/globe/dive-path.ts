import { MathUtils, Matrix4, Quaternion, Vector3 } from 'three';

/**
 * The path of the game camera between the menu globe and the game's view
 * (docs/GLOBE_PLAN.md, Übergabe in Nadir-Sicht), in the scene's frame (the
 * HQ at the origin, Y up). It starts straight above the HQ looking down, the
 * screen's top towards where the game's view looks, and ends in the game's
 * view. Progress `s` runs over the logarithm of the altitude: each halving of
 * the height takes the same share, which reads as an even zoom from orbit to
 * the street. The rise out of a place is the same path backwards.
 */

/** Where the game camera takes over from the globe, metres above the HQ */
export const HANDOVER_ALTITUDE = 500_000;
/** The view turns from straight down to the game's view over the last part of the path */
const TURN_FROM = 0.55;
/** And slides from above the HQ to the view's own spot over the last part */
const SLIDE_FROM = 0.6;
/** Lowest altitude a plan takes for its end (a camera on the ground still has a path) */
const MIN_END_ALTITUDE = 50;

export interface DivePlan {
  /** The game's view, the end of the dive (a camera world matrix) */
  readonly end: Matrix4;
  /** Straight down above the HQ, the start of the dive */
  readonly start: Matrix4;
  readonly startAltitude: number;
  readonly endAltitude: number;
  /** Horizontal unit vector the screen's top points to while looking down */
  readonly heading: Vector3;
}

const _pos = new Vector3();
const _scale = new Vector3();
const _q = new Quaternion();
const _qa = new Quaternion();
const _qb = new Quaternion();
const _eye = new Vector3();
const _target = new Vector3();
const _forward = new Vector3();

/**
 * Where the view looks, flat on the ground: its forward direction, or its
 * up direction when it looks straight down. North (-Z) when neither tells.
 */
export function headingOf(view: Matrix4, target = new Vector3()): Vector3 {
  view.decompose(_pos, _q, _scale);
  target.set(0, 0, -1).applyQuaternion(_q).setY(0);
  if (target.lengthSq() < 1e-6) target.set(0, 1, 0).applyQuaternion(_q).setY(0);
  if (target.lengthSq() < 1e-6) target.set(0, 0, -1);
  return target.normalize();
}

/** A camera straight above (x, z) at `altitude`, looking down, its screen top along `heading` */
export function nadirMatrix(altitude: number, heading: Vector3, target: Matrix4, x = 0, z = 0): Matrix4 {
  _eye.set(x, altitude, z);
  _target.set(x, altitude - 1, z);
  target.lookAt(_eye, _target, heading);
  return target.setPosition(_eye);
}

/** The dive from `startAltitude` straight above the HQ into `end`, the game's view */
export function planDive(end: Matrix4, startAltitude = HANDOVER_ALTITUDE): DivePlan {
  const heading = headingOf(end);
  const endAltitude = Math.max(MIN_END_ALTITUDE, _pos.setFromMatrixPosition(end).y);
  return {
    end: end.clone(),
    start: nadirMatrix(startAltitude, heading, new Matrix4()),
    startAltitude,
    endAltitude,
    heading,
  };
}

/** Altitude at progress `s` (0 at the start, 1 at the end), even in its logarithm */
export function altitudeAt(plan: DivePlan, s: number): number {
  return Math.exp(MathUtils.lerp(Math.log(plan.startAltitude), Math.log(plan.endAltitude), s));
}

/** The camera's world matrix at progress `s` */
export function divePoseAt(plan: DivePlan, s: number, target: Matrix4): Matrix4 {
  const t = MathUtils.clamp(s, 0, 1);
  if (t >= 1) return target.copy(plan.end);
  plan.end.decompose(_pos, _qb, _scale);
  plan.start.decompose(_eye, _qa, _scale);
  const altitude = altitudeAt(plan, t);
  const slide = MathUtils.smoothstep(t, SLIDE_FROM, 1);
  const turn = MathUtils.smoothstep(t, TURN_FROM, 1);
  // Above the end altitude by the log path; the slide brings in the view's own height at the end
  const y = MathUtils.lerp(altitude, _pos.y, slide * slide);
  _eye.set(_pos.x * slide, y, _pos.z * slide);
  _q.slerpQuaternions(_qa, _qb, turn);
  return target.compose(_eye, _q, _scale.set(1, 1, 1));
}

/** The progress at which the path reaches `altitude` */
export function progressAt(plan: DivePlan, altitude: number): number {
  const a = Math.log(plan.startAltitude);
  const b = Math.log(plan.endAltitude);
  return MathUtils.clamp((a - Math.log(altitude)) / (a - b), 0, 1);
}

/**
 * Altitudes the tiles along a dive are warmed at, about a factor three
 * apart. Fixed, not spread over the plan: the ones straight above the HQ are
 * the same poses for every view the place ends in, so a warm-up while the
 * place loads (before its view is framed) serves the dive after it.
 */
export const WARM_ALTITUDES = [HANDOVER_ALTITUDE, 170_000, 60_000, 20_000, 7000, 2500] as const;
/** Of them, the ones above the turn of every dive (straight above the HQ) */
export const UPPER_WARM_ALTITUDES = 4;

/**
 * Poses along the path to warm the tiles for, at WARM_ALTITUDES above the
 * end; the end (the game's view) is loaded by the game camera itself.
 * `upper` keeps the ones straight above the HQ only.
 */
export function warmPoses(plan: DivePlan, upper = false): Matrix4[] {
  const altitudes = WARM_ALTITUDES.slice(0, upper ? UPPER_WARM_ALTITUDES : WARM_ALTITUDES.length);
  return altitudes
    .filter((altitude) => altitude > plan.endAltitude * 1.5)
    .map((altitude) => divePoseAt(plan, progressAt(plan, altitude), new Matrix4()));
}

/** Ease-in (slow start) and ease-out (slow end), quadratic: their speeds meet at the joint */
export const easeIn = (t: number): number => t * t;
export const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);

/**
 * Durations of the globe's part and the game camera's part of a dive, so the
 * zoom runs on through the handover at one speed. The globe eases in over
 * `globeSpan` (log altitude), the game camera eases out over `gameSpan`;
 * both quadratic, so speed at the joint is 2 span / duration on each side.
 */
export function diveDurations(globeSpan: number, gameSpan: number, totalMs: number): { globeMs: number; gameMs: number } {
  const globeMs = (totalMs * globeSpan) / (globeSpan + gameSpan);
  return { globeMs, gameMs: totalMs - globeMs };
}
