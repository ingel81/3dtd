/**
 * DPS Profile - Spatial defense analysis along the enemy path
 *
 * Computes a 20-bin DPS profile representing how much firepower
 * covers each section of the path. Used by the AI to understand
 * spatial defense distribution (gaps, clusters, coverage).
 */

import { GeoPosition } from '../../models/game.types';
import { Tower } from '../../entities/tower.entity';
import { TowerTypeId } from '../../configs/tower-types.config';
import { GlobalRouteGrid } from '../../utils/global-route-grid';
import { CoordinateSync } from '../../three-engine/renderers';
import { computeTowerDPS, canTargetAirEffective } from './tower-dps.util';

export interface PathDPSProfile {
  /** Ground DPS at each bin, normalized 0-1 */
  groundDPS: number[];
  /** Air DPS at each bin, normalized 0-1 */
  airDPS: number[];
  /** Geo positions of bin centers (for visualization) */
  binPositions: GeoPosition[];
}

/** Number of bins along the path */
export const NUM_BINS = 20;

/** Max DPS per bin for normalization (clamped) */
const MAX_DPS_PER_BIN = 500;

/**
 * Compute the DPS profile along the enemy path.
 *
 * Algorithm:
 * 1. Merge all routes, compute cumulative length
 * 2. Sample 20 equidistant points along the path
 * 3. For each point, query the GlobalRouteGrid for visible towers
 * 4. Sum ground/air DPS from visible towers
 * 5. Normalize to 0-1 range
 */
export function computePathDPSProfile(
  routes: GeoPosition[][],
  grid: GlobalRouteGrid,
  towers: Tower[],
  coordinateSync: CoordinateSync,
  airTargetingUnlocked: boolean,
): PathDPSProfile {
  const emptyProfile: PathDPSProfile = {
    groundDPS: new Array(NUM_BINS).fill(0),
    airDPS: new Array(NUM_BINS).fill(0),
    binPositions: [],
  };

  if (!routes.length || !towers.length) {
    return emptyProfile;
  }

  // Use the longest route (primary path)
  const path = routes.reduce((longest, r) => r.length > longest.length ? r : longest, routes[0]);
  if (path.length < 2) return emptyProfile;

  // Build tower lookup by ID for fast access
  const towerMap = new Map<string, Tower>();
  for (const tower of towers) {
    towerMap.set(tower.id, tower);
  }

  // Convert path to local coordinates and compute cumulative distances
  const localPoints: { x: number; z: number; geo: GeoPosition }[] = [];
  for (const point of path) {
    const local = coordinateSync.geoToLocalSimple(point.lat, point.lon, point.height ?? 0);
    localPoints.push({ x: local.x, z: local.z, geo: point });
  }

  // Compute cumulative segment lengths
  const cumulativeDistances: number[] = [0];
  for (let i = 1; i < localPoints.length; i++) {
    const dx = localPoints[i].x - localPoints[i - 1].x;
    const dz = localPoints[i].z - localPoints[i - 1].z;
    const segLen = Math.sqrt(dx * dx + dz * dz);
    cumulativeDistances.push(cumulativeDistances[i - 1] + segLen);
  }

  const totalLength = cumulativeDistances[cumulativeDistances.length - 1];
  if (totalLength < 1) return emptyProfile;

  // Sample NUM_BINS equidistant points along the path
  const groundDPS: number[] = [];
  const airDPS: number[] = [];
  const binPositions: GeoPosition[] = [];

  for (let bin = 0; bin < NUM_BINS; bin++) {
    // Sample at bin center (not edge)
    const targetDist = ((bin + 0.5) / NUM_BINS) * totalLength;

    // Find segment containing this distance
    let segIdx = 0;
    for (let i = 1; i < cumulativeDistances.length; i++) {
      if (cumulativeDistances[i] >= targetDist) {
        segIdx = i - 1;
        break;
      }
      segIdx = i - 1;
    }

    // Interpolate position within segment
    const segStart = cumulativeDistances[segIdx];
    const segEnd = cumulativeDistances[segIdx + 1] ?? segStart;
    const segLength = segEnd - segStart;
    const t = segLength > 0 ? (targetDist - segStart) / segLength : 0;

    const p0 = localPoints[segIdx];
    const p1 = localPoints[segIdx + 1] ?? p0;
    const sampleX = p0.x + (p1.x - p0.x) * t;
    const sampleZ = p0.z + (p1.z - p0.z) * t;

    // Interpolate geo position for visualization
    const geoLat = p0.geo.lat + (p1.geo.lat - p0.geo.lat) * t;
    const geoLon = p0.geo.lon + (p1.geo.lon - p0.geo.lon) * t;
    binPositions.push({ lat: geoLat, lon: geoLon });

    // Query grid cell at this position
    const cell = grid.getCellAt(sampleX, sampleZ);

    let binGroundDPS = 0;
    let binAirDPS = 0;

    if (cell) {
      // Iterate tower visibility for this cell
      for (const [towerId, visible] of cell.towerVisibility) {
        if (!visible) continue;

        const tower = towerMap.get(towerId);
        if (!tower) continue;

        const dps = computeTowerDPS(tower);
        const typeId = tower.typeConfig.id as TowerTypeId;
        const canGround = tower.typeConfig.canTargetGround ?? true;
        const canAir = canTargetAirEffective(typeId, airTargetingUnlocked);

        if (canGround) binGroundDPS += dps;
        if (canAir) binAirDPS += dps;
      }
    }

    groundDPS.push(Math.min(1, binGroundDPS / MAX_DPS_PER_BIN));
    airDPS.push(Math.min(1, binAirDPS / MAX_DPS_PER_BIN));
  }

  return { groundDPS, airDPS, binPositions };
}

/**
 * Create an empty DPS profile (no towers / no path)
 */
export function createEmptyDPSProfile(): PathDPSProfile {
  return {
    groundDPS: new Array(NUM_BINS).fill(0),
    airDPS: new Array(NUM_BINS).fill(0),
    binPositions: [],
  };
}
