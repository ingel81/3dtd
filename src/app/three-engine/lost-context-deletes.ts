/** The WebGL2 calls that make an object three deletes later (fenceSync makes a WebGLSync). */
const CREATE_METHODS = [
  'createBuffer',
  'createFramebuffer',
  'createProgram',
  'createQuery',
  'createRenderbuffer',
  'createSampler',
  'createShader',
  'createTexture',
  'createTransformFeedback',
  'createVertexArray',
  'fenceSync',
] as const;

/** Their delete calls. */
const DELETE_METHODS = [
  'deleteBuffer',
  'deleteFramebuffer',
  'deleteProgram',
  'deleteQuery',
  'deleteRenderbuffer',
  'deleteSampler',
  'deleteShader',
  'deleteTexture',
  'deleteTransformFeedback',
  'deleteVertexArray',
  'deleteSync',
] as const;

type GLMethod = (...args: unknown[]) => unknown;

/**
 * Let `gl` delete only objects of its current context.
 *
 * After a WebGL context loss three builds its GL state again
 * (WebGLRenderer.onContextRestore), but every texture, geometry, material and
 * render target it had used keeps the dispose listener of the old state. When
 * one of them is disposed afterwards, say a tile the tiles renderer unloads or
 * an enemy pool, that listener deletes the handle from the lost context, and
 * Chrome logs "delete: object does not belong to this context" for each. The
 * handle went with the lost context, so skipping the call frees nothing that
 * is still in use.
 *
 * Tracks the objects made since the last `webglcontextlost` on `canvas`; until
 * the first loss every delete goes through. Returns a function that puts the
 * context's methods back and stops listening.
 */
export function skipLostContextDeletes(gl: WebGL2RenderingContext, canvas: HTMLCanvasElement): () => void {
  /** Objects made since the last loss, null before the first one. */
  let current: WeakSet<object> | null = null;
  const methods = gl as unknown as Record<string, GLMethod>;
  const originals = new Map<string, GLMethod>();

  for (const name of CREATE_METHODS) {
    const create = methods[name];
    if (typeof create !== 'function') continue;
    originals.set(name, create);
    methods[name] = (...args: unknown[]): unknown => {
      const made = create.apply(gl, args);
      if (current !== null && typeof made === 'object' && made !== null) current.add(made);
      return made;
    };
  }
  for (const name of DELETE_METHODS) {
    const remove = methods[name];
    if (typeof remove !== 'function') continue;
    originals.set(name, remove);
    methods[name] = (object: unknown): unknown => {
      if (current !== null && typeof object === 'object' && object !== null && !current.has(object)) return undefined;
      return remove.call(gl, object);
    };
  }

  // A lost context makes nothing until it is restored, so every object made
  // after this belongs to the restored one.
  const onLost = (): void => {
    current = new WeakSet();
  };
  canvas.addEventListener('webglcontextlost', onLost);

  return () => {
    canvas.removeEventListener('webglcontextlost', onLost);
    for (const [name, method] of originals) methods[name] = method;
  };
}
