import { Object3D, Scene, Vector4, type Camera, type Material, type WebGLRenderer, type WebGLRenderTarget } from 'three';
import { firstUsePrograms, programsReady } from './programs-ready';

/** One draw of a recorded frame: what it drew, with which camera, into which target (null: the screen) */
export interface RecordedDraw {
  object: Object3D;
  camera: Camera;
  target: WebGLRenderTarget | null;
  /** The material a single mesh drew with: a pass draws one quad with each of its materials in turn */
  material?: Material | Material[];
}

/**
 * Runs `drawFrame` without drawing and returns its draws: each
 * `renderer.render` call is noted with the target the caller set for it.
 * The frame's own setup runs as in a frame (a pass picks its defines and
 * targets in its render), so the draws are the ones the next frame makes.
 * Clears of the screen are left out: the picture stands; clears of targets
 * run (they allocate the targets, as a first frame would).
 */
export function recordDraws(renderer: WebGLRenderer, drawFrame: () => void): RecordedDraw[] {
  const { render, clear } = renderer;
  const draws: RecordedDraw[] = [];
  renderer.render = (object, camera) => {
    draws.push({ object, camera, target: renderer.getRenderTarget(), material: (object as { material?: Material | Material[] }).material });
  };
  renderer.clear = (...args) => {
    if (renderer.getRenderTarget() !== null) clear.apply(renderer, args);
  };
  try {
    drawFrame();
  } finally {
    renderer.render = render;
    renderer.clear = clear;
  }
  return draws;
}

/**
 * A part of a draw's objects compiled as one scene. three's compile walks
 * the scene with `traverse` for the materials and with `traverseVisible`
 * for the lights; the lights come from the draw's scene (compile's
 * targetScene), the slice brings none of its own
 */
class CompileSlice extends Object3D {
  constructor(private readonly objects: readonly Object3D[]) {
    super();
  }

  override traverse(callback: (object: Object3D) => void): void {
    for (const object of this.objects) callback(object);
  }

  override traverseVisible(): void {
    // The lights are the draw's scene's
  }
}

export interface FrameAheadOptions {
  /** Runs `run` in each light state of the world; only for draws of `scene` */
  lightStates?: (run: () => void) => void;
  /** The world's scene, whose draws compile in each light state */
  scene: Scene;
  /** Main-thread time a frame's task spends compiling */
  budgetMs?: number;
  /** The work has become moot (a newer switch, a disposed engine) */
  gone?: () => boolean;
}

/**
 * Objects compiled or drawn per call at most. A call that builds new
 * programs costs a millisecond or two for each, so a slice starts at one
 * object, grows while calls are cheap and shrinks when they build
 */
const MAX_SLICE = 8;

/** The renderable objects under `root`, hidden ones too (three's compile takes them all) */
function renderables(root: Object3D): Object3D[] {
  const out: Object3D[] = [];
  root.traverse((o) => {
    const r = o as Partial<Record<'isMesh' | 'isPoints' | 'isLine' | 'isSprite', boolean>>;
    if (r.isMesh || r.isPoints || r.isLine || r.isSprite) out.push(o);
  });
  return out;
}

/** Runs `run` with a single mesh's draw wearing the material it was recorded with */
function withMaterial(draw: RecordedDraw, run: () => void): void {
  const mesh = draw.object as { material?: Material | Material[] };
  const was = mesh.material;
  mesh.material = draw.material;
  try {
    run();
  } finally {
    mesh.material = was;
  }
}

/**
 * Resolves after the next frame has drawn. A compile points each material
 * at the program it built, and the frame's draw points it back at its own
 * (another output, another light state), so each task's compiles cost the
 * frame after it about as much again: one task per frame
 */
function afterNextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));
}

/** Whether a light shines: it and all above it shown */
function shines(light: Object3D): boolean {
  for (let o: Object3D | null = light; o; o = o.parent) if (!o.visible) return false;
  return true;
}

