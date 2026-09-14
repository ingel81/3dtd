import { describe, it, expect, vi } from 'vitest';

vi.mock('three', async () => {
  const mod = await import('@/test/mocks/three.mock');
  return { ...mod };
});

import { GameObject } from '../../core/game-object';
import { ComponentType } from '../../core/component';
import { MovementComponent } from '../../game-components/movement.component';
import { TransformComponent } from '../../game-components/transform.component';
import { ENEMY_TYPES, WORM_MAX_SEGMENTS } from '../../configs/enemy-types.config';
import type { RouteWaypoint } from '../../models/game.types';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT } from '../../utils/geo-utils';
import { wormSway } from './worm-group';
import { wormPathOf } from './worm-path';

/**
 * What placing the rings on the worm's curve (WormPath.place) costs per
 * ring and sub-step, against what a ring cost before: MovementComponent.
 * advance() to its distance with the lateral offset and heading, plus the
 * heading lerp EnemyManager ran while it turned. Both with the sway the
 * chain computes. A measurement, not a test: skipped unless
 * WORM_PATH_PERF=1, then it prints a table.
 *
 *   $env:WORM_PATH_PERF=1; npx vitest run src/app/managers/worm/worm-path.perf.spec.ts
 *
 * The route: 900 m in 50 m legs turning 60 degrees left and right in turn,
 * so a good share of the rings is on an arc; a longest worm on it.
 */

const chain = ENEMY_TYPES['worm'].chain!;
const STEP_MS = 16.667;
const STEP_M = ENEMY_TYPES['worm'].baseSpeed * STEP_MS / 1000;
const RINGS = WORM_MAX_SEGMENTS;
const STEPS = 3000;

class Ring extends GameObject {
  readonly movement: MovementComponent;
  readonly transform: TransformComponent;
  constructor(path: RouteWaypoint[]) {
    super('enemy');
    this.transform = new TransformComponent(this);
    this.addComponent(this.transform, ComponentType.TRANSFORM);
    this.movement = new MovementComponent(this);
    this.movement.setPath(path);
  }
}

function zigzag(): RouteWaypoint[] {
  const lat0 = 48.776;
  const mPerDegLon = METERS_PER_DEGREE_LAT * Math.cos(lat0 * DEG_TO_RAD);
  const points: RouteWaypoint[] = [{ lat: lat0, lon: 9.183, height: 0 }];
  let e = 0;
  let n = 0;
  for (let leg = 0; leg < 18; leg++) {
    const heading = (leg % 2 === 0 ? 30 : -30) * DEG_TO_RAD;
    e += Math.sin(heading) * 50;
    n += Math.cos(heading) * 50;
    points.push({ lat: lat0 + n / METERS_PER_DEGREE_LAT, lon: 9.183 + e / mPerDegLon, height: 0 });
  }
  return points;
}

/** Time `steps` sub-steps of all rings, the front starting at `front`; ns per ring and step. */
function time(rings: Ring[], front: number, step: (ring: Ring, distance: number) => void): number {
  const t0 = performance.now();
  for (let k = 0; k < STEPS; k++) {
    front += STEP_M;
    for (let slot = 0; slot < rings.length; slot++) step(rings[slot], front - slot * chain.spacing);
  }
  return ((performance.now() - t0) * 1e6) / (STEPS * rings.length);
}

describe.skipIf(process.env['WORM_PATH_PERF'] !== '1')('worm ring placement cost (measurement)', () => {
  it('prints ns per ring and sub-step, before and now', () => {
    const path = zigzag();
    const bend = wormPathOf(path);
    const half = chain.spacing / 2;
    const start = RINGS * chain.spacing + 10;
    const make = (): Ring[] => Array.from({ length: RINGS }, (_, slot) => {
      const ring = new Ring(path);
      ring.movement.seekDistance(start - slot * chain.spacing);
      return ring;
    });

    const before = (ring: Ring, distance: number): void => {
      ring.movement.setLateralFactor(wormSway(chain, distance));
      ring.movement.advance(distance - ring.movement.getDistanceAlongPath());
      ring.transform.update(STEP_MS);
    };
    const now = (ring: Ring, distance: number): void => {
      const lateral = wormSway(chain, distance);
      ring.movement.setLateralFactor(lateral);
      ring.movement.seekDistance(distance);
      bend.place(ring.movement, ring.transform, distance, lateral,
        wormSway(chain, distance - half), wormSway(chain, distance + half), half);
    };

    const rows: Record<string, number>[] = [];
    for (let round = 0; round < 3; round++) {
      const a = time(make(), start, before);
      const b = time(make(), start, now);
      rows.push({
        'before ns/ring': Math.round(a),
        'now ns/ring': Math.round(b),
        [`before us/step (${RINGS} rings)`]: Math.round((a * RINGS) / 100) / 10,
        [`now us/step (${RINGS} rings)`]: Math.round((b * RINGS) / 100) / 10,
      });
    }
    console.log(`route ${path.length} waypoints, ${STEPS} sub-steps per round, front from ${start} m`);
    console.table(rows);
    expect(rows.length).toBe(3);
  });
});
