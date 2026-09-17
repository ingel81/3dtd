import { MathUtils, Vector3 } from 'three';
import { MISSILE_LAUNCH_LOOK } from '../configs/visual-effects.config';

/** Points along the curve its length is measured on */
const CURVE_SAMPLES = 128;
/** Points along the path, evenly spaced, its pace is set on */
const PACE_SAMPLES = 256;
/** Halvings that find the speed the flight takes to fit its time */
const BISECTIONS = 48;
const TAU = Math.PI * 2;

/** Shape and pace of a flight, see MISSILE_LAUNCH_LOOK.flight */
export interface MissileFlightShape {
  readonly apex: { readonly min: number; readonly base: number; readonly perM: number; readonly max: number };
  readonly steep: number;
  readonly swing: number;
  readonly ignition: { readonly seconds: number; readonly share: number };
  readonly lift: { readonly acceleration: number; readonly seconds: number; readonly share: number };
  readonly pace: { readonly boost: number; readonly topSpeed: number; readonly topBand: number; readonly blend: number };
}

/**
 * The flight of a missile from a start point onto a target in a given
 * time: where it is and which way it flies at any moment. Pure geometry in
 * local coordinates (y up), nothing random: the same start, target and
 * time give the same flight, so the renderer and the sound that follows the
 * missile agree (both start it at MissileStart.nozzle, missile-silo.ts).
 *
 * The path, over a parameter s from 0 to 1, lies in the vertical plane
 * through start and target: across it eases from the start to the target
 * (between smoothstep and smootherstep, `steep`), the height goes from the
 * start's to the target's plus a hump of the apex height. Across stands
 * still at both ends, so the missile leaves straight up and comes down
 * straight onto the target. Closer than `swing` the path also swings out
 * sideways and back, so there is always way across at the apex: the
 * missile turns over the top instead of flipping on the spot.
 *
 * The pace: the missile stands on its fire for the ignition and lifts off
 * at a fixed acceleration whatever the distance, slowly out of the shaft.
 * From there its speed blends over `pace.blend` metres into a shape along
 * the path, scaled so that it reaches the target exactly at the end: ever
 * faster along the way (up to 1 + `boost` times), slowed to `topSpeed` of
 * that near the apex (within `topBand` of the climb's height below it, on
 * either side), so it climbs faster and faster, coasts over the apex and
 * dives fastest.
 *
 * Fixed buffers: plan() fills them anew, nothing allocated per call.
 */
export class MissileFlight {
  private readonly start = new Vector3();
  private readonly end = new Vector3();
  /** Unit vectors on the ground: towards the target, and across */
  private alongX = 1;
  private alongZ = 0;
  private sideX = 0;
  private sideZ = 1;
  private distance = 0;
  private hump = 0;
  private swingM = 0;
  private steep = 0;
  /** Length of the curve from the start to each sample, s = i / CURVE_SAMPLES */
  private readonly lengths = new Float32Array(CURVE_SAMPLES + 1);
  private pathLength = 0;
  private durationS = 0;
  private holdS = 0;
  private liftS = 0;
  private liftAcceleration = 0;
  /** Metres covered by the end of the lift-off */
  private liftM = 0;
  /** Speed shape and height at every PACE_SAMPLES-th of the path, set in plan() */
  private readonly shape = new Float32Array(PACE_SAMPLES + 1);
  /** Game seconds when the missile passes each of them, and its speed there */
  private readonly times = new Float64Array(PACE_SAMPLES + 1);
  private readonly speeds = new Float32Array(PACE_SAMPLES + 1);
  private readonly scratch = new Vector3();

  /** Metres along the whole path */
  get length(): number {
    return this.pathLength;
  }

  /** Game seconds from the start to the target */
  get duration(): number {
    return this.durationS;
  }

  /** Game seconds the missile stands on its fire before it moves */
  get ignition(): number {
    return this.holdS;
  }

  /** Metres of the apex above the higher of start and target, for a flight `distance` m across */
  static apexAbove(distance: number, shape: MissileFlightShape = MISSILE_LAUNCH_LOOK.flight): number {
    const { min, base, perM, max } = shape.apex;
    return MathUtils.clamp(base + perM * distance, min, max);
  }

