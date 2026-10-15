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
import { MAP_METERS_PER_DEGREE } from '../world/custom-map/map-document';
import type { TowerTypeId } from '../configs/tower-types.config';
import type { CustomMapWorld } from '../world/custom-map/custom-map-world';
import type { TowerControlService } from '../services/tower-control.service';
import type { SimMirror } from '../sim/client/mirror/sim-mirror';
import type { Tower } from '../entities/tower.entity';
import { headingOfLocal } from '../utils/manual-aim';
import type { MapEnvironment } from '../world/custom-map/map-document';
import type { CameraPose, MapPoint3 } from './camera-path';
import type { ScreenPoint } from './pointer';
import type { Stage } from './stage';
import { element, nextFrame, waitSeconds, waitUntil, type Hands } from './hands';
import { pressKey } from './pointer';

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
  private readonly engineInit: EngineInitializationService;
  private readonly worlds: WorldContext;
  private readonly routes: PathAndRouteService;
  private readonly ui: UIStore;
  private readonly markers: MarkerVisualizationService;
  private readonly placement: TowerPlacementService;
  /** Tower spots found ahead (planTowers), map metres; `spot:<i>` and `spots` in a script */
  private spots: { x: number; y: number }[] = [];
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
    if (name === 'spots' && this.spots.length) {
      return { x: this.spots.reduce((n, p) => n + p.x, 0) / this.spots.length, y: this.spots.reduce((n, p) => n + p.y, 0) / this.spots.length };
    }
    return null;
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
  private planSpots(count: number, tower: string, from = 40, to = 320, only: number | null = null): void {
    // `route`: the spots along that route alone, so they stand together in one shot
    const all = [...this.routes.getCachedPaths().values()].map((r) => r.map((w) => ({ x: w.lon * MAP_METERS_PER_DEGREE, y: w.lat * MAP_METERS_PER_DEGREE })));
    const routes = only === null ? all : all.slice(only, only + 1);
    const chosen: { x: number; y: number }[] = [];
    const apart = (p: { x: number; y: number }) => chosen.every((q) => Math.hypot(q.x - p.x, q.y - p.y) >= 24);
    for (let d = from; d <= to && chosen.length < count; d += 28) {
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
          for (const off of [20, 24, 28, -20, -24, -28]) {
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
      case 'hints':
        // The controls hint over the view goes, as "Got it" would
        c.controlsHintVisible.set(false);
        return;
      case 'credits':
        c.sim.bus.emit({ type: 'debug:add-credits', amount: Number(args['amount'] ?? 100_000) });
        return;
      case 'jumpWave':
        // The next wave to start, the ones before skipped (between waves only): a fuller wave for the camera
        c.sim.bus.emit({ type: 'debug:jump-to-wave', wave: Number(args['wave'] ?? 5), grantGold: false });
        return;
      case 'research':
        c.sim.bus.emit({ type: 'debug:complete-all-research' });
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
        );
        return;
      case 'build': {
        const tower = String(args['tower'] ?? 'archer');
        const at = (args['at'] as MapPoint3 | undefined) ?? this.spotFor(Number(args['spot'] ?? 0), tower);
        return this.build(tower, at, Number(args['dur'] ?? 0.9), Number(args['hold'] ?? 1.5));
      }
      case 'wave':
        await this.hands.click('.td-wave-btn', Number(args['dur'] ?? 0.8));
        return;
      case 'waveDone':
        // The running wave beaten: none alive and none still to come
        await waitUntil(() => c.store.enemiesAlive() === 0 && c.store.waveEnemiesLeft() === 0, Number(args['timeout'] ?? 90), 'the wave to be beaten');
        return;
      case 'environment': {
        const w = this.world;
        const view = (w as unknown as { view: WorldView | null } | null)?.view;
        if (w && view) view.setEnvironment({ ...w.doc.environment, ...(args['patch'] as Partial<MapEnvironment>) });
        return;
      }
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
    if (!control.enter(tower)) throw new Error(`showreel: the ${tower.typeConfig.name} took no one in`);
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
  private async build(tower: string, at: MapPoint3, seconds: number, hold: number): Promise<void> {
    const c = this.component;
    const selector = `.bp-card:has(canvas[data-tower-id="${tower}"])`;
    await waitUntil(() => {
      const card = document.querySelector(selector);
      return !!card && card.getAttribute('aria-disabled') !== 'true' && !card.classList.contains('is-locked');
    }, 10, `the ${tower} card`);
    await this.hands.click(element(selector), seconds);
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
      // Out of the build mode, so the next card shows
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
