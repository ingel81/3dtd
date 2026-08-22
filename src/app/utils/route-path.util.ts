import { Vector3 } from 'three';
import type { ThreeTilesEngine } from '../three-engine';
import type { GeoPosition } from '../models/game.types';

/**
 * Convert a cached enemy route (`GeoPosition[]` from `PathRouteService`) into
 * local Vector3 points.
 *
 * Single source of truth for this conversion — used by the animated route
 * reveal (`RouteAnimationService`) and by scripted camera moves that follow
 * a route (`IntroCameraFlightService`).
 *
 * Height handling: cached route points carry a pre-computed `height` that was
 * stored at route-build time as
 *   `geoHeight = (localY - heightOffset + originTerrainY) + origin.height`
 * so the local Y is recovered by inverting that. This is preferred over a live
 * terrain raycast because the raycast can return null while tiles are still
 * streaming, which produces vertical spikes along the path.
 *
 * CAUTION — the returned Y is in **overlay space**, not scene space. It has
 * `originTerrainY` subtracted and is only correct once added to the shifted
 * `overlayGroup` (which is where the route line lives). Scene-space consumers
 * — anything positioning a camera or raycasting against the tiles — must use
 * X/Z from here and take altitudes from their own raycasts; the two spaces
 * differ by the terrain base, typically ~165 m.
 *
 * @param engine        Engine (for coordinate sync + terrain fallback)
 * @param path          Route as GeoPosition array
 * @param originTerrainY Terrain Y at the origin, captured at route-build time
 * @param heightOffset  Metres above ground the returned points should sit at
 */
export function routePathToLocalPoints(
  engine: ThreeTilesEngine,
  path: GeoPosition[],
  originTerrainY: number,
  heightOffset: number,
): Vector3[] {
  const points: Vector3[] = [];
  const origin = engine.sync.getOrigin();

  for (const pos of path) {
    const local = engine.sync.geoToLocalSimple(pos.lat, pos.lon, 0);

    if (pos.height !== undefined && pos.height !== 0) {
      local.y = (pos.height - origin.height) - originTerrainY + heightOffset;
    } else {
      // Fallback: live terrain sample
      const terrainY = engine.getTerrainHeightAtGeo(pos.lat, pos.lon);
      local.y = terrainY !== null ? terrainY - originTerrainY + heightOffset : heightOffset;
    }

    points.push(local);
  }

  return points;
}