/** The next slice size from what the last one took */
function nextSlice(size: number, ms: number, budget: number): number {
  if (ms > budget / 2) return Math.max(1, size >> 1);
  return ms < budget / 8 ? Math.min(MAX_SLICE, size * 2) : size;
}

/**
 * A frame made ready ahead of a switch, while the frames before it keep
 * drawing the old way (ThreeTilesEngine.switchPasses). Two stages:
 *
 * 1. `compiled`: the programs of the recorded draws, for their targets and
 *    light states, a slice of objects per call and a few calls per task
 *    (a whole scene in one call took 120 ms on the main thread when its
 *    output changed, bloom on, autumn keep), then built and used once
 *    (programsReady, firstUsePrograms).
 * 2. `drawSome`, in frames before their draw: each object drawn once with
 *    its new program into one pixel, a slice at a time. A draw's first use
 *    of a program sets up the object's vertex state and the material's
 *    uniform list; in the frame of the switch that took 60 ms more.
 *
 * Done, the switch draws as cheaply as any frame after it.
 */
export class FrameAhead {
  /** Resolves true when the programs are ready, false when `gone` cut it short */
  readonly compiled: Promise<boolean>;
  private ready = false;
  /** Where drawSome goes on: the draw and its object */
  private drawAt = 0;
  private objectAt = 0;
  private sliceSize = 1;
  private readonly objects: Object3D[][];
  /** Every light of the scene; which of them shine depends on the light state */
  private readonly lights: Object3D[] = [];
  /**
   * Stands in for the scene: its environment and fog, and as children the
   * lights that shine (and, to draw, a slice of objects), set without taking
   * them from their parents (their matrices are the frame's). three gathers
   * the lights of a scene it compiles or draws by walking it, and the whole
   * scene took a few ms a walk. A stand-in, not the scene with its children
   * swapped: the light state of the scene would change with each state the
   * work goes through, and the next frame sent every material of the scene
   * through the program lookup again (26 ms)
   */
  private readonly proxy = new Scene();
  private readonly scissor = new Vector4();
  /** The materials drawSome has drawn */
  private readonly drawnMaterials = new Set<Material>();

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly draws: readonly RecordedDraw[],
    private readonly options: FrameAheadOptions,
  ) {
    this.objects = draws.map((d) => (d.object === options.scene ? renderables(d.object) : [d.object]));
    options.scene.traverse((o) => {
      if ((o as { isLight?: boolean }).isLight) this.lights.push(o);
    });
    this.proxy.matrixWorldAutoUpdate = false;
    this.compiled = this.compile().then((done) => (this.ready = done));
  }

  /** Of a draw's materials those drawSome has not drawn yet */
  private fresh(material: Material | Material[] | undefined): Material[] {
    return (Array.isArray(material) ? material : material ? [material] : []).filter((m) => !this.drawnMaterials.has(m));
  }

  private gone(): boolean {
    return this.options.gone?.() ?? false;
  }

  /**
   * Runs `run` in each light state with the stand-in's children the lights
   * that shine in it and `objects`
   */
  private inEachState(objects: readonly Object3D[], run: () => void): void {
    const proxy = this.proxy as Scene & { children: Object3D[] };
    proxy.environment = this.options.scene.environment;
    proxy.fog = this.options.scene.fog;
    const state = () => {
      proxy.children = this.lights.filter(shines).concat(objects);
      run();
    };
    try {
      if (this.options.lightStates) this.options.lightStates(state);
      else state();
    } finally {
      proxy.children = [];
    }
  }

  private async compile(): Promise<boolean> {
    const { renderer, options } = this;
    const budget = options.budgetMs ?? 3;
    const jobs: Promise<unknown>[] = [];
    let taskStart = performance.now();
    for (let d = 0; d < this.draws.length; d++) {
      const draw = this.draws[d];
      const objects = this.objects[d];
      const ofScene = draw.object === options.scene;
      let size = 1;
      for (let at = 0; at < objects.length; ) {
        if (performance.now() - taskStart > budget) {
          await afterNextFrame();
          if (this.gone()) return false;
          taskStart = performance.now();
        }
        const slice = new CompileSlice(objects.slice(at, (at += size)));
        const sliceStart = performance.now();
        const previous = renderer.getRenderTarget();
        renderer.setRenderTarget(draw.target);
        try {
          // A draw of a single mesh (a pass's quad) is its own scene, as in renderer.render
          if (ofScene) this.inEachState([], () => jobs.push(renderer.compileAsync(slice, draw.camera, this.proxy)));
          else withMaterial(draw, () => jobs.push(renderer.compileAsync(slice, draw.camera, draw.object as Scene)));
        } finally {
          renderer.setRenderTarget(previous);
        }
        size = nextSlice(size, performance.now() - sliceStart, budget);
      }
    }
    await Promise.all(jobs);
    // Frames drawn meanwhile let compileAsync settle before every program is built
    await programsReady(renderer);
    if (this.gone()) return false;
    await firstUsePrograms(renderer, () => this.gone());
    return !this.gone();
  }

  /**
   * In a frame, before its draw: first draws of the recorded objects for
   * about `budgetMs`, into one pixel of their targets (the frame's draw
   * covers it), with at most `maxFirsts` materials drawn for the first time
   * (at least one object). True once all are drawn; false while the
   * programs still compile or draws are left
   */
  drawSome(budgetMs: number, maxFirsts: number): boolean {
    if (!this.ready) return false;
    let firsts = 0;
    const { renderer, options } = this;
    const start = performance.now();
    const previous = renderer.getRenderTarget();
    const scissorTest = renderer.getScissorTest();
    renderer.getScissor(this.scissor);
    const shadows = renderer.shadowMap;
    const shadowsAuto = shadows.autoUpdate;
    const shadowsNeed = shadows.needsUpdate;
    const scene = options.scene;
    // The frame's draw renders the shadows
    shadows.autoUpdate = false;
    shadows.needsUpdate = false;
    try {
      while (this.drawAt < this.draws.length && performance.now() - start < budgetMs) {
        const draw = this.draws[this.drawAt];
        const objects = this.objects[this.drawAt];
        renderer.setRenderTarget(draw.target);
        renderer.setScissorTest(true);
        renderer.setScissor(0, 0, 1, 1);
        if (draw.object !== scene) {
          const fresh = this.fresh(draw.material);
          if (fresh.length && firsts > 0 && firsts + fresh.length > maxFirsts) break;
          for (const m of fresh) this.drawnMaterials.add(m);
          firsts += fresh.length;
          withMaterial(draw, () => renderer.render(draw.object, draw.camera));
          this.drawAt++;
          continue;
        }
        // A slice ends before a material more than the frame may draw first: the GPU process builds a program
        // again on its first draw (ANGLE), unseen by the main thread
        let end = this.objectAt;
        const limit = Math.min(objects.length, this.objectAt + this.sliceSize);
        while (end < limit) {
          const fresh = this.fresh((objects[end] as { material?: Material | Material[] }).material);
          if (fresh.length && firsts > 0 && firsts + fresh.length > maxFirsts) break;
          for (const m of fresh) this.drawnMaterials.add(m);
          firsts += fresh.length;
          end++;
        }
        if (end === this.objectAt) break;
        const sliceStart = performance.now();
        this.inEachState(objects.slice(this.objectAt, end), () => renderer.render(this.proxy, draw.camera));
        this.sliceSize = nextSlice(this.sliceSize, performance.now() - sliceStart, budgetMs);
        this.objectAt = end;
        if (end >= objects.length) {
          this.objectAt = 0;
          this.drawAt++;
        }
      }
    } finally {
      renderer.setScissor(this.scissor);
      renderer.setScissorTest(scissorTest);
      renderer.setRenderTarget(previous);
      shadows.autoUpdate = shadowsAuto;
      shadows.needsUpdate = shadowsNeed;
    }
    return this.drawAt >= this.draws.length;
  }
}
