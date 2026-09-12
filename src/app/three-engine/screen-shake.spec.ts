import { describe, it, expect } from 'vitest';
import { PerspectiveCamera, Vector4 } from 'three';
import { ScreenShake, offsetProjection } from './screen-shake';

describe('ScreenShake', () => {
  it('decays linearly to 0 over its duration in wall-clock time', () => {
    const shake = new ScreenShake();
    expect(shake.amplitudeAt(0)).toBe(0);
    shake.trigger(0.01, 200, 1000);
    expect(shake.amplitudeAt(1000)).toBeCloseTo(0.01);
    expect(shake.amplitudeAt(1100)).toBeCloseTo(0.005);
    expect(shake.amplitudeAt(1200)).toBe(0);
    expect(shake.amplitudeAt(1300)).toBe(0);
  });

  it('keeps the stronger shake and lets a stronger one take over', () => {
    const shake = new ScreenShake();
    shake.trigger(0.01, 200, 0);
    shake.trigger(0.004, 1000, 50); // weaker than the 0.0075 still running
    expect(shake.amplitudeAt(200)).toBe(0);

    shake.trigger(0.004, 200, 300);
    shake.trigger(0.008, 400, 350); // stronger than the 0.003 left
    expect(shake.amplitudeAt(550)).toBeCloseTo(0.004);
  });
});

describe('offsetProjection', () => {
  it('moves every projected point by the same NDC offset', () => {
    const camera = new PerspectiveCamera(60, 16 / 9, 1, 8000);
    const shaken = camera.projectionMatrix.clone();
    offsetProjection(shaken, 0.02, -0.01);

    for (const [x, y, z] of [[0, 0, -10], [30, -5, -400], [-2, 7, -3]]) {
      const p = new Vector4(x, y, z, 1).applyMatrix4(camera.projectionMatrix);
      const q = new Vector4(x, y, z, 1).applyMatrix4(shaken);
      expect(q.x / q.w - p.x / p.w).toBeCloseTo(0.02);
      expect(q.y / q.w - p.y / p.w).toBeCloseTo(-0.01);
      expect(q.z / q.w).toBeCloseTo(p.z / p.w); // depth untouched
    }
  });
});
