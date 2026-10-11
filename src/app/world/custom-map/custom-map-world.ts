import { isDevMode } from '@angular/core';
import type { Group, Matrix4, Object3D, PerspectiveCamera, WebGLRenderer } from 'three';
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

/**
 * A geographic point near `geo` whose degrees come back unchanged through
 * radians. The simulation gets the run's origin through
 * `EllipsoidSync.getOrigin` (degrees to radians and back) while the main
 * thread converts with the degrees it was given; where they differ by the
 * last bit, route points that lie exactly on a 2 m cell border (a map's
 * nodes at whole metres do) fall into different cells on the two sides, and
 * the simulation refuses the world. Rounded to the location's 6 decimals,
 * then nudged by 1e-9 degrees (0.1 mm) until the round trip is exact.
 */
export function stableGeo(geo: { lat: number; lon: number }): { lat: number; lon: number } {
  const stable = (v: number): number => {
    const base = Math.round(v * 1e6) / 1e6;
    for (let k = 0; k < 64; k++) {
      for (const c of [base + k * 1e-9, base - k * 1e-9]) {
        if (((c * Math.PI) / 180) * (180 / Math.PI) === c) return c;
      }
    }
    return base;
  };
  return { lat: stable(geo.lat), lon: stable(geo.lon) };
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
    const [{ CustomMapView }, { MapAssetLibrary }] = await Promise.all([
      import('./render/custom-map-view'),
      import('./render/map-asset-library'),
    ]);
    const view = new CustomMapView(this.doc, this.assets ? this.assets() : MapAssetLibrary.shared());
    this.view = view;
    this.placeView();
    ctx.scene.add(view.group);
    view.setEnvironment(this.doc.environment);
    // Textures and models load behind the ground, which stands at once
    view.ready.catch((err) => console.warn('[CustomMap] assets did not load', err));

    // Over the HQ at the scene origin, controls that raycast the map's ground
    ctx.cameraRig.setupEnvironmentControls(ctx.scene, view.group);

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
    this.view?.update(dt, camera);
  }

  resize(_camera: PerspectiveCamera, _renderer: WebGLRenderer): void {
    // no resolution to follow
  }

  setDrawSuppressed(): void {
    // no queues to widen
  }

  /** The view's whole group, a direct child of the scene (the TowerShadowMapper hides every other child) */
  losBlockers(): Object3D | null {
    return this.view?.group ?? null;
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

  /** HQ (as stableGeo moves it, where the start flow put the origin) and the first `spawnLimit` spawns (customMapSpawnLimit) */
  startLayout(): WorldStartLayout {
    return {
      hq: stableGeo(mapToGeo(this.doc.hq)),
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
    this.view?.group.position.set(this.frame.sceneX(0), 0, this.frame.sceneZ(0));
  }
}
