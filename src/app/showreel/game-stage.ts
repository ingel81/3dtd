/**
 * The game on a custom map (`?world=map:<id>`) as a showreel stage: its
 * camera, its map and what a player does there (build, start a wave,
 * speed), through the real UI where a viewer would see it.
 */
import type { Injector } from '@angular/core';
import { Vector3, type Object3D, type PerspectiveCamera } from 'three';
import { EngineInitializationService } from '../services/infrastructure/engine-initialization.service';
import { WorldContext } from '../world/world-context.service';
import { PathAndRouteService } from '../services/world/path-route.service';
import { UIStore } from '../store/ui.store';
import { MarkerVisualizationService } from '../services/world/marker-visualization.service';
import { TowerPlacementService } from '../services/tower-placement.service';
import { DebugFacadeService } from '../services/debug/debug-facade.service';
import { LosDebugService } from '../services/debug/los-debug.service';
import { SAVE_GAME, manualSlotId, type LoadResult, type SaveResult } from '../services/save-game/save-game.port';
import { MAP_METERS_PER_DEGREE } from '../world/custom-map/map-document';
import type { TowerTypeId } from '../configs/tower-types.config';
import type { CustomMapWorld } from '../world/custom-map/custom-map-world';
import type { TowerControlService } from '../services/tower-control.service';
import type { SimMirror } from '../sim/client/mirror/sim-mirror';
import type { Tower } from '../entities/tower.entity';
import { headingOfLocal } from '../utils/manual-aim';
import type { MapEnvironment } from '../world/custom-map/map-document';
import { waterLevelAt } from '../world/custom-map/water-level';
import { ease, type CameraPose, type Ease, type MapPoint3 } from './camera-path';
import { timeOfDay } from '../world/custom-map/time-of-day';
import { CAMERA_FLOOR_M, flooredHeight } from './camera-floor';
import type { ScreenPoint } from './pointer';
import type { Stage } from './stage';
import { element, nextFrame, waitSeconds, waitUntil, type Hands } from './hands';
import { pressKey } from './pointer';
import { dragOsmSpawn } from './osm-frame-drag';
import { en } from '../i18n/messages/en';

/** What the director uses of the game component (read through Angular's dev API) */
interface GameComponent {
  photoMode: { active(): boolean; enter(): void; exit(): void };
  sim: { bus: { emit(command: Record<string, unknown>): void } };
  store: { credits(): number; enemiesAlive(): number; waveEnemiesLeft(): number };
  controlsHintVisible: { set(on: boolean): void };
  towerControl: TowerControlService;
}

/** What the tower view keeps to itself: the aim the mouse would move, the trigger, the mirror */
interface TowerSeat {
  aimHeading: number;
  aimPitch: number;
  aimMoved: boolean;
  mirror: SimMirror;
  setTrigger(held: boolean): void;
}

/** The intro flight's DevTools handle (IntroCameraFlightService.initialize) */
interface IntroFlight {
  stop(): void;
  state(): { running: boolean; skipReason: string | null };
}

const flight = (): IntroFlight | undefined => (globalThis as { __flight?: IntroFlight }).__flight;

/** The marker service's renderers, which it keeps to itself */
interface MarkerParts {
  markerManager: { diamondMesh: Object3D; ringMesh: Object3D; groundMesh: Object3D } | null;
  labelManager: { mesh: Object3D } | null;
}

/** The map view the custom-map world keeps to itself */
interface WorldView {
  setEnvironment(env: MapEnvironment): void;
}

export class GameStage implements Stage {
  readonly kind = 'game';
  cameraFloor = CAMERA_FLOOR_M;
  private readonly engineInit: EngineInitializationService;
  private readonly worlds: WorldContext;
  private readonly routes: PathAndRouteService;
  private readonly ui: UIStore;
  private readonly markers: MarkerVisualizationService;
  private readonly placement: TowerPlacementService;
  private readonly debug: DebugFacadeService;
  private readonly los: LosDebugService;
  /** The environment the last `environment` action put on the view (the map's own until then) */
  private applied: MapEnvironment | null = null;
  /** The map's environment before the first environment action */
  private startEnvironment: MapEnvironment | null = null;
  /** Tower spots found ahead (planTowers), map metres; `spot:<i>` and `spots` in a script */
  private spots: { x: number; y: number }[] = [];
  /** The enemy each `enemy:<key>` follows, by its number, while it lives */
  private readonly followed = new Map<string, number>();
  private posed: CameraPose | null = null;
  private poseLoop = 0;
  private readonly scratch = new Vector3();

  constructor(injector: Injector, private readonly hands: Hands) {
    this.engineInit = injector.get(EngineInitializationService);
    this.worlds = injector.get(WorldContext);
    this.routes = injector.get(PathAndRouteService);
    this.ui = injector.get(UIStore);
    this.markers = injector.get(MarkerVisualizationService);
    this.placement = injector.get(TowerPlacementService);
    this.debug = injector.get(DebugFacadeService);
    this.los = injector.get(LosDebugService);
  }

