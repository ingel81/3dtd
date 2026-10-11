import { PerspectiveCamera } from 'three';
import { MinimapFrame, ViewFootprint } from './minimap-frame';

describe('MinimapFrame', () => {
  // 200 m wide (west at x 100), 100 m deep (north at z 50)
  const frame = new MinimapFrame({ left: 100, right: -100, top: 50, bottom: -50 }, 200);

  it('fits the area whole and centred, north up and west left', () => {
    expect([frame.x, frame.y, frame.w, frame.h]).toEqual([0, 50, 200, 100]);
    expect(frame.u(100)).toBe(0);
    expect(frame.u(-100)).toBe(200);
    expect(frame.v(50)).toBe(50);
    expect(frame.v(-50)).toBe(150);
  });

  it('maps pixels back into the scene, kept inside the area', () => {
    expect(frame.toScene(100, 100)).toEqual({ x: 0, z: 0 });
    expect(frame.toScene(50, 75)).toEqual({ x: 50, z: 25 });
    expect(frame.toScene(-20, 0)).toEqual({ x: 100, z: 50 });
  });
});

describe('ViewFootprint', () => {
  it('meets the ground under a camera looking straight down', () => {
    const camera = new PerspectiveCamera(90, 1, 1, 1000);
    camera.position.set(10, 100, 20);
    camera.up.set(0, 0, 1);
    camera.lookAt(10, 0, 20);
    camera.updateMatrixWorld();
    const out = new ViewFootprint().update(camera, 0, 5000);
    for (const p of out) {
      // 90 degrees: 100 m to each side from 100 m up
      expect(Math.abs(Math.abs(p.x - 10) - 100)).toBeLessThan(0.01);
      expect(Math.abs(Math.abs(p.z - 20) - 100)).toBeLessThan(0.01);
    }
  });

  it('reaches out a fixed distance for corners above the horizon', () => {
    const camera = new PerspectiveCamera(60, 1, 1, 1000);
    camera.position.set(0, 10, 0);
    camera.lookAt(0, 10, 100);
    camera.updateMatrixWorld();
    const out = new ViewFootprint().update(camera, 0, 300);
    const top = out[2];
    expect(Math.hypot(top.x, top.z)).toBeCloseTo(300, 3);
  });
});
