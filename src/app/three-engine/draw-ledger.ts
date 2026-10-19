import type { BufferGeometry, Material, Texture, WebGLRenderer } from 'three';
import { PIN_TWIN } from './program-pins';

type Resource = BufferGeometry | Material | Texture;

/**
 * DrawLedger: what a renderer drew, compiled and bound, to give it back.
 *
 * three keeps a geometry's vertex array state by its id and a program while
 * a material counts as its user until they are disposed, and every texture,
 * geometry and material it used hangs a dispose listener on itself that
 * holds the renderer (and with it its context, canvas and whatever drew
 * into it). An owner that goes without disposing what it drew leaves all of
 * that standing: a lost context used to free the GPU side, nothing freed the
 * listeners (E195).
 *
 * `free()` disposes every geometry, material and texture recorded since the
 * last `free()`, but what `keep` says lives on (the page's resources on the
 * page's renderer, which the next owner draws as they are); `freeAll()`
 * those too, for a renderer that goes. What is drawn again after a dispose
 * uploads and links again. A pin's twin (program-pins.ts) is the pins' to
 * give back, never the ledger's.
 *
 * Recorded where three passes everything: renderBufferDirect (every draw,
 * the shadow pass's included), compile (compileAsync compiles through it)
 * and the renderer's properties (every texture bound looks itself up there;
 * a render target's texture goes with its target).
 */
export class DrawLedger {
  /** Recorded since the last free(), and what `keep` keeps, recorded over the ledger's life */
  private readonly recorded = new Set<Resource>();
  private readonly kept = new Set<Resource>();

  constructor(
    renderer: WebGLRenderer,
    /** What free() leaves standing */
    private readonly keep: (resource: Resource) => boolean = () => false,
  ) {
    const record = (resource: Resource): void => {
      if (this.recorded.has(resource) || this.kept.has(resource)) return;
      (this.keep(resource) ? this.kept : this.recorded).add(resource);
    };
    const draw = renderer.renderBufferDirect;
    renderer.renderBufferDirect = function (camera, scene, geometry, material, object, group) {
      record(geometry);
      record(material);
      draw.call(this, camera, scene, geometry, material, object, group);
    };
    const compile = renderer.compile;
    renderer.compile = function (scene, camera, targetScene) {
      const compiled = compile.call(this, scene, camera, targetScene);
      for (const material of compiled) record(material);
      return compiled;
    };
    const properties = renderer.properties as unknown as { get(object: object): unknown };
    const get = properties.get;
    properties.get = function (object: object) {
      const texture = object as Texture & { isRenderTargetTexture?: boolean };
      if (texture.isTexture && !texture.isRenderTargetTexture) record(texture);
      return get.call(this, object);
    };
  }

  /** How many resources free() would give back now */
  get size(): number {
    return this.recorded.size;
  }

  /** Disposes what was recorded since the last free(), but what is kept, and starts afresh */
  free(): void {
    for (const resource of this.recorded) dispose(resource);
    this.recorded.clear();
    // No longer kept (its cache let it go and disposed it): nothing to hold on to
    for (const resource of this.kept) if (!this.keep(resource)) this.kept.delete(resource);
  }

  /** Disposes everything recorded, what is kept too (the renderer goes) */
  freeAll(): void {
    this.free();
    for (const resource of this.kept) dispose(resource);
    this.kept.clear();
  }

  /** Forgets what was recorded since the last free() without disposing it */
  forget(): void {
    this.recorded.clear();
  }
}

function dispose(resource: Resource): void {
  if ((resource as Material).isMaterial && (resource as Material).userData[PIN_TWIN]) return;
  resource.dispose();
}
