import { NoToneMapping, PCFShadowMap, SRGBColorSpace, WebGLRenderer } from 'three';
import { releaseContext } from './context-release';
import { skipLostContextDeletes } from './lost-context-deletes';
import { deferPendingProgramDeletes } from './pending-program-deletes';
import type { ProgramPins } from './program-pins';
import { DrawLedger } from './draw-ledger';
import { isSharedGpu } from './shared-gpu';

/**
 * Leases whose pinned programs and shader ids stay after they end: the
 * lease that ended last and the one before it. Switching between the editor
 * and a test run (or two worlds) back and forth finds each side's programs
 * built; older pins are given back to three, which frees what no material
 * uses. Kept programs cost the GPU process a few MB per few hundred.
 */
export const KEEP_LEASES = 2;

/** Options of the shared renderer, without the canvas and its MSAA (RendererHost) */
export const CANVAS_RENDERER_OPTIONS = {
  antialias: true,
  // Required for the 1m..8000m depth range over the 3D tiles (kept to
  // avoid far-field z-fighting).
  logarithmicDepthBuffer: true,
  powerPreference: 'high-performance', // prefer dGPU on hybrid laptops
  // The tower range rings find the surface they lie on with the
  // stencil buffer; without one they paint their whole volume
  // (range-ring.ts). The composer target has one as well.
  stencil: true,
} as const;

const leaseBegins = new Set<() => void>();

/**
 * `listener` hears each new lease of a page's renderer, before its owner
 * draws (what outlives a view counts the leases it was not used in, as the
 * map assets do); returns the unsubscribe
 */
export function onLeaseBegin(listener: () => void): () => void {
  leaseBegins.add(listener);
  return () => leaseBegins.delete(listener);
}

const gpuResets = new Set<() => void>();

/**
 * `listener` hears when what the page uploaded is gone from the GPU: the
 * renderer was made anew (the other MSAA) or its context came back after a
 * loss. What keeps no CPU copy after its upload (the map models' textures)
 * has to be loaded again then; returns the unsubscribe
 */
export function onGpuReset(listener: () => void): () => void {
  gpuResets.add(listener);
  return () => gpuResets.delete(listener);
}

function gpuReset(): void {
  for (const listener of [...gpuResets]) listener();
}

/** A renderer lent to one owner: give it back with `release`, never dispose it */
export interface RendererLease {
  readonly renderer: WebGLRenderer;
  /** The canvas' MSAA, fixed for the context's life */
  readonly msaa: boolean;
  /** Back to the host: its canvas leaves the page, its context stays for the next owner */
  release(): void;
  /**
   * The owner's pinned programs and shader ids stay with the host after the
   * lease ends, for KEEP_LEASES leases: a later owner drawing the same
   * materials finds their programs built (the owner no longer disposes them)
   */
  keep(pins: ProgramPins): void;
}

/**
 * RendererHost: one WebGLRenderer and its canvas for every view that draws
 * the game's worlds, lent to one owner at a time (docs/CUSTOM_WORLD_PERF_VISUAL_PLAN.md, V11).
 *
 * Each world used to make its own canvas and context and lose the old one:
 * a switch built a context (blocking the main thread while the GPU process
 * was busy) and linked every program again. The host keeps the context: a
 * new owner gets the renderer in the state a fresh one has (`acquire`
 * resets what owners change: target, clear colour, tone mapping, shadows,
 * clipping, pixel ratio, three's GL state cache) and its canvas in the
 * owner's place in the page.
 *
 * MSAA is fixed when a context is made: an owner asking for the other
 * setting gets a new renderer and the old one's context goes once the new
 * view stands (releaseContext). Which MSAA a view asks for is decided in
 * one place (RendererHostService.msaa).
 *
 * A lease gives back what it drew: every geometry and material drawn or
 * compiled while it lasted is disposed with `release` (DrawLedger), but
 * what is the page's (shareGpu: module-level materials, the caches'
 * models), which the next view draws again from the GPU as it is. three
 * keeps a geometry's vertex array state by its id and a program while a
 * material counts as its user, not weakly, until they are disposed; a world
 * that let a mesh go without disposing it (a pool emptied, an overlay taken
 * out) kept its buffers and programs on the GPU, which a lost context used
 * to free. Textures go as they are disposed or collected (three holds them
 * weakly), and the listeners three hangs on what this renderer drew hold
 * only this renderer, which stays.
 *
 * The GL shims every renderer of the game needs are installed once, with
 * the renderer: deletes of handles of a lost context are skipped
 * (lost-context-deletes.ts), deletes of programs still linking wait for the
 * link (pending-program-deletes.ts).
 */
