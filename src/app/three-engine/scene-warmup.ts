import type { Camera, Object3D, WebGLRenderer } from 'three';

/** What the load-time warm-up did, for the console log. */
export interface SceneWarmupResult {
  /** Programs three built for the warm-up, shaders the first wave would otherwise compile. */
  newPrograms: number;
  /** Main-thread time of the synchronous compile() inside compileAsync(). */
  syncMs: number;
  /** Until every program reports ready. */
  totalMs: number;
}

/**
 * Compile every shader the scene holds before the first wave needs it.
 *
 * Pools, projectile and VFX materials get their programs on first draw
 * otherwise, and the first draw of most of them is the first wave. With
 * KHR_parallel_shader_compile the driver compiles off the main thread and
 * compileAsync() resolves once all programs are ready; the synchronous part
 * is three building the program parameters for each material in the scene.
 */
export async function warmUpScene(
  renderer: Pick<WebGLRenderer, 'compileAsync' | 'info'>,
  scene: Object3D,
  camera: Camera,
): Promise<SceneWarmupResult> {
  const programsBefore = renderer.info.programs?.length ?? 0;
  const t0 = performance.now();
  const compiled = renderer.compileAsync(scene, camera);
  const syncMs = performance.now() - t0;
  await compiled;
  return {
    newPrograms: (renderer.info.programs?.length ?? 0) - programsBefore,
    syncMs,
    totalMs: performance.now() - t0,
  };
}
