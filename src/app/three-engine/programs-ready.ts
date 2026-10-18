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
export async function firstUsePrograms(
  renderer: { info: { programs?: readonly object[] | null } },
  gone: () => boolean = () => false,
  pace?: () => Promise<void>,
): Promise<void> {
  for (const p of [...(renderer.info.programs ?? [])]) {
    if (gone()) return;
    const t = performance.now();
    (p as { getUniforms?: () => unknown }).getUniforms?.();
    // Only work that took time gives the frames a turn; with `pace` (in play) every program that had work waits
    // for it: its calls wait for the GPU process, and a few of them in one frame held it 20 to 50 ms
    const ms = performance.now() - t;
    if (pace && ms > 0.3) await pace();
    else if (ms > 2) await new Promise((resolve) => setTimeout(resolve));
  }
}

/**
 * The first-use work (firstUsePrograms) of the programs `materials` were
 * compiled with, now, one program per task: for parts that draw outside
 * the frames (PMREM, the sky's bake, an impostor's bake), whose first draw
 * otherwise did it in one long task. A material not compiled yet is
 * skipped.
 */
export async function firstUseOf(
  renderer: { properties: { get(object: object): unknown } },
  materials: readonly (object | null | undefined)[],
): Promise<void> {
  for (const material of materials) {
    if (!material) continue;
    const program = (renderer.properties.get(material) as { currentProgram?: { getUniforms?: () => unknown } }).currentProgram;
    if (!program?.getUniforms) continue;
    program.getUniforms();
    await new Promise((resolve) => setTimeout(resolve));
  }
}
