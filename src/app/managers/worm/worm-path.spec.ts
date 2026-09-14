import { describe, it, expect } from 'vitest';
import { GameObject } from '../../core/game-object';
import { ComponentType } from '../../core/component';
import { MovementComponent } from '../../game-components/movement.component';
import { TransformComponent } from '../../game-components/transform.component';
import type { RouteWaypoint } from '../../models/game.types';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT } from '../../utils/geo-utils';
import { corridorConfig, getRouteProfile, lateralLimit } from '../../utils/route-corridor';
import { WORM_BEND_RADIUS_M, wormPathOf } from './worm-path';

class TestGameObject extends GameObject {
  constructor() {
    super('enemy');
    this.addComponent(new TransformComponent(this), ComponentType.TRANSFORM);
  }
}

const LAT0 = 48.776;
const LON0 = 9.183;
const M_PER_DEG_LON = METERS_PER_DEGREE_LAT * Math.cos(LAT0 * DEG_TO_RAD);
const at = (east: number, north: number, halfWidth?: [number, number]): RouteWaypoint => ({
  lat: LAT0 + north / METERS_PER_DEGREE_LAT,
  lon: LON0 + east / M_PER_DEG_LON,
  height: 0,
  ...(halfWidth ? { corridorLeft: halfWidth[0], corridorRight: halfWidth[1] } : {}),
});
const local = (p: { lat: number; lon: number }): { e: number; n: number } => ({
  e: (p.lon - LON0) * M_PER_DEG_LON,
  n: (p.lat - LAT0) * METERS_PER_DEGREE_LAT,
});

/** 100 m north, then a turn of `deg` to the right and 100 m on; the corridor per segment */
function corner(deg: number, halfWidth?: [number, number]): RouteWaypoint[] {
  const a = deg * DEG_TO_RAD;
  return [at(0, 0, halfWidth), at(0, 100, halfWidth), at(Math.sin(a) * 100, 100 + Math.cos(a) * 100, halfWidth)];
}

/** Place a segment `distance` m along `path` on the worm's curve; where it stands and faces. */
function placed(path: RouteWaypoint[], distance: number, lateral = 0): { e: number; n: number; heading: number } {
  const object = new TestGameObject();
  const movement = new MovementComponent(object);
  const transform = object.getComponent<TransformComponent>(ComponentType.TRANSFORM)!;
  movement.setPath(path);
  movement.seekDistance(distance);
  wormPathOf(path).place(movement, transform, distance, lateral, lateral, lateral, 1.25);
  return { ...local(transform.position), heading: transform.rotation };
}

describe('WormPath', () => {
  const room = lateralLimit(corridorConfig.defaultHalfWidth);

  it('rounds a 90 degree corner as far as the room on the inside allows', () => {
    // The deepest point of the arc, radius * (1 - cos 45), at the lateral limit
    expect(wormPathOf(corner(90)).radiusAt(1)).toBeCloseTo(room / (1 - Math.cos(Math.PI / 4)), 9);
  });

  it('rounds a flat corner with the full radius', () => {
    expect(wormPathOf(corner(30)).radiusAt(1)).toBeCloseTo(WORM_BEND_RADIUS_M, 9);
  });

  it('leaves a corner sharp where the inside has no room, whatever the outside has', () => {
    // A right turn: the inside is on the right. 1.5 m of half width is no room past the edge margin.
    expect(wormPathOf(corner(90, [7, 1.5])).radiusAt(1)).toBe(0);
    expect(wormPathOf(corner(90, [1.5, 7])).radiusAt(1)).toBeGreaterThan(0);
  });

  it('shares a short segment between the arcs at either end', () => {
    // North, 6 m east, north again: two 90 degree turns 6 m apart
    const path = [at(0, 0), at(0, 100), at(6, 100), at(6, 200)];
    const bend = wormPathOf(path);
    const tangents = bend.radiusAt(1) + bend.radiusAt(2); // tan(45) = 1
    expect(tangents).toBeLessThanOrEqual(6 + 1e-9);
    expect(bend.radiusAt(1)).toBeCloseTo(3, 9);
  });

  it('runs on the centre line off the arc and joins it without a kink', () => {
    const path = corner(90);
    const radius = wormPathOf(path).radiusAt(1); // the tangent length too, at 90 degrees
    // Route distance is haversine: 100 m of these local metres are a little less
    const vertex = getRouteProfile(path).cumulativeLength[1];
    const perMetre = 100 / vertex;
    // Before the arc: on the leg, facing north
    const before = placed(path, vertex - (radius + 2) / perMetre);
    expect(before.e).toBeCloseTo(0, 6);
    expect(before.n).toBeCloseTo(100 - radius - 2, 6);
    expect(before.heading).toBeCloseTo(0, 6);
    // Through the arc in 1 cm steps: no jump in place or heading
    let last = placed(path, vertex - (radius + 1) / perMetre);
    for (let s = vertex - (radius + 1) / perMetre + 0.01; s < vertex + (radius + 1) / perMetre; s += 0.01) {
      const p = placed(path, s);
      expect(Math.hypot(p.e - last.e, p.n - last.n)).toBeLessThan(0.0101);
      expect(Math.abs(p.heading - last.heading)).toBeLessThan(0.01);
      last = p;
    }
    // After it: on the next leg, facing east (-PI/2, see TransformComponent.lookAt)
    const after = placed(path, vertex + (radius + 2) / perMetre);
    expect(after.n).toBeCloseTo(100, 6);
    expect(after.e).toBeCloseTo(radius + 2, 3);
    expect(after.heading).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('keeps sway to the inside of an arc within the room the arc leaves', () => {
    const path = corner(90);
    const radius = wormPathOf(path).radiusAt(1);
    // Apex, full factor to the inside (right) and to the outside (left)
    const apex = getRouteProfile(path).cumulativeLength[1];
    const inside = placed(path, apex, 1);
    const outside = placed(path, apex, -1);
    const centre = placed(path, apex);
    const offCorner = (p: { e: number; n: number }): number => Math.min(Math.abs(p.e), Math.abs(p.n - 100));
    // The apex on the centre curve is as deep inside as the room allows: nothing is left to sway into
    expect(100 - centre.n).toBeCloseTo(radius * (1 - Math.cos(Math.PI / 4)), 6);
    expect(Math.hypot(inside.e - centre.e, inside.n - centre.n)).toBeLessThan(1e-6);
    // To the outside it sways the full room
    expect(Math.hypot(outside.e - centre.e, outside.n - centre.n)).toBeCloseTo(room, 6);
    expect(offCorner(inside)).toBeLessThanOrEqual(room + 1e-6);
  });
});
