import { Ray, type Raycaster, Vector3 } from 'three';
import type { ColumnHit, ColumnSample } from '../../three-engine/column-sample';
import { streetHeightAt, type StreetHeightGround } from '../../three-engine/terrain-queries';
import type { StreetSurface } from '../../utils/carried-height';
import type { StationProbe } from '../../utils/route-corridor';
import type { FootprintColumn } from '../../utils/tower-footprint';
import { BUILD_BLOCKED_OBJECT, BUILD_BLOCKED_WATER, WATER_DEPTH_M, type WorldSurface } from '../world-provider';
import type { CustomMapDocument } from './map-document';
import { MAP_METERS_PER_DEGREE } from './map-document';
import { HeightField } from './render/height-field';
import { type BridgeDeck, bridgeDecks, deckHeightAt } from './bridge-decks';
import { FALLEN_SCALE } from './custom-map-destruction';

/** A map column's LOD: nothing streams, so the finest there is; the route grid never samples a cell again */
const MAP_LOD = { depth: 99, geometricError: 0 } as const;

/**
 * Where the map sits in the scene. The scene's origin is a geographic point
 * (the run's origin, the map's HQ); map space is metres around the map's
 * middle at the synthetic origin (0, 0), lat = y / 111 320, lon = x / 111 320
 * (mapToGeo). `EllipsoidSync.geoToLocalSimple` gives scene x = -dLon * M *
 * cos(originLat), z = dLat * M with the same M; a map spans a few kilometres
 * at most, so the origin lies within 0.05 degrees of the equator and the
 * cosine differs from 1 by less than 4e-7 (under a millimetre across the
 * map). The frame leaves it out, as the renderer's mapToScene does.
 */
export class CustomMapFrame {
  /** Map position of the scene origin */
  originX = 0;
  originY = 0;

  setOrigin(lat: number, lon: number): void {
    this.originX = lon * MAP_METERS_PER_DEGREE;
    this.originY = lat * MAP_METERS_PER_DEGREE;
  }

  /** Scene x of a map x (-x is east) */
  sceneX(mapX: number): number {
    return this.originX - mapX;
  }

  /** Scene z of a map y (+z is north) */
  sceneZ(mapY: number): number {
    return mapY - this.originY;
  }

  /** Map x of a scene x */
  mapX(sceneX: number): number {
    return this.originX - sceneX;
  }

  /** Map y of a scene z */
  mapY(sceneZ: number): number {
    return this.originY + sceneZ;
  }
}

/**
 * The WorldSurface of a custom map: heights from the map's height grid (the
 * same two triangles per cell the renderer draws, HeightField), bridge decks
 * as the renderer lays them on top, no streaming LOD, nothing measured
 * beside the streets (roads keep their drawn width), line of sight over the
 * terrain. The column reads are allocation-free apart from the sample object
 * the interface returns, as in DevWorld.
 */
export class CustomMapSurface implements WorldSurface {
  readonly lodVersion = 0;
  readonly field: HeightField;

  private readonly bridges: BridgeDeck[];
  /** Discs (x, y, radius) of the objects that forbid building, in 16 m buckets */
  private blockers: {
    cell: number;
    minX: number;
    minY: number;
    columns: number;
    rows: number;
    buckets: (number[] | undefined)[];
    maxRadius: number;
  } | null = null;
  private readonly ray = new Ray();
  private readonly hit = new Vector3();
  private readonly streetGround: StreetHeightGround = {
    columnAtGeo: (lat, lon) => this.columnAtMap(lon * MAP_METERS_PER_DEGREE, lat * MAP_METERS_PER_DEGREE),
    carriedAtGeo: () => null,
    getGroundHeightEstimate: (lat, lon) => this.getTerrainHeightAtGeo(lat, lon),
  };