  private get world(): CustomMapWorld | null {
    const w = this.worlds.provider();
    return w && w.ref.kind === 'custom-map' ? (w as CustomMapWorld) : null;
  }

  private get camera(): PerspectiveCamera | null {
    return this.engineInit.getEngine()?.getCamera() ?? null;
  }

  private get component(): GameComponent {
    const ng = (window as unknown as { ng?: { getComponent(el: Element | null): unknown } }).ng;
    const c = ng?.getComponent(document.querySelector('app-tower-defense')) as GameComponent | null | undefined;
    if (!c) throw new Error('showreel: no game component (dev build only)');
    return c;
  }

  ready(): boolean {
    return !!this.world && !!this.camera && performance.getEntriesByName('load:ready').length > 0;
  }

  mapSize(): { width: number; depth: number } | null {
    const t = this.world?.doc.terrain;
    return t ? { width: t.width, depth: t.depth } : null;
  }

  groundAt(x: number, y: number): number {
    return this.world?.surface.heightAtMap(x, y) ?? 0;
  }

  waterAt(x: number, y: number): number | null {
    const t = this.world?.doc.terrain;
    return t ? waterLevelAt(t, x, y, this.groundAt(x, y)) : null;
  }

  surfaceAt(x: number, y: number): number {
    // The water surface where water lies, else the ground: what the game's own camera counts from
    return this.world?.surface.surfaceAtMap(x, y) ?? 0;
  }

  rendererState(): string | null {
    const info = this.engineInit.getEngine()?.getRenderer().info;
    return info ? `${info.programs?.length ?? 0}:${info.memory.geometries}:${info.memory.textures}` : null;
  }

  gl(): WebGLRenderingContext | WebGL2RenderingContext | null {
    return this.engineInit.getEngine()?.getRenderer().getContext() ?? null;
  }

  named(name: string): { x: number; y: number } | null {
    const doc = this.world?.doc;
    if (!doc) return null;
    if (name === 'hq') return { x: doc.hq.x, y: doc.hq.y };
    if (name === 'center') return { x: 0, y: 0 };
    const spawn = /^spawn:(\d+)$/.exec(name);
    if (spawn) {
      const s = doc.spawns[Number(spawn[1])];
      return s ? { x: s.x, y: s.y } : null;
    }
    const spot = /^spot:(\d+)$/.exec(name);
    if (spot) return this.spots[Number(spot[1])] ?? null;
    // tower:<i> a tower standing, in the order they were built (tower:-1 the newest) (a take that starts from a save has no planned spots)
    const tower = /^tower:(-?\d+)$/.exec(name);
    if (tower) {
      // Negative from the end: tower:-1 the newest
      const all = (this.component.towerControl as unknown as TowerSeat).mirror.towers();
      const i = Number(tower[1]);
      const t = all[i < 0 ? all.length + i : i];
      return t ? { x: t.position.lon * MAP_METERS_PER_DEGREE, y: t.position.lat * MAP_METERS_PER_DEGREE } : null;
    }
    // hero: where the hero stands now (null while none is hired)
    if (name === 'hero') {
      const h = (this.component.towerControl as unknown as TowerSeat).mirror.heroFrame();
      return h ? { x: h.lon * MAP_METERS_PER_DEGREE, y: h.lat * MAP_METERS_PER_DEGREE } : null;
    }
    const enemy = /^enemy:([\w-]+)$/.exec(name);
    if (enemy) return this.enemySpot(enemy[1]);
    if (name === 'spots' && this.spots.length) {
      return { x: this.spots.reduce((n, p) => n + p.x, 0) / this.spots.length, y: this.spots.reduce((n, p) => n + p.y, 0) / this.spots.length };
    }
    return null;
  }

  /**
   * `enemy:<i>` the i-th enemy alive, `enemy:<type>` the first of that kind
   * (`enemy:zombie`), held by its number while it lives: once it falls the
   * spot is gone (a follow step ends there) and the next ask picks anew
   */
  private enemySpot(key: string): { x: number; y: number } | null {
    const alive = (this.component.towerControl as unknown as TowerSeat).mirror.aliveEnemies();
    const held = this.followed.get(key);
    let e = held === undefined ? undefined : alive.find((v) => v.num === held);
    if (held !== undefined && !e) {
      this.followed.delete(key);
      return null;
    }
    e ??= /^\d+$/.test(key) ? alive[Number(key)] : alive.find((v) => v.typeConfig.id === key);
    if (!e) return null;
    this.followed.set(key, e.num);
    return { x: e.position.lon * MAP_METERS_PER_DEGREE, y: e.position.lat * MAP_METERS_PER_DEGREE };
  }

  /** Whether the game lets a tower stand at a map point, by the rules the click uses (placementAt) */
  private buildable(x: number, y: number, tower: string): boolean {
    const at = this.placement.placementAt(y / MAP_METERS_PER_DEGREE, x / MAP_METERS_PER_DEGREE, tower as TowerTypeId);
    return !!at?.result.valid;
  }

