import { Box3, Raycaster, Vector3, type Intersection, type Object3D } from 'three';
import type { TilesRenderer } from '3d-tiles-renderer';
import { METERS_PER_DEGREE_LAT, DEG_TO_RAD } from '../utils/geo-utils';
import { StationProbe, corridorConfig } from '../utils/route-corridor';
import { raycastStats } from '../utils/raycast-stats';
import type { TerrainProvider } from '../interfaces/terrain-provider.interface';
import type { EllipsoidSync } from './ellipsoid-sync';
import { ColumnHit, ColumnSample, isBetterLod, selectColumnSample } from './column-sample';

/** Shape of a 3D-Tiles tile as far as the tile-info map needs it. */
interface ActiveTile {
  geometricError?: number;
  internal?: { depth?: number };
  engineData?: { scene?: Object3D | null } | null;
}

/** Straight down, the terrain probe is always vertical. */
const COLUMN_RAY_DIRECTION = new Vector3(0, -1, 0);

/**
 * How far along the route a clearance station moves its column when the
 * column under it finds no tile, ahead first: a seam between two tile
 * meshes is far thinner than that. One column cache bucket, so each shift
 * is a column of its own.
 */
const SEAM_SHIFTS_M = [0.5, -0.5] as const;

/** Column cache granularity: 2 buckets per metre (0.5 m grid). */
const COLUMN_CACHE_SCALE = 2;

/** Quantised column key, 0.5 m grid, Szudzik pairing (negatives safe). */
export function columnCacheKey(localX: number, localZ: number): number {
  const xi = Math.round(localX * COLUMN_CACHE_SCALE);
  const zi = Math.round(localZ * COLUMN_CACHE_SCALE);
  const a = xi >= 0 ? 2 * xi : -2 * xi - 1;
  const b = zi >= 0 ? 2 * zi : -2 * zi - 1;
  return a >= b ? a * a + a + b : b * b + a;
}

/** Woher die Abfragen ihren Boden nehmen. Beide Quellen setzt der Engine erst nach dem Konstruktor. */
export interface TerrainSources {
  /** Die 3D-Tiles; null vor initialize(), nach dispose() und in DevWorld. */
  tiles(): TilesRenderer | null;
  /** Das prozedurale DevWorld-Gelände; null auf den 3D-Tiles. */
  devTerrain(): TerrainProvider | null;
}

/**
 * TerrainQueries: die Raycasts des Engines gegen Boden und Tiles, ohne das Screen-Picking.
 *
 * Vorher inline in `three-tiles-engine.ts`. Enthält:
 * - die Säulen-Probe `sampleColumn()` mit ihrem Cache pro 0,5-m-Säule und der `lodVersion`,
 *   die ihn Eintrag für Eintrag invalidiert, dazu die Leser `getTerrainHeightAtGeo()`,
 *   `getGroundHeightEstimate()` und `raycastTerrainHeight()`
 * - `peekBestTileLODAtLocal()`, die LOD-Probe ohne Raycast, mit ihrem Bounds-Cache
 * - `measureStreetClearance()` für den Routen-Korridor
 * - `raycastLineOfSight()` für die Tower
 *
 * Jede Abfrage bucht ihre Strahlen unter demselben Aufrufer wie zuvor im Engine
 * (`__raycastStats()`). In DevWorld beantwortet der DevTerrainProvider die Abfragen.
 *
 * Vom Engine besessen, als `engine.terrain` erreichbar. Der Engine ruft
 * `markTileSetChanged()` nach jedem beruhigten tiles-load-end und `clearHeightCache()`
 * aus `setOrigin()`.
 */
export class TerrainQueries {
  /**
   * Lazy cache of per-tile horizontal AABB (min/max x,z). Built on demand
   * by `peekBestTileLODAtLocal` and cached for the lifetime of each tile
   * scene, tile geometry is immutable once loaded, so the AABB never
   * changes until the scene unloads. WeakMap keys die with their scene,
   * so no manual eviction needed.
   */
  private tileBoundsCache = new WeakMap<Object3D, { minX: number; maxX: number; minZ: number; maxZ: number }>();

