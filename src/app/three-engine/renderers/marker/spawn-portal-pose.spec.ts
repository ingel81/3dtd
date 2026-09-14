import { describe, it, expect } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import {
  portalCorridorWidth,
  portalFrontDistance,
  portalScaleForWidth,
  provisionalPortalPose,
  routeExitPoint,
  spawnPortalPose,
  type SpawnPortalPose,
} from './spawn-portal-pose';
import { corridorConfig } from '../../../utils/route-corridor';
import {
  PORTAL_DEPTH,
  PORTAL_MAX_SCALE,
  PORTAL_MIN_SCALE,
  PORTAL_OPENING_WIDTH,
} from '../../../configs/marker-geometry.config';

/** Where the portal's +z points after its heading. */
function facing(heading: number): Vector3 {
  return new Vector3(0, 0, 1).applyMatrix4(new Matrix4().makeRotationY(heading));
}

interface Point {
  x: number;
  z: number;
}

/** A route point in portal space: `ahead` along the facing, `across` to the side (m). */
function inPortal(pose: SpawnPortalPose, p: Point): { ahead: number; across: number } {
  const f = facing(pose.heading);
  const dx = p.x - pose.x;
  const dz = p.z - pose.z;
  return { ahead: dx * f.x + dz * f.z, across: dx * f.z - dz * f.x };
}

/**
 * How the route runs inside the portal: the largest sideways offset up to
 * the front surface, and the offset where it crosses the front surface.
 */
function throughPortal(pose: SpawnPortalPose, points: readonly Point[]): { widest: number; atFront: number } {
  const front = portalFrontDistance(pose.scale);
  let widest = 0;
  for (let i = 1; i < points.length; i++) {
    const a = inPortal(pose, points[i - 1]);
    const b = inPortal(pose, points[i]);
    if (b.ahead >= front) {
      const t = (front - a.ahead) / (b.ahead - a.ahead);
      const atFront = a.across + (b.across - a.across) * t;
      return { widest: Math.max(widest, Math.abs(atFront)), atFront };
    }
    widest = Math.max(widest, Math.abs(b.across));
  }
  throw new Error('the route does not leave the portal');
}

/** Points on a circle round (cx, cz), from `fromDeg` in `stepDeg` steps (0° = +z, 90° = +x). */
function arc(cx: number, cz: number, radius: number, fromDeg: number, stepDeg: number, count: number): Point[] {
  return Array.from({ length: count }, (_, i) => {
    const a = ((fromDeg + i * stepDeg) * Math.PI) / 180;
    return { x: cx + radius * Math.sin(a), z: cz + radius * Math.cos(a) };
  });
}

