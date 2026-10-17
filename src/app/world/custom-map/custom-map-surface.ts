import { Ray, type Raycaster, Vector3 } from 'three';
import type { ColumnHit, ColumnSample } from '../../three-engine/column-sample';
import { streetHeightAt, type StreetHeightGround } from '../../three-engine/terrain-queries';
import type { StreetSurface } from '../../utils/carried-height';
import type { StationProbe } from '../../utils/route-corridor';
import type { FootprintColumn } from '../../utils/tower-footprint';
import { PLINTH_CONFIG } from '../../configs/placement.config';
import { BUILD_BLOCKED_OBJECT, BUILD_BLOCKED_WATER, WATER_DEPTH_M, type WorldSurface } from '../world-provider';
import type { CustomMapDocument, MapObject } from './map-document';
import { MAP_METERS_PER_DEGREE } from './map-document';
import { HeightField } from './render/height-field';
import { waterLevelAt } from './water-level';
import { type BridgeDeck, bridgeDecks, deckHeightAt } from './bridge-decks';
import { FALLEN_SCALE } from './custom-map-destruction';
import type { GroundBox } from './object-ground';
import { type CatalogRoof, PlacedRoof } from './object-roof';
import type { ObjectCategory } from './render/asset-catalog';
import { seatHeight } from './render/objects/object-seat';

/** Farthest a bridge deck lies over the ground where a walker off the bridge still steps onto it, metres (walkHeightAtMap) */
const DECK_STEP_M = 0.5;

/** Step along a crown's axis when checking that it carries, m (crownCarries) */
const CROWN_STEP_M = 0.5;
/** Farthest a crown is followed when two walls meet, to pick the one that carries farther, m (crownAt) */
const CROWN_MAX_REACH_M = 12;
/** Widest a crown is across, half of it, m: a gatehouse along its length is no crown that way */
const CROWN_MAX_HALF_WIDTH_M = 4;
/** A crown this far under the highest roof at a point still counts there (a wall under a junction piece), m */
const CROWN_LEVEL_M = PLINTH_CONFIG.MAX_DROP;

/** How far a cursor pick looks, m (HeightField.raycast's default) */
const PICK_REACH_M = 20000;

/** Side of the buckets objects are sorted into for the build rules, m */
const OBJECT_CELL = 16;

