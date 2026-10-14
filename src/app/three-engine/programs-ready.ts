/**
 * Resolves once every program the renderer holds has finished compiling
 * (KHR_parallel_shader_compile's completion status, WebGLProgram.isReady),
 * polling without blocking. compileAsync alone does not say so when frames
 * keep drawing meanwhile: it asks each material's current program, and a
 * frame that drew the material for another picture (the screen instead of
 * a render target, with fog instead of without) set that one, ready long
 * ago. A draw that comes to a program still compiling then waits for it on
 * the main thread. `timeoutMs` gives up waiting (a lost context).
 */
export function programsReady(
  renderer: { info: { programs?: readonly object[] | null } },
  timeoutMs = 10_000,
  everyMs = 16,
): Promise<void> {
  const until = performance.now() + timeoutMs;
  return new Promise((resolve) => {
    const check = () => {
      const programs = renderer.info.programs ?? [];
      // three's typings leave out WebGLProgram.isReady
      if (programs.every((p) => (p as { isReady?: () => boolean }).isReady?.() !== false) || performance.now() >= until) resolve();
      else setTimeout(check, everyMs);
    };
    check();
  });
}