  constructor(
    readonly doc: CustomMapDocument,
    readonly frame: CustomMapFrame,
  ) {
    const t = doc.terrain;
    this.field = new HeightField(t.grid, t.width, t.depth);
    this.bridges = bridgeDecks(doc.paths, t, this.field);
  }

  /** Terrain height at a map point */
  heightAtMap(x: number, y: number): number {
    return this.field.heightAt(x, y);
  }

  /** The height a walker has at a map point: a bridge deck where one spans it, else the terrain */
  walkHeightAtMap(x: number, y: number): number {
    const deck = deckHeightAt(this.bridges, x, y);
    return Number.isNaN(deck) ? this.field.heightAt(x, y) : deck;
  }

  getTerrainHeightAtGeo(lat: number, lon: number): number | null {
    return this.field.heightAt(lon * MAP_METERS_PER_DEGREE, lat * MAP_METERS_PER_DEGREE);
  }

  getStreetHeightEstimate(
    lat: number, lon: number,
    prevLat: number, prevLon: number,
    nextLat: number, nextLon: number,
    surface: StreetSurface | null,
  ): number | null {
    return streetHeightAt(this.streetGround, lat, lon, prevLat, prevLon, nextLat, nextLon, surface);
  }

  /** Nothing stands beside a map's roads to rule out: the walking height at the point */
  getGroundHeightEstimate(lat: number, lon: number): number | null {
    return this.walkHeightAtMap(lon * MAP_METERS_PER_DEGREE, lat * MAP_METERS_PER_DEGREE);
  }

  sampleColumn(localX: number, localZ: number): ColumnSample | null {
    return this.columnAtMap(this.frame.mapX(localX), this.frame.mapY(localZ));
  }

  raycastTerrainHeight(localX: number, localZ: number): number | null {
    return this.field.heightAt(this.frame.mapX(localX), this.frame.mapY(localZ));
  }

  raycastColumnSample(localX: number, localZ: number): ColumnSample | null {
    return this.sampleColumn(localX, localZ);
  }

  /** No tiles, no hits to tell apart */
  inspectColumn(): { hits: ColumnHit[]; fresh: ColumnSample | null; cached: ColumnSample | null } | null {
    return null;
  }

  /** Roads are drawn at the width the corridor uses: nothing to measure */
  measureStreetClearance(): StationProbe | null {
    return null;
  }

  peekBestTileLODAtLocal(): { depth: number; geometricError: number } | null {
    return { depth: MAP_LOD.depth, geometricError: MAP_LOD.geometricError };
  }

  /**
   * The terrain between two scene points: marched in steps of half a grid
   * cell, blocked where the line runs below the surface. Objects are left to
   * the tower's sight cube, which renders them.
   */
  raycastLineOfSight(
    originX: number, originY: number, originZ: number,
    targetX: number, targetY: number, targetZ: number,
  ): boolean {
    const ax = this.frame.mapX(originX);
    const ay = this.frame.mapY(originZ);
    const bx = this.frame.mapX(targetX);
    const by = this.frame.mapY(targetZ);
    const length = Math.hypot(bx - ax, by - ay);
    const steps = Math.ceil(length / (this.field.cellSize * 0.5));
    // The ends stand on the ground; only what lies between them blocks
    for (let k = 1; k < steps; k++) {
      const t = k / steps;
      const y = originY + (targetY - originY) * t;
      if (y < this.field.heightAt(ax + (bx - ax) * t, ay + (by - ay) * t) - 0.05) return true;
    }
    return false;
  }

  /** The nearest terrain the ray hits; a new vector, null for none */
  pickRay(raycaster: Raycaster): Vector3 | null {
    // The height field casts in the frame of the map's middle at the scene origin: move the ray there
    const r = raycaster.ray;
    this.ray.origin.set(
      r.origin.x - this.frame.sceneX(0),
      r.origin.y,
      r.origin.z - this.frame.sceneZ(0),
    );
    this.ray.direction.copy(r.direction);
    if (this.field.raycast(this.ray, this.hit) === null) return null;
    return new Vector3(this.hit.x + this.frame.sceneX(0), this.hit.y, this.hit.z + this.frame.sceneZ(0));
  }

