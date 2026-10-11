import { Group, Ray, Vector3, type Camera, type Object3D } from 'three';
import type { CustomMapDocument, MapEnvironment, MapObject } from '../map-document';
import { HeightField } from './height-field';
import type { MapAssetLibrary } from './map-asset-library';
import { sceneToMap } from './map-coords';
import { CustomMapEnvironment } from './environment/map-environment';
import { EffectLayer } from './effects/effect-layer';
import { MapObjectLayer, type ObjectHit } from './objects/object-layer';
import { BridgeLayer } from './paths/path-bridges';
import { MapTerrainLayer } from './terrain/map-terrain';
import { WaterSurface } from './water/water-surface';
import type { GridRect } from './terrain/terrain-chunks';

/**
 * CustomMapView: draws a custom map document. The editor and the game use
 * the same view (docs/CUSTOM_MAPS.md).
 *
 * ```ts
 * const view = new CustomMapView(doc, MapAssetLibrary.shared(), { anisotropy });
 * view.attach(scene);                     // group + losBlockers as direct scene children
 * view.environment.apply(scene, renderer); // sky, environment light, sun with shadows, fog
 * await view.ready;                        // ground materials and models are in
 * view.update(dt, camera, focus?);         // every frame: LOD, wind, water, culling, shadow box
 * view.heightAt(x, y);                     // map space, metres
 * view.raycast(ray); view.raycastObjects(ray);
 * ```
 *
 * Frame: see map-coords.ts (scene x = -map x, scene z = map y, y up). The
 * group sits at the scene origin; it may be moved but not rotated, and the
 * map space queries (`heightAt`) do not follow a move.
 *
 * Editor updates: change the document in place, then call the matching
 * update with the changed rectangle in map metres (`updateHeights`,
 * `updateSplat`), or the whole part (`updateLayers`, `updateWater`,
 * `setObjects`, `updateObject`, `updatePaths`, `setEnvironment`).
 *
 * Line of sight: `losBlockers` holds the terrain and the objects that block
 * sight; it is the group a world provider hands to the LOS cube. Everything
 * else in `group` (water, decoration, bridges, the apron) is outside it and
 * marked `userData.losTransparent`. The LOS cube hides every direct scene
 * child except its group, so `losBlockers` must be a direct child of the
 * scene: `attach(scene)` adds `group` and lifts `losBlockers` beside it
 * (same transform, the group sits at the origin).
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
  /** Main water body first (null without one), then the further bodies */
  private readonly waters: (WaterSurface | null)[] = [];
  private readonly objects: MapObjectLayer;
  private readonly bridges: BridgeLayer;
  private readonly effects: EffectLayer;
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
    this.environment.setFogBase(lowGround(t.grid.heights, t.water?.level));
    this.updateWater();
    this.objects = new MapObjectLayer(this.heights, assets, this.losBlockers);
    this.group.add(this.objects.group);
    this.bridges = new BridgeLayer(this.heights, assets);
    this.group.add(this.bridges.group);
    this.effects = new EffectLayer(this.heights);
    this.group.add(this.effects.group);
    this.ready = this.load();
  }

  /**
   * Adds the map to a scene: `group`, and `losBlockers` as a direct child of
   * the scene (the LOS cube renders only one direct child). Without it,
   * `scene.add(view.group)` draws the same but the LOS cube would hide the
   * blockers with the group.
   */
  attach(scene: Object3D): void {
    scene.add(this.group);
    scene.add(this.losBlockers);
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
    for (const w of this.waters) w?.update(dtSeconds);
    this.objects.update(dtSeconds, camera);
    camera.getWorldPosition(this.camPos);
    this.group.worldToLocal(this.camPos);
    this.terrain.update(this.camPos, dtSeconds);
    if (focus) {
      this.focusPoint.copy(focus);
    } else {
      this.viewRay.origin.copy(this.camPos);
      camera.getWorldDirection(this.viewRay.direction);
      if (this.heights.raycast(this.viewRay, this.focusPoint, 3000) === null) this.focusPoint.copy(this.camPos);
    }
    // Shadow box sized to what the camera sees around the focus: sharp up close, wide from high up
    const reach = this.camPos.distanceTo(this.focusPoint);
    this.environment.focus(this.focusPoint, Math.min(450, Math.max(70, reach * 0.9)));
    this.effects.update(dtSeconds, this.focusPoint);
    this.environment.update(dtSeconds, camera);
  }

  /** Heights changed inside `rect` (map metres); whole map when omitted. Objects and water follow. */
  updateHeights(rect?: MapRect): void {
    this.terrain.rebuild(rect ? this.gridRect(rect) : undefined);
    this.objects.refreshHeights();
    if (this.waters.some((w) => w)) this.updateWater();
    void this.bridges.set(this.doc.paths, this.doc.terrain.water);
  }

  /** First placed object a scene-space ray hits (editor picking) */
  raycastObjects(ray: Ray): ObjectHit | null {
    return this.objects.raycast(ray);
  }

  /** The ground layers or the cliff material changed: reloads the terrain's materials */
  updateLayers(): Promise<void> {
    return this.terrain.load(this.assets, this.doc.paths, this.options.anisotropy ?? 8);
  }

  /** Splat weights changed inside `rect` */
  updateSplat(_rect?: MapRect): void {
    this.terrain.refreshSplat();
  }

  /**
   * Water changed: level, mask, colour or kind of the main body or of the
   * further bodies (`terrain.waterBodies`), or heights under them
   */
  updateWater(): void {
    this.terrain.refreshWater();
    const bodies = [this.doc.terrain.water, ...(this.doc.terrain.waterBodies ?? [])];
    // Slot 0 is the main body (it may be null); further bodies follow
    while (this.waters.length > bodies.length) this.waters.pop()?.dispose();
    bodies.forEach((body, k) => {
      const surface = this.waters[k] ?? null;
      if (!body) {
        surface?.dispose();
        this.waters[k] = null;
        return;
      }
      const apron = k === 0 ? this.terrain.apronProfile : null;
      if (surface) {
        surface.set(body, apron);
      } else {
        const created = new WaterSurface(this.heights, body, apron);
        this.waters[k] = created;
        this.group.add(created.mesh);
      }
    });
    this.lightWater();
  }

  /** Replaces the placed objects (also `doc.objects`); resolves when their models are in */
  setObjects(objects: MapObject[]): Promise<void> {
    this.doc.objects = objects;
    return Promise.all([this.objects.setObjects(objects), this.refreshEffects()]).then(() => undefined);
  }

  /** One object moved, turned, scaled or changed asset (already changed in `doc.objects`) */
  updateObject(object: MapObject): void {
    if (!this.objects.updateObject(object)) void this.objects.setObjects(this.doc.objects);
    void this.refreshEffects(object.asset);
  }

  updatePaths(): void {
    this.terrain.refreshPaths(this.doc.paths);
    void this.bridges.set(this.doc.paths, this.doc.terrain.water);
  }

  setEnvironment(env: MapEnvironment): void {
    this.doc.environment = env;
    this.environment.set(env);
    this.lightWater();
    this.effects.setDarkness(this.environment.darkness);
  }

  /** Rebuilds effects and lights; with an asset id only when that asset has any */
  private async refreshEffects(asset?: string): Promise<void> {
    const catalog = await this.assets.catalog();
    if (this.disposed) return;
    if (asset) {
      const e = catalog.objects.find((o) => o.id === asset);
      if (!e?.effects && !e?.light) return;
    }
    this.effects.set(this.doc.objects, catalog);
    this.effects.setDarkness(this.environment.darkness);
  }

  private lightWater(): void {
    const e = this.environment;
    for (const w of this.waters) w?.setSky(e.skyDome.uniforms, e.sun.intensity);
  }

  dispose(): void {
    this.disposed = true;
    this.terrain.dispose();
    for (const w of this.waters) w?.dispose();
    this.effects.dispose();
    this.objects.dispose();
    this.bridges.dispose();
    this.environment.dispose();
    this.group.removeFromParent();
    this.losBlockers.removeFromParent();
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
      this.refreshEffects(),
      this.bridges.set(this.doc.paths, this.doc.terrain.water),
    ]);
  }
}

/** The low ground of a map for the height fog: the water level, or near the lowest heights */
function lowGround(heights: Float32Array, waterLevel: number | undefined): number {
  if (waterLevel !== undefined) return waterLevel;
  const sorted = Float32Array.from(heights).sort();
  return sorted[Math.floor(sorted.length * 0.05)] ?? 0;
}
