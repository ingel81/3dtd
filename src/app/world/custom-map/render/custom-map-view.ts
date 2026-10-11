import { Group, Ray, Vector3, type Camera } from 'three';
import type { CustomMapDocument, MapEnvironment, MapObject } from '../map-document';
import { HeightField } from './height-field';
import type { MapAssetLibrary } from './map-asset-library';
import { sceneToMap } from './map-coords';
import { CustomMapEnvironment } from './environment/map-environment';
import { MapObjectLayer, type ObjectHit } from './objects/object-layer';
import { BridgeLayer } from './paths/path-bridges';
import { MapTerrainLayer } from './terrain/map-terrain';
import { WaterSurface } from './water/water-surface';
import type { GridRect } from './terrain/terrain-chunks';

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

export interface CustomMapViewOptions {
  /** Anisotropic filtering of the ground textures (renderer.capabilities.getMaxAnisotropy()) */
  anisotropy?: number;
}

export class CustomMapView {
  /** All render content of the map */
  readonly group = new Group();
  /** Terrain and sight-blocking objects, the LOS cube's group */
  readonly losBlockers = new Group();
  readonly heights: HeightField;
  readonly ready: Promise<void>;
  /** Sky, lights and fog; the owner applies it to its scene (`environment.apply(scene, renderer)`) */
  readonly environment: CustomMapEnvironment;

  private readonly terrain: MapTerrainLayer;
  private water: WaterSurface | null = null;
  private readonly objects: MapObjectLayer;
  private readonly bridges: BridgeLayer;
  private readonly camPos = new Vector3();
  private readonly hitPoint = new Vector3();
  private readonly mapPoint = { x: 0, y: 0 };
  private readonly focusPoint = new Vector3();
  private readonly viewRay = new Ray();
  private disposed = false;

  constructor(
    readonly doc: CustomMapDocument,
    readonly assets: MapAssetLibrary,
    private readonly options: CustomMapViewOptions = {},
  ) {
    const t = doc.terrain;
    this.heights = new HeightField(t.grid, t.width, t.depth);
    this.group.name = 'custom-map';
    this.losBlockers.name = 'custom-map-los-blockers';
    this.group.add(this.losBlockers);

    this.terrain = new MapTerrainLayer(t, this.heights);
    this.losBlockers.add(this.terrain.chunks.group);
    this.group.add(this.terrain.apron);

    this.environment = new CustomMapEnvironment(doc.environment);
    this.updateWater();
    this.objects = new MapObjectLayer(this.heights, assets, this.losBlockers);
    this.group.add(this.objects.group);
    this.bridges = new BridgeLayer(this.heights, assets);
    this.group.add(this.bridges.group);
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

  /**
   * Per frame: terrain levels by camera distance, and the sun's shadow box
   * around `focus` (scene space; default: where the camera looks at the ground).
   */
  update(dtSeconds: number, camera: Camera, focus?: Vector3): void {
    if (this.disposed) return;
    this.water?.update(dtSeconds);
    this.objects.update(dtSeconds, camera);
    camera.getWorldPosition(this.camPos);
    this.group.worldToLocal(this.camPos);
    this.terrain.update(this.camPos);
    if (focus) {
      this.focusPoint.copy(focus);
    } else {
      this.viewRay.origin.copy(this.camPos);
      camera.getWorldDirection(this.viewRay.direction);
      if (this.heights.raycast(this.viewRay, this.focusPoint, 3000) === null) this.focusPoint.copy(this.camPos);
    }
    this.environment.focus(this.focusPoint);
  }

  /** Heights changed inside `rect` (map metres); whole map when omitted. Objects and water follow. */
  updateHeights(rect?: MapRect): void {
    this.terrain.rebuild(rect ? this.gridRect(rect) : undefined);
    this.objects.refreshHeights();
    if (this.water) this.updateWater();
    void this.bridges.set(this.doc.paths, this.doc.terrain.water);
  }

  /** First placed object a scene-space ray hits (editor picking) */
  raycastObjects(ray: Ray): ObjectHit | null {
    return this.objects.raycast(ray);
  }

  /** Splat weights changed inside `rect` */
  updateSplat(_rect?: MapRect): void {
    this.terrain.refreshSplat();
  }

  /** Water level, mask or colour changed, or heights under the water */
  updateWater(): void {
    const water = this.doc.terrain.water;
    if (!water) {
      this.water?.dispose();
      this.water = null;
      return;
    }
    if (this.water) {
      this.water.set(water);
    } else {
      this.water = new WaterSurface(this.heights, water);
      this.group.add(this.water.mesh);
    }
    this.lightWater();
  }

  /** Replaces the placed objects (also `doc.objects`); resolves when their models are in */
  setObjects(objects: MapObject[]): Promise<void> {
    this.doc.objects = objects;
    return this.objects.setObjects(objects);
  }

  /** One object moved, turned, scaled or changed asset (already changed in `doc.objects`) */
  updateObject(object: MapObject): void {
    if (!this.objects.updateObject(object)) void this.objects.setObjects(this.doc.objects);
  }

  updatePaths(): void {
    this.terrain.refreshPaths(this.doc.paths);
    void this.bridges.set(this.doc.paths, this.doc.terrain.water);
  }

  setEnvironment(env: MapEnvironment): void {
    this.doc.environment = env;
    this.environment.set(env);
    this.lightWater();
  }

  private lightWater(): void {
    const e = this.environment;
    this.water?.setLighting(e.zenith, e.horizon, e.sunDir, e.sun.color, e.sun.intensity);
  }

  dispose(): void {
    this.disposed = true;
    this.terrain.dispose();
    this.water?.dispose();
    this.objects.dispose();
    this.bridges.dispose();
    this.environment.dispose();
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
    await Promise.all([
      this.terrain.load(this.assets, this.doc.paths, this.options.anisotropy ?? 8),
      this.objects.setObjects(this.doc.objects),
      this.bridges.set(this.doc.paths, this.doc.terrain.water),
    ]);
  }
}