  /**
   * First terrain hit of a scene-space ray from `origin` along `direction`,
   * into `target` (may be `origin`); false when it misses. Allocation-free.
   */
  groundAlong(origin: Vector3, direction: Vector3, target: Vector3, maxDistance = 3000): boolean {
    this.ray.origin.set(origin.x - this.frame.sceneX(0), origin.y, origin.z - this.frame.sceneZ(0));
    this.ray.direction.copy(direction);
    if (this.field.raycast(this.ray, this.hit, maxDistance) === null) return false;
    target.set(this.hit.x + this.frame.sceneX(0), this.hit.y, this.hit.z + this.frame.sceneZ(0));
    return true;
  }

  /** A point on the ground ahead of a scene-space look that missed the terrain (HeightField.groundAhead) */
  groundAhead(origin: Vector3, direction: Vector3, target: Vector3): void {
    this.ray.origin.set(origin.x - this.frame.sceneX(0), origin.y, origin.z - this.frame.sceneZ(0));
    this.field.groundAhead(this.ray.origin, direction, target);
    target.x += this.frame.sceneX(0);
    target.z += this.frame.sceneZ(0);
  }

  /** Towers stand on the picked ground */
  roofAt(): number | null {
    return null;
  }

  /**
   * Why a tower of `radius` may not stand at the point: water under it
   * (inWater), or an object that forbids building (its own `blocksBuild`,
   * else its catalogue entry's) whose ground disc (footprint x scale) comes
   * within `radius`; objects count once the catalogue is known
   * (setObjectCatalog). Null where it may.
   */
  buildBlocker(lat: number, lon: number, radius: number): string | null {
    const x = lon * MAP_METERS_PER_DEGREE;
    const y = lat * MAP_METERS_PER_DEGREE;
    if (this.inWater(x, y, radius)) return BUILD_BLOCKED_WATER;
    return this.objectAt(x, y, radius) ? BUILD_BLOCKED_OBJECT : null;
  }