  /** From `start` onto `target` (local) in `durationS` game seconds. */
  plan(start: Vector3, target: Vector3, durationS: number, shape: MissileFlightShape = MISSILE_LAUNCH_LOOK.flight): this {
    this.start.copy(start);
    this.end.copy(target);
    const dx = target.x - start.x;
    const dz = target.z - start.z;
    this.distance = Math.hypot(dx, dz);
    if (this.distance > 1e-3) {
      this.alongX = dx / this.distance;
      this.alongZ = dz / this.distance;
    } else {
      this.alongX = 1;
      this.alongZ = 0;
    }
    this.sideX = this.alongZ;
    this.sideZ = -this.alongX;
    // The hump puts the middle of the path apexAbove over the higher end
    const top = MissileFlight.apexAbove(this.distance, shape) + Math.max(start.y, target.y);
    this.hump = top - (start.y + target.y) / 2;
    this.swingM = shape.swing * (1 - MathUtils.smoothstep(this.distance, 0, shape.swing));
    this.steep = shape.steep;
    this.measure();

    const total = Math.max(durationS, 1e-3);
    this.durationS = total;
    this.holdS = Math.min(shape.ignition.seconds, shape.ignition.share * total);
    this.liftS = Math.min(shape.lift.seconds, shape.lift.share * (total - this.holdS));
    this.liftAcceleration = shape.lift.acceleration;
    this.liftM = Math.min(0.5 * this.liftAcceleration * this.liftS * this.liftS, this.pathLength);
    this.shapePace(shape, top);
    this.fitPace(shape, total - this.holdS - this.liftS);
    return this;
  }

  /** Metres flown `t` game seconds after the start. */
  distanceAt(t: number): number {
    if (t <= this.holdS) return 0;
    if (t >= this.durationS) return this.pathLength;
    const lifted = t - this.holdS;
    if (lifted <= this.liftS) return Math.min(0.5 * this.liftAcceleration * lifted * lifted, this.liftM);
    const j = this.sampleAtTime(t);
    const t0 = this.times[j];
    const t1 = this.times[j + 1];
    const share = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
    return Math.max(this.liftM, ((j + share) / PACE_SAMPLES) * this.pathLength);
  }

  /** Speed in m/s `t` game seconds after the start. */
  speedAt(t: number): number {
    if (t <= this.holdS || t >= this.durationS) return 0;
    const lifted = t - this.holdS;
    if (lifted <= this.liftS) return this.liftAcceleration * lifted;
    const j = this.sampleAtTime(t);
    const t0 = this.times[j];
    const t1 = this.times[j + 1];
    return MathUtils.lerp(this.speeds[j], this.speeds[j + 1], t1 > t0 ? (t - t0) / (t1 - t0) : 0);
  }

  /** Game seconds when the missile has flown `d` metres. */
  timeAtDistance(d: number): number {
    if (d <= 0) return this.holdS;
    if (d >= this.pathLength) return this.durationS;
    if (d <= this.liftM) return this.holdS + Math.sqrt((2 * d) / this.liftAcceleration);
    const u = (d / this.pathLength) * PACE_SAMPLES;
    const j = Math.min(PACE_SAMPLES - 1, Math.floor(u));
    return Math.max(this.holdS + this.liftS, MathUtils.lerp(this.times[j], this.times[j + 1], u - j));
  }

  /**
   * Where the missile is and which way it flies (unit vector) at `u` of the
   * flight, 0 the start, 1 the impact.
   */
  at(u: number, position: Vector3, direction: Vector3 | null = null): void {
    this.atDistance(this.distanceAt(MathUtils.clamp(u, 0, 1) * this.durationS), position, direction);
    if (u >= 1) position.copy(this.end);
  }

  /** The point `d` metres along the path, and the way on there (unit vector). */
  atDistance(d: number, position: Vector3, direction: Vector3 | null = null): void {
    this.curve(this.parameterAt(d), position, direction);
  }

  /** The curve's length at CURVE_SAMPLES points. */
  private measure(): void {
    const point = this.scratch;
    let { x, y, z } = this.start;
    this.lengths[0] = 0;
    for (let i = 1; i <= CURVE_SAMPLES; i++) {
      this.curve(i / CURVE_SAMPLES, point, null);
      this.lengths[i] = this.lengths[i - 1] + Math.hypot(point.x - x, point.y - y, point.z - z);
      ({ x, y, z } = point);
    }
    this.pathLength = this.lengths[CURVE_SAMPLES];
  }

  /** The speed shape at every pace sample: faster along the way, slower near the `top`, on either side of the apex. */
  private shapePace(shape: MissileFlightShape, top: number): void {
    const { boost, topSpeed, topBand } = shape.pace;
    const band = Math.max(1, topBand * (top - this.start.y));
    for (let j = 0; j <= PACE_SAMPLES; j++) {
      this.atDistance((j / PACE_SAMPLES) * this.pathLength, this.scratch);
      const coast = topSpeed + (1 - topSpeed) * MathUtils.smoothstep(top - this.scratch.y, 0, band);
      this.shape[j] = (1 + (boost * j) / PACE_SAMPLES) * coast;
    }
  }