  /** Tiles-group position the cached AABBs were taken at. */
  private readonly boundsCacheGroupPos = new Vector3(NaN, NaN, NaN);

  /**
   * Column samples keyed by quantised local (x,z), each stamped with the
   * {@link lodVersion} it was taken at. Replaces the old lat/lon height cache
   * and its all-or-nothing clear.
   */
  private columnCache = new Map<number, { sample: ColumnSample; lodVersion: number }>();

  /**
   * Raycaster reserved for terrain columns. Separate from `losRaycaster`
   * because LOS checks set `far` to their segment length and screen picking
   * sets its own origin, sharing one instance made the effective range
   * depend on whatever ran last.
   */
  private readonly terrainRaycaster = new Raycaster();
  private readonly _columnRayOrigin = new Vector3();
  private readonly _columnResults: Intersection[] = [];
  private readonly _columnHits: ColumnHit[] = [];

  /** Raycaster for the horizontal street clearance probe, see measureStreetClearance. */
  private readonly clearanceRaycaster = new Raycaster();
  private readonly _clearanceOrigin = new Vector3();
  private readonly _clearanceDirection = new Vector3();
  private readonly _clearanceResults: Intersection[] = [];

  /** Raycaster of the line-of-sight checks, see raycastLineOfSight. */
  private readonly losRaycaster = new Raycaster();
  // Reused buffers for hot-path raycasts (called hundreds of times per LOS preview frame)
  private readonly _losOrigin = new Vector3();
  private readonly _losDirection = new Vector3();
  private readonly _losResults: Intersection[] = [];

  /**
   * Monotonic counter of loaded-tile-set changes. Every cached column sample
   * records the version it was taken at; a newer version means "re-verify",
   * which replaces the old all-or-nothing `heightCache.clear()`.
   */
  private _lodVersion = 0;

  constructor(
    private readonly sync: EllipsoidSync,
    private readonly sources: TerrainSources,
  ) {}

  /** Changes of the loaded tile set so far, see markTileSetChanged(). */
  get lodVersion(): number {
    return this._lodVersion;
  }

  /**
   * Get terrain height at geographic coordinates using LOCAL coordinate raycast.
   * Uses cache to avoid expensive raycasts for the same positions.
   *
   * With ReorientationPlugin (recenter: true):
   * - Tiles are centered at local origin (0,0,0) - NOT in ECEF!
   * - tiles.group.rotation.x = -PI/2 converts Z-up to Y-up
   * - We raycast from high above (Y=10000) straight down (0,-1,0)
   * - geoToLocalSimple() gives local offsets in the same coordinate system
   *
   * @param lat - Latitude in degrees
   * @param lon - Longitude in degrees
   * @returns Height in local Y coordinates, or null if no hit
   */
  getTerrainHeightAtGeo(lat: number, lon: number): number | null {
    // DevWorld: delegate to provider
    const devTerrain = this.sources.devTerrain();
    if (devTerrain) {
      return devTerrain.getHeightAtGeo(lat, lon);
    }

    // Caching happens per column in `sampleColumn`, keyed on local (x,z):
    // one keyspace for the whole engine instead of a second lat/lon one.
    const localPos = this.sync.geoToLocalSimple(lat, lon, 0);
    const scope = raycastStats.enter('heightAtGeo');
    try {
      return this.sampleColumn(localPos.x, localPos.z)?.groundY ?? null;
    } finally {
      raycastStats.exit(scope);
    }
  }

