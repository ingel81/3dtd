import { Box3, Raycaster, Vector3, type Intersection, type Object3D } from 'three';
import type { TilesRenderer } from '3d-tiles-renderer';
import { METERS_PER_DEGREE_LAT, DEG_TO_RAD } from '../utils/geo-utils';
import { LOW_WALL_BEHIND_M, StationProbe, corridorConfig, lowObjectTop, lowRayAlone } from '../utils/route-corridor';
import { StreetDeck, approachY, carriedY, surfaceY } from '../utils/carried-height';
import type { StreetUnder } from '../utils/underpass';
import { raycastStats } from '../utils/raycast-stats';
import type { ApproachPoint } from '../utils/route-cell';
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
 * meshes is far thinner than that. A station's columns are exact rays
 * (measureStreetClearance), so each shift is a column of its own.
 */
const SEAM_SHIFTS_M = [0.5, -0.5] as const;

/** Column cache granularity: 2 buckets per metre (0.5 m grid). */
const COLUMN_CACHE_SCALE = 2;

/**
 * Where the column of a local coordinate stands: the centre of its 0.5 m
 * cache bucket. Every point of a bucket reads the column there, so what the
 * cache holds for a bucket does not depend on which point asked first
 * (playtest 2026-09-16, PLAYTEST 745). The cells and the band sample at
 * whole metres and half metres, which are centres already.
 */
