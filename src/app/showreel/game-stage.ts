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
import type { CustomMapWorld } from '../world/custom-map/custom-map-world';
import type { MapEnvironment } from '../world/custom-map/map-document';
import type { CameraPose, MapPoint3 } from './camera-path';
import type { ScreenPoint } from './pointer';
import type { Stage } from './stage';
import { element, nextFrame, waitSeconds, waitUntil, type Hands } from './hands';

/** What the director uses of the game component (read through Angular's dev API) */
interface GameComponent {
  photoMode: { active(): boolean; enter(): void; exit(): void };
  sim: { bus: { emit(command: Record<string, unknown>): void } };
  store: { credits(): number };
  controlsHintVisible: { set(on: boolean): void };
}

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
  private posed: CameraPose | null = null;
  private poseLoop = 0;
  private readonly scratch = new Vector3();

  constructor(injector: Injector, private readonly hands: Hands) {
    this.engineInit = injector.get(EngineInitializationService);
    this.worlds = injector.get(WorldContext);
    this.routes = injector.get(PathAndRouteService);
    this.ui = injector.get(UIStore);
    this.markers = injector.get(MarkerVisualizationService);
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
    return null;
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
      (globalThis as { __flight?: { stop(): void } }).__flight?.stop();
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
        else c.photoMode.exit();
        await waitSeconds(0.1);
        return;
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
      case 'research':
        c.sim.bus.emit({ type: 'debug:complete-all-research' });
        return;
      case 'speed':
        (globalThis as { __load?: { speed(v: number): void } }).__load?.speed(Number(args['value'] ?? 1));
        return;
      case 'build':
        return this.build(String(args['tower'] ?? 'archer'), args['at'] as MapPoint3, Number(args['dur'] ?? 0.9));
      case 'wave':
        await this.hands.click('.td-wave-btn', Number(args['dur'] ?? 0.8));
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
   * A tower through the sidebar: its card, then the spot on the map. A spot
   * the game refuses (trees, too far from a street) costs nothing: the
   * pointer tries a few steps around it, as a player would, and gives up
   * with Escape
   */
  private async build(tower: string, at: MapPoint3, seconds: number): Promise<void> {
    const c = this.component;
    const card = element(`.bp-card:has(canvas[data-tower-id="${tower}"])`);
    await this.hands.click(card, seconds);
    await waitUntil(() => !!document.querySelector('.bp-cancel'), 3, 'the build mode');
    const before = c.store.credits();
    const tries = [[0, 0], [0, 8], [0, -8], [8, 0], [-8, 0], [0, 16], [0, -16], [14, 10], [-14, -10], [-14, 10]];
    for (const [dx, dy] of tries) {
      await this.hands.clickMap(this, { x: at.x + dx, y: at.y + dy, h: Number.NaN }, dx || dy ? 0.35 : seconds);
      await waitSeconds(0.35);
      if (c.store.credits() < before) break;
    }
    // Out of the build mode where it stays (a refused spot)
    if (document.querySelector('.bp-cancel')) await this.hands.click('.bp-cancel', 0.5);
    await nextFrame();
  }
}