  /**
   * Estimate ground height by sampling center + lateral points perpendicular to path direction.
   * Detects obstacles (trees, buildings) by comparing center height with lateral samples.
   *
   * If center is significantly higher than the lateral minimum, the raycast likely hit
   * a tree canopy or building roof. In that case, returns the lateral minimum as ground estimate.
   *
   * Preserves bridges: bridge decks are wide enough (6-12m+) that lateral samples at ±3m/±6m
   * still hit the bridge surface, so center ≈ lateral → no correction applied.
   *
   * @param lat - Latitude of the path point
   * @param lon - Longitude of the path point
   * @param prevLat - Latitude of the previous path point (for direction)
   * @param prevLon - Longitude of the previous path point
   * @param nextLat - Latitude of the next path point (for direction)
   * @param nextLon - Longitude of the next path point
   * @returns Estimated ground height, or null if no hit
   */
  getGroundHeightEstimate(
    lat: number, lon: number,
    prevLat: number, prevLon: number,
    nextLat: number, nextLon: number
  ): number | null {
    const centerHeight = this.getTerrainHeightAtGeo(lat, lon);
    if (centerHeight === null) return null;

    // DevWorld uses procedural terrain without tree/building issues
    if (this.sources.devTerrain()) return centerHeight;

    // Calculate path direction vector (in degrees)
    const dLat = nextLat - prevLat;
    const dLon = nextLon - prevLon;
    const len = Math.sqrt(dLat * dLat + dLon * dLon);

    // If no direction available (single point), return center height
    if (len < 1e-10) return centerHeight;

    // Perpendicular direction (rotate 90°): swap and negate one component
    const perpLat = -dLon / len;
    const perpLon = dLat / len;

    // Convert meter offsets to degree offsets
    const METERS_TO_DEG_LAT = 1 / METERS_PER_DEGREE_LAT;
    const cosLat = Math.cos(lat * DEG_TO_RAD);

    // Sample at ±3m and ±6m perpendicular to path
    const OFFSETS_M = [3, 6];
    // If center is this much higher than lateral minimum, it's an obstacle (tree/building)
    const OBSTACLE_THRESHOLD = 3;

    let minLateralHeight = centerHeight;
    let lateralSampleCount = 0;

    for (const offsetM of OFFSETS_M) {
      const offsetLat = perpLat * offsetM * METERS_TO_DEG_LAT;
      const offsetLon = perpLon * offsetM * METERS_TO_DEG_LAT / cosLat;

      // Left side of path
      const leftH = this.getTerrainHeightAtGeo(lat + offsetLat, lon + offsetLon);
      if (leftH !== null) {
        minLateralHeight = Math.min(minLateralHeight, leftH);
        lateralSampleCount++;
      }

      // Right side of path
      const rightH = this.getTerrainHeightAtGeo(lat - offsetLat, lon - offsetLon);
      if (rightH !== null) {
        minLateralHeight = Math.min(minLateralHeight, rightH);
        lateralSampleCount++;
      }
    }

    // If lateral samples exist and center is significantly higher → obstacle detected
    if (lateralSampleCount > 0 && (centerHeight - minLateralHeight) > OBSTACLE_THRESHOLD) {
      return minLateralHeight;
    }

    return centerHeight;
  }

  /**
   * The one vertical terrain probe. Everything that needs to know how high
   * the ground is goes through here.
   *
   * Casts a single top-down ray, resolves each hit to its tile's LOD, and
   * hands the set to {@link selectColumnSample}, which keeps only the finest
   * LOD present and reads ground and top off that. See that function for why
   * the finest-LOD filter is the whole point.
   *
   * Results are cached per 0.5 m column and invalidated per entry via
   * {@link lodVersion}, a stale entry is only re-raycast when the peek says
   * better tile data actually exists, otherwise it is just re-stamped.
   *
   * @returns null if nothing usable was hit; the cache is left untouched so
   *   callers keep whatever value they already had.
   */
  sampleColumn(localX: number, localZ: number): ColumnSample | null {
    const devTerrain = this.sources.devTerrain();
    if (devTerrain) {
      const y = devTerrain.getHeightAtLocal(localX, localZ);
      if (y === null) return null;
      // DevWorld has no streaming LOD and no overhead clutter.
      return { groundY: y, topY: y, tileDepth: 99, tileGeometricError: 0 };
    }

    const key = columnCacheKey(localX, localZ);
    const entry = this.columnCache.get(key);
    if (entry) {
      if (entry.lodVersion === this._lodVersion) return entry.sample;
      // Tile set changed. Only pay for a ray if finer data is actually there.
      const peek = this.peekBestTileLODAtLocal(localX, localZ);
      if (peek && !isBetterLod(peek, entry.sample)) {
        entry.lodVersion = this._lodVersion;
        return entry.sample;
      }
    }

    const sample = this.raycastColumn(localX, localZ);
    if (sample === null) return null;

    this.columnCache.set(key, { sample, lodVersion: this._lodVersion });
    return sample;
  }