  /**
   * Water under a tower at map (x, y): its middle or a point of its ring
   * (radius) in a body (lake, sea, swamp, ice, lava; mask set and the ground
   * WATER_DEPTH_M below the level) or within half a river's width of its
   * line. A bridge deck carries the road, not a tower: no exception.
   */
  inWater(x: number, y: number, radius: number): boolean {
    const t = this.doc.terrain;
    const bodies = t.waterBodies?.length ? (t.water ? [t.water, ...t.waterBodies] : t.waterBodies) : t.water ? [t.water] : [];
    if (bodies.length > 0) {
      const r = radius * 0.7;
      for (const [px, py] of [[x, y], [x + r, y], [x - r, y], [x, y + r], [x, y - r]]) {
        const ground = this.field.heightAt(px, py);
        const k = this.sampleIndex(px, py);
        for (const body of bodies) {
          if (body.mask[k] > 0 && ground < body.level - WATER_DEPTH_M) return true;
        }
      }
    }
    for (const river of t.rivers ?? []) {
      const p = river.points;
      for (let n = 0; n + 1 < p.length; n++) {
        const a = p[n];
        const b = p[n + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        const u = len2 > 0 ? Math.min(1, Math.max(0, ((x - a.x) * dx + (y - a.y) * dy) / len2)) : 0;
        const half = (a.width + (b.width - a.width) * u) / 2 + radius / 2;
        const ex = a.x + dx * u - x;
        const ey = a.y + dy * u - y;
        if (ex * ex + ey * ey < half * half) return true;
      }
    }
    return false;
  }

  /** The height sample nearest a map point, as the water masks index it */
  private sampleIndex(x: number, y: number): number {
    const f = this.field;
    const i = Math.min(f.columns - 1, Math.max(0, Math.round((x - f.originX) / f.cellSize)));
    const j = Math.min(f.rows - 1, Math.max(0, Math.round((y - f.originY) / f.cellSize)));
    return j * f.columns + i;
  }

  /** An object that forbids building within `radius` of map (x, y) */
  private objectAt(x: number, y: number, radius: number): boolean {
    const g = this.blockers;
    if (!g) return false;
    const reach = radius + g.maxRadius;
    const i0 = Math.floor((x - reach - g.minX) / g.cell);
    const i1 = Math.floor((x + reach - g.minX) / g.cell);
    const j0 = Math.floor((y - reach - g.minY) / g.cell);
    const j1 = Math.floor((y + reach - g.minY) / g.cell);
    for (let j = Math.max(0, j0); j <= Math.min(g.rows - 1, j1); j++) {
      for (let i = Math.max(0, i0); i <= Math.min(g.columns - 1, i1); i++) {
        const bucket = g.buckets[j * g.columns + i];
        if (!bucket) continue;
        for (let k = 0; k < bucket.length; k += 3) {
          const r = bucket[k + 2] + radius;
          const dx = bucket[k] - x;
          const dy = bucket[k + 1] - y;
          if (dx * dx + dy * dy < r * r) return true;
        }
      }
    }
    return false;
  }

  /**
   * The catalogue's objects (footprint radius at scale 1, whether they forbid
   * building): from now on buildBlocker sees the map's objects
   */
  setObjectCatalog(entries: readonly { id: string; footprint: number; blocksBuild: boolean }[]): void {
    const byId = new Map(entries.map((e) => [e.id, e]));
    const cell = 16;
    const t = this.doc.terrain;
    const minX = -t.width / 2;
    const minY = -t.depth / 2;
    const columns = Math.max(1, Math.ceil(t.width / cell));
    const rows = Math.max(1, Math.ceil(t.depth / cell));
    const buckets: (number[] | undefined)[] = new Array(columns * rows);
    let maxRadius = 0;
    for (const o of this.doc.objects) {
      const entry = byId.get(o.asset);
      // A fallen structure (FALLEN_SCALE, CustomMapDestruction) blocks nothing
      if (!(o.blocksBuild ?? entry?.blocksBuild ?? false) || o.scale <= FALLEN_SCALE) continue;
      const r = (entry?.footprint ?? 1) * o.scale;
      maxRadius = Math.max(maxRadius, r);
      const i = Math.min(columns - 1, Math.max(0, Math.floor((o.x - minX) / cell)));
      const j = Math.min(rows - 1, Math.max(0, Math.floor((o.y - minY) / cell)));
      (buckets[j * columns + i] ??= []).push(o.x, o.y, r);
    }
    this.blockers = { cell, minX, minY, columns, rows, buckets, maxRadius };
  }

  footprintColumn(localX: number, localZ: number): FootprintColumn | null {
    const mx = this.frame.mapX(localX);
    const my = this.frame.mapY(localZ);
    const ground = this.field.heightAt(mx, my);
    const deck = deckHeightAt(this.bridges, mx, my);
    return { groundY: ground, topY: Number.isNaN(deck) ? ground : Math.max(ground, deck) };
  }

  /** Nothing streams on a map */
  markTileSetChanged(): void {
    // no tile set
  }

  /** Heights are read live from the grid: no cache to clear */
  clearHeightCache(): void {
    // nothing cached
  }

  private columnAtMap(x: number, y: number): ColumnSample {
    const ground = this.field.heightAt(x, y);
    const deck = deckHeightAt(this.bridges, x, y);
    return {
      groundY: ground,
      topY: Number.isNaN(deck) ? ground : Math.max(ground, deck),
      tileDepth: MAP_LOD.depth,
      tileGeometricError: MAP_LOD.geometricError,
    };
  }
}
