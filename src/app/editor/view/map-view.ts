/**
 * The editor's handle on the custom map renderer (`world/custom-map/render/`,
 * the same view the game draws): the editor speaks in grid samples, splat
 * texels and object ids, the renderer in map metres and objects. The
 * renderer only reads the document; which objects it shows (hidden
 * categories) it keeps itself. Scene space is the game's: scene x = -map x
 * (east), scene z = map y (north), y up.
 */
import { Vector3, type Camera, type Mesh, type Object3D, type Ray, type Scene, type WebGLRenderer } from 'three';
import type { CustomMapDocument, MapObject } from '../../world/custom-map/map-document';
import { CustomMapView, type MapRect } from '../../world/custom-map/render/custom-map-view';
import type { RoadCover } from '../../world/custom-map/render/paths/path-mask';
import type { TexelRect } from '../../world/custom-map/render/terrain/texture-ranges';
import { MapAssetLibrary } from '../../world/custom-map/render/map-asset-library';
import { mapToScene as toScene } from '../../world/custom-map/render/map-coords';
import type { GridRect } from '../../map-ops/grid';

/** Scene position of a map point at a height */
export function mapToScene(x: number, y: number, height: number, target = new Vector3()): Vector3 {
  return toScene(x, y, height, target);
}

export class EditorMapView {
  readonly view: CustomMapView;

  constructor(
    private readonly doc: CustomMapDocument,
    scene: Scene,
    renderer: WebGLRenderer,
  ) {
    this.view = new CustomMapView(doc, MapAssetLibrary.shared(), { anisotropy: renderer.capabilities.getMaxAnisotropy(), renderer });
    this.view.attach(scene);
    this.view.environment.apply(scene, renderer);
  }

  get group(): CustomMapView['group'] {
    return this.view.group;
  }

  get ready(): Promise<void> {
    return this.view.ready;
  }

  /** Compiles every program the map needs (models, shadows) once it is in, so the first stroke does not stall */
  async warmUp(renderer: WebGLRenderer, scene: Scene, camera: Camera): Promise<void> {
    await this.view.ready;
    await this.view.warmUp(renderer, scene, camera);
  }

  /** Weather, ambient particles, effects and glows on or off (off for pictures from above) */
  setParticlesVisible(visible: boolean): void {
    this.view.setParticlesVisible(visible);
  }

  /** Runs `run` with the map's point lights as they are (`current`) and in the other state (night on, day off) */
  withEitherLights(run: (current: boolean) => void): void {
    this.view.withEitherLights(run);
  }

  /** Where a scene ray meets the ground, in map space (z is the height) */
  raycast(ray: Ray): { x: number; y: number; z: number } | null {
    const hit = this.view.raycast(ray);
    return hit ? { x: hit.x, y: hit.y, z: hit.height } : null;
  }

  /** The placed object a scene ray hits first, by its model */
  pickObject(ray: Ray): string | null {
    return this.view.raycastObjects(ray)?.object.id ?? null;
  }

  /** Every frame; `focus` (scene space) is where the camera orbits, the sun's shadow box follows it */
  update(dt: number, camera: Camera, focus?: Vector3): void {
    this.view.update(dt, camera, focus);
  }

  /** The layer list, a layer's material or the cliff material changed (splat weights follow) */
  updateLayers(): void {
    void this.view.updateLayers();
  }

  /** Height samples changed */
  updateHeights(rect: GridRect): void {
    const t = this.doc.terrain;
    const cell = t.grid.cellSize;
    this.view.updateHeights(metres(t.width, t.depth, rect.i0 * cell, rect.j0 * cell, rect.i1 * cell, rect.j1 * cell));
  }

  /** Splat texels changed */
  updateSplat(rect: GridRect): void {
    const t = this.doc.terrain;
    const sx = t.width / t.splat.resolution;
    const sy = t.depth / t.splat.resolution;
    this.view.updateSplat(metres(t.width, t.depth, rect.i0 * sx, rect.j0 * sy, (rect.i1 + 1) * sx, (rect.j1 + 1) * sy));
  }

  updateWater(): void {
    this.view.updateWater();
  }

  /** Only further body k (0..) changed, within `rect` (samples) */
  updateWaterBody(k: number, rect: GridRect): void {
    const t = this.doc.terrain;
    const cell = t.grid.cellSize;
    this.view.updateWater(metres(t.width, t.depth, rect.i0 * cell, rect.j0 * cell, rect.i1 * cell, rect.j1 * cell), k + 1);
  }

  /** The document's object list was replaced: all shown anew */
  setObjects(): void {
    void this.view.setObjects();
  }

  /** Show only the objects `visible` accepts (null: all); rebuilds the batches */
  setVisible(visible: ((o: MapObject) => boolean) | null): void {
    void this.view.setVisible(visible);
  }

  /** Some objects were added, removed or changed */
  objectsChanged(ids: readonly string[]): void {
    void this.view.objectsChanged(ids);
  }

  /** Compiles the programs of assets not on the map yet (a biome or asset about to be placed), `compile` for each picture */
  warmUpAssets(renderer: WebGLRenderer, scene: Scene, camera: Camera, assetIds: string[], compile?: (object: Object3D) => Promise<unknown>): Promise<number> {
    return this.view.warmUpAssets(renderer, scene, camera, assetIds, compile);
  }

  /** Compiles `object`'s programs for the water's mirror; null when no mirror draws */
  compileForMirror(renderer: WebGLRenderer, object: Object3D, camera: Camera, scene: Scene): Promise<unknown> | null {
    return this.view.compileForMirror(renderer, object, camera, scene);
  }

  /** Meshes for the terrain shader's variants with more material layers, to compile ahead of a new layer */
  terrainLayerTwins(): Mesh[] {
    return this.view.terrainLayerTwins();
  }

  /** Water, lava and particle stand-ins, to compile before a brush brings the first one */
  effectTwins(): Mesh[] {
    return this.view.effectTwins();
  }

  updatePaths(): void {
    this.view.updatePaths();
  }

  /** Hears when the path mask was painted from the map as it is now (EditorPathMask takes over from there) */
  onPathMaskBuilt(fn: () => void): void {
    this.view.pathMaskBuilt = fn;
  }

  /** Where the paved road surface hides the ground, as laid now */
  roadCovers(): readonly RoadCover[] {
    return this.view.roadCovers();
  }

  /** Texels of the path mask the editor's worker painted; false when they are of another mask */
  setPathMask(m: { width: number; depth: number; resolution: number; rect: TexelRect; data: Uint8Array }): boolean {
    return this.view.setPathMask(m);
  }

  setEnvironment(): void {
    this.view.setEnvironment(this.doc.environment);
  }

  /** The map's life areas or switches changed */
  setLife(): void {
    this.view.setLife();
  }

  dispose(): void {
    this.view.environment.detach();
    this.view.dispose();
    this.view.losBlockers.removeFromParent();
  }

}

/** A rectangle given from the map's south-west corner, as map metres around the middle */
function metres(width: number, depth: number, x0: number, y0: number, x1: number, y1: number): MapRect {
  return { minX: x0 - width / 2, minY: y0 - depth / 2, maxX: x1 - width / 2, maxY: y1 - depth / 2 };
}
