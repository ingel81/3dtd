import { describe, expect, it } from 'vitest';
import { CAMERA_FLOOR_M, WATER_CLEARANCE_M, cameraRow, flooredHeight, flooredPose } from './camera-floor';

describe('showreel camera floor', () => {
  it('lifts an eye below the ground plus the floor', () => {
    expect(flooredHeight(11, 10, null)).toBe(10 + CAMERA_FLOOR_M);
    expect(flooredHeight(40, 10, null)).toBe(40);
  });

  it('keeps the eye over a water surface deeper than the floor', () => {
    // A lake 6 m deep: ground + 3 m is still under the water
    expect(flooredHeight(-2, -6, 0)).toBe(WATER_CLEARANCE_M);
    expect(flooredHeight(5, -6, 0)).toBe(5);
  });

  it('takes a scene floor lower than the default', () => {
    expect(flooredHeight(0.8, 0, null, 1)).toBe(1);
  });

  it('leaves the look of a lifted pose alone and returns a pose above the floor as it is', () => {
    const pose = { eye: { x: 1, y: 2, h: 0 }, look: { x: 5, y: 6, h: -1 } };
    const lifted = flooredPose(pose, 0, null);
    expect(lifted.eye).toEqual({ x: 1, y: 2, h: CAMERA_FLOOR_M });
    expect(lifted.look).toBe(pose.look);
    const high = { eye: { x: 1, y: 2, h: 50 }, look: pose.look };
    expect(flooredPose(high, 0, null)).toBe(high);
  });

  it('logs a frame rounded to centimetres, water null on dry ground', () => {
    const row = cameraRow(1234.5678, { eye: { x: 1.234, y: -2.345, h: 3.456 }, look: { x: 0, y: 0, h: 0 } }, 0.004, null);
    expect(row).toEqual([1234.6, 1.23, -2.35, 3.46, 0, null, 0, 0, 0]);
  });
});
