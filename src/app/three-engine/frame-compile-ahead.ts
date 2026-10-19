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
  /** The world's scene, whose draws compile with its lights */
  scene: Scene;
  /**
   * In place of the scene's own renderables for its draw: these objects,
   * lit by the scene (models loaded after the game stood, stand-ins never
   * drawn; ThreeTilesEngine.compileAhead)
   */
  objects?: readonly Object3D[];
  /** Main-thread time a frame's task spends compiling */
  budgetMs?: number;
  /** The work has become moot (a newer switch, a disposed engine) */
  gone?: () => boolean;
  /**
   * Runs `run` in the state the frame is made ready for and puts the one
   * drawn now back (a quality level's light count and effects): each task
   * of the compile and each frame's first draws run inside it
   */
  inState?: (run: () => void) => void;
  /**
   * Compile only, no first draws: the states made ready in the background,
   * where the draws cost frames (the GPU process works through each object's
   * first draw) and a switch later draws without them as fast
   */
  compileOnly?: boolean;
  /** What each compile task and each program's first use waits for: the next frame (default), or a quiet moment */
  pace?: () => Promise<void>;
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
 * (another output), so each task's compiles cost the
 * frame after it about as much again: one task per frame
 */
function afterNextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));
}

/** An object's render hook that does nothing (FrameAhead's first draws) */
const noHook = (): void => undefined;

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
 *    the scene's lights, a slice of objects per call and a few calls per task
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
  /** Every light of the scene; those shown shine (shines) */
  private readonly lights: Object3D[] = [];
  /**
   * Stands in for the scene: its environment and fog, and as children the
   * lights that shine (and, to draw, a slice of objects), set without taking
   * them from their parents (their matrices are the frame's). three gathers
   * the lights of a scene it compiles or draws by walking it, and the whole
   * scene took a few ms a walk. A stand-in, not the scene with its children
   * swapped: the scene's light state would change with each slice the work
   * goes through, and the next frame sent every material of the scene
   * through the program lookup again (26 ms)
   */
  private readonly proxy = new Scene();
  private readonly scissor = new Vector4();
  /** The materials drawSome has drawn */
  private readonly drawnMaterials = new Set<Material>();
  /** The compile built a program: the frame needs its first draws (drawSome) */
  private built = false;
  /** Set after the last first draw, signalled once the GPU process has done them (gpuCaughtUp) */
  private fence: WebGLSync | null = null;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly draws: readonly RecordedDraw[],
    private readonly options: FrameAheadOptions,
  ) {
    this.objects = draws.map((d) => (d.object === options.scene ? [...(options.objects ?? renderables(d.object))] : [d.object]));
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

  /** Runs `run` with the stand-in's children the scene's lights that shine and `objects` */
  private withLights(objects: readonly Object3D[], run: () => void): void {
    const proxy = this.proxy as Scene & { children: Object3D[] };
    proxy.environment = this.options.scene.environment;
    proxy.fog = this.options.scene.fog;
    try {
      proxy.children = this.lights.filter(shines).concat(objects);
      run();
    } finally {
      proxy.children = [];
    }
  }

  /** Runs `run` in the state the frame is made ready for (FrameAheadOptions.inState) */
  private within(run: () => void): void {
    if (this.options.inState) this.options.inState(run);
    else run();
  }

  private async compile(): Promise<boolean> {
    const { renderer, options } = this;
    const budget = options.budgetMs ?? 3;
    const jobs: Promise<unknown>[] = [];
    let d = 0;
    let at = 0;
    let size = 1;
    // One task per frame, each in the frame's state, compiling slices for about `budget`
    const programs = () => renderer.info.programs?.length ?? 0;
    const task = () => {
      const start = performance.now();
      const built = programs();
      // Until the budget is spent or a slice built a program: the GPU process translates each new one on its
      // main thread (tens of ms on ANGLE), and the frame after waits for it
      while (d < this.draws.length && performance.now() - start < budget && programs() === built) {
        const draw = this.draws[d];
        const objects = this.objects[d];
        const slice = new CompileSlice(objects.slice(at, (at += size)));
        const sliceStart = performance.now();
        const previous = renderer.getRenderTarget();
        renderer.setRenderTarget(draw.target);
        try {
          // A draw of a single mesh (a pass's quad) is its own scene, as in renderer.render
          if (draw.object === options.scene) this.withLights([], () => jobs.push(renderer.compileAsync(slice, draw.camera, this.proxy)));
          else withMaterial(draw, () => jobs.push(renderer.compileAsync(slice, draw.camera, draw.object as Scene)));
        } finally {
          renderer.setRenderTarget(previous);
        }
        size = nextSlice(size, performance.now() - sliceStart, budget);
        if (at >= objects.length) {
          d++;
          at = 0;
          size = 1;
        }
      }
      if (programs() !== built) this.built = true;
    };
    for (;;) {
      this.within(task);
      if (d >= this.draws.length) break;
      await (options.pace ?? afterNextFrame)();
      if (this.gone()) return false;
    }
    await Promise.all(jobs);
    // Frames drawn meanwhile let compileAsync settle before every program is built
    await programsReady(renderer);
    if (this.gone()) return false;
    await firstUsePrograms(renderer, () => this.gone(), this.options.pace ?? afterNextFrame);
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
    // Every program there already: the loading warm-up built and drew the state (prepareSwitchStates), and the
    // first draws here only cost frames (some ten of 40 ms per level switch on autumn keep)
    if (!this.built || this.options.compileOnly) return true;
    if (this.drawAt >= this.draws.length) return this.gpuCaughtUp();
    const renderer = this.renderer;
    const start = performance.now();
    const previous = renderer.getRenderTarget();
    const scissorTest = renderer.getScissorTest();
    renderer.getScissor(this.scissor);
    const shadows = renderer.shadowMap;
    const shadowsAuto = shadows.autoUpdate;
    const shadowsNeed = shadows.needsUpdate;
    // The frame's draw renders the shadows
    shadows.autoUpdate = false;
    shadows.needsUpdate = false;
    try {
      this.within(() => this.drawSlices(start, budgetMs, maxFirsts));
    } finally {
      renderer.setScissor(this.scissor);
      renderer.setScissorTest(scissorTest);
      renderer.setRenderTarget(previous);
      shadows.autoUpdate = shadowsAuto;
      shadows.needsUpdate = shadowsNeed;
    }
    if (this.drawAt < this.draws.length) return false;
    // A fence after the last of them: the switch waits until the GPU process has done them
    const gl = renderer.getContext() as WebGL2RenderingContext;
    this.fence = typeof gl.fenceSync === 'function' ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
    gl.flush();
    return false;
  }

  /**
   * Whether the GPU process has done the first draws (their fence signalled,
   * asked without waiting). A switch in a frame with that work still queued
   * waited for it in its first call that syncs with the GPU process (the
   * canvas resized to the level's resolution: 170 ms)
   */
  private gpuCaughtUp(): boolean {
    const fence = this.fence;
    if (!fence) return true;
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (gl.getSyncParameter(fence, gl.SYNC_STATUS) !== gl.SIGNALED) return false;
    gl.deleteSync(fence);
    this.fence = null;
    return true;
  }

  /** drawSome's draws, from `start` on for about `budgetMs` */
  private drawSlices(start: number, budgetMs: number, maxFirsts: number): void {
    const { renderer, options } = this;
    const scene = options.scene;
    let firsts = 0;
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
      const slice = objects.slice(this.objectAt, end);
      // Without the objects' render hooks: a water's mirror renders the scene again and its refraction copies the
      // frame in them, for every slice (eight frames of 40 ms after a level's compile); a pixel needs neither
      const hooks = slice.map((o) => [o.onBeforeRender, o.onAfterRender] as const);
      for (const o of slice) {
        o.onBeforeRender = noHook;
        o.onAfterRender = noHook;
      }
      const sliceStart = performance.now();
      try {
        this.withLights(slice, () => renderer.render(this.proxy, draw.camera));
      } finally {
        slice.forEach((o, k) => ([o.onBeforeRender, o.onAfterRender] = hooks[k]));
      }
      this.sliceSize = nextSlice(this.sliceSize, performance.now() - sliceStart, budgetMs);
      this.objectAt = end;
      if (end >= objects.length) {
        this.objectAt = 0;
        this.drawAt++;
      }
    }
  }
}
