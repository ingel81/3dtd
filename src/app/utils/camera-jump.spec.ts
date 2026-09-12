import { describe, expect, it } from 'vitest';
import { easeInOutCubic, jumpCameraPosition, JUMP_MAX_DISTANCE_M, JUMP_MIN_DISTANCE_M } from './camera-jump';

// 45° down, looking north (-Z)
const DOWN_NORTH = { x: 0, y: -Math.SQRT1_2, z: -Math.SQRT1_2 };

describe('jumpCameraPosition', () => {
  it('keeps the offset to the point the camera looks at', () => {
    // Looking at (0, 0, -200) from 200 m up: 283 m along the ray
    const to = jumpCameraPosition({ x: 0, y: 200, z: 0 }, DOWN_NORTH, { x: 500, y: 0, z: 300 })!;
    expect(to.x).toBeCloseTo(500);
    expect(to.y).toBeCloseTo(200);
    expect(to.z).toBeCloseTo(500);
  });

  it('takes the target height into account', () => {
    const to = jumpCameraPosition({ x: 0, y: 200, z: 0 }, DOWN_NORTH, { x: 0, y: 50, z: 0 })!;
    // 150 m above the target at 45°
    expect(to.y).toBeCloseTo(200);
    expect(to.z).toBeCloseTo(150);
  });

  it('holds the distance within its bounds', () => {
    const far = jumpCameraPosition({ x: 0, y: 5000, z: 0 }, DOWN_NORTH, { x: 0, y: 0, z: 0 })!;
    expect(Math.hypot(far.x, far.y, far.z)).toBeCloseTo(JUMP_MAX_DISTANCE_M);
    const near = jumpCameraPosition({ x: 0, y: 10, z: 0 }, DOWN_NORTH, { x: 0, y: 0, z: 0 })!;
    expect(Math.hypot(near.x, near.y, near.z)).toBeCloseTo(JUMP_MIN_DISTANCE_M);
    // Camera below the target height: nearest distance, not behind it
    const below = jumpCameraPosition({ x: 0, y: 0, z: 0 }, DOWN_NORTH, { x: 0, y: 100, z: 0 })!;
    expect(below.y).toBeGreaterThan(100);
  });

  it('is null when the camera looks at the horizon', () => {
    expect(jumpCameraPosition({ x: 0, y: 200, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 0 })).toBeNull();
    expect(jumpCameraPosition({ x: 0, y: 200, z: 0 }, { x: 0, y: 0.5, z: -0.866 }, { x: 0, y: 0, z: 0 })).toBeNull();
  });
});

describe('easeInOutCubic', () => {
  it('runs from 0 to 1 through 0.5 at the middle', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.25)).toBeLessThan(0.25);
  });
});
