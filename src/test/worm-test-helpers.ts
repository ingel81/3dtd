// Shared worm-spec fixtures, used by worm-arrows.scenario.spec.ts,
// worm-chains.spec.ts, worm-wave.scenario.spec.ts and boss-bar.scenario.spec.ts.
// Not app code: import only from specs.

import { METERS_PER_DEGREE_LAT } from '../app/utils/geo-utils';
import type { GeoPosition } from '../app/models/game.types';
import type { Enemy } from '../app/entities/enemy.entity';
import type { WormGroup } from '../app/managers/worm/worm-group';

/** Straight route north from (48.776, 9.183), a waypoint every 50 m. */
function buildStraightNorthPath(meters: number): GeoPosition[] {
  const points: GeoPosition[] = [];
  for (let m = 0; m < meters; m += 50) {
    points.push({ lat: 48.776 + m / METERS_PER_DEGREE_LAT, lon: 9.183, height: 300 });
  }
  points.push({ lat: 48.776 + meters / METERS_PER_DEGREE_LAT, lon: 9.183, height: 300 });
  return points;
}

/** worm-arrows.scenario.spec.ts and worm-chains.spec.ts call it straightPath. */
export const straightPath = buildStraightNorthPath;
/** boss-bar.scenario.spec.ts and worm-wave.scenario.spec.ts call the same path northPath. */
export const northPath = buildStraightNorthPath;

export const distance = (e: Enemy): number => e.movement.getDistanceAlongPath();

export const out = (group: WormGroup): Enemy[] => group.segments.filter((e): e is Enemy => e !== null);