  /** Uncached ray + LOD resolution behind {@link sampleColumn}. */
  private raycastColumn(localX: number, localZ: number): ColumnSample | null {
    // The ray only ever hits active tiles.
    const tiles = this.sources.tiles();
    if (!tiles || tiles.activeTiles.size === 0) return null;

    this._columnRayOrigin.set(localX, 10000, localZ);
    this.terrainRaycaster.set(this._columnRayOrigin, COLUMN_RAY_DIRECTION);
    this.terrainRaycaster.far = 20000;

    this._columnResults.length = 0;
    this.terrainRaycaster.intersectObject(tiles.group, true, this._columnResults);
    if (this._columnResults.length === 0) return null;

    this._columnHits.length = 0;
    for (const r of this._columnResults) {
      // Every object in a tile's scene carries its tile. Hits always come from
      // tilesRenderer.raycast, so this is always a tile mesh.
      const tile = r.object.userData['tile'] as ActiveTile | undefined;
      this._columnHits.push({
        y: r.point.y,
        depth: tile?.internal?.depth ?? 0,
        geometricError: tile?.geometricError ?? Infinity,
      });
    }

    return selectColumnSample(this._columnHits);
  }

  /**
   * Free space either side of a point on a street, for fitting the route
   * corridor to the street the tiles show. Casts a horizontal ray to each
   * side at every height in `heightsAboveGround`, over the column's ground
   * (over its top `onDeck`, for a bridge). Only what blocks the rays at all
   * heights counts as a wall (a facade, a wall, a trunk), so the free space
   * on a side is the farthest of the first hits: a parked van stops the
   * low ray, an eave or a tree crown the high one, neither the corridor.
   * Capped at `maxDistance`. `acrossX, acrossZ` points to the right of the
   * direction of travel.
   *
   * Only tiles up to `corridorConfig.maxTileError` count, for the column
   * and for the hits, so a coarse hull still waiting for its children
   * neither places the rays nor blocks them. A station without such a tile
   * comes back unmeasured, with the reason (`StationProbe.unmeasured`).
   *
   * A column that finds no tile at all may stand on a seam between two
   * tile meshes. The station then tries the columns half a metre ahead and
   * behind along the route (SEAM_SHIFTS_M) and measures from the first that
   * finds one (`StationProbe.shiftM`): at most two more column rays, only
   * for such a station.
   *
   * @returns the first hit per height and side (probeFreeSpace makes the
   *   free space of it), or null where there is nothing to measure: in
   *   DevWorld (its roads are drawn at the width the corridor already uses).
   */
  measureStreetClearance(
    localX: number,
    localZ: number,
    acrossX: number,
    acrossZ: number,
    heightsAboveGround: readonly number[],
    maxDistance: number,
    onDeck = false,
  ): StationProbe | null {
    const tiles = this.sources.tiles();
    if (this.sources.devTerrain() || !tiles) return null;
    // The column under the station and all side rays count as the corridor's.
    const scope = raycastStats.enter('routeCorridor');
    try {
      const len = Math.hypot(acrossX, acrossZ);
      let x = localX;
      let z = localZ;
      let shiftM: number | null = null;
      let column = this.sampleColumn(x, z);
      if (!column && len > 0) {
        for (const shift of SEAM_SHIFTS_M) {
          // (acrossZ, -acrossX) is the direction of travel: across points to its right.
          x = localX + (acrossZ / len) * shift;
          z = localZ - (acrossX / len) * shift;
          column = this.sampleColumn(x, z);
          if (column) {
            shiftM = shift;
            break;
          }
        }
      }
      const shifted = shiftM === null ? {} : { shiftM };
      if (!column) return { unmeasured: 'no tile', tileError: Infinity, left: [], right: [] };
      if (column.tileGeometricError > corridorConfig.maxTileError) {
        return { unmeasured: 'coarse tile', tileError: column.tileGeometricError, left: [], right: [], ...shifted };
      }
      if (len === 0) return null;

      const surfaceY = onDeck ? column.topY : column.groundY;
      const left: number[] = [];
      const right: number[] = [];
      for (const height of heightsAboveGround) {
        this._clearanceOrigin.set(x, surfaceY + height, z);
        left.push(this.clearanceRay(tiles.group, -acrossX / len, -acrossZ / len, maxDistance));
        right.push(this.clearanceRay(tiles.group, acrossX / len, acrossZ / len, maxDistance));
      }
      return { unmeasured: null, tileError: column.tileGeometricError, left, right, ...shifted };
    } finally {
      raycastStats.exit(scope);
    }
  }

