import { isDevMode } from '@angular/core';
import { type Group, type Matrix4, type Object3D, type PerspectiveCamera, Vector3, type WebGLRenderer } from 'three';
import { MAX_SPAWN_PORTALS } from '../../configs/marker-geometry.config';
import { EllipsoidSync } from '../../three-engine/ellipsoid-sync';
import type { RootLoadFailure } from '../../three-engine/tile-loading-tracker';
import type {
  StreetStyle,
  WorldAttachContext,
  WorldCapabilities,
  WorldProvider,
  WorldStartLayout,
} from '../world-provider';
import type { WorldRef } from '../world-ref';
import { CustomMapFrame, CustomMapSurface } from './custom-map-surface';
import { CustomMapStreets } from './custom-map-streets';
import { type CustomMapDocument, mapToGeo } from './map-document';
import { MapStore } from './map-store';
import type { MapAssetLibrary } from './render/map-asset-library';
import type { CustomMapView } from './render/custom-map-view';

/** A map of its own: no real place, nothing streams, no credentials, nothing to roll again */
export const CUSTOM_MAP_CAPABILITIES: WorldCapabilities = {
  realPlace: false,
  streaming: false,
  ecef: false,
  credentials: false,
  regenerate: false,
  destructible: false,
  ownEnvironment: true,
  controls: 'environment',
};

/**
 * Roads the map draws itself into its ground: the debug street overlay and
 * the route line a little above them, cut into 4 m pieces so they follow
 * ramps and cliffs, heights from the plain terrain (bridge decks included),
 * no off-street leg carried on.
 */
export const CUSTOM_MAP_STREET_STYLE: StreetStyle = {
  overlayLift: 0.5,
  routeLineLift: 1.5,
  subdivideM: 4,
  plainGround: true,
  carryOffStreet: false,
};

/** A map as the game plays it: the document and the hash its WorldRef carries */
export interface LoadedCustomMap {
  doc: CustomMapDocument;
  contentHash: string;
}

/**
 * How many of the map's spawns a run uses: `?spawns=N` in the link (1 to
 * MAX_SPAWN_PORTALS), else all of them up to that cap. The game shows a
 * portal for at most MAX_SPAWN_PORTALS; spawns past it stay unused.
 */
export function customMapSpawnLimit(search: string): number {
  const n = Number.parseInt(new URLSearchParams(search).get('spawns') ?? '', 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_SPAWN_PORTALS) : MAX_SPAWN_PORTALS;
}

/** Maps opened before their world is made (WorldFactory.startHq loads, create takes), by map id */
const opened = new Map<string, LoadedCustomMap>();

/**
 * Loads the map a ref names from the map store (own maps in IndexedDB, then
 * the shipped ones) and keeps it for `openedCustomMap`. Throws with a
 * readable message when there is no such map or its content is not the one
 * the ref names.
 */
export async function openCustomMap(ref: WorldRef & { kind: 'custom-map' }, store: MapStore = new MapStore()): Promise<LoadedCustomMap> {
  const { doc, summary } = await store.load(ref.mapId);
  if (ref.contentHash && summary.contentHash && ref.contentHash !== summary.contentHash) {
    throw new Error(`the map "${doc.meta.name}" here is not the one this run was played on`);
  }
  const loaded = { doc, contentHash: summary.contentHash };
  opened.set(ref.mapId, loaded);
  return loaded;
}

/** The map `openCustomMap` loaded for this ref, null before */
export function openedCustomMap(ref: WorldRef & { kind: 'custom-map' }): LoadedCustomMap | null {
  return opened.get(ref.mapId) ?? null;
}

/**
 * A custom map as a WorldProvider (docs/WORLD_PROVIDER_PLAN.md): the map's
 * CustomMapView in the scene, EnvironmentControls over it, its paths as the
 * street network, HQ and spawns from the document.
 *
 * The scene origin is the run's origin (the map's HQ, as the start flow sets
 * it); the view's group is moved so the map lies right around it, and the
 * surface converts scene and map coordinates through the same frame.
 */
export class CustomMapWorld implements WorldProvider {
  readonly capabilities = CUSTOM_MAP_CAPABILITIES;
  readonly sync: EllipsoidSync;
  readonly frame = new CustomMapFrame();
  readonly surface: CustomMapSurface;
  readonly streets: CustomMapStreets;
  readonly streetStyle = CUSTOM_MAP_STREET_STYLE;
  readonly tiles = null;
  readonly doc: CustomMapDocument;

  private view: CustomMapView | null = null;
  private lastUpdate = 0;
  private readonly focus = new Vector3();
  private readonly lookDirection = new Vector3();
  private readonly firstGroundWaiters: (() => void)[] = [];

