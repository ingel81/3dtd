import { Vector3 } from 'three';
import type { ThreeTilesEngine } from '../three-engine';
import type { GeoPosition } from '../models/game.types';

/**
 * Convert a cached enemy route (`GeoPosition[]` from `PathRouteService`) into
 * local Vector3 points, in absolute scene Y.
 *
 * Single source of truth for this conversion — used by the animated route
 * reveal (`RouteAnimationService`) and by scripted camera moves that follow
 * a route (`IntroCameraFlightService`).
 *
 * Height handling: cached route points carry a pre-computed `height`, stored
 * at route-build time as `terrainY + origin.height`, so the local scene Y is
 * recovered by subtracting the origin height again. This is preferred over a
 * live terrain raycast because the raycast can return null while tiles are
 * still streaming, which produces vertical spikes along the path.
 *
 * @param engine       Engine (for coordinate sync + terrain fallback)
 * @param path         Route as GeoPosition array
 * @param heightOffset Metres above ground the returned points should sit at
 */
export function routePathToLocalPoints(
  engine: ThreeTilesEngine,
  path: GeoPosition[],
  heightOffset: number,
): Vector3[] {
  const points: Vector3[] = [];
  const origin = engine.sync.getOrigin();

  for (const pos of path) {
    const local = engine.sync.geoToLocalSimple(pos.lat, pos.lon, 0);

    if (pos.height !== undefined && pos.height !== 0) {
      local.y = (pos.height - origin.height) + heightOffset;
    } else {
      // Fallback: live terrain sample
      const terrainY = engine.getTerrainHeightAtGeo(pos.lat, pos.lon);
      local.y = (terrainY ?? 0) + heightOffset;
    }

    points.push(local);
  }

  return points;
}