  /**
   * Distance from `_clearanceOrigin` along the horizontal unit direction
   * (dirX, dirZ) to the first fine tile surface, `maxDistance` if there is
   * none that close.
   */
  private clearanceRay(group: Object3D, dirX: number, dirZ: number, maxDistance: number): number {
    this._clearanceDirection.set(dirX, 0, dirZ);
    this.clearanceRaycaster.set(this._clearanceOrigin, this._clearanceDirection);
    this.clearanceRaycaster.far = maxDistance;
    this._clearanceResults.length = 0;
    this.clearanceRaycaster.intersectObject(group, true, this._clearanceResults);
    // Sorted by distance: the first fine hit is the nearest one.
    for (const r of this._clearanceResults) {
      const tile = r.object.userData['tile'] as ActiveTile | undefined;
      if ((tile?.internal?.depth ?? 0) === 0) continue;
      if ((tile?.geometricError ?? Infinity) > corridorConfig.maxTileError) continue;
      return Math.min(maxDistance, r.distance);
    }
    return maxDistance;
  }

  /**
   * Ground height at a local position. Thin read of {@link sampleColumn},
   * the rays it casts are booked on `caller` (raycastStats).
   */
  raycastTerrainHeight(localX: number, localZ: number, caller: string): number | null {
    const scope = raycastStats.enter(caller);
    try {
      return this.sampleColumn(localX, localZ)?.groundY ?? null;
    } finally {
      raycastStats.exit(scope);
    }
  }

  /**
   * Called on every settled tile-load-end. Bumps {@link lodVersion}, which
   * invalidates cached column samples one entry at a time instead of by a
   * global cache wipe, and drops the lazily computed tile AABBs.
   */
  markTileSetChanged(): void {
    this.tileBoundsCache = new WeakMap();
    this._lodVersion++;
  }

