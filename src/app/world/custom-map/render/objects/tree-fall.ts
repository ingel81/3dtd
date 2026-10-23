/**
 * How a felled tree falls (CustomMapView.setFelled, docs/DESTRUCTION_PLAN.md
 * "Bäume fallen"): a rigid trunk tipping over about its foot, which stays on
 * the ground. The blast leaves it a little tilted and turning; from there the
 * weight pulls it over as a rod on its end (θ'' = 3g / 2L · sin θ), slowly at
 * first, then ever faster, until its crown meets the ground at FELLED_PITCH.
 * There the crown springs back a few degrees and settles. A tall tree falls
 * slower than a small one: the time goes with the root of its height.
 */

/** The tilt a felled tree lies at, radians from upright: its crown on the ground, the trunk rising to it from its foot */
export const FELLED_PITCH = 1.25;
/** What the blast leaves it with: a tilt (radians) and a turn rate (radians per unit of the fall's time, see unitSeconds) */
const START_TILT = 0.05;
const START_TURN = 0.12;
/** How far the crown springs back up when it lands, radians, and the seconds it takes to settle */
const BOUNCE = 0.06;
const BOUNCE_SECONDS = 1.1;
/** How long one swing of the springing crown takes, s */
const BOUNCE_PERIOD = 0.42;
const GRAVITY = 9.81;
/** Steps of the integrated fall per unit of its time */
const STEPS_PER_UNIT = 200;

/** The tilt over the fall at even steps of the fall's own time (unitSeconds), up to the step it lands in */
const CURVE: Float32Array = (() => {
  const dt = 1 / STEPS_PER_UNIT;
  const out: number[] = [START_TILT];
  let tilt = START_TILT;
  let turn = START_TURN;
  // Semi-implicit Euler: the pull of the weight, then the turn; a few thousand steps at most, once
  while (tilt < FELLED_PITCH && out.length < 100 * STEPS_PER_UNIT) {
    turn += Math.sin(tilt) * dt;
    tilt += turn * dt;
    out.push(Math.min(FELLED_PITCH, tilt));
  }
  return Float32Array.from(out);
})();
/** The fall's own time until the crown lands */
const LANDS_AT = (CURVE.length - 1) / STEPS_PER_UNIT;

/** Seconds per unit of the fall's time for a tree `height` m tall: the root of 2L / 3g */
function unitSeconds(height: number): number {
  return Math.sqrt((2 * Math.max(1, height)) / (3 * GRAVITY));
}

/** Seconds a tree `height` m tall takes from the blast until its crown lies still (a 12 m oak about 3.5 s) */
export function fallSeconds(height: number): number {
  return LANDS_AT * unitSeconds(height) + BOUNCE_SECONDS;
}

/** The tilt of a tree `height` m tall `seconds` after the blast felled it, radians from upright */
export function fallTilt(seconds: number, height: number): number {
  const unit = unitSeconds(height);
  const t = Math.max(0, seconds) / unit;
  if (t < LANDS_AT) {
    const at = t * STEPS_PER_UNIT;
    const k = Math.floor(at);
    return CURVE[k] + (CURVE[k + 1] - CURVE[k]) * (at - k);
  }
  // Down: the crown springs back and settles
  const after = (t - LANDS_AT) * unit;
  if (after >= BOUNCE_SECONDS) return FELLED_PITCH;
  return FELLED_PITCH - BOUNCE * Math.exp(-4 * after) * Math.abs(Math.sin((Math.PI * after) / BOUNCE_PERIOD));
}
