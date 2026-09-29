import type { ThreeTilesEngine } from '../../three-engine';
import type { GlobalRouteGridService } from '../../services/world/global-route-grid.service';
import type { GeoPosition, RouteWaypoint } from '../../models/game.types';
import type { SpawnPoint } from '../../managers/wave.manager';
import type { SimWorld } from '../protocol/messages';
import { worldKeyOf } from '../protocol/world-key';

/**
 * The finished world as the simulation gets it (docs/SIM_WORKER.md): what the
 * main thread built from the tiles, the corridor and the routes, frozen. The
 * simulation stands on it without a tile; the tiles are picture only from
 * here on. Null before the world stands (no origin yet).
 */
export function buildSimWorld(
  engine: ThreeTilesEngine,
  grid: GlobalRouteGridService,
  hq: GeoPosition,
  spawns: readonly SpawnPoint[],
  paths: ReadonlyMap<string, readonly RouteWaypoint[]>,
): SimWorld | null {
  const origin = engine.sync.getOrigin();
  if (!origin) return null;
  const spawnGround: Record<string, number | null> = {};
  for (const spawn of spawns) {
    // Where the grid has no cell under a spawn, the enemy's feet fall back to
    // the ground here (EnemyManager); the tiles answer once, on this thread
    const localY = engine.getTerrainHeightAtGeo(spawn.lat, spawn.lon);
    spawnGround[spawn.id] = localY === null ? null : localY + origin.height;
  }
  return {
    origin: { lat: origin.lat, lon: origin.lon, height: origin.height },
    hq: { ...hq },
    spawns: spawns.map((s) => ({ ...s })),
    paths: [...paths.entries()].map(([id, path]) => [id, path.map((p) => ({ ...p }))]),
    heights: grid.exportHeights(),
    worldKey: worldKeyOf(grid.snapshotHeights(), paths.values(), origin),
    spawnGround,
  };
}
