import { describe, expect, it } from 'vitest';
import { arcLengthTable, catmullRom, ease, poseToOrbit, shotPlayer, type MapPoint3 } from './camera-path';

const p = (x: number, y: number, h = 0): MapPoint3 => ({ x, y, h });

describe('showreel camera paths', () => {
  it('eases start at 0, end at 1 and stay monotonic', () => {
    for (const kind of ['linear', 'in', 'out', 'inOut', 'smooth'] as const) {
      expect(ease(kind, 0)).toBeCloseTo(0);
      expect(ease(kind, 1)).toBeCloseTo(1);
      let last = -1;
      for (let t = 0; t <= 1; t += 0.05) {
        const v = ease(kind, t);
        expect(v).toBeGreaterThanOrEqual(last - 1e-12);
        last = v;
      }
    }
  });

  it('passes through every keyframe', () => {
    const keys = [p(0, 0, 10), p(100, 20, 40), p(150, 120, 30), p(60, 200, 80)];
    keys.forEach((k, i) => {
      const at = catmullRom(keys, i / (keys.length - 1));
      expect(at.x).toBeCloseTo(k.x, 6);
      expect(at.y).toBeCloseTo(k.y, 6);
      expect(at.h).toBeCloseTo(k.h, 6);
    });
  });

  it('moves at one speed along unevenly spaced keyframes', () => {
    const keys = [p(0, 0), p(10, 0), p(200, 0)];
    const even = arcLengthTable(keys);
    // Half the length lies at x = 100, far past the middle keyframe that the plain parameter puts at t = 0.5
    expect(catmullRom(keys, even(0.5)).x).toBeCloseTo(100, 0);
    expect(catmullRom(keys, 0.5).x).toBeCloseTo(10, 6);
  });

  it('orbits counter-clockwise from the south, looking at the centre', () => {
    const play = shotPlayer({ kind: 'orbit', center: p(10, 20, 5), from: 0, to: 90, radius: 100, height: 50, ease: 'linear' });
    const start = play(0);
    expect(start.eye.x).toBeCloseTo(10);
    expect(start.eye.y).toBeCloseTo(-80);
    expect(start.eye.h).toBeCloseTo(55);
    expect(start.look).toEqual(p(10, 20, 5));
    const end = play(1);
    expect(end.eye.x).toBeCloseTo(110);
    expect(end.eye.y).toBeCloseTo(20);
  });

  it('turns a pose into the orbit terms of the editor camera', () => {
    // Looking north and down 45 degrees
    const north = poseToOrbit({ eye: p(0, -100, 100), look: p(0, 0, 0) });
    expect(north.yaw).toBeCloseTo(0);
    expect(north.pitch).toBeCloseTo(Math.PI / 4);
    expect(north.distance).toBeCloseTo(Math.SQRT2 * 100);
    // Looking east: CameraController's forward (sin yaw, cos yaw) on the map
    expect(poseToOrbit({ eye: p(-50, 0, 0), look: p(0, 0, 0) }).yaw).toBeCloseTo(Math.PI / 2);
  });
});
