import { Ray, type Raycaster, Vector3 } from 'three';
import type { ColumnHit, ColumnSample } from '../../three-engine/column-sample';
import { streetHeightAt, type StreetHeightGround } from '../../three-engine/terrain-queries';
import type { StreetSurface } from '../../utils/carried-height';
import type { StationProbe } from '../../utils/route-corridor';
import type { FootprintColumn } from '../../utils/tower-footprint';
import type { WorldSurface } from '../world-provider';
import type { CustomMapDocument, MapPoint } from './map-document';
import { MAP_METERS_PER_DEGREE } from './map-document';
import { HeightField } from './render/height-field';

/** A map column's LOD: nothing streams, so the finest there is; the route grid never samples a cell again */
const MAP_LOD = { depth: 99, geometricError: 0 } as const;

/** One bridge deck in map metres, as the renderer's BridgeLayer lays it */
interface BridgeDeck {
  line: MapPoint[];
  /** Cumulative length at each line point */
  at: number[];
  total: number;
  half: number;
  hA: number;
  hB: number;
  arch: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

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
    this.bridges = this.bridgeDecks();
  }

  /** Terrain height at a map point */
  heightAtMap(x: number, y: number): number {
    return this.field.heightAt(x, y);
  }

  /** The height a walker has at a map point: a bridge deck where one spans it, else the terrain */
  walkHeightAtMap(x: number, y: number): number {
    const deck = this.deckAt(x, y);
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

  /** Towers stand on the picked ground */
  roofAt(): number | null {
    return null;
  }

  footprintColumn(localX: number, localZ: number): FootprintColumn | null {
    const mx = this.frame.mapX(localX);
    const my = this.frame.mapY(localZ);
    const ground = this.field.heightAt(mx, my);
    const deck = this.deckAt(mx, my);
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
    const deck = this.deckAt(x, y);
    return {
      groundY: ground,
      topY: Number.isNaN(deck) ? ground : Math.max(ground, deck),
      tileDepth: MAP_LOD.depth,
      tileGeometricError: MAP_LOD.geometricError,
    };
  }

  /** Deck height of the bridge spanning a map point, NaN where none does */
  private deckAt(x: number, y: number): number {
    for (const b of this.bridges) {
      if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue;
      for (let s = 0; s + 1 < b.line.length; s++) {
        const p = b.line[s];
        const q = b.line[s + 1];
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const len2 = dx * dx + dy * dy;
        if (len2 === 0) continue;
        const u = Math.max(0, Math.min(1, ((x - p.x) * dx + (y - p.y) * dy) / len2));
        if (Math.hypot(x - p.x - dx * u, y - p.y - dy * u) > b.half) continue;
        const t = (b.at[s] + u * Math.sqrt(len2)) / b.total;
        return b.hA + (b.hB - b.hA) * t + Math.sin(t * Math.PI) * b.arch;
      }
    }
    return NaN;
  }

  /** Bridge edges with the deck heights of the renderer's BridgeLayer (ends over the water, a slight arch) */
  private bridgeDecks(): BridgeDeck[] {
    const { paths, terrain } = this.doc;
    const nodes = new Map(paths.nodes.map((n) => [n.id, n]));
    const minDeck = (terrain.water?.level ?? -Infinity) + 1;
    const out: BridgeDeck[] = [];
    for (const e of paths.edges) {
      if (e.kind !== 'bridge') continue;
      const a = nodes.get(e.a);
      const b = nodes.get(e.b);
      if (!a || !b) continue;
      const line = [a, ...(e.via ?? []), b];
      const at = [0];
      for (let s = 0; s + 1 < line.length; s++) at.push(at[s] + Math.hypot(line[s + 1].x - line[s].x, line[s + 1].y - line[s].y));
      const total = at[at.length - 1];
      if (total <= 0) continue;
      const half = e.width / 2;
      out.push({
        line,
        at,
        total,
        half,
        hA: Math.max(this.field.heightAt(a.x, a.y), minDeck),
        hB: Math.max(this.field.heightAt(b.x, b.y), minDeck),
        arch: Math.min(1.5, total * 0.04),
        minX: Math.min(...line.map((p) => p.x)) - half,
        minY: Math.min(...line.map((p) => p.y)) - half,
        maxX: Math.max(...line.map((p) => p.x)) + half,
        maxY: Math.max(...line.map((p) => p.y)) + half,
      });
    }
    return out;
  }
}