  /**
   * The speed after lift-off, `restS` seconds for the rest of the way: the
   * lift-off speed blending into the shape times the factor that makes the
   * way take exactly that long, found by halving. Fills times and speeds.
   */
  private fitPace(shape: MissileFlightShape, restS: number): void {
    const liftSpeed = this.liftAcceleration * this.liftS;
    const liftEnd = this.holdS + this.liftS;
    let lo = 0;
    let hi = 1;
    while (this.walk(hi, liftSpeed, liftEnd, shape.pace.blend, false) - liftEnd > restS && hi < 1e7) hi *= 2;
    for (let k = 0; k < BISECTIONS; k++) {
      const mid = (lo + hi) / 2;
      if (this.walk(mid, liftSpeed, liftEnd, shape.pace.blend, false) - liftEnd > restS) lo = mid;
      else hi = mid;
    }
    this.walk(hi, liftSpeed, liftEnd, shape.pace.blend, true);
    // What is left of rounding goes on the last stretch, which ends at the impact
    this.times[PACE_SAMPLES] = this.durationS;
  }

  /**
   * Walk the path at `factor` times the shape after lift-off: the time at
   * its end. With `store` the time and speed at every pace sample go into
   * the tables.
   */
  private walk(factor: number, liftSpeed: number, liftEnd: number, blend: number, store: boolean): number {
    const step = this.pathLength / PACE_SAMPLES;
    let time = liftEnd;
    let lastSpeed = liftSpeed;
    for (let j = 0; j <= PACE_SAMPLES; j++) {
      const d = j * step;
      let speed: number;
      if (d <= this.liftM) {
        speed = Math.sqrt(2 * this.liftAcceleration * d);
        if (store) this.times[j] = this.holdS + (speed > 0 ? speed / this.liftAcceleration : 0);
      } else {
        const ramp = MathUtils.smoothstep(d, this.liftM, this.liftM + blend);
        speed = liftSpeed + factor * this.shape[j] * ramp;
        const from = Math.max(this.liftM, d - step);
        time += (d - from) / Math.max(1e-6, (speed + (d - step < this.liftM ? liftSpeed : lastSpeed)) / 2);
        if (store) this.times[j] = time;
      }
      if (store) this.speeds[j] = speed;
      lastSpeed = speed;
    }
    return time;
  }

  /** The pace sample j with times[j] <= t < times[j + 1] (t after lift-off). */
  private sampleAtTime(t: number): number {
    const times = this.times;
    let lo = 0;
    let hi = PACE_SAMPLES;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (times[mid] <= t) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /** The curve's parameter s where the path is `d` metres long. */
  private parameterAt(d: number): number {
    const lengths = this.lengths;
    if (d <= 0) return 0;
    if (d >= this.pathLength) return 1;
    let lo = 0;
    let hi = CURVE_SAMPLES;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (lengths[mid] <= d) lo = mid;
      else hi = mid;
    }
    const span = lengths[hi] - lengths[lo];
    return (lo + (span > 0 ? (d - lengths[lo]) / span : 0)) / CURVE_SAMPLES;
  }

  /** The path at `s`, and its unit tangent. */
  private curve(s: number, position: Vector3, direction: Vector3 | null): void {
    const { start, end, steep } = this;
    const smooth = s * s * (3 - 2 * s);
    const smoother = s * s * s * (s * (6 * s - 15) + 10);
    const ease = smooth + (smoother - smooth) * steep;
    const hump = 4 * s * (1 - s);
    // Swinging out sideways and back: round the side at the apex
    const radius = (this.swingM * (1 - Math.cos(TAU * s))) / 2;
    const turn = Math.PI * s;
    const along = this.distance * ease + radius * Math.cos(turn);
    const side = radius * Math.sin(turn);
    position.set(
      start.x + this.alongX * along + this.sideX * side,
      start.y + (end.y - start.y) * ease + this.hump * hump,
      start.z + this.alongZ * along + this.sideZ * side,
    );
    if (!direction) return;
    const inOut = s * (1 - s);
    const easeRate = 6 * inOut + (30 * inOut * inOut - 6 * inOut) * steep;
    const radiusRate = this.swingM * Math.PI * Math.sin(TAU * s);
    const alongRate = this.distance * easeRate + radiusRate * Math.cos(turn) - radius * Math.PI * Math.sin(turn);
    const sideRate = radiusRate * Math.sin(turn) + radius * Math.PI * Math.cos(turn);
    direction.set(
      this.alongX * alongRate + this.sideX * sideRate,
      (end.y - start.y) * easeRate + this.hump * (4 - 8 * s),
      this.alongZ * alongRate + this.sideZ * sideRate,
    );
    const length = direction.length();
    if (length > 1e-9) direction.divideScalar(length);
    else direction.set(0, 1, 0);
  }
}