  /**
   * Tile-LOD peek WITHOUT raycast. Walks the active tiles and returns the best
   * (deepest / lowest geometricError) tile whose horizontal AABB contains the
   * local (x,z). Used by the route-grid to skip stable cells whose Tile-LOD
   * hasn't improved since the last sample, eliminates the per-cell raycast
   * cost in the post-tile-load full-sweep.
   *
   * Reads `activeTiles`, NOT `forEachLoadedModel`: the latter also yields
   * LRU-cached tiles that are loaded but not part of the current refinement,
   * and those are invisible to the raycast (`TilesRenderer.raycast` walks the
   * active traversal only). Reporting their LOD made the peek promise a
   * quality the ray could never deliver.
   *
   * Returns `null` when no active tile horizontally contains (x,z).
   *
   * Cost: O(active tiles). AABB computed lazily on first touch per scene and
   * cached in `tileBoundsCache` until the next tile-set change.
   */
  peekBestTileLODAtLocal(localX: number, localZ: number): { depth: number; geometricError: number } | null {
    if (this.sources.devTerrain()) {
      // DevWorld has no streaming LOD, synthetic high quality so the
      // route-grid never re-raycasts stable cells in dev mode.
      return { depth: 99, geometricError: 0 };
    }
    const tiles = this.sources.tiles();
    if (!tiles) return null;

    // Bounds are world-space, so they are only valid while the tiles group
    // sits where it did when they were taken. The group moves when the root
    // tileset loads and on every origin change; without this check the cache
    // would quietly answer for the wrong patch of ground.
    if (!tiles.group.position.equals(this.boundsCacheGroupPos)) {
      this.tileBoundsCache = new WeakMap();
      this.boundsCacheGroupPos.copy(tiles.group.position);
    }

    let bestDepth = -1;
    let bestErr = Infinity;
    let any = false;
    for (const tile of tiles.activeTiles as Set<ActiveTile>) {
      const scene = tile.engineData?.scene;
      if (!scene) continue;
      let bounds = this.tileBoundsCache.get(scene);
      if (!bounds) {
        // `setFromObject` reads matrixWorld. Touching a scene before the
        // renderer has updated it bakes an AABB around an identity
        // transform, permanently wrong, since the WeakMap has no eviction
        // short of the scene unloading.
        scene.updateWorldMatrix(true, true);
        const box = new Box3().setFromObject(scene);
        if (box.isEmpty()) continue;
        bounds = {
          minX: box.min.x,
          maxX: box.max.x,
          minZ: box.min.z,
          maxZ: box.max.z,
        };
        this.tileBoundsCache.set(scene, bounds);
      }
      if (localX < bounds.minX || localX > bounds.maxX) continue;
      if (localZ < bounds.minZ || localZ > bounds.maxZ) continue;
      any = true;
      // "Better" = strictly deeper depth, or same depth + lower geom-error.
      const depth = tile.internal?.depth ?? 0;
      const err = tile.geometricError ?? Infinity;
      if (depth > bestDepth || (depth === bestDepth && err < bestErr)) {
        bestDepth = depth;
        bestErr = err;
      }
    }
    return any ? { depth: bestDepth, geometricError: bestErr } : null;
  }

  /**
   * Raycast between two 3D points to check Line-of-Sight
   * Returns true if the ray is BLOCKED (hits terrain/building before reaching target)
   *
   * @param originX, originY, originZ - Starting point (e.g., tower tip)
   * @param targetX, targetY, targetZ - End point (e.g., hex cell or enemy position)
   * @returns true if blocked, false if clear line of sight
   */
  raycastLineOfSight(
    originX: number, originY: number, originZ: number,
    targetX: number, targetY: number, targetZ: number
  ): boolean {
    // DevWorld: delegate to provider
    const devTerrain = this.sources.devTerrain();
    if (devTerrain) {
      return devTerrain.hasLineOfSightBlocked(
        originX, originY, originZ,
        targetX, targetY, targetZ
      );
    }

    const tiles = this.sources.tiles();
    if (!tiles) return false;

    this._losOrigin.set(originX, originY, originZ);
    this._losDirection.set(targetX - originX, targetY - originY, targetZ - originZ);
    const distance = this._losDirection.length();
    this._losDirection.multiplyScalar(1 / distance);

    this.losRaycaster.set(this._losOrigin, this._losDirection);
    this.losRaycaster.far = distance - 0.5; // Stop slightly before target

    // Reuse intersection array, intersectObject appends, so clear first
    this._losResults.length = 0;
    const scope = raycastStats.enter('lineOfSight');
    try {
      this.losRaycaster.intersectObject(tiles.group, true, this._losResults);
    } finally {
      raycastStats.exit(scope);
    }

    return this._losResults.length > 0;
  }

  /**
   * Clear height cache
   */
  clearHeightCache(): void {
    this.columnCache.clear();
    this.tileBoundsCache = new WeakMap();
  }
}
