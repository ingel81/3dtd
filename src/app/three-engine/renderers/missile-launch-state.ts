import type { Quaternion, Vector3 } from 'three';
import type { MissileFlight } from '../../utils/missile-flight';

/** One launch of a missile with its smoke (MissileLaunchRenderer), and its pose this frame. */
export interface Launch {
  active: boolean;
  strikeId: number;
  /** Game seconds since the command */
  t: number;
  /** The impact came or the flight's time is up: the missile is gone, its trail stands */
  landed: boolean;
  /** Game seconds after the command when the last of its smoke is gone */
  end: number;
  readonly flight: MissileFlight;
  /** The silo's base, local */
  readonly site: Vector3;
  /** Top of the silo over its base, m (MissileStart.shaftTop) */
  shaftTop: number;
  /** The missile's turn and scale as it stood in the silo (MissileStart) */
  readonly turn: Quaternion;
  baseScale: number;
  /** Height of the target, local */
  targetY: number;
  /** All sprites, or the `low` counts (impact effects off) */
  full: boolean;
  /** Wind direction, unit vector on the ground */
  windX: number;
  windZ: number;
  /** Order of the launches, the oldest makes room */
  born: number;

  // This frame, set by the renderer before the parts draw
  /** The nozzle, local */
  readonly position: Vector3;
  /** The way the missile flies, unit vector */
  readonly direction: Vector3;
  /** Growth of the missile and its flame, 1 in the shaft (up to MISSILE_LAUNCH_LOOK.missile.flightScale) */
  scale: number;
  /** Strength of the engine, 0 before the ignition and once landed */
  thrust: number;
  /** m/s */
  speed: number;
}
