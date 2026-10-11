/**
 * The trial wave in the editor: the game's own enemy models walk every
 * spawn's route to the HQ at their real speed, animated, so a map's
 * distances, choke points and sight lines can be judged without starting
 * the game. Ground enemies follow the roads; nothing fights, nothing dies.
 */
import { AnimationMixer, CanvasTexture, Group, Sprite, SpriteMaterial, type AnimationClip, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ENEMY_TYPES, type EnemyTypeConfig } from '../../configs/enemy-types.config';
import type { MapPoint } from '../../world/custom-map/map-document';
import { pointAt } from '../ops/path-graph';

/** Ground enemies of different speeds for a trial when the map names none */
export const TRIAL_TYPES = ['zombie', 'rat', 'tank', 'spider', 'skeleton'];
/** Seconds between two runners on one route */
const SPACING_S = 1.6;
/** Most runners at once, all routes together */
const MAX_RUNNERS = 60;

interface Runner {
  route: number;
  type: EnemyTypeConfig;
  along: number;
  model: Object3D;
  mixer: AnimationMixer | null;
  /** The same size on the screen from near and far: the models alone vanish in an overview */
  dot: Sprite;
}

interface LoadedModel {
  scene: Object3D;
  clips: AnimationClip[];
}

export interface TrialRoute {
  points: MapPoint[];
  length: number;
  /** Colour of its runners' dots (the spawn's), CSS */
  color?: string;
}

/** On-screen size of a runner's dot, as a share of the view's height */
const DOT_SIZE = 0.014;

export class TrialRunners {
  readonly group = new Group();
  private readonly loader = new GLTFLoader();
  private readonly models = new Map<string, Promise<LoadedModel | null>>();
  private runners: Runner[] = [];
  private routes: TrialRoute[] = [];
  private types: EnemyTypeConfig[] = [];
  private clock = 0;
  private spawned = 0;
  private running = false;
  private readonly dotMaterials = new Map<string, SpriteMaterial>();

  constructor(private readonly heightAt: (x: number, y: number) => number) {
    this.group.name = 'trial-runners';
  }

  get active(): boolean {
    return this.running;
  }

  /** How long the fastest and the slowest of the types take on the longest route, seconds */
  static timing(routes: readonly TrialRoute[], types: readonly EnemyTypeConfig[]): { fastest: number; slowest: number } {
    const longest = Math.max(0, ...routes.map((r) => r.length));
    const speeds = types.map((t) => t.baseSpeed).filter((s) => s > 0);
    if (!speeds.length || !longest) return { fastest: 0, slowest: 0 };
    return { fastest: longest / Math.max(...speeds), slowest: longest / Math.min(...speeds) };
  }

  /** Starts a wave on the routes with these enemy types (unknown ids are left out) */
  start(routes: TrialRoute[], typeIds: readonly string[]): EnemyTypeConfig[] {
    this.stop();
    this.routes = routes.filter((r) => r.points.length > 1 && r.length > 0);
    this.types = typeIds.map((id) => ENEMY_TYPES[id]).filter((t): t is EnemyTypeConfig => !!t && !t.isAirUnit);
    if (!this.types.length) this.types = [ENEMY_TYPES['zombie']];
    for (const t of this.types) this.model(t);
    this.clock = 0;
    this.spawned = 0;
    this.running = this.routes.length > 0;
    return this.types;
  }

  stop(): void {
    this.running = false;
    for (const r of this.runners) this.group.remove(r.model, r.dot);
    this.runners = [];
  }

  /** Every frame */
  update(dt: number): void {
    if (!this.running) return;
    this.clock += dt;
    // A new runner on each route every few seconds, the types in turn
    const due = Math.floor(this.clock / SPACING_S);
    while (this.spawned < due && this.runners.length < MAX_RUNNERS) {
      const type = this.types[this.spawned % this.types.length];
      for (let route = 0; route < this.routes.length && this.runners.length < MAX_RUNNERS; route++) this.spawn(route, type);
      this.spawned++;
    }
    for (const r of this.runners) {
      const route = this.routes[r.route];
      r.along += r.type.baseSpeed * dt;
      if (r.along >= route.length) r.along = 0;
      const p = pointAt(route.points, r.along);
      const q = pointAt(route.points, Math.min(route.length, r.along + 1));
      const h = this.heightAt(p.x, p.y);
      r.model.position.set(-p.x, h, p.y);
      r.dot.position.set(-p.x, h + 1.5, p.y);
      // Facing along the road: scene x is west, so the map heading turns into the scene's
      const heading = Math.atan2(-(q.x - p.x), q.y - p.y);
      r.model.rotation.y = heading + (r.type.headingOffset ?? 0);
      r.mixer?.update(dt);
    }
  }

  dispose(): void {
    this.stop();
    for (const m of this.dotMaterials.values()) {
      m.map?.dispose();
      m.dispose();
    }
    this.dotMaterials.clear();
    this.group.removeFromParent();
  }

  private spawn(route: number, type: EnemyTypeConfig): void {
    const holder = new Group();
    holder.scale.setScalar(type.scale);
    const dot = new Sprite(this.dotMaterial(this.routes[route].color ?? '#e8c060'));
    dot.scale.set(DOT_SIZE, DOT_SIZE, 1);
    dot.renderOrder = 9;
    const runner: Runner = { route, type, along: 0, model: holder, mixer: null, dot };
    this.runners.push(runner);
    this.group.add(holder, dot);
    void this.model(type).then((loaded) => {
      if (!loaded || !this.runners.includes(runner)) return;
      const body = cloneSkinned(loaded.scene);
      holder.add(body);
      const clip = loaded.clips.find((c) => c.name === type.walkAnimation) ?? loaded.clips[0];
      if (clip) {
        runner.mixer = new AnimationMixer(body);
        const action = runner.mixer.clipAction(clip);
        action.timeScale = type.animationSpeed ?? 1;
        action.play();
        runner.mixer.setTime(Math.random() * clip.duration);
      }
    });
  }

  /** A round dot with a dark rim in the route's colour, one material per colour */
  private dotMaterial(color: string): SpriteMaterial {
    let m = this.dotMaterials.get(color);
    if (m) return m;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.beginPath();
      ctx.arc(16, 16, 13, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(10, 12, 10, 0.85)';
      ctx.stroke();
    }
    m = new SpriteMaterial({ map: new CanvasTexture(canvas), sizeAttenuation: false, depthTest: false, transparent: true });
    this.dotMaterials.set(color, m);
    return m;
  }

  private model(type: EnemyTypeConfig): Promise<LoadedModel | null> {
    let p = this.models.get(type.id);
    if (!p) {
      const url = new URL(type.modelUrl, document.baseURI).toString();
      p = this.loader.loadAsync(url).then(
        (gltf) => ({ scene: gltf.scene, clips: gltf.animations }),
        () => null,
      );
      this.models.set(type.id, p);
    }
    return p;
  }
}