export function columnCentre(local: number): number {
  return Math.round(local * COLUMN_CACHE_SCALE) / COLUMN_CACHE_SCALE;
}

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
    return this.columnAtGeo(lat, lon)?.groundY ?? null;
  }

  /** The column at a geographic point (sampleColumn), its rays booked as `heightAtGeo`. */
  private columnAtGeo(lat: number, lon: number): ColumnSample | null {
    const localPos = this.sync.geoToLocalSimple(lat, lon, 0);
    const scope = raycastStats.enter('heightAtGeo');
    try {
      return this.sampleColumn(localPos.x, localPos.z);
    } finally {
      raycastStats.exit(scope);
    }
  }

  /**
   * Height of a street at a path point, as the yellow street overlay draws
   * it and `__routes.describe()` compares the route cells with.
   *
   * `deck` 'bridge', on a way with `bridge=*`: the top of the column, the
   * deck, as the route cells of a bridge segment take it. `deck` the way
   * from a bridge end, on the stretch off it (carried-height.ts): the hit
   * nearest to the height the way carries there (carriedY,
   * approachY), as the route cells there take it; where that lies more
   * than `roofRise` above the height carried (a crown, awning or car with
   * no ground under it), the height carried. `deck` the portals of a stretch under
   * another way (StreetUnder, underpass.ts): the ground at the two portals
   * (getGroundHeightEstimate across the way from one to the other),
   * interpolated, as the route cells of a tunnel stretch take it. Otherwise,
   * for `deck` null and without a column at the bridge end or at a portal,
   * getGroundHeightEstimate.
   */
  getStreetHeightEstimate(
    lat: number, lon: number,
    prevLat: number, prevLon: number,
    nextLat: number, nextLon: number,
    deck: StreetDeck | null,
  ): number | null {
    if (deck === 'bridge') return this.columnAtGeo(lat, lon)?.topY ?? null;
    if (deck !== null && 'portals' in deck) {
      const [a, b] = deck.portals;
      const ya = this.getGroundHeightEstimate(a.lat, a.lon, a.lat, a.lon, b.lat, b.lon);
      const yb = this.getGroundHeightEstimate(b.lat, b.lon, a.lat, a.lon, b.lat, b.lon);
      if (ya !== null && yb !== null) return ya + (yb - ya) * deck.f;
    } else if (deck !== null) {
      const here = this.columnAtGeo(lat, lon);
      const carried = here === null ? null : this.carriedAtGeo(deck);
      if (here !== null && carried !== null) {
        const y = approachY(here, carried);
        return y - carried > corridorConfig.roofRise ? carried : y;
      }
    }
    return this.getGroundHeightEstimate(lat, lon, prevLat, prevLon, nextLat, nextLon);
  }

  /** The height carried at a street point off a bridge end (carriedY), its rays booked as `heightAtGeo`. */
  private carriedAtGeo(deck: Exclude<StreetDeck, 'bridge' | StreetUnder>): number | null {
    const path = deck.path.map((p) => {
      const local = this.sync.geoToLocalSimple(p.lat, p.lon, 0);
      return { x: local.x, z: local.z };
    });
    const scope = raycastStats.enter('heightAtGeo');
    try {
      return carriedY({ path, m: deck.m }, (x, z) => this.sampleColumn(x, z));
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
   * On a bridge every sample is the lowest hit of its column (sampleColumn), the river or
   * road under the deck where the photogrammetry has it, so the estimate lies under the
   * bridge. getStreetHeightEstimate takes the deck there, as the route cells do.
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
   * The ray and the peek stand at the column's centre (columnCentre), not at
   * the point asked for. Cast at the first point that asked, a bucket held
   * what that point showed, and the cells of a corridor build read other
   * heights depending on what had sampled before them: the stations on a
   * cold load, nothing on `__corridor.reset()`.
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

    const x = columnCentre(localX);
    const z = columnCentre(localZ);
    const key = columnCacheKey(x, z);
    const entry = this.columnCache.get(key);
    if (entry) {
      if (entry.lodVersion === this._lodVersion) return entry.sample;
      // Tile set changed. Only pay for a ray if finer data is actually there.
      const peek = this.peekBestTileLODAtLocal(x, z);
      if (peek && !isBetterLod(peek, entry.sample)) {
        entry.lodVersion = this._lodVersion;
        return entry.sample;
      }
    }

    const sample = this.raycastColumn(x, z);
    if (sample === null) return null;

    this.columnCache.set(key, { sample, lodVersion: this._lodVersion });
    return sample;
  }

  /**
   * What the column at a local position is made of, for `__corridor.pick()`:
   * every hit of a fresh ray through the column's centre (columnCentre;
   * height, tile depth, geometricError), the sample selectColumnSample makes
   * of them now, and the sample the column cache holds, which the route
   * cells and the street overlay read. Tells
   * apart a street under a deck that no hit shows, one only in a coarser
   * tile than the deck (dropped by the finest-LOD filter), and one the
   * cache has not seen yet. Uncached; rays booked on `corridorPick`. Null
   * in DevWorld.
   */
  inspectColumn(localX: number, localZ: number): { hits: ColumnHit[]; fresh: ColumnSample | null; cached: ColumnSample | null } | null {
    if (this.sources.devTerrain()) return null;
    const scope = raycastStats.enter('corridorPick');
    try {
      const x = columnCentre(localX);
      const z = columnCentre(localZ);
      const fresh = this.raycastColumn(x, z);
      return {
        hits: this._columnHits.map((hit) => ({ ...hit })),
        fresh,
        cached: this.columnCache.get(columnCacheKey(x, z))?.sample ?? null,
      };
    } finally {
      raycastStats.exit(scope);
    }
  }

  /**
   * Uncached ray + LOD resolution behind {@link sampleColumn}, and the exact
   * column of a station measurement (measureStreetClearance).
   */
  private raycastColumn(localX: number, localZ: number): ColumnSample | null {
    this._columnHits.length = 0;
    // The ray only ever hits active tiles.
    const tiles = this.sources.tiles();
    if (!tiles || tiles.activeTiles.size === 0) return null;

    this._columnRayOrigin.set(localX, 10000, localZ);
    this.terrainRaycaster.set(this._columnRayOrigin, COLUMN_RAY_DIRECTION);
    this.terrainRaycaster.far = 20000;

    this._columnResults.length = 0;
    this.terrainRaycaster.intersectObject(tiles.group, true, this._columnResults);
    if (this._columnResults.length === 0) return null;

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
   * side at every height in `heightsAboveGround`, over the surface the
   * route cells there stand on (surfaceY in carried-height.ts): the column's
   * ground, its top `onDeck` for a bridge, and on the stretch off a bridge
   * end (`onApproach`, the route from that end to the station) the hit nearest
   * to the height the route carries there (carriedY). Such a station
   * comes back unmeasured (`no approach start`)
   * while the column at the bridge end has no tile up to `maxTileError`.
   * What blocks the rays at all
   * heights counts as a wall (a facade, a wall, a trunk), so the free space
   * on a side is the farthest of the first hits: an eave or a tree crown
   * stops only the high ray, not the corridor (probeFreeSpace, which makes
   * an exception for a jetty right in front of its facade).
   * Capped at `maxDistance`. `acrossX, acrossZ` points to the right of the
   * direction of travel.
   *
   * Where the low ray alone stops (lowRayAlone: a parked van, a hedge, a
   * fence), one more column LOW_WALL_BEHIND_M behind its hit tells how far
   * the ground there lies above the station's (`StationProbe.lowRise`);
   * raised ground makes the hit a wall (probeLowWall). That column's ground
   * is taken by the station's rule (surfaceY): on the stretch off a bridge
   * end the hit nearest to the height carried there, so a car there is a
   * wall and a station over a hollow under the road measures from the road.
   * Not on a deck (`onDeck`), where the lowest hit of that column may be the
   * river, quay or road under the deck.
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
   * for such a station. The column at a bridge end tries the same shifts.
   *
   * Every column of a station, under it, beside a seam, at and off a bridge
   * end and behind a low hit, is a ray at its exact point that neither reads
   * nor writes the column cache (raycastColumn). The side rays start at that
   * column's height: the column at the centre of its cache bucket
   * (columnCentre) can lie 0.35 m away, on a kerb or a car; and a station
   * that filled the cache would decide what the cells beside it read
   * (PLAYTEST 745). A station therefore costs its columns on every
   * measurement, the cells and the band never pay for them.
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
    onApproach: ApproachPoint | null = null,
  ): StationProbe | null {
    const tiles = this.sources.tiles();
    if (this.sources.devTerrain() || !tiles) return null;
    // The column under the station and all side rays count as the corridor's.
    const scope = raycastStats.enter('routeCorridor');
    try {
      const len = Math.hypot(acrossX, acrossZ);
      // (acrossZ, -acrossX) is the direction of travel: across points to its right.
      const alongX = len > 0 ? acrossZ / len : 0;
      const alongZ = len > 0 ? -acrossX / len : 0;
      const station = this.columnBesideSeam(localX, localZ, alongX, alongZ);
      if (!station) return { unmeasured: 'no tile', tileError: Infinity, left: [], right: [] };
      const { column, x, z, shiftM } = station;
      const shifted = shiftM === null ? {} : { shiftM };
      if (column.tileGeometricError > corridorConfig.maxTileError) {
        return { unmeasured: 'coarse tile', tileError: column.tileGeometricError, left: [], right: [], ...shifted };
      }
      if (len === 0) return null;

      // Off a bridge end the rays start where the cells there stand: on the
      // hit nearest to the height the route carries there from that end.
      let carried: number | null = null;
      if (onApproach !== null && !onDeck) {
        const end = onApproach.path[0];
        const deck = this.columnBesideSeam(end.x, end.z, alongX, alongZ);
        if (!deck || deck.column.tileGeometricError > corridorConfig.maxTileError) {
          return { unmeasured: 'no approach start', tileError: column.tileGeometricError, left: [], right: [], ...shifted };
        }
        carried = carriedY(onApproach, (px, pz) => this.columnBesideSeam(px, pz, alongX, alongZ)?.column ?? null);
      }
      const baseY = surfaceY(onDeck ? 'deck' : carried === null ? 'ground' : 'approach', column, carried)!;
      const left: number[] = [];
      const right: number[] = [];
      for (const height of heightsAboveGround) {
        this._clearanceOrigin.set(x, baseY + height, z);
        left.push(this.clearanceRay(tiles.group, -acrossX / len, -acrossZ / len, maxDistance));
        right.push(this.clearanceRay(tiles.group, acrossX / len, acrossZ / len, maxDistance));
      }
      const lowRise = onDeck
        ? { left: NaN, right: NaN }
        : {
          left: this.riseBehindLowHit(x, z, -acrossX / len, -acrossZ / len, left, maxDistance, baseY, carried),
          right: this.riseBehindLowHit(x, z, acrossX / len, acrossZ / len, right, maxDistance, baseY, carried),
        };
      return { unmeasured: null, tileError: column.tileGeometricError, left, right, lowRise, ...shifted };
    } finally {
      raycastStats.exit(scope);
    }
  }

  /**
   * The exact, uncached column at (x, z) (raycastColumn), or, where that
   * finds no tile (a seam between two tile meshes), the first one
   * SEAM_SHIFTS_M along the unit direction (alongX, alongZ) that does, with
   * where it stands and the shift it took (null for none). Null without a
   * column; no shift for a zero direction.
   */
  private columnBesideSeam(
    x: number, z: number, alongX: number, alongZ: number,
  ): { column: ColumnSample; x: number; z: number; shiftM: number | null } | null {
    const column = this.raycastColumn(x, z);
    if (column) return { column, x, z, shiftM: null };
    if (alongX === 0 && alongZ === 0) return null;
    for (const shift of SEAM_SHIFTS_M) {
      const sx = x + alongX * shift;
      const sz = z + alongZ * shift;
      const shifted = this.raycastColumn(sx, sz);
      if (shifted) return { column: shifted, x: sx, z: sz, shiftM: shift };
    }
    return null;
  }

  /**
   * How far the column LOW_WALL_BEHIND_M behind the low ray's hit, along
   * the horizontal unit direction (dirX, dirZ) from (x, z), comes down
   * above `groundY`, where the low ray alone stopped (`hits` per ray
   * height, see lowRayAlone): its lowest hit, or on the stretch off a
   * bridge end the one nearest to `carried`, the height carried at the
   * station, as the station's own ground (surfaceY); the top of a low
   * object over a hollow above that instead (lowObjectTop: a car the mesh
   * made hollow, the street under its body its lowest hit). NaN where it
   * did not, or where that column has no tile up to `maxTileError`. An
   * exact, uncached column, as every column of a station.
   */
  private riseBehindLowHit(
    x: number, z: number, dirX: number, dirZ: number, hits: readonly number[], maxDistance: number, groundY: number,
    carried: number | null,
  ): number {
    if (!lowRayAlone(hits, maxDistance)) return NaN;
    const reach = hits[0] + LOW_WALL_BEHIND_M;
    const behind = this.raycastColumn(x + dirX * reach, z + dirZ * reach);
    if (!behind || behind.tileGeometricError > corridorConfig.maxTileError) return NaN;
    const y = surfaceY(carried === null ? 'ground' : 'approach', behind, carried)!;
    return (lowObjectTop(behind, y) ?? y) - groundY;
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
   * The column at a local position: its ground and its highest surface, roof,
   * deck, car or crown where there is one (`ColumnSample`). What a tower's
   * footprint is judged by. Thin read of {@link sampleColumn}, booked on
   * `caller`.
   */
  raycastColumnSample(localX: number, localZ: number, caller: string): ColumnSample | null {
    const scope = raycastStats.enter(caller);
    try {
      return this.sampleColumn(localX, localZ);
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
