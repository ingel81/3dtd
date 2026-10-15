import { describe, expect, it } from 'vitest';
import { Matrix4, PerspectiveCamera, Vector4 } from 'three';
import { placeMirror } from './water-reflection';

function setup(): { camera: PerspectiveCamera; mirror: PerspectiveCamera; toTexture: Matrix4 } {
  const camera = new PerspectiveCamera(50, 1.5, 0.5, 2000);
  camera.position.set(0, 20, 30);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const mirror = new PerspectiveCamera();
  const toTexture = new Matrix4();
  placeMirror(camera, 2, mirror, toTexture, 400);
  return { camera, mirror, toTexture };
}

/** Clip-space position of a scene point in the mirror */
function clipOf(mirror: PerspectiveCamera, x: number, y: number, z: number): Vector4 {
  return new Vector4(x, y, z, 1).applyMatrix4(mirror.matrixWorldInverse).applyMatrix4(mirror.projectionMatrix);
}

describe('placeMirror', () => {
  it('stands mirrored under the plane, as far below it as the camera is above', () => {
    const { mirror } = setup();
    expect(mirror.position.y).toBeCloseTo(-16);
    expect(mirror.position.z).toBeCloseTo(30);
    expect(mirror.far).toBe(400);
  });

  it('maps a point of the water plane in view into the texture', () => {
    const { toTexture } = setup();
    const p = new Vector4(0, 2, 0, 1).applyMatrix4(toTexture);
    expect(p.x / p.w).toBeCloseTo(0.5);
    expect(p.y / p.w).toBeGreaterThan(0);
    expect(p.y / p.w).toBeLessThan(1);
  });

  it('clips what lies under the water and keeps what stands over it', () => {
    const { mirror } = setup();
    const under = clipOf(mirror, 0, -3, -10);
    const over = clipOf(mirror, 0, 7, -10);
    expect(under.z / under.w).toBeLessThan(-1);
    expect(Math.abs(over.z / over.w)).toBeLessThanOrEqual(1);
  });
});
