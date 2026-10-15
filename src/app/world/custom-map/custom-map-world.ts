import { isDevMode } from '@angular/core';
import { defaultOpenLanes, laneChoiceOf, laneChoiceProblem, type LaneChoice } from './lane-choice';
import { type Group, type Matrix4, type Object3D, type PerspectiveCamera, type Scene, Vector3, type WebGLRenderer, WebGLRenderTarget } from 'three';
import { MAX_SPAWN_PORTALS } from '../../configs/marker-geometry.config';
import type { CameraBounds, CameraRig } from '../../three-engine/camera-rig';
import { EllipsoidSync } from '../../three-engine/ellipsoid-sync';
import type { RootLoadFailure } from '../../three-engine/tile-loading-tracker';
import type {
  GroundHeights,
  StreetStyle,
  WorldAttachContext,
  IntroTour,
  WorldCapabilities,
  WorldMinimap,
  WorldProvider,
  WorldStartLayout,
  WorldLanes,
  WorldWaves,
} from '../world-provider';
import type { WorldRef } from '../world-ref';
import { runRulesOf, type RunRules, type RunWaveEvent } from '../../sim/protocol/run-rules';
import { MAX_START_WAVE, runStartAt, type RunStart } from '../../sim/protocol/run-start';
import { validateWaveTable, type WaveTable } from '../../director/sources/table/wave-table';
import { createWaveSource, initialWaveSourceId } from '../../director/wave-source.registry';
import { CustomMapFrame, CustomMapSurface } from './custom-map-surface';
import { CustomMapStreets } from './custom-map-streets';
import { type CustomMapDocument, type MapEnvironment, type MapObject, difficultyFactor, geoToMap, mapToGeo } from './map-document';
import { environmentAt, hiddenObjectsAt, messagesOf } from './wave-events';
import { CustomMapDestruction, FALLEN_SCALE, type StructureEntry } from './custom-map-destruction';
import { renderMinimapPicture } from './custom-map-minimap';
import { MapStore } from './map-store';
import type { MapAssetLibrary } from './render/map-asset-library';
import type { CustomMapView } from './render/custom-map-view';
import type { CustomMapQuality, QualityKnobs } from '../../three-engine/render-quality';
import { Soundscape } from './ambience/soundscape';
import { sceneToMap } from './render/map-coords';

/** A map of its own: no real place, nothing streams, no credentials, nothing to roll again */
export const CUSTOM_MAP_CAPABILITIES: WorldCapabilities = {
  realPlace: false,
  streaming: false,
  ecef: false,
  credentials: false,
  regenerate: false,
  destructible: false,
  ownEnvironment: true,
  enemyRimLight: true,
  groundShadows: true,
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

/** The credit line's note on the assets a custom map is drawn with (public/maps/assets/LICENSES.md) */
export const CUSTOM_MAP_ASSET_CREDIT = 'Assets: CC0, see licences';

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

/** The link's parameter of the wave a test run starts at (the editor's "Test map" from wave N) */
export const START_WAVE_PARAM = 'fromWave';

/**
 * The wave a run on the map starts at: `?fromWave=N` in the link (2 to
 * MAX_START_WAVE), else 1. A test parameter of the editor for one player; a
 * coop guest opens the map without it and would not match the host's world.
 */
export function customMapStartWave(search: string): number {
  const n = Number.parseInt(new URLSearchParams(search).get(START_WAVE_PARAM) ?? '', 10);
  return Number.isFinite(n) && n > 1 ? Math.min(n, MAX_START_WAVE) : 1;
}

/**
 * The map opened before its world is made (WorldFactory.startHq loads,
 * create takes; the coop host packs it), by map id. Only the last one:
 * a page plays one map, and another world reloads the page
 */
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
  opened.clear();
  opened.set(ref.mapId, loaded);
  return loaded;
}

/**
 * Starts fetching and decoding the map's ground materials and models (and
 * the renderer's code) while the start flow builds the engine, streets and
 * routes; the view takes them from the library's cache when it attaches.
 */
