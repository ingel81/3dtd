/**
 * The editor's handle on the custom map renderer (`world/custom-map/render/`,
 * the same view the game draws): the editor speaks in grid samples, splat
 * texels and object ids, the renderer in map metres and objects. Scene
 * space is the game's: scene x = -map x (east), scene z = map y (north),
 * y up.
 */
import { Vector3, type Camera, type Ray, type Scene, type WebGLRenderer } from 'three';
import type { CustomMapDocument, MapObject } from '../../world/custom-map/map-document';
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
  /** Objects the renderer holds by id (removing needs the objects themselves) */
  private known = new Map<string, MapObject>();
  /** Which objects the view shows (hidden categories left out); null shows all */
  private visible: ((o: MapObject) => boolean) | null = null;
  /**
   * The object list the renderer holds when it is not the document's own
   * (hidden categories): the renderer writes its list into its document,
   * so it gets a view of the document whose `objects` is its own
   */
  private shown: MapObject[] | null = null;

  constructor(
    private readonly doc: CustomMapDocument,
    scene: Scene,
    renderer: WebGLRenderer,
  ) {
    const own = new Proxy(doc, {
      get: (target, key, receiver) => (key === 'objects' ? (this.shown ?? target.objects) : Reflect.get(target, key, receiver)),
      set: (target, key, value, receiver) => {
        if (key !== 'objects') return Reflect.set(target, key, value, receiver);
        this.shown = value === target.objects ? null : (value as MapObject[]);
        return true;
      },
    });
    this.view = new CustomMapView(own, MapAssetLibrary.shared(), { anisotropy: renderer.capabilities.getMaxAnisotropy(), renderer });
    this.view.attach(scene);
    this.view.environment.apply(scene, renderer);
    this.known = new Map(doc.objects.map((o) => [o.id, o]));
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

  setObjects(): void {
    const shown = this.visible ? this.doc.objects.filter(this.visible) : this.doc.objects;
    void this.view.setObjects(shown);
    this.known = new Map(shown.map((o) => [o.id, o]));
  }

  /** Show only the objects `visible` accepts (null: all); rebuilds the batches */
  setVisible(visible: ((o: MapObject) => boolean) | null): void {
    this.visible = visible;
    this.setObjects();
  }

  /**
   * Some objects changed: new ones go in and gone ones out cell by cell (the
   * renderer rebuilds only their 192 m cells), the others move in place
   */
  updateObjects(ids: readonly string[]): void {
    const byId = new Map(this.doc.objects.map((o) => [o.id, o]));
    const added: MapObject[] = [];
    const removed: MapObject[] = [];
    const moved: MapObject[] = [];
    const was: MapObject[] = [];
    for (const id of ids) {
      const o = byId.get(id);
      const shown = !!o && (!this.visible || this.visible(o));
      const had = this.known.get(id);
      if (shown && !had) added.push(o!);
      else if (!shown && had) removed.push(had);
      else if (shown && had) {
        moved.push(o!);
        was.push(had);
        this.known.set(id, o!);
      }
    }
    this.view.updateObjects(moved, was);
    if (removed.length) {
      this.view.removeObjects(removed);
      for (const o of removed) this.known.delete(o.id);
    }
    if (added.length) {
      for (const o of added) this.known.set(o.id, o);
      void this.view.addObjects(added);
    }
  }

  /** Compiles the programs of assets not on the map yet (a biome or asset about to be placed) */
  warmUpAssets(renderer: WebGLRenderer, scene: Scene, camera: Camera, assetIds: string[]): Promise<number> {
    return this.view.warmUpAssets(renderer, scene, camera, assetIds);
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

}

/** A rectangle given from the map's south-west corner, as map metres around the middle */
function metres(width: number, depth: number, x0: number, y0: number, x1: number, y1: number): MapRect {
  return { minX: x0 - width / 2, minY: y0 - depth / 2, maxX: x1 - width / 2, maxY: y1 - depth / 2 };
}
