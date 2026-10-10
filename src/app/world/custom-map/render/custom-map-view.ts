import { Group, MeshStandardMaterial, Ray, Vector3, type Camera } from 'three';
import type { CustomMapDocument, MapEnvironment, MapObject } from '../map-document';
import { HeightField } from './height-field';
import type { MapAssetLibrary } from './map-asset-library';
import { sceneToMap } from './map-coords';
import { TerrainChunks, type GridRect } from './terrain/terrain-chunks';

/**
 * CustomMapView: draws a custom map document. The editor and the game use
 * the same view.
 *
 * ```ts
 * const view = new CustomMapView(doc, MapAssetLibrary.shared());
 * scene.add(view.group);
 * await view.ready;                      // textures and models are in
 * view.update(dt, camera);               // every frame: LOD, wind, water
 * view.heightAt(x, y);                   // map space, metres
 * ```
 *
 * Frame: see map-coords.ts (scene x = -map x, scene z = map y, y up). The
 * group sits at the scene origin; moving it moves everything, and the map
 * space queries (`heightAt`) do not follow such a move.
 *
 * Editor updates: change the document in place, then call the matching
 * update with the changed rectangle in map metres (`updateHeights`,
 * `updateSplat`), or the whole part (`updateWater`, `setObjects`,
 * `updatePaths`, `setEnvironment`).
 *
 * Line of sight: `losBlockers` holds the terrain and the objects that block
 * sight; it is the group a world provider hands to the LOS cube. Everything
 * else in `group` (water, decoration) is outside it or marked
 * `userData.losTransparent`.
 */

/** Rectangle in map metres */
export interface MapRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface MapRayHit {
  /** Scene position of the hit */
  point: Vector3;
  distance: number;
  /** Map position and surface height */
  x: number;
  y: number;
  height: number;
}

export class CustomMapView {
  /** All render content of the map */
  readonly group = new Group();
  /** Terrain and sight-blocking objects, the LOS cube's group */
  readonly losBlockers = new Group();
  readonly heights: HeightField;
  readonly ready: Promise<void>;

  private readonly terrain: TerrainChunks;
  private readonly camPos = new Vector3();
  private readonly hitPoint = new Vector3();
  private readonly mapPoint = { x: 0, y: 0 };
  private disposed = false;

  constructor(
    readonly doc: CustomMapDocument,
    readonly assets: MapAssetLibrary,
  ) {
    const t = doc.terrain;
    this.heights = new HeightField(t.grid, t.width, t.depth);
    this.group.name = 'custom-map';
    this.losBlockers.name = 'custom-map-los-blockers';
    this.group.add(this.losBlockers);

    this.terrain = new TerrainChunks(this.heights, new MeshStandardMaterial({ color: 0x5f7a3c, roughness: 0.95 }));
    this.losBlockers.add(this.terrain.group);

    this.ready = this.load();
  }

  /** Surface height at map point (x, y), the surface the finest terrain level shows */
  heightAt(x: number, y: number): number {
    return this.heights.heightAt(x, y);
  }

  /** First terrain hit of a scene-space ray, or null */
  raycast(ray: Ray): MapRayHit | null {
    const distance = this.heights.raycast(ray, this.hitPoint);
    if (distance === null) return null;
    const p = sceneToMap(this.hitPoint, this.mapPoint);
    return { point: this.hitPoint.clone(), distance, x: p.x, y: p.y, height: this.hitPoint.y };
  }

  /** Per frame: terrain levels by camera distance */
  update(_dtSeconds: number, camera: Camera): void {
    if (this.disposed) return;
    camera.getWorldPosition(this.camPos);
    this.group.worldToLocal(this.camPos);
    this.terrain.update(this.camPos);
  }

  /** Heights changed inside `rect` (map metres); whole map when omitted */
  updateHeights(rect?: MapRect): void {
    this.terrain.rebuild(rect ? this.gridRect(rect) : undefined);
  }

  /** Splat weights changed inside `rect` */
  updateSplat(_rect?: MapRect): void {
    /* the splat material arrives with the terrain shader */
  }

  updateWater(): void {
    /* water arrives with the water surface */
  }

  setObjects(_objects: MapObject[]): void {
    /* objects arrive with the instanced object layer */
  }

  updateObject(_object: MapObject): void {
    /* objects arrive with the instanced object layer */
  }

  updatePaths(): void {
    /* paths arrive with the path mask */
  }

  setEnvironment(env: MapEnvironment): void {
    this.doc.environment = env;
  }

  dispose(): void {
    this.disposed = true;
    this.terrain.dispose();
    this.group.removeFromParent();
    this.group.clear();
  }

  /** Grid samples covering a map rectangle, one sample of margin */
  private gridRect(rect: MapRect): GridRect {
    const f = this.heights;
    return {
      i0: Math.floor((rect.minX - f.originX) / f.cellSize) - 1,
      j0: Math.floor((rect.minY - f.originY) / f.cellSize) - 1,
      i1: Math.ceil((rect.maxX - f.originX) / f.cellSize) + 1,
      j1: Math.ceil((rect.maxY - f.originY) / f.cellSize) + 1,
    };
  }

  private async load(): Promise<void> {
    await this.assets.catalog();
  }
}