describe('spawnPortalPose', () => {
  it('steht mit seiner Mitte auf dem Routenstart, wo die Gegner erscheinen, und schaut entlang einer geraden Route', () => {
    const pose = spawnPortalPose([{ x: 10, z: 20 }, { x: 40, z: 20 }], 296, PORTAL_OPENING_WIDTH)!;
    expect(pose.x).toBeCloseTo(10);
    expect(pose.z).toBeCloseTo(20);
    expect(pose.y).toBe(296);
    expect(pose.scale).toBeCloseTo(1);
    const f = facing(pose.heading);
    expect(f.x).toBeCloseTo(1);
    expect(f.z).toBeCloseTo(0);
  });

  it('lässt einen Stummel am Start in der Öffnung und die Route mittig durch die Vorderfläche hinaus', () => {
    // 1 m nach Norden (+z), dann nach Westen (+x) weiter
    const points = [{ x: 0, z: 0 }, { x: 0, z: 1 }, { x: 30, z: 1 }];
    const pose = spawnPortalPose(points, 0, 9)!;
    expect(facing(pose.heading).x).toBeGreaterThan(0.95);
    expect(Math.hypot(pose.x, pose.z)).toBeCloseTo(0);
    const run = throughPortal(pose, points);
    expect(run.atFront).toBeCloseTo(0, 6);
    expect(run.widest).toBeLessThan(1.01);
  });

  it('folgt einem Bogen: die Route kreuzt die Vorderfläche mittig und bleibt im Portal nahe der Mitte', () => {
    // Auf einem Kreisverkehr mit 15 m Radius, Knoten alle 5°, eine Viertelrunde
    const ring = arc(0, -15, 15, 0, 5, 19);
    const pose = spawnPortalPose(ring, 0, PORTAL_OPENING_WIDTH)!;
    const run = throughPortal(pose, ring);
    expect(run.atFront).toBeCloseTo(0, 6);
    expect(run.widest).toBeLessThan(0.3);
  });

  it('dreht sich an einer Ausfahrt aus dem Kreisverkehr so, dass die Route nicht durch einen Pfeiler läuft', () => {
    // Start auf dem Ring (12 m Radius), zwei Knoten im Bogen, 3,3 m vom
    // Start; dort biegt die Ausfahrt nach Süden ab und läuft 40 m gerade.
    // Zielte das Portal auf den ersten Knoten ab 4 m, das Ende der
    // Ausfahrt, stünde der Knick 3,3 m neben der Mitte, in einer Gasse
    // (Skala 0,75, halbe Öffnung 3 m) im Pfeiler.
    const ring = arc(0, -12, 12, 0, 8, 3);
    const bend = ring[2];
    const road = new Vector3(0.2, 0, -1).normalize();
    const points = [...ring, { x: bend.x + road.x * 40, z: bend.z + road.z * 40 }];
    const pose = spawnPortalPose(points, 0, 6)!;
    expect(pose.scale).toBe(PORTAL_MIN_SCALE);
    const halfOpening = (PORTAL_OPENING_WIDTH / 2) * pose.scale;

    const run = throughPortal(pose, points);
    expect(run.atFront).toBeCloseTo(0, 6);
    expect(run.widest).toBeLessThan(halfOpening * 0.7);
  });

  it('zielt auf den fernsten Punkt, wenn die Route nicht aus dem Portal herausreicht', () => {
    const pose = spawnPortalPose([{ x: 0, z: 0 }, { x: 0, z: -2 }, { x: 0, z: -1 }], 0, 9)!;
    expect(facing(pose.heading).z).toBeCloseTo(-1);
  });

  it('richtet die Öffnung am Korridor aus, begrenzt auf den Skalenbereich', () => {
    const route = [{ x: 0, z: 0 }, { x: 0, z: 50 }];
    expect(spawnPortalPose(route, 0, 12)!.scale).toBeCloseTo(12 / PORTAL_OPENING_WIDTH);
    expect(spawnPortalPose(route, 0, 2)!.scale).toBe(PORTAL_MIN_SCALE);
    expect(spawnPortalPose(route, 0, 40)!.scale).toBe(PORTAL_MAX_SCALE);
    expect(portalScaleForWidth(PORTAL_OPENING_WIDTH)).toBe(1);
  });

  it('spannt die Öffnung über die breitere Seite des Korridors am Routenstart', () => {
    expect(portalCorridorWidth({ lat: 0, lon: 0, corridorLeft: 3, corridorRight: 5 })).toBe(10);
    expect(portalCorridorWidth({ lat: 0, lon: 0, corridorLeft: 6 })).toBe(12);
    expect(portalCorridorWidth({ lat: 0, lon: 0 })).toBe(2 * corridorConfig.defaultHalfWidth);
  });

  it('gibt ohne Richtung keine Pose', () => {
    expect(spawnPortalPose([{ x: 3, z: 3 }], 0, 9)).toBeNull();
    expect(spawnPortalPose([{ x: 3, z: 3 }, { x: 3, z: 3 }], 0, 9)).toBeNull();
  });
});

describe('routeExitPoint', () => {
  it('liegt auf dem Kreis um den Start, auf dem Segment, das ihn kreuzt', () => {
    const exit = routeExitPoint([{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 10 }], 5)!;
    expect(exit.x).toBeCloseTo(3);
    expect(exit.z).toBeCloseTo(4);
  });

  it('misst die Vorderfläche mit der Tiefe, die in schmalen Korridoren nicht schrumpft', () => {
    expect(portalFrontDistance(1)).toBe(PORTAL_DEPTH / 2);
    expect(portalFrontDistance(PORTAL_MIN_SCALE)).toBe(PORTAL_DEPTH / 2);
    expect(portalFrontDistance(PORTAL_MAX_SCALE)).toBeCloseTo((PORTAL_DEPTH / 2) * PORTAL_MAX_SCALE);
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
