import type { Camera, Object3D, WebGLRenderer } from 'three';
import { findDrawGates } from './renderers/draw-gate';

/** What the load-time warm-up did, for the console log. */
export interface SceneWarmupResult {
  /** Programs three built for the warm-up, shaders the first wave would otherwise compile. */
  newPrograms: number;
  /** Main-thread time of the synchronous compile() inside compileAsync(). */
  syncMs: number;
  /** Until every program reports ready. */
  compileMs: number;
  /** Pools drawn for one frame while empty. */
  pools: number;
  /** Waiting for that frame. */
  frameMs: number;
}

/**
 * Prepare everything in the scene before the first wave needs it.
 *
 * 1. Shaders. Pool, projectile and VFX materials get their programs on first
 *    draw otherwise, and the first draw of most of them is the first wave.
 *    With KHR_parallel_shader_compile the driver compiles off the main
 *    thread and compileAsync() resolves once all programs are ready; the
 *    synchronous part is three building the program parameters for each
 *    material in the scene. three r186 compile() walks hidden objects too
 *    (scene.traverse), so the empty, hidden pools are included.
 * 2. Uploads. Buffers and textures (the VAT position textures are large
 *    float textures) go to the GPU in the first frame that draws an object.
 *    Every pool hides while empty (DrawGate), so `renderedFrame` is awaited
 *    with all gates forced open: one loading frame draws the empty pools and
 *    uploads what the first spawn would otherwise upload.
 */
export async function warmUpScene(
  renderer: Pick<WebGLRenderer, 'compileAsync' | 'info'>,
  scene: Object3D,
  camera: Camera,
  renderedFrame: () => Promise<void>,
): Promise<SceneWarmupResult> {
  const programsBefore = renderer.info.programs?.length ?? 0;
  const t0 = performance.now();
  const compiled = renderer.compileAsync(scene, camera);
  const syncMs = performance.now() - t0;
  await compiled;
  const compileMs = performance.now() - t0;
  const newPrograms = (renderer.info.programs?.length ?? 0) - programsBefore;

  const gates = findDrawGates(scene);
  const t1 = performance.now();
  for (const gate of gates) gate.setForced(true);
  try {
    await renderedFrame();
  } finally {
    for (const gate of gates) gate.setForced(false);
  }

  return { newPrograms, syncMs, compileMs, pools: gates.length, frameMs: performance.now() - t1 };
}
