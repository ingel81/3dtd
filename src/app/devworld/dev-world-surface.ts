import type { Raycaster, Vector3 } from 'three';
import type { ColumnHit, ColumnSample } from '../three-engine/column-sample';
import type { EllipsoidSync } from '../three-engine/ellipsoid-sync';
import { streetHeightAt, type StreetHeightGround } from '../three-engine/terrain-queries';
import { carriedY, type StreetApproach, type StreetSurface } from '../utils/carried-height';
import type { StationProbe } from '../utils/route-corridor';
import type { FootprintColumn } from '../utils/tower-footprint';
import type { WorldSurface } from '../world/world-provider';
import type { DevTerrainProvider } from './dev-terrain.provider';

/** A DevWorld column's LOD: no streaming, so the finest there is; the route grid never samples a cell again */
const DEV_WORLD_LOD = { depth: 99, geometricError: 0 } as const;

/**
 * The WorldSurface of DevWorld: every query answered by its procedural
 * terrain (DevTerrainProvider). Heights are the mesh surface, the columns
 * have no streaming LOD and nothing over the ground, the street corridor
 * keeps the drawn road width, line of sight and the tower's roof see the
 * buildings. The answers are those the engine's DevWorld branches gave.
 */
export class DevWorldSurface implements WorldSurface {
  /** DevWorld's ground never changes by loading; a regeneration clears the caches that hold it */
  readonly lodVersion = 0;

  private readonly streetGround: StreetHeightGround = {
    columnAtGeo: (lat, lon) => {
      const local = this.sync.geoToLocalSimple(lat, lon, 0);
      return this.sampleColumn(local.x, local.z);
    },
    carriedAtGeo: (approach) => this.carriedAtGeo(approach),
    getGroundHeightEstimate: (lat, lon) => this.getTerrainHeightAtGeo(lat, lon),
  };

  constructor(
    private readonly terrain: DevTerrainProvider,
    private readonly sync: EllipsoidSync,
  ) {}

  getTerrainHeightAtGeo(lat: number, lon: number): number | null {
    return this.terrain.getHeightAtGeo(lat, lon);
  }

  getStreetHeightEstimate(
    lat: number, lon: number,
    prevLat: number, prevLon: number,
    nextLat: number, nextLon: number,
    surface: StreetSurface | null,
  ): number | null {
    return streetHeightAt(this.streetGround, lat, lon, prevLat, prevLon, nextLat, nextLon, surface);
  }

  /** The procedural terrain has no trees or roofs beside a path to rule out: the height at the point */
  getGroundHeightEstimate(lat: number, lon: number): number | null {
    return this.getTerrainHeightAtGeo(lat, lon);
  }

  sampleColumn(localX: number, localZ: number): ColumnSample | null {
    const y = this.terrain.getHeightAtLocal(localX, localZ);
    if (y === null) return null;
    // DevWorld has no streaming LOD and no overhead clutter.
    return { groundY: y, topY: y, tileDepth: DEV_WORLD_LOD.depth, tileGeometricError: DEV_WORLD_LOD.geometricError };
  }

  raycastTerrainHeight(localX: number, localZ: number): number | null {
    return this.sampleColumn(localX, localZ)?.groundY ?? null;
  }

  raycastColumnSample(localX: number, localZ: number): ColumnSample | null {
    return this.sampleColumn(localX, localZ);
  }

  /** No tiles, no hits to tell apart */
  inspectColumn(): { hits: ColumnHit[]; fresh: ColumnSample | null; cached: ColumnSample | null } | null {
    return null;
  }

  /** The roads are drawn at the width the corridor already uses: nothing to measure */
  measureStreetClearance(): StationProbe | null {
    return null;
  }

  peekBestTileLODAtLocal(): { depth: number; geometricError: number } | null {
    return { depth: DEV_WORLD_LOD.depth, geometricError: DEV_WORLD_LOD.geometricError };
  }

  raycastLineOfSight(
    originX: number, originY: number, originZ: number,
    targetX: number, targetY: number, targetZ: number,
  ): boolean {
    return this.terrain.hasLineOfSightBlocked(originX, originY, originZ, targetX, targetY, targetZ);
  }

  pickRay(raycaster: Raycaster): Vector3 | null {
    return this.terrain.pickRay(raycaster);
  }

  /** The top of terrain and buildings straight down: a tower stands on the roof */
  roofAt(localX: number, localZ: number): number | null {
    return this.terrain.raycastDown(localX, localZ, 10000)?.y ?? null;
  }

  /** The same raycastDown as the cursor surface for the top, the terrain height for the ground */
  footprintColumn(localX: number, localZ: number): FootprintColumn | null {
    const top = this.terrain.raycastDown(localX, localZ, 10000);
    if (!top) return null;
    return { groundY: this.terrain.getHeightAtLocal(localX, localZ) ?? top.y, topY: top.y };
  }

  /** Nothing streams in DevWorld */
  markTileSetChanged(): void {
    // no tile set
  }

  clearHeightCache(): void {
    this.terrain.clearHeightCache();
  }

  /** The height carried at a street point on an approach (carriedY) */
  private carriedAtGeo(approach: StreetApproach): number | null {
    const path = approach.path.map((p) => {
      const local = this.sync.geoToLocalSimple(p.lat, p.lon, 0);
      return { x: local.x, z: local.z };
    });
    return carriedY({ path, m: approach.m, start: approach.start }, (x, z) => this.sampleColumn(x, z));
  }
}
