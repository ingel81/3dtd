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

/**
 * Does each program's first-use work now, one program per task: three
 * fetches a program's info log and its uniform and attribute locations the
 * first time a draw uses it (WebGLProgram.getUniforms), and for a program
 * compiled ahead but not drawn yet (the other light state, a biome's
 * assets) that cost 50 to 160 ms in the frame of the click that first drew
 * it. Programs already used answer at once. Resolves when all are done.
 */
export async function firstUsePrograms(renderer: { info: { programs?: readonly object[] | null } }, gone: () => boolean = () => false): Promise<void> {
  for (const p of [...(renderer.info.programs ?? [])]) {
    if (gone()) return;
    const t = performance.now();
    (p as { getUniforms?: () => unknown }).getUniforms?.();
    // Only work that took time gives the frames a turn
    if (performance.now() - t > 2) await new Promise((resolve) => setTimeout(resolve));
  }
}