export function prefetchCustomMapAssets(doc: CustomMapDocument): void {
  void import('./render/custom-map-view');
  void import('./render/map-asset-library')
    .then(({ MapAssetLibrary }) => {
      const library = MapAssetLibrary.shared();
      const materials = new Set([...doc.terrain.layers.map((l) => l.material), doc.terrain.cliffMaterial]);
      for (const id of materials) library.prefetchMaterial(id).catch(() => undefined);
      for (const id of new Set(doc.objects.map((o) => o.asset))) {
        library.model(id).catch(() => undefined);
        library.lodModels(id).catch(() => undefined);
      }
    })
    .catch(() => undefined);
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
  readonly capabilities: WorldCapabilities;
  readonly sync: EllipsoidSync;
  readonly frame = new CustomMapFrame();
  readonly surface: CustomMapSurface;
  readonly streets: CustomMapStreets;
  readonly streetStyle = CUSTOM_MAP_STREET_STYLE;
  readonly tiles = null;
  readonly doc: CustomMapDocument;
  /** Its buildings, walls and structures that fall; null unless the map says so (gameplay.destructible) */
  readonly destruction: CustomMapDestruction | null;

  private view: CustomMapView | null = null;
  /** The quality level's custom-map part, kept for a view made after it came */
  private quality: CustomMapQuality | null = null;
  private lastUpdate = 0;
  private prepared = false;
  private rig: CameraRig | null = null;
  private readonly focus = new Vector3();
  private readonly lookDirection = new Vector3();
  private readonly firstGroundWaiters: (() => void)[] = [];
  /** dispose() ran: an attach still waiting for the renderer's code builds nothing */
  private disposed = false;
  /** The catalogue's objects once loaded: the build blocking is redone with them when a structure falls */
  private catalogObjects: readonly (StructureEntry & { blocksBuild: boolean })[] = [];
  /** Objects lying fallen (destruction) and objects a wave event keeps out of the picture now */
  private readonly fallenIds = new Set<string>();
  private eventHidden = new Set<string>();
  /** The scale an object out of the picture had, to stand it up again */
  private readonly outScale = new Map<string, number>();
  /** The map's own sky and weather, before its wave events change them */
  private readonly baseEnvironment: MapEnvironment;
  /** What the minimap picture renders: the scene and the children the map put into it */
  private stage: { scene: Scene; renderer: WebGLRenderer; owned: Set<Object3D>; fog: { value: number }; drawsToTarget: () => boolean } | null = null;
  private minimapPicture: HTMLCanvasElement | null = null;
  /** The map's lanes and their bounds (lane-choice.ts) */
  private readonly laneChoice: LaneChoice;
  /** The lanes the player opened before wave 1, null: the map's first (TODO E130) */
  private chosenLanes: string[] | null = null;
  private highest: number | null = null;
  /** The map's ambient sound (ambience/soundscape.ts), with the game's audio; null without */
  private soundscape: Soundscape | null = null;
  private soundVolume: () => number = () => 0;
  private readonly cameraRight = new Vector3();
  private readonly listenerScene = new Vector3();
  private readonly listenerAt = { x: 0, y: 0 };

  constructor(
    private readonly map: LoadedCustomMap,
    origin: { lat: number; lon: number; height: number },
    private readonly spawnLimit = MAX_SPAWN_PORTALS,
    /** The asset library the view loads from; the shared one by default */
    private readonly assets: (() => MapAssetLibrary) | null = null,
    /** Buildings, walls and structures take damage and fall (TODO E131); the map's own say by default */
    destructible = map.doc.gameplay?.destructible === true,
    /** The wave runs start at (customMapStartWave), 1 for a normal run */
    private readonly startWave = 1,
  ) {
    // A fallen object, one a wave event hides and a sky the events change leave the run's own copy, never the opened map
    const events = map.doc.gameplay?.events ?? [];
    this.doc = destructible || events.length ? { ...map.doc, objects: map.doc.objects.map((o) => ({ ...o })) } : map.doc;
    this.baseEnvironment = map.doc.environment;
    this.capabilities = destructible ? { ...CUSTOM_MAP_CAPABILITIES, destructible: true } : CUSTOM_MAP_CAPABILITIES;
    this.laneChoice = laneChoiceOf(this.doc.spawns, this.doc.gameplay, spawnLimit);
    this.destruction = destructible
      ? new CustomMapDestruction(() => this.doc.objects, (fallen) => this.fell(fallen), (risen) => this.rose(risen))
      : null;
    this.sync = new EllipsoidSync(origin.lat, origin.lon, origin.height);
    this.frame.setOrigin(origin.lat, origin.lon);
    this.surface = new CustomMapSurface(this.doc, this.frame);
    this.streets = new CustomMapStreets(this.doc);
    // The sky and objects of the first wave to play, before the simulation says so: nothing shows that it hides
    this.showWaveEvents(startWave);
  }

  get ref(): WorldRef {
    return { kind: 'custom-map', mapId: this.doc.meta.id, contentHash: this.map.contentHash, name: this.doc.meta.name };
  }

  async attach(ctx: WorldAttachContext): Promise<void> {
    if (isDevMode()) console.log(`[CustomMap] ${this.doc.meta.name} instead of 3D tiles`);
    // The renderer loads with the first map: the registry and the game start stay light without it
    const [{ CustomMapView }, { MapAssetLibrary }, { CustomMapEnvironment }, { HEIGHT_FOG_UNIFORMS }] = await Promise.all([
      import('./render/custom-map-view'),
      import('./render/map-asset-library'),
      import('./render/environment/map-environment'),
      import('./render/environment/height-fog'),
    ]);
    // Disposed while the renderer loaded (the start gave up, another world): nothing into a scene that is gone
    if (this.disposed) return;
    // Ground layers as GPU-compressed textures for this renderer's GPU (the library's pixels where a file has none)
    MapAssetLibrary.useCompressedTextures(ctx.renderer);
    const view = new CustomMapView(this.doc, this.assets ? this.assets() : MapAssetLibrary.shared(), {
      anisotropy: ctx.renderer.capabilities.getMaxAnisotropy(),
      // Bakes the impostors of far trees
      renderer: ctx.renderer,
    });
    this.view = view;
    if (this.quality) view.applyQuality(this.quality);
    this.placeView();
    const before = new Set(ctx.scene.children);
    // The group and the sight blockers as direct children of the scene: the LOS cube renders only the latter
    view.attach(ctx.scene);
    // The map's sky, sun with shadows, fill light and fog; the engine added none (capabilities.ownEnvironment)
    CustomMapEnvironment.enableShadows(ctx.renderer);
    view.environment.apply(ctx.scene, ctx.renderer);
    this.stage = {
      scene: ctx.scene,
      renderer: ctx.renderer,
      owned: new Set(ctx.scene.children.filter((child) => !before.has(child))),
      fog: HEIGHT_FOG_UNIFORMS.uFogDensity,
      drawsToTarget: ctx.drawsToTarget,
    };
    // Over the HQ at the scene origin, controls that raycast the map's ground and objects
    ctx.cameraRig.setupEnvironmentControls(ctx.scene, view.losBlockers);
    this.rig = ctx.cameraRig;
    ctx.cameraRig.setBounds(this.cameraBounds());

    // The catalogue tells which objects forbid building and which can fall: before the world goes to the
    // simulation, whose run rules carry the structures (runRules)
    try {
      const catalog = await view.assets.catalog();
      if (this.view === view) this.useCatalog(catalog.objects);
    } catch (err) {
      console.warn('[CustomMap] no catalogue, objects do not block building', err);
    }

    // The map's ambient sound, through the game's master bus
    if (ctx.audio) {
      this.soundscape = new Soundscape(ctx.audio);
      this.soundscape.setMap(this.doc);
      this.soundVolume = ctx.audio.volume;
    }

    // Streets, spawns and routes go on while the map's textures and models load and its shaders compile
    void this.prepare(ctx, view);
  }

  /**
   * The map's first frame without stalls: its ground materials and models
   * loaded (view.ready), then every program of the scene compiled in parallel
   * off the main thread (view.warmUp: compileAsync, KHR_parallel_shader_compile) before
   * the first draw. Drawn before, each new material links its program
   * synchronously in the frame that first shows it: some 3 s on the main
   * thread for the demo valley. Until then `ready()` holds the frames back.
   */
  private async prepare(ctx: WorldAttachContext, view: CustomMapView): Promise<void> {
    await view.ready.catch((err) => console.warn('[CustomMap] assets did not load', err));
    if (this.view !== view) return;
    performance.mark('load:map-assets:done');
    // Every program the scene needs, the map's hidden levels, cells and effects and the sun's shadow pass
    // included, for the output the frames draw to: with bloom or grading on that is the composer's linear
    // target, and programs for the screen would all link again in the first frame
    const target = ctx.drawsToTarget() ? new WebGLRenderTarget(1, 1) : null;
    await view
      .warmUp(ctx.renderer, ctx.scene, ctx.camera, target)
      .catch((err) => console.warn('[CustomMap] shaders did not compile ahead', err));
    target?.dispose();
    if (this.view !== view) return;
    performance.mark('load:map-shaders:done');
    this.prepared = true;
    for (const waiter of this.firstGroundWaiters.splice(0)) waiter();
  }

  /** Frames draw once the map is prepared (prepare) */
  ready(): boolean {
    return this.prepared;
  }

  setOrigin(lat: number, lon: number, height: number): void {
    this.sync.setOrigin(lat, lon, height);
    this.frame.setOrigin(lat, lon);
    this.placeView();
    this.rig?.setBounds(this.cameraBounds());
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
    // A ray past a ridge into the sky (or from beyond the map) hits nothing: the box goes on the ground ahead,
    // not around the camera in the air, where no tree cast and every shadow went at once
    if (!this.surface.groundAlong(this.focus, this.lookDirection, this.focus)) this.surface.groundAhead(this.focus, this.lookDirection, this.focus);
    this.view.update(dt, camera, this.focus);
    this.hear(dt, camera);
  }

  /** The soundscape heard from the ground the camera looks at */
  private hear(dt: number, camera: PerspectiveCamera): void {
    const sound = this.soundscape;
    const view = this.view;
    if (!sound || !view) return;
    sound.setVolume(this.soundVolume());
    const height = camera.position.y - this.focus.y;
    sceneToMap(view.group.worldToLocal(this.listenerScene.copy(this.focus)), this.listenerAt);
    // The camera's right in the map's frame: scene x is minus map x
    this.cameraRight.setFromMatrixColumn(camera.matrixWorld, 0);
    const len = Math.hypot(this.cameraRight.x, this.cameraRight.z) || 1;
    sound.update(dt, { at: this.listenerAt, height, right: { x: -this.cameraRight.x / len, y: this.cameraRight.z / len }, darkness: view.environment.darkness });
  }

  resize(_camera: PerspectiveCamera, _renderer: WebGLRenderer): void {
    // no resolution to follow
  }

  setDrawSuppressed(): void {
    // no queues to widen
  }

  /** The level's custom-map part: shadows, detail, impostors, grass, the map's particles and lights */
  applyQuality(knobs: QualityKnobs): void {
    this.quality = knobs.customMaps;
    this.view?.applyQuality(knobs.customMaps);
  }

  /** A tower came or went: the map's cached sun shadow map renders again */
  invalidateShadows(): void {
    this.view?.environment.invalidateShadows();
  }

  /** The terrain's height texture and where the map stands in the scene (the units' blob shadows lie on it) */
  groundHeights(): GroundHeights | null {
    const view = this.view;
    if (!view) return null;
    const u = view.heightUniforms;
    return { heights: u.uTerrainHeights.value, grid: u.uTerrainGrid.value, gridSize: u.uTerrainGridSize.value, origin: view.group.position };
  }

  /** Terrain and sight-blocking objects, a direct child of the scene (the TowerShadowMapper hides every other child) */
  losBlockers(): Object3D | null {
    return this.view?.losBlockers ?? null;
  }

  sceneToEcef(_target: Matrix4): Matrix4 | null {
    return null;
  }

  /** The map with its author, the data it was made of (an OSM world's: OpenStreetMap, the heights), and the licence of the assets it is drawn with */
  attribution(): string[] {
    const { name, author, source } = this.doc.meta;
    const data = source?.kind === 'osm' ? source.attribution : [];
    return [author ? `${name} by ${author}` : name, ...data, CUSTOM_MAP_ASSET_CREDIT];
  }

  onFirstGround(callback: () => void): void {
    if (this.prepared) callback();
    else this.firstGroundWaiters.push(callback);
  }

  /** The map is in memory: nothing to refuse, nothing to reach */
  onLoadFailure(_callback: (failure: RootLoadFailure | null) => void): void {
    // never fails to load
  }

  retryLoad(): void {
    // nothing failed
  }

  /**
   * The map's start credits, HQ health and tower types (MapGameplay), held
   * in bounds (runRulesOf), and a start past wave 1 (runStartAt, with the
   * gold of the waves the map plays); null where it sets none of them, so
   * the world plays the game's and its key stays as without
   */
  runRules(): RunRules | null {
    const play = this.doc.gameplay;
    // A destructible map's structures: the simulation keeps their HP (TODO E131)
    const structures = this.destruction?.asRunStructures() ?? [];
    const start = this.runStart();
    const events = this.runEvents();
    if (!structures.length && !start && !events.length && (!play || (play.startCredits === undefined && play.hqHealth === undefined && !play.towers?.length))) return null;
    return runRulesOf({ ...play, structures, start, events });
  }

  /**
   * The map's wave events for the simulation (TODO E170): the objects of an
   * objects event with where they stand and their ground radius at the scale
   * they were made with (not one a hidden or fallen object has now), for the
   * towers whose sight they change
   */
  private runEvents(): RunWaveEvent[] {
    const events = this.doc.gameplay?.events ?? [];
    if (!events.length) return [];
    const byId = new Map(this.doc.objects.map((o) => [o.id, o]));
    const footprint = new Map(this.catalogObjects.map((e) => [e.id, e.footprint]));
    return events.map((e): RunWaveEvent => {
      if (e.kind !== 'objects') return e;
      const objects = e.ids.flatMap((id) => {
        const o = byId.get(id);
        if (!o) return [];
        const radius = Math.round((footprint.get(o.asset) ?? 1) * (this.outScale.get(id) ?? o.scale) * 100) / 100;
        return [{ id, ...mapToGeo(o), radius }];
      });
      return { ...e, objects };
    });
  }

  /** The messages of the map's events before `wave` */
  waveMessages(wave: number): string[] {
    return messagesOf(this.doc.gameplay?.events ?? [], wave);
  }

  /**
   * The wave events up to `wave` happened (op `waveEvents.setReached`): the
   * sky and weather of then, and the objects they show or hide in or out of
   * the picture and the build blocking (as a fallen structure)
   */
  showWaveEvents(wave: number): void {
    const events = this.doc.gameplay?.events;
    if (!events?.length) return;
    const env = environmentAt(this.baseEnvironment, events, wave);
    if (JSON.stringify(env) !== JSON.stringify(this.doc.environment)) {
      if (this.view) this.view.setEnvironment(env);
      else this.doc.environment = env;
    }
    const hidden = hiddenObjectsAt(events, wave);
    const changed = this.doc.objects.filter((o) => hidden.has(o.id) !== this.eventHidden.has(o.id));
    this.eventHidden = hidden;
    if (changed.length) this.takeOut(changed);
  }

  /** Where a test run starts past wave 1, with the gold of the waves this map plays (its own list, else the player's source) */
  private runStart(): RunStart | null {
    if (this.startWave <= 1) return null;
    const waves = this.worldWaves();
    const source = waves?.source ?? initialWaveSourceId(typeof window === 'undefined' ? '' : window.location.search);
    return runStartAt(this.startWave, createWaveSource(source, waves?.table ? { table: waves.table } : {}).rules);
  }

  /**
   * The map's waves: the game's budget source, or its own list for the table
   * source, and its difficulty on the budget (difficultyFactor). A list with
   * mistakes (validateWaveTable) is left out with a warning: the game's
   * choice plays instead.
   */
  worldWaves(): WorldWaves | null {
    const waves = this.doc.gameplay?.waves;
    const difficulty = difficultyFactor(this.doc.gameplay);
    const scaled = difficulty !== 1 ? { difficulty } : {};
    if (!waves) return difficulty !== 1 ? { source: null, ...scaled } : null;
    if (waves.kind === 'budget') return { source: 'budget', ...scaled };
    const table = waves.table as unknown as WaveTable;
    const problems = validateWaveTable(table);
    if (problems.length > 0) {
      console.warn(`[CustomMap] the map's wave list is not used: ${problems.slice(0, 3).join('; ')}`);
      return difficulty !== 1 ? { source: null, ...scaled } : null;
    }
    return { source: 'table', table, ...scaled };
  }

  /**
   * HQ (where the start flow put the origin) and the open lanes among the
   * first `spawnLimit` spawns (customMapSpawnLimit, lanes()), each with its
   * place in the map's list
   */
  startLayout(): WorldStartLayout {
    const open = new Set(this.openLanes());
    return {
      hq: mapToGeo(this.doc.hq),
      spawns: this.doc.spawns.slice(0, this.spawnLimit)
        .map((s, slot) => ({ id: s.id, name: s.name, ...mapToGeo(s), slot }))
        .filter((s) => open.has(s.id)),
    };
  }

  /** The map's lanes (TODO E130): switched before wave 1 where some are optional, closed when a coop room leaves them free */
  lanes(): WorldLanes | null {
    const choice = this.laneChoice;
    if (choice.lanes.length === 0) return null;
    return {
      choice,
      open: () => this.openLanes(),
      setOpen: (ids, vacancy = false) => {
        const known = ids.length > 0 && ids.every((id) => choice.lanes.some((l) => l.id === id));
        if (vacancy ? !known : laneChoiceProblem(choice, ids) !== null) return false;
        this.chosenLanes = choice.lanes.filter((l) => ids.includes(l.id)).map((l) => l.id);
        return true;
      },
    };
  }

  /** The lanes open now: the player's choice, else the map's first (defaultOpenLanes) */
  private openLanes(): readonly string[] {
    return this.chosenLanes ?? defaultOpenLanes(this.laneChoice);
  }

  /**
   * From the HQ past every spawn of the run, in turn around the HQ starting
   * with the farthest: the whole map in one flight
   */
  introTour(): IntroTour | null {
    const spawns = this.startLayout().spawns.map((s) => {
      const p = geoToMap(s.lat, s.lon);
      return { x: this.frame.sceneX(p.x), z: this.frame.sceneZ(p.y) };
    });
    if (spawns.length < 2) return null;
    const hq = { x: this.frame.sceneX(this.doc.hq.x), z: this.frame.sceneZ(this.doc.hq.y) };
    const angle = (p: { x: number; z: number }): number => Math.atan2(p.z - hq.z, p.x - hq.x);
    const far = spawns.reduce((a, b) => (Math.hypot(b.x - hq.x, b.z - hq.z) > Math.hypot(a.x - hq.x, a.z - hq.z) ? b : a));
    const start = angle(far);
    const turn = (p: { x: number; z: number }): number => (angle(p) - start + Math.PI * 4) % (Math.PI * 2);
    const ordered = [...spawns].sort((a, b) => turn(a) - turn(b));
    return { points: [hq, ...ordered], portals: ordered };
  }

  /**
   * The map from above, rendered once after its first drawn frame (its
   * levels of detail set) from the map's own scene children only
   */
  minimap(): WorldMinimap | null {
    const { width, depth } = this.doc.terrain;
    const area = {
      left: this.frame.sceneX(-width / 2),
      right: this.frame.sceneX(width / 2),
      top: this.frame.sceneZ(depth / 2),
      bottom: this.frame.sceneZ(-depth / 2),
    };
    if (!this.minimapPicture) {
      if (!this.prepared || !this.stage || !this.view || this.lastUpdate === 0) return null;
      const { scene, renderer, owned, fog, drawsToTarget } = this.stage;
      try {
        this.minimapPicture = renderMinimapPicture(renderer, scene, owned, area, this.topHeight(), fog, !drawsToTarget());
      } catch (err) {
        console.warn('[CustomMap] no minimap picture', err);
        this.stage = null;
        return null;
      }
    }
    return { picture: this.minimapPicture, ...area };
  }

  regenerate(): Promise<void> {
    return Promise.reject(new Error('A custom map cannot be rolled again'));
  }

  dispose(): void {
    this.disposed = true;
    this.rig?.setBounds(null);
    this.rig = null;
    // The shared library keeps every material's pixels (some 88 MB); the next map's shared() makes a new one
    if (this.view && !this.assets) this.view.assets.dispose();
    this.view?.dispose();
    this.view = null;
    this.soundscape?.dispose();
    this.soundscape = null;
    this.stage = null;
    this.minimapPicture = null;
  }

  /**
   * The camera over the map: its position at most a third of the map's
   * larger side beyond the edge (the steep view from there still shows the
   * edge), at least 3 m over the ground, at most high enough for the whole
   * map in view
   */
  cameraBounds(): CameraBounds {
    const { width, depth } = this.doc.terrain;
    const size = Math.max(width, depth);
    const margin = size / 3;
    const top = this.topHeight();
    return {
      minX: this.frame.sceneX(width / 2) - margin,
      maxX: this.frame.sceneX(-width / 2) + margin,
      minZ: this.frame.sceneZ(-depth / 2) - margin,
      maxZ: this.frame.sceneZ(depth / 2) + margin,
      minHeight: 3,
      maxHeight: Math.max(0, top) + Math.max(300, size * 1.4),
      groundAt: (x, z) => this.surface.heightAtMap(this.frame.mapX(x), this.frame.mapY(z)),
    };
  }

  /** The catalogue's objects: what blocks building, what can fall */
  useCatalog(objects: readonly (StructureEntry & { blocksBuild: boolean })[]): void {
    this.catalogObjects = objects;
    this.surface.setObjectCatalog(objects);
    if (!this.destruction) return;
    this.destruction.setCatalog(objects);
    if (isDevMode()) console.log(`[CustomMap] ${this.destruction.structures().length} structures can fall`);
  }

  /** Fallen structures shrink to next to nothing in the view (FALLEN_SCALE) and stop blocking the build */
  private fell(objects: readonly MapObject[]): void {
    if (isDevMode()) console.log(`[CustomMap] fell: ${objects.map((o) => `${o.asset} ${o.id}`).join(', ')}`);
    for (const o of objects) this.fallenIds.add(o.id);
    this.takeOut(objects);
  }

  /** A reset stands them up again */
  private rose(objects: readonly MapObject[]): void {
    for (const o of objects) this.fallenIds.delete(o.id);
    this.takeOut(objects);
  }

  /**
   * Objects out of the picture while fallen or hidden by a wave event:
   * shrunk to next to nothing (FALLEN_SCALE), so they neither show, block
   * sight nor block building; back at their scale once neither holds
   */
  private takeOut(objects: readonly MapObject[]): void {
    for (const o of objects) {
      const out = this.fallenIds.has(o.id) || this.eventHidden.has(o.id);
      const kept = this.outScale.get(o.id);
      if (out && kept === undefined) {
        this.outScale.set(o.id, o.scale);
        o.scale = FALLEN_SCALE;
      } else if (!out && kept !== undefined) {
        o.scale = kept;
        this.outScale.delete(o.id);
      }
    }
    this.view?.updateObjects(objects);
    this.surface.setObjectCatalog(this.catalogObjects);
  }

  /** The highest ground sample */
  private topHeight(): number {
    if (this.highest === null) {
      let top = -Infinity;
      for (const h of this.doc.terrain.grid.heights) if (h > top) top = h;
      this.highest = top;
    }
    return this.highest;
  }

  /** The map's middle where the frame puts map (0, 0) */
  private placeView(): void {
    if (!this.view) return;
    this.view.group.position.set(this.frame.sceneX(0), 0, this.frame.sceneZ(0));
    this.view.losBlockers.position.copy(this.view.group.position);
  }
}
