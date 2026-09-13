import { describe, it, expect } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import {
  PORTAL_HEADING_RUN,
  portalScaleForWidth,
  provisionalPortalPose,
  spawnPortalPose,
} from './spawn-portal-pose';
import {
  PORTAL_MAX_SCALE,
  PORTAL_MIN_SCALE,
  PORTAL_OPENING_WIDTH,
} from '../../../configs/marker-geometry.config';

/** Where the portal's +z points after its heading. */
function facing(heading: number): Vector3 {
  return new Vector3(0, 0, 1).applyMatrix4(new Matrix4().makeRotationY(heading));
}

describe('spawnPortalPose', () => {
  it('steht mit seiner Mitte auf dem Routenstart, wo die Gegner erscheinen, und schaut entlang des ersten Segments', () => {
    const pose = spawnPortalPose([{ x: 10, z: 20 }, { x: 40, z: 20 }], 296, PORTAL_OPENING_WIDTH)!;
    expect(pose.x).toBeCloseTo(10);
    expect(pose.z).toBeCloseTo(20);
    expect(pose.y).toBe(296);
    expect(pose.scale).toBeCloseTo(1);
    const f = facing(pose.heading);
    expect(f.x).toBeCloseTo(1);
    expect(f.z).toBeCloseTo(0);
  });

  it('nimmt die Richtung vom ersten Punkt mit genug Abstand, nicht vom Stummel am Start', () => {
    // 1 m nach Norden (+z), dann nach Westen (+x) weiter
    const points = [{ x: 0, z: 0 }, { x: 0, z: 1 }, { x: 30, z: 1 }];
    const pose = spawnPortalPose(points, 0, 9)!;
    const f = facing(pose.heading);
    expect(f.x).toBeGreaterThan(0.99);
    expect(Math.hypot(pose.x, pose.z)).toBeCloseTo(0);
  });

  it('nimmt den letzten Punkt, wenn die Route kürzer als der Vorlauf ist', () => {
    const pose = spawnPortalPose([{ x: 0, z: 0 }, { x: 0, z: -PORTAL_HEADING_RUN / 2 }], 0, 9)!;
    expect(facing(pose.heading).z).toBeCloseTo(-1);
  });

  it('richtet die Öffnung am Korridor aus, begrenzt auf den Skalenbereich', () => {
    const route = [{ x: 0, z: 0 }, { x: 0, z: 50 }];
    expect(spawnPortalPose(route, 0, 12)!.scale).toBeCloseTo(12 / PORTAL_OPENING_WIDTH);
    expect(spawnPortalPose(route, 0, 2)!.scale).toBe(PORTAL_MIN_SCALE);
    expect(spawnPortalPose(route, 0, 40)!.scale).toBe(PORTAL_MAX_SCALE);
    expect(portalScaleForWidth(PORTAL_OPENING_WIDTH)).toBe(1);
  });

  it('gibt ohne Richtung keine Pose', () => {
    expect(spawnPortalPose([{ x: 3, z: 3 }], 0, 9)).toBeNull();
    expect(spawnPortalPose([{ x: 3, z: 3 }, { x: 3, z: 3 }], 0, 9)).toBeNull();
  });
});

describe('provisionalPortalPose', () => {
  it('schaut vom Spawnpunkt zum HQ', () => {
    const pose = provisionalPortalPose(100, 5, 0, 0, 0);
    const f = facing(pose.heading);
    expect(f.x).toBeCloseTo(-1);
    expect(pose.scale).toBe(1);
    expect(pose.y).toBe(5);
  });
});
