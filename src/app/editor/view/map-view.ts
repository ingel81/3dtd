/**
 * The editor's handle on the custom map renderer (`world/custom-map/render/`,
 * the same view the game draws): the editor speaks in grid samples, splat
 * texels and object ids, the renderer in map metres and objects. Scene
 * space is the game's: scene x = -map x (east), scene z = map y (north),
 * y up.
 */
import { Vector3, type Camera, type Ray, type Scene, type WebGLRenderer } from 'three';
import type { CustomMapDocument } from '../../world/custom-map/map-document';
import { CustomMapView, type MapRect } from '../../world/custom-map/render/custom-map-view';
import { MapAssetLibrary } from '../../world/custom-map/render/map-asset-library';
import { mapToScene as toScene } from '../../world/custom-map/render/map-coords';
import type { GridRect } from '../model/grid';

/** Scene position of a map point at a height */
export function mapToScene(x: number, y: number, height: number, target = new Vector3()): Vector3 {
  return toScene(x, y, height, target);
}

export class EditorMapView {
  readonly view: CustomMapView;
  /** Object ids the renderer holds, so a new or removed one asks for a full rebuild */
  private known = new Set<string>();

  constructor(
    private readonly doc: CustomMapDocument,
    scene: Scene,
    renderer: WebGLRenderer,
  ) {
    this.view = new CustomMapView(doc, MapAssetLibrary.shared(), { anisotropy: renderer.capabilities.getMaxAnisotropy() });
    this.view.attach(scene);
    this.view.environment.apply(scene, renderer);
    this.rememberObjects();
  }

  get group(): CustomMapView['group'] {
    return this.view.group;
  }

  get ready(): Promise<void> {
    return this.view.ready;
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

  setObjects(): void {
    void this.view.setObjects(this.doc.objects);
    this.rememberObjects();
  }

  /** Some objects changed; a new or removed one rebuilds the batches once */
  updateObjects(ids: readonly string[]): void {
    const byId = new Map(this.doc.objects.map((o) => [o.id, o]));
    if (ids.some((id) => !this.known.has(id) || !byId.has(id))) {
      this.setObjects();
      return;
    }
    for (const id of ids) this.view.updateObject(byId.get(id)!);
  }

  updatePaths(): void {
    this.view.updatePaths();
  }

  setEnvironment(): void {
    this.view.setEnvironment(this.doc.environment);
  }

  dispose(): void {
    this.view.environment.detach();
    this.view.dispose();
    this.view.losBlockers.removeFromParent();
  }

  private rememberObjects(): void {
    this.known = new Set(this.doc.objects.map((o) => o.id));
  }
}

/** A rectangle given from the map's south-west corner, as map metres around the middle */
function metres(width: number, depth: number, x0: number, y0: number, x1: number, y1: number): MapRect {
  return { minX: x0 - width / 2, minY: y0 - depth / 2, maxX: x1 - width / 2, maxY: y1 - depth / 2 };
}