  /**
   * Buildable with room around: the click lands where the pointer's ray
   * meets the ground, which can be a metre or two off the planned point
   */
  private buildableAround(x: number, y: number, tower: string): boolean {
    return [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]].every(([dx, dy]) => this.buildable(x + dx, y + dy, tower));
  }

  /**
   * Spots for `count` towers before the pointer moves: beside the routes,
   * from the HQ outwards, both sides, each checked by the game's placement
   * rules and apart from the others, so every build is one clean click
   */
  private planSpots(count: number, tower: string, from = 40, to = 320, only: number | null = null, offsets = [20, 24, 28], step = 28): void {
    // `route`: the spots along that route alone, so they stand together in one shot
    const all = [...this.routes.getCachedPaths().values()].map((r) => r.map((w) => ({ x: w.lon * MAP_METERS_PER_DEGREE, y: w.lat * MAP_METERS_PER_DEGREE })));
    const routes = only === null ? all : all.slice(only, only + 1);
    const chosen: { x: number; y: number }[] = [];
    const apart = (p: { x: number; y: number }) => chosen.every((q) => Math.hypot(q.x - p.x, q.y - p.y) >= 24);
    for (let d = from; d <= to && chosen.length < count; d += step) {
      for (const route of routes) {
        // Walk from the HQ end back along the route to distance d
        let left = d;
        for (let i = route.length - 1; i > 0 && chosen.length < count; i--) {
          const a = route[i];
          const b = route[i - 1];
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          if (left > len) {
            left -= len;
            continue;
          }
          const k = left / (len || 1);
          const px = a.x + (b.x - a.x) * k;
          const py = a.y + (b.y - a.y) * k;
          const nx = -(b.y - a.y) / (len || 1);
          const ny = (b.x - a.x) / (len || 1);
          const side = chosen.length % 2 ? 1 : -1;
          // How far beside the route, this side first (a city's corners stand closer than a meadow's)
          for (const off of [...offsets, ...offsets.map((o) => -o)]) {
            const p = { x: px + nx * off * side, y: py + ny * off * side };
            if (apart(p) && this.buildableAround(p.x, p.y, tower)) {
              chosen.push(p);
              break;
            }
          }
          break;
        }
      }
    }
    this.spots = chosen;
    if (chosen.length < count) console.warn(`[showreel] ${chosen.length} of ${count} tower spots found`);
  }

  private toScene(p: MapPoint3, target: Vector3): Vector3 | null {
    const w = this.world;
    if (!w) return null;
    const h = Number.isNaN(p.h) ? this.groundAt(p.x, p.y) : p.h;
    return target.set(w.frame.sceneX(p.x), h, w.frame.sceneZ(p.y));
  }

  setPose(pose: CameraPose | null): void {
    const controls = this.engineInit.getEngine()?.getControls();
    if (pose && !this.posed) {
      // The intro flight and the controls' inertia let go of the camera
      flight()?.stop();
      if (controls) controls.enabled = false;
      this.posed = pose;
      this.poseLoop = requestAnimationFrame(() => this.applyPose());
    }
    this.posed = pose;
    if (!pose) {
      cancelAnimationFrame(this.poseLoop);
      if (controls) controls.enabled = true;
    } else this.applyPose(false);
  }

  /** Each frame before the engine draws (the director's frame comes first, it asked first) */
  private applyPose(again = true): void {
    if (again && this.posed) this.poseLoop = requestAnimationFrame(() => this.applyPose());
    const camera = this.camera;
    const pose = this.posed;
    if (!camera || !pose) return;
    const eye = this.toScene(pose.eye, new Vector3());
    const look = this.toScene(pose.look, this.scratch);
    if (!eye || !look) return;
    // Over the camera floor: the ground there plus cameraFloor, any water surface
    eye.y = flooredHeight(eye.y, this.groundAt(pose.eye.x, pose.eye.y), this.waterAt(pose.eye.x, pose.eye.y), this.cameraFloor);
    camera.position.copy(eye);
    camera.up.set(0, 1, 0);
    camera.lookAt(look);
    camera.updateMatrixWorld();
  }

  pose(): CameraPose | null {
    const w = this.world;
    const camera = this.camera;
    if (!w || !camera) return null;
    const dir = camera.getWorldDirection(new Vector3());
    const p = camera.position;
    const along = 200;
    const map = (x: number, y: number, z: number): MapPoint3 => ({ x: w.frame.mapX(x), y: w.frame.mapY(z), h: y });
    return { eye: map(p.x, p.y, p.z), look: map(p.x + dir.x * along, p.y + dir.y * along, p.z + dir.z * along) };
  }

  canvas(): HTMLCanvasElement | null {
    return this.engineInit.getEngine()?.getRenderer().domElement ?? null;
  }

  toScreen(p: MapPoint3): ScreenPoint | null {
    const camera = this.camera;
    const canvas = this.engineInit.getEngine()?.getRenderer().domElement;
    const v = this.toScene(p, new Vector3());
    if (!camera || !canvas || !v) return null;
    v.project(camera);
    if (v.z > 1 || v.z < -1) return null;
    const r = canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  /** The save game the game component provides (SAVE_GAME), read through Angular's dev API */
  private get saves(): { importFile(file: File): Promise<LoadResult>; save(slotId: string, name?: string): Promise<SaveResult>; exportFile(slotId: string): Promise<SaveResult> } {
    const ng = (window as unknown as { ng?: { getInjector(el: Element | null): Injector } }).ng;
    const el = document.querySelector('app-tower-defense');
    if (!ng || !el) throw new Error('showreel: no game component (dev build only)');
    return ng.getInjector(el).get(SAVE_GAME);
  }

  /** A take's start: a save file (base64, the app's own format) loaded as the menu's Load from file would */
  async loadSave(base64: string, name: string): Promise<LoadResult> {
    const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
    return this.saves.importFile(new File([bytes], name));
  }

  /** The run saved into the first manual slot and downloaded as a file (fixtures.mjs takes the download) */
  async exportSave(name: string): Promise<SaveResult> {
    const saved = await this.saves.save(manualSlotId(1), name);
    return saved.ok ? this.saves.exportFile(manualSlotId(1)) : saved;
  }

  /** The player's credits set to `value` (a cheat's change, so the HUD shows a normal sum, not cheat credits) */
  async setCredits(value: number): Promise<number> {
    const c = this.component;
    const change = value - c.store.credits();
    if (change) c.sim.bus.emit({ type: 'debug:add-credits', amount: change });
    await waitUntil(() => c.store.credits() === value, 5, `credits ${value}`);
    return c.store.credits();
  }

  /** What a take's start can be checked against: the environment on the view, the overlays, the credits */
  state(): Record<string, unknown> {
    const c = this.component;
    const m = this.markers as unknown as MarkerParts;
    return {
      environment: this.applied ?? this.world?.doc.environment ?? null,
      ui: !c.photoMode.active(),
      routes: this.ui.routesVisible(),
      markers: m.markerManager?.diamondMesh.visible ?? null,
      healthBars: this.debug.healthBarsVisible(),
      credits: c.store.credits(),
    };
  }

  async act(name: string, args: Record<string, unknown>): Promise<void> {
    const c = this.component;
    switch (name) {
      case 'ui':
        if (args['on'] === false) c.photoMode.enter();
        else {
          c.photoMode.exit();
          // An intro page's HUD comes back with it (showreel.ts, sr-hud-off)
          document.documentElement.classList.remove('sr-hud-off');
        }
        await waitSeconds(0.1);
        return;
      case 'intro':
        return this.intro(Number(args['timeout'] ?? 120));
      case 'man':
        return this.man(
          args['spot'] === undefined ? null : Number(args['spot']),
          Number(args['dur'] ?? 5),
          Number(args['wait'] ?? 6),
          (args['towers'] as string[] | undefined) ?? null,
        );
      case 'photo':
        if (args['on'] === false) c.photoMode.exit();
        else c.photoMode.enter();
        await waitSeconds(0.1);
        return;
      case 'routes': {
        // The enemies' route lines, as the quick action switches them
        const on = args['on'] !== false;
        this.ui.routesVisible.set(on);
        this.routes.setRouteLinesVisible(on);
        return;
      }
      case 'markers': {
        // The HQ diamond and the name signs over HQ and spawns; the portals stay, they stand in the land
        const on = args['on'] !== false;
        const m = this.markers as unknown as MarkerParts;
        for (const mesh of [m.markerManager?.diamondMesh, m.markerManager?.ringMesh, m.markerManager?.groundMesh, m.labelManager?.mesh]) {
          if (mesh) mesh.visible = on;
        }
        return;
      }
      case 'healthBars':
        // The enemies' health bars, as the display options switch them (a close chase sees them as green slabs)
        this.debug.onHealthBarsToggled(args['on'] !== false);
        return;
      case 'hints':
        // The controls hint over the view goes, as "Got it" would
        c.controlsHintVisible.set(false);
        return;
      case 'credits':
        c.sim.bus.emit({ type: 'debug:add-credits', amount: Number(args['amount'] ?? 100_000) });
        return;
      case 'jumpWave': {
        // The next wave to start, the ones before skipped (between waves only): a fuller wave for the camera.
        // The game takes it only once the last wave has ended (a jump asked as it winds down was refused and
        // the next wave came instead): asked again until the wave button names the wave
        const wave = Number(args['wave'] ?? 5);
        const shown = () => /Wave\s+(\d+)/.exec(document.querySelector('.td-wave-btn')?.textContent ?? '')?.[1];
        await waitUntil(() => !document.querySelector('.td-wave-btn.td-wave-running'), 60, 'the last wave to end');
        await waitUntil(() => {
          if (shown() === String(wave)) return true;
          c.sim.bus.emit({ type: 'debug:jump-to-wave', wave, grantGold: false });
          return false;
        }, 15, `wave ${wave} on the wave button`);
        return;
      }
      case 'research':
        c.sim.bus.emit({ type: 'debug:complete-all-research' });
        return;
      case 'upgradeAll':
        // Every tower standing to its last level (the developer options' Max upgrade): a late wave's firepower
        c.sim.bus.emit({ type: 'debug:max-upgrade-all-towers' });
        return;
      case 'speed':
        (globalThis as { __load?: { speed(v: number): void } }).__load?.speed(Number(args['value'] ?? 1));
        return;
      case 'planTowers':
        this.planSpots(
          Number(args['count'] ?? 6),
          String(args['tower'] ?? 'archer'),
          Number(args['from'] ?? 40),
          Number(args['to'] ?? 320),
          args['route'] === undefined ? null : Number(args['route']),
          (args['offsets'] as number[] | undefined) ?? undefined,
          args['step'] === undefined ? undefined : Number(args['step']),
        );
        return;
      case 'build': {
        const tower = String(args['tower'] ?? 'archer');
        // `near`: the buildable spot closest to a map point (a placement named by place, P1 to P5 of a story)
        const near = args['near'] as MapPoint3 | undefined;
        const at = near
          ? this.spotNear(near, tower, Number(args['within'] ?? 30))
          : ((args['at'] as MapPoint3 | undefined) ?? this.spotFor(Number(args['spot'] ?? 0), tower));
        // `optional`: a tower the credits may not cover yet is left out (a run played by a fixture)
        return this.build(tower, at, Number(args['dur'] ?? 0.9), Number(args['hold'] ?? 1.5), args['optional'] === true);
      }
      case 'command':
        // One of the game's own commands as the UI sends it (research, hero, upgrades): for fixtures, not in a take
        c.sim.bus.emit(args['command'] as Record<string, unknown>);
        await waitSeconds(0.2);
        return;
      case 'hero': {
        // The hero hired, walked to a map point, its ammo chosen (fixtures: a save with the hero in place)
        c.sim.bus.emit({ type: 'command:hire-hero' });
        await waitSeconds(0.5);
        const at = args['at'] as MapPoint3;
        c.sim.bus.emit({ type: 'command:hero-move', target: { lat: at.y / MAP_METERS_PER_DEGREE, lon: at.x / MAP_METERS_PER_DEGREE } });
        if (args['ammo']) c.sim.bus.emit({ type: 'command:hero-ammo', ammo: String(args['ammo']) });
        await waitSeconds(Number(args['walk'] ?? 8));
        return;
      }
      case 'readyAbility':
        c.sim.bus.emit({ type: 'debug:ready-ability', abilityId: String(args['ability']) });
        return;
      case 'wave':
        // `ifIdle`: only between waves (a scene that shows several towers starts the next wave when one ends)
        if (args['ifIdle'] === true && document.querySelector('.td-wave-btn.td-wave-running')) return;
        await this.hands.click('.td-wave-btn', Number(args['dur'] ?? 0.8));
        return;
      case 'ability': {
        // An ability fired at a map point (an enemy's spot), as its button and a click on the map would
        const at = args['at'] as MapPoint3;
        c.sim.bus.emit({ type: 'command:use-ability', abilityId: String(args['ability']), target: { lat: at.y / MAP_METERS_PER_DEGREE, lon: at.x / MAP_METERS_PER_DEGREE } });
        return;
      }
      case 'enemiesNear': {
        // Until an enemy walks within `radius` m of a named spot `near` (`spots`: the towers), to skip the long walk
        // `near: 'any'`: within `radius` of any planned tower spot (a boss may come in on another lane)
        // `at`: a map point instead (a tunnel's mouth)
        const name = String(args['near'] ?? 'spots');
        // `any` without planned spots (a take from a save): any standing tower
        const standing = () => (c.towerControl as unknown as TowerSeat).mirror.towers().map((t) => ({ x: t.position.lon * MAP_METERS_PER_DEGREE, y: t.position.lat * MAP_METERS_PER_DEGREE }));
        const point = args['at'] as { x: number; y: number } | undefined;
        const targets = point ? [point] : name === 'any' ? (this.spots.length ? this.spots : standing()) : [this.named(name)].filter((p): p is { x: number; y: number } => !!p);
        if (!targets.length) throw new Error(`showreel: no spot ${name} for enemiesNear`);
        const radius = Number(args['radius'] ?? 60);
        // `kind`: only an enemy of that type counts (the boss, not the swarm ahead of it)
        const kind = args['kind'] === undefined ? null : String(args['kind']);
        const mirror = (c.towerControl as unknown as TowerSeat).mirror;
        await waitUntil(
          () => mirror.aliveEnemies().some((e) => (!kind || e.typeConfig.id === kind) && targets.some((at) => Math.hypot(e.position.lon * MAP_METERS_PER_DEGREE - at.x, e.position.lat * MAP_METERS_PER_DEGREE - at.y) <= radius)),
          Number(args['timeout'] ?? 90),
          'an enemy near the towers',
        ).catch((e: unknown) => {
          // What there was instead: the kinds alive
          const kinds = [...new Set(mirror.aliveEnemies().map((v) => v.typeConfig.id))].join(', ') || 'none';
          const why = `${e instanceof Error ? e.message : String(e)} (${kind ?? 'any kind'}; alive: ${kinds})`;
          // `optional`: the scene goes on without that enemy (a tower shown without a target is cut later)
          if (args['optional'] === true) console.warn(`[showreel] ${why}, going on`);
          else throw new Error(why);
        });
        return;
      }
      case 'waveDone': {
        // The running wave beaten: none alive, none still to come and the wave button free again. Right after the
        // wave's start nothing has spawned yet, which read as beaten: the wave has to run first
        const running = () => !!document.querySelector('.td-wave-btn.td-wave-running') || c.store.enemiesAlive() > 0 || c.store.waveEnemiesLeft() > 0;
        await waitUntil(running, 10, 'the wave to start').catch(() => console.warn('[showreel] waveDone: no wave running'));
        await waitUntil(() => !running(), Number(args['timeout'] ?? 90), 'the wave to be beaten');
        return;
      }
      case 'choosePath': {
        // A tower's path bought by the game's command (fixtures; a take shows the panel's button instead)
        const all = (c.towerControl as unknown as TowerSeat).mirror.towers();
        const i = Number(args['tower'] ?? -1);
        const t = all[i < 0 ? all.length + i : i];
        if (!t) throw new Error('showreel: no tower for choosePath');
        // Refused while the tower still stands in its scaffold: asked again until the path is there
        const path = String(args['path']);
        await waitUntil(() => {
          const now = (c.towerControl as unknown as TowerSeat).mirror.towers().find((x) => x.id === t.id);
          if (now?.pathId === path) return true;
          c.sim.bus.emit({ type: 'command:choose-path', towerId: t.id, pathId: path });
          return false;
        }, 30, `the ${path} path`);
        return;
      }
      case 'environment': {
        const w = this.world;
        const view = (w as unknown as { view: WorldView | null } | null)?.view;
        if (!w || !view) throw new Error('showreel: no map view to set the environment on');
        // `fresh`: the patch on the map's environment as it was before the scene's first change (the view keeps
        // each change in the map), not on the last one
        this.startEnvironment ??= { ...w.doc.environment };
        const base = args['fresh'] ? this.startEnvironment : w.doc.environment;
        this.applied = { ...base, ...((args['patch'] as Partial<MapEnvironment> | undefined) ?? {}) };
        view.setEnvironment(this.applied);
        // A change over `dur` seconds from there: numbers (also of wind and planet) toward `to`, the hour of day
        // through `hours` [from, to] as the editor's time slider sets sun and sky (a time-lapse), each frame
        const to = (args['to'] as Partial<MapEnvironment> | undefined) ?? {};
        const hours = args['hours'] as [number, number] | undefined;
        const seconds = Number(args['dur'] ?? 0);
        if (!hours && !Object.keys(to).length) return;
        const from = this.applied;
        const at = (u: number): MapEnvironment => ({
          ...(lerpFields(from, to, u) as unknown as MapEnvironment),
          ...(hours ? timeOfDay(hours[0] + (hours[1] - hours[0]) * u, from.sky) : {}),
        });
        // Without a duration: the end at once (an hour of day as the time slider sets it)
        if (seconds <= 0) {
          this.applied = at(1);
          view.setEnvironment(this.applied);
          return;
        }
        const start = await nextFrame();
        for (;;) {
          const t = Math.min(1, ((await nextFrame()) - start) / (seconds * 1000));
          this.applied = at(ease((args['ease'] as Ease | undefined) ?? 'inOut', t));
          view.setEnvironment(this.applied);
          if (t >= 1) return;
        }
      }
      case 'osmDrag':
        return dragOsmSpawn(this.hands.pointer, args);
      case 'los':
        // The line-of-sight debugger's cells (the selected tower's view of the route)
        this.los.setEnabled(args['on'] !== false);
        return;
      case 'escape':
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
        return;
      default:
        throw new Error(`showreel: the game knows no action ${name}`);
    }
  }

  /**
   * The game's intro flight, whole: it starts as the map stands (the runner
   * started the scene right then, an intro page), the camera stays the
   * flight's until it has landed in the game view
   */
  private async intro(timeoutS: number): Promise<void> {
    const f = flight();
    const started = await waitUntil(() => !!f?.state().running, 5, 'the intro flight').then(
      () => true,
      () => false,
    );
    if (!started) {
      console.warn(`[showreel] no intro flight: ${f?.state().skipReason ?? 'no __flight'}`);
      return;
    }
    await waitUntil(() => !f!.state().running, timeoutS, 'the intro flight to land');
  }

  /**
   * A while in the first-person view of a tower (docs/TOWER_CONTROL.md), as
   * C would put the player there: the tower nearest planned spot `spot`, or
   * without one the first a wave's enemy comes into range of (waits up to
   * `wait` seconds for one), of the kinds in `towers` when given. The aim turns to the nearest enemy at a hand's
   * pace, the trigger is held while one is in range; then out again, the
   * camera back where it was
   */
  private async man(spot: number | null, seconds: number, wait: number, types: string[] | null = null): Promise<void> {
    const control = this.component.towerControl;
    const seat = control as unknown as TowerSeat;
    const engine = this.engineInit.getEngine();
    if (!engine) throw new Error('showreel: no engine');
    // `towers`: only these kinds (a cannon's smoke fills its own view)
    const mannable = () => seat.mirror.towers().filter((t) => control.canEnter(t) && (!types || types.includes(t.typeConfig.id)));
    let tower: Tower | undefined;
    if (spot !== null) {
      const at = this.spots[spot];
      if (!at) throw new Error(`showreel: no tower spot ${spot} to sit in`);
      const lat = at.y / MAP_METERS_PER_DEGREE;
      const lon = at.x / MAP_METERS_PER_DEGREE;
      tower = mannable().sort((a, b) => Math.hypot(a.position.lat - lat, a.position.lon - lon) - Math.hypot(b.position.lat - lat, b.position.lon - lon))[0];
    } else {
      const engaged = () => mannable().find((t) => this.nearestEnemy(t, seat.mirror, t.combat.range));
      await waitUntil(() => !!engaged(), wait, 'an enemy in range of a tower').catch(() => console.warn('[showreel] no enemy came into range, in the first tower anyway'));
      tower = engaged() ?? mannable()[0];
    }
    if (!tower) throw new Error('showreel: no tower to sit in');
    // The director's camera lets go without the controls taking over: the tower saves this pose and gives it back
    cancelAnimationFrame(this.poseLoop);
    this.posed = null;
    if (!control.enter(tower)) throw new Error(`showreel: the ${en.names.towers[tower.typeConfig.id]} took no one in`);
    await waitUntil(() => control.active(), 3, 'the seat in the tower');
    const height = (tower.position.height ?? 0) + tower.typeConfig.heightOffset + tower.typeConfig.shootHeight;
    const from = engine.sync.geoToLocalSimpleInto(tower.position.lat, tower.position.lon, height, new Vector3());
    const to = new Vector3();
    const range = tower.combat.range;
    const start = await nextFrame();
    let last = start;
    for (;;) {
      const now = await nextFrame();
      const dt = (now - last) / 1000;
      last = now;
      // The nearest enemy, in range or coming: the view turns to it, the trigger waits for range
      const target = this.nearestEnemy(tower, seat.mirror, Infinity);
      let aligned = false;
      if (target) {
        engine.sync.geoToLocalSimpleInto(target.lat, target.lon, target.height + 0.8, to);
        const dx = to.x - from.x;
        const dz = to.z - from.z;
        const turn = wrap(headingOfLocal(dx, dz) - seat.aimHeading);
        const lift = Math.atan2(to.y - from.y, Math.hypot(dx, dz)) - seat.aimPitch;
        // A hand's pace: most of the way within a fifth of a second
        const k = 1 - Math.exp(-dt * 6);
        seat.aimHeading += turn * k;
        seat.aimPitch += lift * k;
        seat.aimMoved = true;
        aligned = Math.abs(turn) < 0.2 && target.distance <= range;
      }
      seat.setTrigger(aligned);
      if (now - start >= seconds * 1000) break;
    }
    seat.setTrigger(false);
    control.exit();
    await waitUntil(() => !control.active(), 3, 'out of the tower');
    await nextFrame();
  }

  /** The alive enemy nearest the tower within `range` (horizontal, m): where it stands (geo, its height) and how far */
  private nearestEnemy(tower: Tower, mirror: SimMirror, range: number): { lat: number; lon: number; height: number; distance: number } | null {
    let best: { lat: number; lon: number; height: number; distance: number } | null = null;
    for (const e of mirror.aliveEnemies()) {
      const d = Math.hypot((e.position.lat - tower.position.lat) * MAP_METERS_PER_DEGREE, (e.position.lon - tower.position.lon) * MAP_METERS_PER_DEGREE);
      if (d <= range && (!best || d < best.distance)) best = { lat: e.position.lat, lon: e.position.lon, height: e.position.height ?? 0, distance: d };
    }
    return best;
  }

  /** The buildable spot nearest `at` within `within` m (rings of 3 m), by the rules a click uses */
  private spotNear(at: MapPoint3, tower: string, within: number): MapPoint3 {
    for (let r = 0; r <= within; r += 3) {
      const steps = r ? Math.ceil((2 * Math.PI * r) / 3) : 1;
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * Math.PI * 2;
        const x = at.x + Math.cos(a) * r;
        const y = at.y + Math.sin(a) * r;
        if (this.buildableAround(x, y, tower)) return { x, y, h: Number.NaN };
      }
    }
    throw new Error(`showreel: no spot for a ${tower} within ${within} m of ${Math.round(at.x)}, ${Math.round(at.y)}`);
  }

  /** A planned spot, checked again now (an earlier tower may stand near it); a new one beside the routes if not */
  private spotFor(index: number, tower: string): MapPoint3 {
    let p = this.spots[index];
    if (!p || !this.buildableAround(p.x, p.y, tower)) {
      const kept = this.spots;
      this.planSpots(1, tower);
      p = this.spots[0];
      this.spots = kept;
      if (!p) throw new Error('showreel: no tower spot left beside the routes');
      this.spots[index] = p;
    }
    return { x: p.x, y: p.y, h: Number.NaN };
  }

  /**
   * A spot under the HUD (sidebar, minimap) or near the canvas edge takes no
   * click: the camera glides over, keeping its height and angle, until the
   * spot lies well inside the view
   */
  private async keepInView(at: MapPoint3): Promise<void> {
    const canvas = this.engineInit.getEngine()?.getRenderer().domElement;
    const screen = this.toScreen(at);
    if (!canvas || !screen) return;
    const r = canvas.getBoundingClientRect();
    const inner = screen.x > r.left + r.width * 0.2 && screen.x < r.left + r.width * 0.7 && screen.y > r.top + r.height * 0.2 && screen.y < r.top + r.height * 0.8;
    if (inner && document.elementFromPoint(screen.x, screen.y) === canvas) return;
    const from = this.pose();
    if (!from) return;
    const dx = at.x - from.look.x;
    const dy = at.y - from.look.y;
    const start = await nextFrame();
    for (;;) {
      const t = Math.min(1, ((await nextFrame()) - start) / 1200);
      const k = t * t * (3 - 2 * t);
      this.setPose({
        eye: { ...from.eye, x: from.eye.x + dx * k, y: from.eye.y + dy * k },
        look: { ...from.look, x: from.look.x + dx * k, y: from.look.y + dy * k },
      });
      if (t >= 1) return;
    }
  }

  /**
   * A tower through the sidebar: its card once it stands enabled, then the
   * spot, one click each. The spot was checked by the game's rules before
   * the pointer moved (planTowers, spotFor)
   */
  private async build(tower: string, at: MapPoint3, seconds: number, hold: number, optional = false): Promise<void> {
    const c = this.component;
    const selector = `.bp-card:has(canvas[data-tower-id="${tower}"])`;
    const usable = () => {
      const card = document.querySelector(selector);
      return !!card && card.getAttribute('aria-disabled') !== 'true' && !card.classList.contains('is-locked');
    };
    if (optional && !usable()) {
      console.warn(`[showreel] no ${tower} now (credits or research), left out`);
      return;
    }
    await waitUntil(usable, 10, `the ${tower} card`);
    // A card below the panel's fold (the new towers come last) scrolls up first, as a hand on the wheel would
    const card = element(selector);
    const list = card.getBoundingClientRect();
    if (list.bottom > innerHeight - 60 || list.top < 60) {
      card.scrollIntoView({ block: 'center', behavior: 'smooth' });
      await waitSeconds(0.6);
    }
    await this.hands.click(card, seconds);
    await waitUntil(() => !!document.querySelector('.bp-cancel'), 3, 'the build mode');
    await this.keepInView(at);
    const before = c.store.credits();
    // The build preview with its range and the route grid follows the pointer: rest there so the viewer
    // sees them (and the preview checks the spot), then one click
    await this.hands.toMap(this, at, seconds);
    await waitSeconds(hold);
    const p = this.hands.pointer.position;
    this.hands.pointer.moveTo({ x: p.x + 1, y: p.y });
    await waitSeconds(0.2);
    this.hands.pointer.click();
    const stood = await waitUntil(() => c.store.credits() < before || !document.querySelector('.bp-cancel'), 2, `the ${tower} to stand`).then(
      () => true,
      () => false,
    );
    if (!stood) {
      console.warn(`[showreel] the ${tower} was refused at ${Math.round(at.x)}, ${Math.round(at.y)}: ${this.ui.buildValidationReason() ?? 'no reason given'}`);
    }
    // Out of the build mode (it stays for the next of the same kind), so the next click is the next card's or
    // the wave button's; only while it is on: Escape outside it opens the pause menu
    if (document.querySelector('.bp-cancel')) {
      pressKey('Escape');
      await waitSeconds(0.2);
    }
    await nextFrame();
  }
}

/** An angle into (-π, π] */
function wrap(a: number): number {
  const turn = Math.PI * 2;
  return a - turn * Math.floor((a + Math.PI) / turn);
}

/** `from` with the numbers of `to` (nested ones too: wind, planet) a share `u` of the way there, the rest of `to` at the end */
function lerpFields(from: object, to: object, u: number): Record<string, unknown> {
  const out: Record<string, unknown> = { ...from };
  for (const [key, goal] of Object.entries(to)) {
    const was = (from as Record<string, unknown>)[key];
    if (typeof goal === 'number') out[key] = (typeof was === 'number' ? was : goal) + (goal - (typeof was === 'number' ? was : goal)) * u;
    else if (goal && typeof goal === 'object') out[key] = lerpFields(was && typeof was === 'object' ? was : goal, goal, u);
    else out[key] = u >= 1 ? goal : (was ?? goal);
  }
  return out;
}