  constructor(
    private readonly map: LoadedCustomMap,
    origin: { lat: number; lon: number; height: number },
    private readonly spawnLimit = MAX_SPAWN_PORTALS,
    /** The asset library the view loads from; the shared one by default */
    private readonly assets: (() => MapAssetLibrary) | null = null,
  ) {
    this.doc = map.doc;
    this.sync = new EllipsoidSync(origin.lat, origin.lon, origin.height);
    this.frame.setOrigin(origin.lat, origin.lon);
    this.surface = new CustomMapSurface(this.doc, this.frame);
    this.streets = new CustomMapStreets(this.doc);
  }

  get ref(): WorldRef {
    return { kind: 'custom-map', mapId: this.doc.meta.id, contentHash: this.map.contentHash, name: this.doc.meta.name };
  }

  async attach(ctx: WorldAttachContext): Promise<void> {
    if (isDevMode()) console.log(`[CustomMap] ${this.doc.meta.name} instead of 3D tiles`);
    // The renderer loads with the first map: the registry and the game start stay light without it
    const [{ CustomMapView }, { MapAssetLibrary }, { CustomMapEnvironment }] = await Promise.all([
      import('./render/custom-map-view'),
      import('./render/map-asset-library'),
      import('./render/environment/map-environment'),
    ]);
    const view = new CustomMapView(this.doc, this.assets ? this.assets() : MapAssetLibrary.shared(), {
      anisotropy: ctx.renderer.capabilities.getMaxAnisotropy(),
    });
    this.view = view;
    this.placeView();
    // The group and the sight blockers as direct children of the scene: the LOS cube renders only the latter
    view.attach(ctx.scene);
    // The map's sky, sun with shadows, fill light and fog; the engine added none (capabilities.ownEnvironment)
    CustomMapEnvironment.enableShadows(ctx.renderer);
    view.environment.apply(ctx.scene, ctx.renderer);
    // Textures and models load behind the ground, which stands at once
    view.ready.catch((err) => console.warn('[CustomMap] assets did not load', err));

    // Over the HQ at the scene origin, controls that raycast the map's ground and objects
    ctx.cameraRig.setupEnvironmentControls(ctx.scene, view.losBlockers);

    for (const waiter of this.firstGroundWaiters.splice(0)) waiter();
  }

  ready(): boolean {
    return true;
  }

  setOrigin(lat: number, lon: number, height: number): void {
    this.sync.setOrigin(lat, lon, height);
    this.frame.setOrigin(lat, lon);
    this.placeView();
  }

  /** LOD, wind and water of the view; the overlay stands at the scene's zero, nothing moves under it */
  update(camera: PerspectiveCamera, overlay: Group): void {
    overlay.position.y = 0;
    const now = performance.now();
    const dt = this.lastUpdate ? Math.min(0.25, (now - this.lastUpdate) / 1000) : 0;
    this.lastUpdate = now;
    if (!this.view) return;
    // The sun's shadow box around the ground the camera looks at
    camera.getWorldPosition(this.focus);
    camera.getWorldDirection(this.lookDirection);
    if (!this.surface.groundAlong(this.focus, this.lookDirection, this.focus)) camera.getWorldPosition(this.focus);
    this.view.update(dt, camera, this.focus);
  }

  resize(_camera: PerspectiveCamera, _renderer: WebGLRenderer): void {
    // no resolution to follow
  }

  setDrawSuppressed(): void {
    // no queues to widen
  }

  /** Terrain and sight-blocking objects, a direct child of the scene (the TowerShadowMapper hides every other child) */
  losBlockers(): Object3D | null {
    return this.view?.losBlockers ?? null;
  }

  sceneToEcef(_target: Matrix4): Matrix4 | null {
    return null;
  }

  attribution(): string {
    const { name, author } = this.doc.meta;
    return author ? `${name} by ${author}` : '';
  }

  onFirstGround(callback: () => void): void {
    if (this.view) callback();
    else this.firstGroundWaiters.push(callback);
  }

  /** The map is in memory: nothing to refuse, nothing to reach */
  onLoadFailure(_callback: (failure: RootLoadFailure) => void): void {
    // never fails to load
  }

  /** HQ (where the start flow put the origin) and the first `spawnLimit` spawns (customMapSpawnLimit) */
  startLayout(): WorldStartLayout {
    return {
      hq: mapToGeo(this.doc.hq),
      spawns: this.doc.spawns.slice(0, this.spawnLimit).map((s) => ({ id: s.id, name: s.name, ...mapToGeo(s) })),
    };
  }

  regenerate(): Promise<void> {
    return Promise.reject(new Error('A custom map cannot be rolled again'));
  }

  dispose(): void {
    this.view?.dispose();
    this.view = null;
  }

  /** The map's middle where the frame puts map (0, 0) */
  private placeView(): void {
    if (!this.view) return;
    this.view.group.position.set(this.frame.sceneX(0), 0, this.frame.sceneZ(0));
    this.view.losBlockers.position.copy(this.view.group.position);
  }
}
