import { isDevMode } from '@angular/core';
import { defaultOpenLanes, laneChoiceOf, laneChoiceProblem, type LaneChoice } from './lane-choice';
import { type Camera, type Group, type Matrix4, type Object3D, type PerspectiveCamera, type Raycaster, type Scene, Vector3, type WebGLRenderer, WebGLRenderTarget } from 'three';
import { STORM_STRIKE_LIGHT } from '../../configs/shot-lights.config';
import type { CameraBounds, CameraRig } from '../../three-engine/camera-rig';
import { EllipsoidSync } from '../../three-engine/ellipsoid-sync';
import type { RootLoadFailure } from '../../three-engine/tile-loading-tracker';
import type {
  GroundHeights,
  StreetStyle,
  WorldAttachContext,
  IntroShot,
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
import { MAX_SPAWN_PORTALS } from '../../configs/marker-geometry.config';
import { runStartAt, type RunStart } from '../../sim/protocol/run-start';
import { validateWaveTable, type WaveTable } from '../../director/sources/table/wave-table';
import { createWaveSource, initialWaveSourceId } from '../../director/wave-source.registry';
import { type BuildCatalogEntry, CustomMapFrame, CustomMapSurface } from './custom-map-surface';
import { CustomMapStreets } from './custom-map-streets';
import { MapGroundPick } from './custom-map-ground-pick';
import { type CustomMapDocument, type MapEnvironment, type MapObject, difficultyFactor, geoToMap, MAP_METERS_PER_DEGREE, mapToGeo } from './map-document';
import { environmentAt, hiddenObjectsAt, messagesOf } from './wave-events';
import { CustomMapDestruction, DESTRUCTIBLE_CATEGORIES, FALLEN_SCALE, passingObjectIds, type StructureEntry } from './custom-map-destruction';
import { boxTarget, CraterObliteration, roundTarget, type ObliterationChange, type ObliterationRect, type ObliterationTarget } from './crater-obliteration';
import { craterCm } from '../../map-ops/impact-stamp';
import { fallWay, TreeGrid, type TreeSpot } from './fall-way';
import { CustomMapGroundDamage } from './custom-map-ground-damage';
import { CraterLakes, mapCraterSources, waterKindAt } from './crater-lakes';
import type { CraterWaterEntry } from './render/water/crater-water';
import { renderMinimapPicture, type MinimapArea } from './custom-map-minimap';
import { MapStore } from './map-store';
import type { MapAssetLibrary } from './render/map-asset-library';
import type { CustomMapView } from './render/custom-map-view';
import type { CustomMapQuality, QualityKnobs } from '../../three-engine/render-quality';
import { Soundscape } from './ambience/soundscape';
import { sceneToMap } from './render/map-coords';
import { emptyPose, introPoseAt } from './map-intro';
import { massRadius } from './object-mass';
import { NextFrameGate } from './next-frame-gate';
import { lowBarriersUnder } from './tower-cover';
import { CUSTOM_MAP_CAPABILITIES, keepOpenedMap, type LoadedCustomMap } from './custom-map-start';
import { MapStoreError } from './map-file-kind';
import { en, type Messages } from '../../i18n/messages/en';
import { say } from '../../i18n/said';

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

/** Metres the map's own intro flight keeps above the ground under the camera */
const INTRO_GROUND_CLEARANCE = 3;

/**
 * Loads the map a ref names from the map store (own maps in IndexedDB, then
 * the shipped ones) and keeps it for `openedCustomMap`. Throws with a
 * readable message when there is no such map or its content is not the one
 * the ref names.
 */
export async function openCustomMap(ref: WorldRef & { kind: 'custom-map' }, store: MapStore = new MapStore()): Promise<LoadedCustomMap> {
  const { doc, summary, repaired } = await store.load(ref.mapId);
  if (ref.contentHash && summary.contentHash && ref.contentHash !== summary.contentHash) {
    throw new MapStoreError({ key: 'notThisRun', v: { name: doc.meta.name } });
  }
  const loaded = { doc, contentHash: summary.contentHash, ...(repaired?.length ? { repaired } : {}) };
  keepOpenedMap(ref.mapId, loaded);
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
  /** Buildings, walls and structures fall (gameplay.destructible) */
  private readonly structuresFall: boolean;
  /** Impacts dig craters (gameplay.craters, as destructible when missing) */
  private readonly cratersDug: boolean;
  /** The run's ground under craters and rubble, null where it stays as built */
  private readonly groundDamage: CustomMapGroundDamage | null;

  private view: CustomMapView | null = null;
  /** The quality level's custom-map part, kept for a view made after it came */
  private quality: CustomMapQuality | null = null;
  private lastUpdate = 0;
  /** The game's clock, seconds: the sum of what the engine hands each update (paused 0, faster at 2x and 4x) */
  private gameClock = 0;
  /** The craters' version the lakes in them were worked out for (CustomMapGroundDamage.craterVersion; 0 without) */
  private craterWaterVersion = -1;
  /** What each crater does to the rivers, the map's own (dug in the editor) and the impacts': worked out once per crater */
  private readonly craterLakes = new CraterLakes();
  /** The craters' lakes worked out in the last frame, to build in this one */
  private craterWaterDue: CraterWaterEntry[] | null = null;
  private prepared = false;
  /** The scene's programs compile ahead (prepare, after the assets) */
  private compilingNow = false;
  private rig: CameraRig | null = null;
  private readonly focus = new Vector3();
  private readonly lookDirection = new Vector3();
  private readonly firstGroundWaiters: (() => void)[] = [];
  /** dispose() ran: an attach still waiting for the renderer's code builds nothing */
  private disposed = false;
  /** The catalogue's objects once loaded: the build blocking is redone with them when a structure falls */
  private catalogObjects: readonly (StructureEntry & BuildCatalogEntry)[] = [];
  /** The low barriers each tower's plinth covers (towerStands) */
  private readonly covering = new Map<string, { at: string; ids: string[] }>();
  /** Objects that may leave the map during the run (they fall, a wave event hides or shows them): they carry no tower */
  private passingIds: ReadonlySet<string> = new Set();
  /** Objects lying fallen (destruction) and objects a wave event keeps out of the picture now */
  private readonly fallenIds = new Set<string>();
  /** Each damaged structure's stage, for a view that comes later */
  private readonly stages = new Map<string, { stage: number; heading: number }>();
  /** What the craters wiped out (crater-obliteration.ts): out of the picture, the sight and the build blocking */
  private readonly obliteration = new CraterObliteration();
  private readonly craterCmAt = (x: number, y: number): number => this.groundDamage?.craterCmAt(x, y) ?? 0;
  private readonly fallenNow = (id: string): boolean => this.stages.get(id)?.stage === 3;
  /** What the craters wiped out or gave back since the last frame, for the view: taken out in the next (update) */
  private readonly goneLater = new Map<string, boolean>();
  /** Trees a blast felled (true) or that stand again (false) since the last frame, for the view in the next one */
  private readonly felledLater = new Map<string, boolean>();
  /** What a strike wiped out and the tiles its craters changed: from the frame after the strike's (E271) */
  private readonly goneGate = new NextFrameGate();
  private readonly dugGate = new NextFrameGate();
  /** The structures' holes as the simulation has them, for a view to come */
  private readonly holes = new Map<string, Int32Array>();
  private eventHidden = new Set<string>();
  /** The scale an object out of the picture had, to stand it up again */
  private readonly outScale = new Map<string, number>();
  /** The map's own sky and weather, before its wave events change them */
  private readonly baseEnvironment: MapEnvironment;
  /** What the minimap picture renders: the scene and the children the map put into it */
  private stage: { scene: Scene; renderer: WebGLRenderer; owned: Set<Object3D>; fog: readonly { value: number }[]; drawsToTarget: () => boolean } | null = null;
  private minimapPicture: HTMLCanvasElement | null = null;
  /** The minimap's picture is read back (startMinimapPicture) */
  private minimapPending = false;
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
  /** The ground the camera controls raycast: terrain and roofs, without the scene's meshes */
  private readonly groundPick: MapGroundPick;

  constructor(
    private readonly map: LoadedCustomMap,
    origin: { lat: number; lon: number; height: number },
    private readonly spawnLimit = MAX_SPAWN_PORTALS,
    /** The asset library the view loads from; the shared one by default */
    private readonly assets: (() => MapAssetLibrary) | null = null,
    /**
     * Buildings, walls and structures take damage and fall (TODO E131); the map's own say by default, which is what
     * a run uses (world-provider-registry passes none) and what the editor's build areas read; other values for specs
     */
    destructible = map.doc.gameplay?.destructible === true,
    /** The wave runs start at (customMapStartWave), 1 for a normal run */
    private readonly startWave = 1,
  ) {
    // A fallen object, one a wave event hides and a sky the events change leave the run's own copy, never the opened
    // map; so do the heights the craters and the rubble change
    const events = map.doc.gameplay?.events ?? [];
    this.structuresFall = destructible;
    this.cratersDug = map.doc.gameplay?.craters ?? destructible;
    const damaged = destructible || this.cratersDug;
    const terrain = map.doc.terrain;
    this.doc = destructible || damaged || events.length
      ? {
        ...map.doc,
        objects: map.doc.objects.map((o) => ({ ...o })),
        ...(damaged ? { terrain: { ...terrain, grid: { ...terrain.grid, heights: terrain.grid.heights.slice() } } } : {}),
      }
      : map.doc;
    this.baseEnvironment = map.doc.environment;
    this.capabilities = damaged ? { ...CUSTOM_MAP_CAPABILITIES, destructible: true } : CUSTOM_MAP_CAPABILITIES;
    this.laneChoice = laneChoiceOf(this.doc.spawns, this.doc.gameplay, spawnLimit);
    const ground = damaged
      ? new CustomMapGroundDamage(
        this.doc.terrain.grid, this.doc.terrain.width, this.doc.terrain.depth,
        (rect) => this.view?.updateHeights(rect, true),
        (marks) => this.view?.setImpactMarks(marks),
        (id) => this.destruction?.materialOf(id) ?? 'plaster',
        (bare) => this.view?.setGroundBare(bare),
        (x, y, radius, height, colour, count, seed) => this.view?.throwDebris(x, y, radius, height, colour, count, seed),
        (rect) => this.cratersChanged(rect),
        () => this.gameClock,
        (x, y) => waterKindAt(this.doc.terrain, x, y),
      )
      : null;
    this.groundDamage = ground;
    this.destruction = damaged
      ? new CustomMapDestruction(() => this.doc, (fallen) => this.fell(fallen), (risen) => this.rose(risen), destructible, ground, (changes, now) => this.damageChanged(changes, now), (id) => this.view?.impactOf(id) ?? null,
        (object, holes, now) => this.holed(object.id, holes, now))
      : null;
    this.sync = new EllipsoidSync(origin.lat, origin.lon, origin.height);
    this.frame.setOrigin(origin.lat, origin.lon);
    this.surface = new CustomMapSurface(this.doc, this.frame);
    this.groundPick = new MapGroundPick(this.surface);
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
    const view = new CustomMapView(this.doc, this.assets ? this.assets() : MapAssetLibrary.shared(), {
      anisotropy: ctx.renderer.capabilities.getMaxAnisotropy(),
      // Bakes the impostors of far trees
      renderer: ctx.renderer,
      // The lamps' lights at night, with the shots'
      lights: ctx.lights,
      // Craters and rubble, their program built with the map's
      impactMarks: this.groundDamage !== null,
      // Ruins likewise, standing on the map's own heights with the craters (a stump sinks at a rim), not on the rubble
      ...(this.structuresFall ? { ruins: true, standingGround: this.groundDamage?.standing ?? this.map.doc.terrain.grid } : {}),
      // Craters may cut its rivers (an impact's, or one the map brought from the editor): their lakes and falls built
      // with the map's
      craterWater: (this.groundDamage !== null || (this.doc.terrain.craters?.length ?? 0) > 0) && (this.doc.terrain.rivers?.length ?? 0) > 0,
    });
    this.view = view;
    view.onImpact = (id, hit) => this.destruction?.impacted(id, hit);
    // Stages that came before the view: the ruins as they lie
    if (this.stages.size) view.setObjectDamage([...this.stages].map(([id, s]) => ({ id, stage: s.stage, heading: s.heading, now: false })));
    view.setGone(this.obliteration.goneIds(), []);
    view.setFelled(this.obliteration.felledIds().map((id) => this.felledHow(id, false)), []);
    for (const [id, holes] of this.holes) {
      if (!this.stages.has(id)) view.setObjectDamage([{ id, stage: 1, heading: -1, now: false }]);
      view.setObjectHoles(id, holes, false);
    }
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
      fog: [HEIGHT_FOG_UNIFORMS.uFogDensity, HEIGHT_FOG_UNIFORMS.uFogAirDensity],
      drawsToTarget: ctx.drawsToTarget,
    };
    // Over the HQ at the scene origin, controls that raycast the map's ground and roofs, analytically
    ctx.scene.add(this.groundPick);
    ctx.cameraRig.setupEnvironmentControls(ctx.scene, this.groundPick, this.groundPick.version);
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
      // A storm's thunder after its lightning
      view.environment.lightning.onStrike = (strike) => this.soundscape?.thunder(strike);
    }

    // A storm's strikes light the land, towers and enemies through the shots' light (none on Low)
    const lights = ctx.lights;
    if (lights) {
      // One look, its brightness set per stroke (the pulse's scale widens, it does not brighten)
      const look = { ...STORM_STRIKE_LIGHT };
      view.environment.lightning.onStroke = (x, y, z, strength) => {
        look.intensity = STORM_STRIKE_LIGHT.intensity * strength;
        lights.pulse(x, y + 8, z, look);
      };
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
   * thread for the demo valley. Both light states of a map with lights, so a
   * night later links nothing. Until then `ready()` holds the frames back.
   */
  private async prepare(ctx: WorldAttachContext, view: CustomMapView): Promise<void> {
    await view.ready.catch((err) => console.warn('[CustomMap] assets did not load', err));
    if (this.view !== view) return;
    performance.mark('load:map-assets:done');
    this.compilingNow = true;
    // Every program the scene needs, the map's hidden levels, cells and effects and the sun's shadow pass
    // included, for the output the frames draw to: with bloom or grading on that is the composer's linear
    // target, and programs for the screen would all link again in the first frame
    const target = ctx.drawsToTarget() ? new WebGLRenderTarget(1, 1) : null;
    await view
      .warmUp(ctx.renderer, ctx.scene, ctx.camera, target)
      .catch((err) => console.warn('[CustomMap] shaders did not compile ahead', err));
    target?.dispose();
    this.compilingNow = false;
    if (this.view !== view) return;
    performance.mark('load:map-shaders:done');
    this.prepared = true;
    for (const waiter of this.firstGroundWaiters.splice(0)) waiter();
  }

  /** The nearest placed object as drawn on a screen pick's ray (CustomMapView.raycastObjects), scene space */
  pickObjects(raycaster: Raycaster): Vector3 | null {
    return this.view?.raycastObjects(raycaster.ray)?.point ?? null;
  }

  floorUnder(at: Vector3): number | null {
    return this.view?.floorUnder(at) ?? null;
  }

  /** Frames draw once the map is prepared (prepare) */
  ready(): boolean {
    return this.prepared;
  }

  compiling(): boolean {
    return this.compilingNow;
  }

  withAllShown<T>(run: () => T): T {
    return this.view ? this.view.withAllShown(run) : run();
  }

  withLosStandIns<T>(run: () => T): T {
    return this.view ? this.view.withLosStandIns(run) : run();
  }

  setOrigin(lat: number, lon: number, height: number): void {
    this.sync.setOrigin(lat, lon, height);
    this.frame.setOrigin(lat, lon);
    this.placeView();
    this.rig?.setBounds(this.cameraBounds());
  }

  /** LOD, wind and water of the view; the overlay stands at the scene's zero, nothing moves under it */
  update(camera: PerspectiveCamera, overlay: Group, gameSeconds = 0): void {
    overlay.position.y = 0;
    this.gameClock += gameSeconds;
    const now = performance.now();
    const dt = this.lastUpdate ? Math.min(0.25, (now - this.lastUpdate) / 1000) : 0;
    // A frame drawn before this one: its levels of detail stand for the minimap's picture, made while loading
    if (this.lastUpdate) this.startMinimapPicture();
    this.lastUpdate = now;
    this.goneGate.tick();
    this.dugGate.tick();
    if (!this.view) return;
    // The sun's shadow box around the ground the camera looks at
    camera.getWorldPosition(this.focus);
    camera.getWorldDirection(this.lookDirection);
    // A ray past a ridge into the sky (or from beyond the map) hits nothing: the box goes on the ground ahead,
    // not around the camera in the air, where no tree cast and every shadow went at once
    if (!this.surface.groundAlong(this.focus, this.lookDirection, this.focus)) this.surface.groundAhead(this.focus, this.lookDirection, this.focus);
    // What the craters wiped out since the last frame leaves the picture, then the craters and the rubble of the
    // last frames, a few tiles at a time
    // The frame's packets are applied before this update: what a strike wiped out or dug waits for the next frame,
    // so the strike's frame carries the blast and the falls only (E271: a nuclear strike's impact 37 ms)
    if (this.goneLater.size && this.goneGate.open) {
      const gone = [...this.goneLater].filter(([, g]) => g).map(([id]) => id);
      const back = [...this.goneLater].filter(([, g]) => !g).map(([id]) => id);
      this.goneLater.clear();
      this.view.setGone(gone, back);
    }
    if (this.felledLater.size && this.goneGate.open) {
      const felled = [...this.felledLater].filter(([, down]) => down).map(([id]) => this.felledHow(id, true));
      const rose = [...this.felledLater].filter(([, down]) => !down).map(([id]) => id);
      this.felledLater.clear();
      this.view.setFelled(felled, rose);
    }
    if (this.dugGate.open) this.groundDamage?.flush();
    if (this.craterWaterDue) {
      this.view.setCraterWater(this.craterWaterDue);
      this.craterWaterDue = null;
    }
    this.refreshCraterWater();
    this.view.setGameTime(this.gameClock);
    this.view.update(dt, camera, this.focus);
    this.hear(dt, camera);
  }

  /**
   * The craters' lakes where they cut rivers (crater-lakes.ts), once the
   * craters changed and their ground is written: the map's own (dug in the
   * editor) full from the start, an impact's filling from when it was dug,
   * full for one known before (a restore, a replay's jump)
   */
  private refreshCraterWater(): void {
    const g = this.groundDamage;
    const version = g?.craterVersion ?? 0;
    if (!this.view || version === this.craterWaterVersion || (g && g.pending > 0)) return;
    this.craterWaterVersion = version;
    const sources = mapCraterSources(this.doc.terrain.craters);
    if (g) for (const [key, c] of g.craters()) sources.push({ key: `${key}:${c.radius}:${c.depthCm}`, crater: c, start: g.dugAt(key) });
    if (!sources.length) return;
    // Built in the next frame: the reckoning and the meshes each in a frame of their own
    this.craterWaterDue = this.craterLakes.entries(this.doc.terrain, sources);
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

  withQuality(knobs: QualityKnobs, run: () => void): void {
    if (this.view) this.view.withQuality(knobs.customMaps, run);
    else run();
  }

  /** A tower stands (or moved) at (lat, lon) with its plinth `radius` m round: the low barriers under it leave the picture */
  towerStands(id: string, lat: number, lon: number, radius: number): void {
    // A tower's other changes (an upgrade, its sight) leave its plinth where it is
    const at = `${lat},${lon},${radius}`;
    if (this.covering.get(id)?.at === at) return;
    const entries = new Map(this.catalogObjects.map((e) => [e.id, e]));
    this.covering.set(id, { at, ids: lowBarriersUnder(this.doc.objects, entries, lon * MAP_METERS_PER_DEGREE, lat * MAP_METERS_PER_DEGREE, radius) });
    this.view?.setCovered(new Set([...this.covering.values()].flatMap((c) => c.ids)));
  }

  /** Tower `id` is gone: what it covered shows again */
  towerGone(id: string): void {
    if (!this.covering.delete(id)) return;
    this.view?.setCovered(new Set([...this.covering.values()].flatMap((c) => c.ids)));
  }

  /**
   * Where `camera` stands and looks, as /map-preview's `cam` takes it (map x and y, metres over the ground, of the
   * eye and of the ground it looks at), with the map's id: the same picture again from a developer's note (F8)
   */
  cameraSpot(camera: PerspectiveCamera): string {
    const eye = camera.getWorldPosition(new Vector3());
    const look = camera.getWorldDirection(new Vector3());
    const at = new Vector3();
    if (!this.surface.groundAlong(eye, look, at)) at.copy(eye).addScaledVector(look, 100);
    const spot = (p: Vector3) => {
      const ground = this.surface.raycastTerrainHeight(p.x, p.z) ?? 0;
      return [this.frame.mapX(p.x), this.frame.mapY(p.z), p.y - ground].map((v) => v.toFixed(1)).join(',');
    };
    return `map=${this.doc.meta.id} cam=${spot(eye)},${spot(at)}`;
  }

  /** A tower came or went: the map's cached sun shadow map renders again */
  invalidateShadows(): void {
    this.view?.environment.invalidateShadows();
  }

  compileCasters(renderer: WebGLRenderer, scene: Scene, camera: Camera, objects: readonly Object3D[]): Promise<Object3D[]> {
    return this.view?.compileCasters(renderer, scene, camera, objects) ?? Promise.resolve([]);
  }

  warmLater(...args: Parameters<CustomMapView['warmLater']>): ReturnType<CustomMapView['warmLater']> {
    return this.view?.warmLater(...args) ?? null;
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
  attribution(t: Messages): string[] {
    const { name, author, source } = this.doc.meta;
    const data = source?.kind === 'osm' ? source.attribution : [];
    return [author ? t.hud.world.mapBy(name, author) : name, ...data, t.hud.world.assetCredit];
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
    // Craters where the map is destructible unless it says no, or where it asks for them alone
    const destruction = { craters: this.cratersDug, wear: this.structuresFall && play?.wear === true };
    const damaged = destruction.craters || destruction.wear;
    const start = this.runStart();
    const events = this.runEvents();
    if (!structures.length && !damaged && !start && !events.length && (!play || (play.startCredits === undefined && play.hqHealth === undefined && !play.towers?.length))) return null;
    return runRulesOf({ ...play, structures, destruction, start, events });
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
        const radius = Math.round((o.mass ? massRadius(o.mass) : (footprint.get(o.asset) ?? 1)) * (this.outScale.get(id) ?? o.scale) * 100) / 100;
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
      this.doc.environment = env;
      this.view?.setEnvironment(env);
      // A storm brings its downpour and wind, a clear sky takes them
      this.soundscape?.setMap(this.doc);
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
    const source = waves?.source ?? initialWaveSourceId();
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
      console.warn(`[CustomMap] the map's wave list is not used: ${problems.slice(0, 3).map((p) => say(en.check.waveTable, p)).join('; ')}`);
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

  /** The map's sound at each wave's start (life.waveSound), heard from where the camera looks */
  waveStarted(_wave: number): void {
    void this.soundscape?.playWave();
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
   * The map's own intro flight (its `intro`), in scene space; the camera
   * stays at least INTRO_GROUND_CLEARANCE above the ground or water under it
   */
  introShot(): IntroShot | null {
    const intro = this.doc.intro;
    if (!intro) return null;
    const { hq } = this.doc;
    const at = { x: hq.x, y: hq.y, h: this.surface.heightAtMap(hq.x, hq.y) };
    const pose = emptyPose();
    return {
      seconds: intro.seconds,
      poseAt: (t, position, look) => {
        introPoseAt(intro, at, t, pose);
        const floor = this.surface.surfaceAtMap(pose.x, pose.y) + INTRO_GROUND_CLEARANCE;
        position.set(this.frame.sceneX(pose.x), Math.max(floor, pose.h), this.frame.sceneZ(pose.y));
        look.set(this.frame.sceneX(pose.lookX), pose.lookH, this.frame.sceneZ(pose.lookY));
      },
    };
  }

  /**
   * The map from above, rendered once after its first drawn frame (its
   * levels of detail set) from the map's own scene children only
   */
  minimap(): WorldMinimap | null {
    if (!this.minimapPicture) {
      this.startMinimapPicture();
      return null;
    }
    return { picture: this.minimapPicture, ...this.minimapArea() };
  }

  /** The map's ground in scene space, as the minimap shows it */
  private minimapArea(): MinimapArea {
    const { width, depth } = this.doc.terrain;
    return {
      left: this.frame.sceneX(-width / 2),
      right: this.frame.sceneX(width / 2),
      top: this.frame.sceneZ(depth / 2),
      bottom: this.frame.sceneZ(-depth / 2),
    };
  }

  /**
   * The minimap's picture rendered now, its pixels read back over the next
   * frames (renderMinimapPicture): from the second frame of the load on
   * (update), so the game's first frames do not render it
   */
  private startMinimapPicture(): void {
    if (this.minimapPicture || this.minimapPending || !this.prepared || !this.stage || !this.view || this.lastUpdate === 0) return;
    const stage = this.stage;
    this.minimapPending = true;
    renderMinimapPicture(stage.renderer, stage.scene, stage.owned, this.minimapArea(), this.topHeight(), stage.fog, !stage.drawsToTarget())
      .then((picture) => {
        if (this.stage === stage) this.minimapPicture = picture;
      })
      .catch((err) => {
        console.warn('[CustomMap] no minimap picture', err);
        if (this.stage === stage) this.stage = null;
      })
      .finally(() => (this.minimapPending = false));
  }

  regenerate(): Promise<void> {
    return Promise.reject(new Error('A custom map cannot be rolled again'));
  }

  dispose(): void {
    this.disposed = true;
    this.rig?.setBounds(null);
    this.rig = null;
    // The view lets go of the shared library: it stays a while for the editor's view of this map, then goes
    // (MapAssetLibrary.release; some 88 MB of material pixels with its models)
    this.view?.dispose();
    this.view = null;
    this.groundPick.removeFromParent();
    this.soundscape?.dispose();
    this.soundscape = null;
    this.stage = null;
    this.minimapPicture = null;
  }

  /**
   * The camera over the map: its position at most a third of the map's
   * larger side beyond the edge (the steep view from there still shows the
   * edge), at least 3 m over the ground or the water on it (never under a
   * sea's surface), at most high enough for the whole map in view
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
      groundAt: (x, z) => this.surface.surfaceAtMap(this.frame.mapX(x), this.frame.mapY(z)),
    };
  }

  /** The catalogue's objects: what blocks building, what carries a tower, what can fall */
  useCatalog(objects: readonly (StructureEntry & BuildCatalogEntry)[]): void {
    this.catalogObjects = objects;
    this.passingIds = passingObjectIds(this.doc);
    this.surface.setObjectCatalog(objects, this.passingIds, this.outIds());
    if (!this.destruction) return;
    this.destruction.setCatalog(objects);
    if (isDevMode()) console.log(`[CustomMap] ${this.destruction.structures().length} structures can fall`);
    this.obliterationTargets(objects);
  }

  /**
   * What a crater may wipe out: the structures that fall (by their ground
   * rectangle) and every object that does not take damage (a tree, a lamp, a
   * bench), not those the map keeps standing nor those of wave events
   */
  private obliterationTargets(entries: readonly (StructureEntry & BuildCatalogEntry)[]): void {
    const byAsset = new Map(entries.map((e) => [e.id, e]));
    const targets: ObliterationTarget[] = [];
    const structures = new Set<string>();
    for (const s of this.destruction?.asRunStructures() ?? []) {
      structures.add(s.id);
      targets.push(s.box ? boxTarget(s.id, true, s.box) : roundTarget(s.id, true, s.lon * MAP_METERS_PER_DEGREE, s.lat * MAP_METERS_PER_DEGREE, s.radius * 2));
    }
    for (const o of this.doc.objects) {
      if (structures.has(o.id) || this.passingIds.has(o.id)) continue;
      const entry = byAsset.get(o.asset);
      if (!entry || DESTRUCTIBLE_CATEGORIES.has(entry.category)) continue;
      // A tree falls to a blast before a deep crater wipes it out
      targets.push(roundTarget(o.id, false, o.x, o.y, entry.footprint * (o.scale || 1), entry.category === 'tree'));
    }
    this.objectsById = null;
    this.trees = null;
    this.goneChanged(this.obliteration.setTargets(targets));
    this.goneChanged(this.obliteration.update(null, this.craterCmAt, this.fallenNow));
  }

  /** Craters came or went in `rect`: what stands there gone or back */
  private cratersChanged(rect: ObliterationRect): void {
    this.dugGate.mark();
    this.goneChanged(this.obliteration.update(rect, this.craterCmAt, this.fallenNow));
  }

  /**
   * Objects a crater wiped out leave the picture, the sight and the build
   * blocking, and trees a blast felled lie down out of the sight and the
   * build blocking; those it gave back return
   */
  private goneChanged(change: ObliterationChange): void {
    const freed = [...change.gone, ...change.felled];
    if (!freed.length && !change.back.length && !change.rose.length) return;
    // The view takes them out in the next frame, not in the strike's: that one carries the blast and the falls
    this.goneGate.mark();
    for (const id of change.gone) this.goneLater.set(id, true);
    for (const id of change.back) this.goneLater.set(id, false);
    for (const id of change.felled) this.felledLater.set(id, true);
    for (const id of change.rose) this.felledLater.set(id, false);
    if (change.back.length || change.rose.length) this.surface.setObjectCatalog(this.catalogObjects, this.passingIds, this.outIds());
    else {
      const out = new Set(freed);
      this.surface.dropObjects(this.doc.objects.filter((o) => out.has(o.id)));
    }
  }

  /** What blocks no building now: the fallen, what a wave event keeps out, what a crater wiped out or a blast felled */
  private outIds(): ReadonlySet<string> {
    const gone = this.obliteration.goneIds();
    const felled = this.obliteration.felledIds();
    if (!gone.length && !felled.length) return this.fallenIds;
    const out = new Set(this.fallenIds);
    for (const id of gone) out.add(id);
    for (const id of felled) out.add(id);
    return out;
  }

  /**
   * How felled tree `id` lies: away from the crater that reaches deepest
   * under it (its blast), falling now when that crater was dug in this run
   * and `live` (not after a load or a seek: there it lies already)
   */
  private felledHow(id: string, live: boolean): { id: string; heading: number; now: boolean } {
    const o = (this.objectsById ??= new Map(this.doc.objects.map((m) => [m.id, m]))).get(id);
    let best: { x: number; y: number; key: string } | null = null;
    let deepest = 0;
    for (const [key, c] of this.groundDamage?.craters() ?? []) {
      if (!o) break;
      const dx = o.x - c.x;
      const dy = o.y - c.y;
      const cm = craterCm(dx * dx + dy * dy, c.radius, c.depthCm);
      if (cm < deepest) {
        deepest = cm;
        best = { x: c.x, y: c.y, key };
      }
    }
    // Straight under the middle of its crater, or none found: a way of its own from its id
    const dx = o && best ? o.x - best.x : 0;
    const dy = o && best ? o.y - best.y : 0;
    const away = dx * dx + dy * dy > 1e-4 ? Math.atan2(dy, dx) : ([...id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 628, 7)) / 100;
    return { id, heading: this.fallWayOf(o, away), now: live && !!best && this.groundDamage?.dugAt(best.key) != null };
  }

  /** Tree `o` as the fall reads it: where it stands, its crown's radius and height (catalogue, scaled), null for none */
  private treeOf(o: MapObject): TreeSpot | null {
    const e = this.catalogEntries().get(o.asset);
    if (e?.category !== 'tree') return null;
    const s = o.scale || 1;
    return { id: o.id, x: o.x, y: o.y, crown: e.footprint * s, height: (e.height ?? e.footprint * 5) * s };
  }

  /** Felled tree `o` falls from `away` towards the open (fall-way.ts), past the trees that still stand */
  private fallWayOf(o: MapObject | undefined, away: number): number {
    const tree = o && this.treeOf(o);
    if (!tree) return away;
    this.trees ??= new TreeGrid(this.doc.objects.map((m) => this.treeOf(m)).filter((t): t is TreeSpot => t !== null));
    return fallWay(tree, away, this.trees, (id) => !this.obliteration.isFelled(id) && !this.obliteration.isGone(id));
  }

  private catalogEntries(): ReadonlyMap<string, StructureEntry & BuildCatalogEntry> {
    if (this.entriesFor !== this.catalogObjects) {
      this.entriesFor = this.catalogObjects;
      this.entryMap = new Map(this.catalogObjects.map((e) => [e.id, e]));
    }
    return this.entryMap;
  }

  private entriesFor: readonly (StructureEntry & BuildCatalogEntry)[] | null = null;
  private entryMap = new Map<string, StructureEntry & BuildCatalogEntry>();
  /** The trees on their grid (fall-way.ts); anew with the objects */
  private trees: TreeGrid | null = null;

  /** The document's objects by id, for the few felled trees looked up; anew with the objects */
  private objectsById: Map<string, MapObject> | null = null;

  /** Fallen structures lie in ruins (damageChanged) and stop blocking the build */
  private fell(objects: readonly MapObject[]): void {
    if (isDevMode()) console.log(`[CustomMap] fell: ${objects.map((o) => `${o.asset} ${o.id}`).join(', ')}`);
    for (const o of objects) this.fallenIds.add(o.id);
    this.surface.dropObjects(objects);
  }

  /** A reset stands them up again */
  private rose(objects: readonly MapObject[]): void {
    for (const o of objects) this.fallenIds.delete(o.id);
    this.surface.setObjectCatalog(this.catalogObjects, this.passingIds, this.outIds());
  }

  /** The structures' stages to the view's buildings (docs/DESTRUCTION_PLAN.md, Z2): `now` falls as it happens */
  /** A structure's holes changed (CustomMapDestruction): kept, and on the view */
  private holed(id: string, holes: Int32Array, now: boolean): void {
    const before = this.shownStage(id, 0);
    if (holes.some((v) => v !== 0)) this.holes.set(id, holes);
    else this.holes.delete(id);
    // A standing structure with holes shows as battered (the view draws holes on ruins only); without, whole again
    if (!this.stages.has(id) && this.shownStage(id, 0) !== before) {
      this.view?.setObjectDamage([{ id, stage: this.shownStage(id, 0), heading: -1, now: false }]);
    }
    this.view?.setObjectHoles(id, holes, now);
  }

  /** The stage the view shows for a structure at `stage`: a standing one with holes as battered */
  private shownStage(id: string, stage: number): number {
    return stage > 0 ? stage : this.holes.has(id) ? 1 : 0;
  }

  private damageChanged(changes: readonly { object: MapObject; stage: number; heading: number }[], now: boolean): void {
    for (const c of changes) {
      if (c.stage > 0) this.stages.set(c.object.id, { stage: c.stage, heading: c.heading });
      else this.stages.delete(c.object.id);
    }
    this.view?.setObjectDamage(changes.map((c) => ({ id: c.object.id, stage: this.shownStage(c.object.id, c.stage), heading: c.heading, now })));
    // A structure that fell in a crater is gone, one standing again is back
    for (const c of changes) this.goneChanged(this.obliteration.updateOne(c.object.id, this.craterCmAt, this.fallenNow));
  }

  /**
   * Objects a wave event hides, out of the picture: shrunk to next to
   * nothing (FALLEN_SCALE), so they neither show, block sight nor block
   * building; back at their scale once it shows them
   */
  private takeOut(objects: readonly MapObject[]): void {
    for (const o of objects) {
      const out = this.eventHidden.has(o.id);
      const kept = this.outScale.get(o.id);
      if (out && kept === undefined) {
        this.outScale.set(o.id, o.scale);
        o.scale = FALLEN_SCALE;
      } else if (!out && kept !== undefined) {
        o.scale = kept;
        this.outScale.delete(o.id);
      }
    }
    void this.view?.objectsChanged(objects.map((o) => o.id));
    this.surface.setObjectCatalog(this.catalogObjects, this.passingIds, this.outIds());
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
    this.view.placeAt(this.frame.sceneX(0), this.frame.sceneZ(0));
    this.groundPick.moved();
  }
}