export class RendererHost {
  private current: { renderer: WebGLRenderer; msaa: boolean } | null = null;
  private owner: object | null = null;
  /** Pins kept from ended leases (RendererLease.keep), by the number of the lease they came from */
  private kept: { lease: number; pins: ProgramPins }[] = [];
  private leases = 0;
  /** What the lease now drew and compiled, given back when it ends */
  private ledger: DrawLedger | null = null;

  constructor(
    private readonly make: (msaa: boolean) => WebGLRenderer = (msaa) =>
      new WebGLRenderer({ ...CANVAS_RENDERER_OPTIONS, antialias: msaa }),
  ) {}

  /** The renderer, while one lives (diagnostics, the editor's next step) */
  get renderer(): WebGLRenderer | null {
    return this.current?.renderer ?? null;
  }

  /**
   * Lends the renderer to a new owner with its canvas in `slot`, made first
   * when none lives or its MSAA is not `msaa`. A previous owner that did not
   * give it back loses it (its release does nothing then). Throws when the
   * browser has no WebGL 2.
   */
  acquire(slot: HTMLElement, msaa: boolean): RendererLease {
    if (!this.current || this.current.msaa !== msaa) this.replace(msaa);
    const { renderer } = this.current!;
    const owner = {};
    const number = ++this.leases;
    this.owner = owner;
    // What an owner that never gave the renderer back drew goes now
    this.ledger!.free();
    resetRenderer(renderer);
    const canvas = renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    slot.appendChild(canvas);
    for (const listener of [...leaseBegins]) listener();
    return {
      renderer,
      msaa,
      release: () => {
        if (this.owner !== owner) return;
        this.owner = null;
        this.ledger!.free();
        // Pins of leases before the last KEEP_LEASES go back: three frees what no material holds
        for (const k of this.kept.filter((k) => k.lease <= number - KEEP_LEASES)) k.pins.dispose(renderer);
        this.kept = this.kept.filter((k) => k.lease > number - KEEP_LEASES);
        resetRenderer(renderer);
        canvas.remove();
      },
      keep: (pins) => {
        if (this.owner !== owner) pins.dispose(renderer);
        else this.kept.push({ lease: number, pins });
      },
    };
  }

  /** The renderer goes for good (the page closes): its context with it */
  dispose(): void {
    if (!this.current) return;
    const { renderer } = this.current;
    this.current = null;
    this.owner = null;
    this.kept = [];
    this.ledger?.freeAll();
    this.ledger = null;
    renderer.domElement.removeEventListener('webglcontextrestored', gpuReset);
    renderer.domElement.remove();
    renderer.dispose();
    renderer.forceContextLoss();
  }

  private replace(msaa: boolean): void {
    const old = this.current;
    let renderer: WebGLRenderer;
    try {
      renderer = this.make(msaa);
    } catch {
      throw new Error('WebGL is not supported. Enable hardware acceleration in your browser.');
    }
    const gl = renderer.getContext() as WebGL2RenderingContext;
    skipLostContextDeletes(gl, renderer.domElement);
    deferPendingProgramDeletes(gl);
    // Heard after three's own listener has made its state anew, before the owners' (they rebuild from what is loaded)
    renderer.domElement.addEventListener('webglcontextrestored', gpuReset);
    // What a lease drew and compiled, but the page's (shareGpu)
    const oldLedger = this.ledger;
    this.ledger = new DrawLedger(renderer, isSharedGpu);
    this.current = { renderer, msaa };
    // Pins of the old renderer go with it
    this.kept = [];
    if (old) {
      // The page's resources too: three's listeners on them would hold the old renderer
      oldLedger?.freeAll();
      old.renderer.domElement.remove();
      old.renderer.dispose();
      releaseContext(old.renderer);
      old.renderer.domElement.removeEventListener('webglcontextrestored', gpuReset);
      gpuReset();
    }
  }
}

/** What owners change on the renderer, back to a fresh renderer's state */
export function resetRenderer(renderer: WebGLRenderer): void {
  renderer.setRenderTarget(null);
  renderer.setClearColor(0x000000, 1);
  renderer.autoClear = true;
  renderer.toneMapping = NoToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.localClippingEnabled = false;
  renderer.clippingPlanes = [];
  renderer.shadowMap.enabled = false;
  renderer.shadowMap.autoUpdate = true;
  renderer.shadowMap.needsUpdate = false;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.info.autoReset = true;
  renderer.info.reset();
  renderer.setPixelRatio(1);
  renderer.resetState();
}
