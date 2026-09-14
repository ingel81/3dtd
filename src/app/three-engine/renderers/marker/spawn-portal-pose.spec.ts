import { describe, it, expect } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import {
  bearingToPortalHeading,
  clampPortalHeading,
  portalCorridorWidth,
  portalHeadingToBearing,
  portalFrontDistance,
  portalLaneOffset,
  portalScaleForWidth,
  portalTurnRange,
  provisionalPortalPose,
  routeExitPoint,
  routeLeavesThroughOpening,
  spawnPortalPose,
  type SpawnPortalPose,
} from './spawn-portal-pose';
import { corridorConfig, lateralLimit } from '../../../utils/route-corridor';
import {
  PORTAL_DEPTH,
  PORTAL_MAX_SCALE,
  PORTAL_MIN_SCALE,
  PORTAL_OPENING_WIDTH,
  PORTAL_TURN_CLEARANCE,
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

/**
 * The route shifted `offset` metres square to itself, each vertex along the
 * mean of the segments meeting there: an enemy's lane, built another way
 * than routeLeavesThroughOpening builds it.
 */
function laneOf(points: readonly Point[], offset: number): Point[] {
  return points.map((p, i) => {
    const before = points[Math.max(0, i - 1)];
    const after = points[Math.min(points.length - 1, i + 1)];
    const length = Math.hypot(after.x - before.x, after.z - before.z);
    return { x: p.x + ((after.z - before.z) / length) * offset, z: p.z - ((after.x - before.x) / length) * offset };
  });
}

/** The portal turned by `offset` from its route's heading. */
function turned(pose: SpawnPortalPose, offset: number): SpawnPortalPose {
  return { ...pose, heading: pose.heading + offset };
}

describe('portal turn range', () => {
  /** Opening half width less the clearance, for a portal of `scale` */
  const room = (scale: number) => (PORTAL_OPENING_WIDTH / 2) * scale - PORTAL_TURN_CLEARANCE;

  it('lässt auf einer geraden Straße so weit drehen, wie die äußeren Gegner noch zwischen den Pfeilern hinausgehen', () => {
    // Nach Westen (+x), Korridor 9 m: Skala 1,125, Gegner bis 3 m neben der Mitte
    const street = [{ x: 0, z: 0 }, { x: 60, z: 0 }];
    const start = { lat: 0, lon: 0, corridorLeft: 4.5, corridorRight: 4.5 };
    const pose = spawnPortalPose(street, 0, portalCorridorWidth(start))!;
    const lane = portalLaneOffset(start);
    expect(lane).toBeCloseTo(lateralLimit(4.5));

    const range = portalTurnRange(street, pose, lane);
    // Gerade Straße: zu beiden Seiten gleich weit
    expect(range.max).toBeCloseTo(-range.min, 3);
    // An der Grenze trifft die äußere Spur die Vorderfläche am Rand der
    // Öffnung: f tan(t) + lane / cos(t) = halbe Öffnung weniger Abstand
    const f = portalFrontDistance(pose.scale);
    const t = range.max;
    expect(f * Math.tan(t) + lane / Math.cos(t)).toBeCloseTo(room(pose.scale), 2);
    expect(t).toBeGreaterThan((5 * Math.PI) / 180);
    expect(t).toBeLessThan((15 * Math.PI) / 180);

    // Die äußere Spur, anders gebaut, geht an der Grenze noch durch, dahinter nicht
    for (const side of [-1, 1]) {
      const run = throughPortal(turned(pose, range.max), laneOf(street, side * lane));
      expect(Math.abs(run.atFront)).toBeLessThanOrEqual(room(pose.scale) + 0.01);
    }
    expect(routeLeavesThroughOpening(street, pose, pose.heading + range.max + 0.01, lane)).toBe(false);
  });

  it('hält eine Drehung durch einen Pfeiler oder die Rückwand an der Grenze an', () => {
    const street = [{ x: 0, z: 0 }, { x: 60, z: 0 }];
    const pose = spawnPortalPose(street, 0, 9)!;
    const lane = lateralLimit(4.5);
    const range = portalTurnRange(street, pose, lane);

    // Quer: durch den Pfeiler
    expect(clampPortalHeading(street, pose, pose.heading + Math.PI / 2, lane)).toBeCloseTo(pose.heading + range.max, 6);
    expect(clampPortalHeading(street, pose, pose.heading - Math.PI / 2, lane)).toBeCloseTo(pose.heading + range.min, 6);
    // Fast rückwärts: durch die Rückwand, zur näheren Grenze
    expect(clampPortalHeading(street, pose, pose.heading + 3, lane)).toBeCloseTo(pose.heading + range.max, 6);
    expect(clampPortalHeading(street, pose, pose.heading - 3, lane)).toBeCloseTo(pose.heading + range.min, 6);
    // Innerhalb bleibt die Drehung, auch eine volle Umdrehung weiter
    const small = range.max / 2;
    expect(clampPortalHeading(street, pose, pose.heading + small + 2 * Math.PI, lane)).toBeCloseTo(pose.heading + small, 6);
  });

  it('dreht in einer Gasse, wo die Öffnung nicht mit dem Korridor schrumpft, weiter als auf einer Allee', () => {
    const street = [{ x: 0, z: 0 }, { x: 0, z: 60 }];
    const alley = spawnPortalPose(street, 0, 6)!;
    const avenue = spawnPortalPose(street, 0, 12)!;
    expect(alley.scale).toBe(PORTAL_MIN_SCALE);
    const alleyRange = portalTurnRange(street, alley, lateralLimit(3));
    const avenueRange = portalTurnRange(street, avenue, lateralLimit(6));
    expect(alleyRange.max).toBeGreaterThan(avenueRange.max);
    expect(avenueRange.max).toBeGreaterThan(0);
  });

  it('folgt auf dem Kreisverkehr dem Bogen: jede erlaubte Drehung lässt alle Spuren durch die Öffnung', () => {
    // Kreisverkehr mit 15 m Radius, Knoten alle 5°, eine Viertelrunde; Korridor 9 m
    const ring = arc(0, -15, 15, 0, 5, 19);
    const pose = spawnPortalPose(ring, 0, 9)!;
    const lane = lateralLimit(4.5);
    const range = portalTurnRange(ring, pose, lane);
    expect(range.min).toBeLessThan(0);
    expect(range.max).toBeGreaterThan(0);

    for (const offset of [range.min, range.min / 2, 0, range.max / 2, range.max]) {
      for (const side of [-1, 0, 1]) {
        const run = throughPortal(turned(pose, offset), laneOf(ring, side * lane));
        expect(run.widest, `Drehung ${offset.toFixed(3)}, Spur ${side}`).toBeLessThanOrEqual(room(pose.scale) + 0.05);
      }
    }
    // Jenseits der Grenzen läuft eine Spur in einen Pfeiler
    expect(routeLeavesThroughOpening(ring, pose, pose.heading + range.max + 0.02, lane)).toBe(false);
    expect(routeLeavesThroughOpening(ring, pose, pose.heading + range.min - 0.02, lane)).toBe(false);
  });

  it('lässt einen Korridor, der breiter ist als die größte Öffnung, nicht drehen', () => {
    // 20 m: Skala am Maximum, Öffnung 14 m, Gegner bis 8,5 m neben der Mitte
    const street = [{ x: 0, z: 0 }, { x: 0, z: 60 }];
    const pose = spawnPortalPose(street, 0, 20)!;
    expect(pose.scale).toBe(PORTAL_MAX_SCALE);
    const lane = lateralLimit(10);
    expect(portalTurnRange(street, pose, lane)).toEqual({ min: 0, max: 0 });
    expect(clampPortalHeading(street, pose, pose.heading + 0.3, lane)).toBeCloseTo(pose.heading, 9);
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

describe('portal bearing', () => {
  it('reads a heading as a compass bearing: +z north, -x east, clockwise', () => {
    expect(portalHeadingToBearing(0)).toBe(0);
    expect(portalHeadingToBearing(-Math.PI / 2)).toBeCloseTo(90, 9);
    expect(portalHeadingToBearing(Math.PI)).toBeCloseTo(180, 9);
    expect(portalHeadingToBearing(Math.PI / 2)).toBeCloseTo(270, 9);
    expect(facing(bearingToPortalHeading(90)).x).toBeCloseTo(-1, 9);
  });

  it('stays in 0 up to 360 and turns back into the same direction', () => {
    for (const heading of [-7, -3, -1, 0.2, 2.5, 3.1, 9]) {
      const bearing = portalHeadingToBearing(heading);
      expect(bearing).toBeGreaterThanOrEqual(0);
      expect(bearing).toBeLessThan(360);
      const back = bearingToPortalHeading(bearing);
      expect(Math.cos(back - heading)).toBeCloseTo(1, 12);
      expect(Math.sin(back - heading)).toBeCloseTo(0, 12);
    }
  });
});