/** What the build rules need of a catalogue entry (setObjectCatalog) */
export interface BuildCatalogEntry {
  id: string;
  /** Ground radius and height at scale 1 */
  footprint: number;
  height?: number;
  blocksBuild: boolean;
  /** Ground rectangle (object-ground.ts) */
  box?: GroundBox;
  /** With `roof`: how the renderer seats the model (object-seat.ts) */
  category?: ObjectCategory;
  float?: boolean;
  /** The top a tower stands on (object-roof.ts) */
  roof?: CatalogRoof;
}

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
  /**
   * The ground of the objects that forbid building (object-ground.ts), in
   * 16 m buckets, BLOCKER_STRIDE numbers each: the disc (x, y, radius), the
   * top (NaN without a height), the rectangle's middle (x, y), half sides
   * (Infinity without one), turn (cos, sin) and 1 where it carries a tower
   * on its roof, else 0
   */
  private blockers: {
    cell: number;
    minX: number;
    minY: number;
    columns: number;
    rows: number;
    buckets: (number[] | undefined)[];
    maxRadius: number;
  } | null = null;
  /** The roofs that carry towers (object-roof.ts), and per 16 m bucket of the blockers' grid the ones over it */
  private roofs: PlacedRoof[] = [];
  private roofBuckets: (PlacedRoof[] | undefined)[] = [];
  /** Height of the roof roofOver found last */
  private roofHeight = NaN;
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

  /**
   * The top of what the camera sees at a map point: a water surface (sea,
   * lake, river, lava, ice) over the terrain, else the terrain. The camera
   * keeps its least height above this, not above a sea floor
   */
  surfaceAtMap(x: number, y: number): number {
    const ground = this.field.heightAt(x, y);
    return waterLevelAt(this.doc.terrain, x, y, ground) ?? ground;
  }

  /**
   * The height a walker off a bridge way has at a map point: the terrain,
   * also under a deck (a road under a bridge); a deck only where it lies
   * within DECK_STEP_M of the ground, at a bridge end, so nobody sinks under
   * its edge there. A walker on the bridge way takes the deck through its
   * street surface (`bridge`, streetHeightAt), as on the real places, where
   * the route under another way is cut and runs between portals on the
   * ground (UnderpassIndex)
   */
  walkHeightAtMap(x: number, y: number): number {
    const ground = this.field.heightAt(x, y);
    const deck = deckHeightAt(this.bridges, x, y);
    return !Number.isNaN(deck) && deck >= ground && deck - ground <= DECK_STEP_M ? deck : ground;
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

  /** Nothing stands beside a map's roads to rule out: the walking height off a bridge way at the point */
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

  /**
   * The nearest terrain or roof that carries towers the ray hits (a tower
   * goes where the cursor points, on a house as on the ground); a new
   * vector, null for none
   */
  pickRay(raycaster: Raycaster): Vector3 | null {
    // The height field casts in the frame of the map's middle at the scene origin: move the ray there
    const r = raycaster.ray;
    this.ray.origin.set(
      r.origin.x - this.frame.sceneX(0),
      r.origin.y,
      r.origin.z - this.frame.sceneZ(0),
    );
    this.ray.direction.copy(r.direction);
    const ground = this.field.raycast(this.ray, this.hit);
    const roof = this.roofAlong(r.origin, r.direction, ground ?? PICK_REACH_M);
    if (roof >= 0) return r.at(roof, new Vector3());
    if (ground === null) return null;
    return new Vector3(this.hit.x + this.frame.sceneX(0), this.hit.y, this.hit.z + this.frame.sceneZ(0));
  }

  /** The nearest roof that carries towers along a scene-space ray, its parameter t; -1 for none before `far` */
  private roofAlong(origin: Vector3, direction: Vector3, far: number): number {
    // Map space: x = origin x - scene x, y = origin y + scene z
    const ox = this.frame.mapX(origin.x);
    const oy = this.frame.mapY(origin.z);
    const dx = -direction.x;
    const dy = direction.z;
    const dh = direction.y;
    const length = Math.hypot(dx, dy, dh);
    let nearest = far;
    let hit = -1;
    for (const roof of this.roofs) {
      // Only where the ray passes the sphere round the roof's grid and height
      const half = (roof.top - roof.baseY) / 2;
      const px = roof.cx - ox;
      const py = roof.cy - oy;
      const ph = roof.baseY + half - origin.y;
      const along = (px * dx + py * dy + ph * dh) / length;
      const reach2 = roof.radius * roof.radius + half * half;
      if (px * px + py * py + ph * ph - along * along > reach2) continue;
      const reach = Math.sqrt(reach2);
      if (along < -reach || (along - reach) / length > nearest) continue;
      const t = roof.raycast(ox, oy, origin.y, dx, dy, dh, nearest);
      if (t >= 0 && t < nearest) {
        nearest = t;
        hit = t;
      }
    }
    return hit;
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

  /** The roof of an object that carries towers over a local point (a house, a wall's walk), local Y; null off them */
  roofAt(localX: number, localZ: number): number | null {
    const top = this.roofTopAtMap(this.frame.mapX(localX), this.frame.mapY(localZ));
    return Number.isNaN(top) ? null : top;
  }

  /** The highest roof that carries towers over map (x, y), NaN where none does */
  roofTopAtMap(x: number, y: number): number {
    return this.roofOver(x, y) ? this.roofHeight : NaN;
  }

  /**
   * Where a tower on a crown (a wall's walk, a gatehouse: object-roof.ts)
   * stands when the cursor is at a local point: on the crown's centre line
   * across from it, with the crown's axis (scene x, z), half width and top.
   * Of the crowns there (a wall, a corner or junction piece over it) and
   * either way along each, no wider than CROWN_MAX_HALF_WIDTH_M across: the
   * one that carries farthest both ways, then the higher one under the
   * point, then the one whose centre line is nearest. Null where the highest
   * roof there is no crown.
   */
  crownAt(localX: number, localZ: number): { x: number; z: number; axisX: number; axisZ: number; halfWidth: number; top: number } | null {
    const mx = this.frame.mapX(localX);
    const my = this.frame.mapY(localZ);
    const highest = this.roofOver(mx, my);
    if (!highest?.crown) return null;
    const top = this.roofHeight;
    let best: { x: number; z: number; axisX: number; axisZ: number; halfWidth: number; top: number } | null = null;
    let bestScore = [-1, 0, 0];
    for (const roof of this.roofBuckets[this.bucketOf(mx, my)] ?? []) {
      const height = roof.heightAt(mx, my);
      if (!roof.crown || !(height >= top - CROWN_LEVEL_M)) continue;
      for (const alongX of [true, false]) {
        const c = roof.section(mx, my, PLINTH_CONFIG.MAX_DROP, alongX);
        if (!c || c.halfWidth > CROWN_MAX_HALF_WIDTH_M) continue;
        // Scene x is map -x, scene z map y
        const crown = { x: this.frame.sceneX(c.x), z: this.frame.sceneZ(c.y), axisX: -c.ax, axisZ: c.ay, halfWidth: c.halfWidth, top: c.top };
        const score = [
          this.crownReach(crown.x, crown.z, crown.axisX, crown.axisZ, crown.top, CROWN_MAX_REACH_M),
          height,
          -Math.hypot(c.x - mx, c.y - my),
        ];
        if (score[0] > bestScore[0] || (score[0] === bestScore[0] && (score[1] > bestScore[1] + 1e-6 || (Math.abs(score[1] - bestScore[1]) <= 1e-6 && score[2] > bestScore[2])))) {
          bestScore = score;
          best = crown;
        }
      }
    }
    return best;
  }

  /**
   * Whether the roofs carry `reach` metres both ways along a crown's axis
   * (scene x, z) from a local point at height `top`: every half metre a roof
   * no more than MAX_DROP below and MAX_RISE above, the next wall segment as
   * well as this one. The long way a tower on a crown stands on
   * (tower-footprint.ts)
   */
  crownCarries(localX: number, localZ: number, axisX: number, axisZ: number, top: number, reach: number): boolean {
    return this.crownReach(localX, localZ, axisX, axisZ, top, reach) >= reach;
  }

  /** How far, up to `limit`, the roofs carry both ways along a crown's axis (crownCarries), the shorter way */
  private crownReach(localX: number, localZ: number, axisX: number, axisZ: number, top: number, limit: number): number {
    const mx = this.frame.mapX(localX);
    const my = this.frame.mapY(localZ);
    let reach = limit;
    for (const side of [1, -1]) {
      for (let d = CROWN_STEP_M; d < reach + CROWN_STEP_M - 1e-6; d += CROWN_STEP_M) {
        const along = Math.min(d, reach) * side;
        const h = this.roofTopAtMap(mx - axisX * along, my + axisZ * along);
        if (!(h >= top - PLINTH_CONFIG.MAX_DROP && h <= top + PLINTH_CONFIG.MAX_RISE)) {
          reach = Math.min(reach, d - CROWN_STEP_M);
          break;
        }
      }
    }
    return Math.max(0, reach);
  }

  /** Index of the 16 m bucket over map (x, y), -1 off the map */
  private bucketOf(x: number, y: number): number {
    const g = this.blockers;
    if (!g) return -1;
    const i = Math.floor((x - g.minX) / g.cell);
    const j = Math.floor((y - g.minY) / g.cell);
    return i < 0 || j < 0 || i >= g.columns || j >= g.rows ? -1 : j * g.columns + i;
  }

  /** The highest roof over map (x, y), its height in roofHeight; null where none is */
  private roofOver(x: number, y: number): PlacedRoof | null {
    if (this.roofs.length === 0) return null;
    const list = this.roofBuckets[this.bucketOf(x, y)];
    if (!list) return null;
    let best: PlacedRoof | null = null;
    let height = -Infinity;
    for (const roof of list) {
      const h = roof.heightAt(x, y);
      if (h > height) {
        height = h;
        best = roof;
      }
    }
    this.roofHeight = height;
    return best;
  }

  /**
   * The top of the highest object that forbids building (a house, a wall, a
   * tower) whose ground disc covers a local point, local Y; null where none
   * does. The column's topY knows only the ground and the bridge decks.
   */
  skylineAt(localX: number, localZ: number): number | null {
    const g = this.blockers;
    if (!g) return null;
    const x = this.frame.mapX(localX);
    const y = this.frame.mapY(localZ);
    let best: number | null = null;
    const i0 = Math.max(0, Math.floor((x - g.maxRadius - g.minX) / g.cell));
    const i1 = Math.min(g.columns - 1, Math.floor((x + g.maxRadius - g.minX) / g.cell));
    const j0 = Math.max(0, Math.floor((y - g.maxRadius - g.minY) / g.cell));
    const j1 = Math.min(g.rows - 1, Math.floor((y + g.maxRadius - g.minY) / g.cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const bucket = g.buckets[j * g.columns + i];
        if (!bucket) continue;
        for (let k = 0; k < bucket.length; k += BLOCKER_STRIDE) {
          const top = bucket[k + 3];
          if (Number.isNaN(top) || (best !== null && top <= best)) continue;
          if (covers(bucket, k, x, y, 0)) best = top;
        }
      }
    }
    return best;
  }

  /**
   * Why a tower of `radius` may not stand at the point: water under it
   * (inWater), or an object that forbids building (its own `blocksBuild`,
   * else its catalogue entry's) whose ground (object-ground.ts: its disc,
   * footprint x scale, and its turned rectangle) comes within `radius`; objects count once the catalogue is known
   * (setObjectCatalog). Where the point lies on a roof that carries towers,
   * such roofs block nothing: the ground under the footprint decides, as on
   * the tiles' roofs (a facade, an edge, resolveTowerFootprint). On the
   * ground beside a house it blocks as before. Null where it may.
   */
  buildBlocker(lat: number, lon: number, radius: number): string | null {
    const x = lon * MAP_METERS_PER_DEGREE;
    const y = lat * MAP_METERS_PER_DEGREE;
    if (this.inWater(x, y, radius)) return BUILD_BLOCKED_WATER;
    return this.objectAt(x, y, radius, !Number.isNaN(this.roofTopAtMap(x, y))) ? BUILD_BLOCKED_OBJECT : null;
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

  /** An object that forbids building within `radius` of map (x, y); with `onRoof` only those that carry no tower */
  private objectAt(x: number, y: number, radius: number, onRoof: boolean): boolean {
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
        for (let k = 0; k < bucket.length; k += BLOCKER_STRIDE) {
          if (!(onRoof && bucket[k + 10] === 1) && covers(bucket, k, x, y, radius)) return true;
        }
      }
    }
    return false;
  }

  /**
   * The catalogue's objects (footprint radius and height at scale 1, whether
   * they forbid building, the roof a tower stands on): from now on
   * buildBlocker, skylineAt, roofAt, footprintColumn and pickRay see the
   * map's objects. Roofs come from the objects that forbid building and
   * stand upright; none from an object in `passing`, which may leave the map
   * during a run (it falls, a wave event hides it) and would leave a tower in
   * the air: it blocks as before.
   */
  setObjectCatalog(entries: readonly BuildCatalogEntry[], passing: ReadonlySet<string> = NO_IDS): void {
    const byId = new Map(entries.map((e) => [e.id, e]));
    const cell = OBJECT_CELL;
    const t = this.doc.terrain;
    const minX = -t.width / 2;
    const minY = -t.depth / 2;
    const columns = Math.max(1, Math.ceil(t.width / cell));
    const rows = Math.max(1, Math.ceil(t.depth / cell));
    const buckets: (number[] | undefined)[] = new Array(columns * rows);
    let maxRadius = 0;
    const roofs: PlacedRoof[] = [];
    const roofBuckets: (PlacedRoof[] | undefined)[] = new Array(columns * rows);
    for (const o of this.doc.objects) {
      const entry = byId.get(o.asset);
      // A fallen structure (FALLEN_SCALE, CustomMapDestruction) blocks nothing
      if (!(o.blocksBuild ?? entry?.blocksBuild ?? false) || o.scale <= FALLEN_SCALE) continue;
      const r = (entry?.footprint ?? 1) * o.scale;
      maxRadius = Math.max(maxRadius, r);
      const i = Math.min(columns - 1, Math.max(0, Math.floor((o.x - minX) / cell)));
      const j = Math.min(rows - 1, Math.max(0, Math.floor((o.y - minY) / cell)));
      const top = entry?.height === undefined ? NaN : this.field.heightAt(o.x, o.y) + o.z + entry.height * o.scale;
      const box = entry?.box;
      const cos = Math.cos(o.rotation);
      const sin = Math.sin(o.rotation);
      // The rectangle's middle from the model's x and z to the map (object-ground.ts)
      const bx = box ? o.x - (box[0] * cos + box[1] * sin) * o.scale : o.x;
      const by = box ? o.y - box[0] * sin * o.scale + box[1] * cos * o.scale : o.y;
      const roof = entry?.roof && entry.category && !o.pitch && !o.roll && !passing.has(o.id)
        ? new PlacedRoof(entry.roof, o.x, o.y, o.rotation, o.scale || 1, this.seatOf(entry, o) + o.z)
        : null;
      (buckets[j * columns + i] ??= []).push(o.x, o.y, r, top, bx, by, box ? box[2] * o.scale : Infinity, box ? box[3] * o.scale : Infinity, cos, sin, roof ? 1 : 0);
      if (!roof) continue;
      roofs.push(roof);
      const i0 = Math.max(0, Math.floor((roof.cx - roof.radius - minX) / cell));
      const i1 = Math.min(columns - 1, Math.floor((roof.cx + roof.radius - minX) / cell));
      const j0 = Math.max(0, Math.floor((roof.cy - roof.radius - minY) / cell));
      const j1 = Math.min(rows - 1, Math.floor((roof.cy + roof.radius - minY) / cell));
      for (let jj = j0; jj <= j1; jj++) for (let ii = i0; ii <= i1; ii++) (roofBuckets[jj * columns + ii] ??= []).push(roof);
    }
    this.blockers = { cell, minX, minY, columns, rows, buckets, maxRadius };
    this.roofs = roofs;
    this.roofBuckets = roofBuckets;
  }

  /** Where the renderer stands an object's origin before its own z (seatHeight) */
  private seatOf(entry: BuildCatalogEntry, o: MapObject): number {
    const footing = { category: entry.category!, footprint: entry.footprint, height: entry.height ?? 0, box: entry.box, float: entry.float };
    return seatHeight(footing, o, (x, y) => this.field.heightAt(x, y), (x, y) => waterLevelAt(this.doc.terrain, x, y, this.field.heightAt(x, y)));
  }

  /** Ground and the highest of ground, bridge deck and a roof that carries towers (the tiles' column has its roofs) */
  footprintColumn(localX: number, localZ: number): FootprintColumn | null {
    const mx = this.frame.mapX(localX);
    const my = this.frame.mapY(localZ);
    const ground = this.field.heightAt(mx, my);
    const deck = deckHeightAt(this.bridges, mx, my);
    const roof = this.roofOver(mx, my);
    const top = Number.isNaN(deck) ? ground : Math.max(ground, deck);
    if (!roof || !(this.roofHeight > top)) return { groundY: ground, topY: top };
    return roof.crown ? { groundY: ground, topY: this.roofHeight, built: true, crown: true } : { groundY: ground, topY: this.roofHeight, built: true };
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

/** Numbers per object in the surface's blocker buckets */
const BLOCKER_STRIDE = 11;

const NO_IDS: ReadonlySet<string> = new Set();

/** Whether the ground of the blocker at `k` (its disc and its rectangle) comes within `reach` of map (x, y) */
function covers(bucket: readonly number[], k: number, x: number, y: number, reach: number): boolean {
  const r = bucket[k + 2] + reach;
  const dx = bucket[k] - x;
  const dy = bucket[k + 1] - y;
  if (dx * dx + dy * dy >= r * r) return false;
  const hx = bucket[k + 6];
  if (hx === Infinity) return true;
  // In the model's x and z (object-ground.ts toModel), inline: buildBlocker runs per cell of the build areas
  const cos = bucket[k + 8];
  const sin = bucket[k + 9];
  const ox = x - bucket[k + 4];
  const oy = y - bucket[k + 5];
  const mx = Math.max(0, Math.abs(-ox * cos - oy * sin) - hx);
  const mz = Math.max(0, Math.abs(-ox * sin + oy * cos) - bucket[k + 7]);
  return mx * mx + mz * mz <= reach * reach;
}
