/**
 * The showreel camera's floor: a shot never goes below the ground plus a
 * few metres nor under a water surface (a lake seen from below, a hill's
 * inside). The stages lift the eye of every pose they apply; the camera log
 * (one row per frame, whoever holds the camera) lets the runner check a take
 * for the frames that still went under.
 */
import type { CameraPose } from './camera-path';

/** Metres the eye keeps above the terrain, unless a scene asks for less (a grass close-up) */
export const CAMERA_FLOOR_M = 3;
/** Metres the eye keeps above a water surface: under it the water's own surface is cut by the near plane */
export const WATER_CLEARANCE_M = 0.5;

/** The eye's height lifted to the floor: `floor` over the ground, WATER_CLEARANCE_M over water (null: dry) */
export function flooredHeight(eye: number, ground: number, water: number | null, floor = CAMERA_FLOOR_M): number {
  return Math.max(eye, ground + floor, water === null ? -Infinity : water + WATER_CLEARANCE_M);
}

/** A pose with its eye lifted to the floor; the look stays where the shot wants it */
export function flooredPose(pose: CameraPose, ground: number, water: number | null, floor = CAMERA_FLOOR_M): CameraPose {
  const h = flooredHeight(pose.eye.h, ground, water, floor);
  return h === pose.eye.h ? pose : { eye: { ...pose.eye, h }, look: pose.look };
}

/**
 * One frame of the camera log: page time (ms), the eye on the map and its
 * height, the ground and the water surface under it (null: dry), the point it
 * looks at. Rounded to centimetres, so a take's log stays small.
 */
export type CameraRow = [t: number, x: number, y: number, h: number, ground: number, water: number | null, lx: number, ly: number, lh: number];

const cm = (v: number): number => Math.round(v * 100) / 100;

export function cameraRow(t: number, pose: CameraPose, ground: number, water: number | null): CameraRow {
  return [
    Math.round(t * 10) / 10,
    cm(pose.eye.x),
    cm(pose.eye.y),
    cm(pose.eye.h),
    cm(ground),
    water === null ? null : cm(water),
    cm(pose.look.x),
    cm(pose.look.y),
    cm(pose.look.h),
  ];
}
