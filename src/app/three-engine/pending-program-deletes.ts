/** How often parked deletes ask whether their program is built, ms */
const POLL_MS = 50;

/**
 * Lets `gl` delete a program that is still being built (KHR_parallel_shader_compile)
 * once it is built, not at once.
 *
 * Deleting a program whose link still runs in the driver's worker makes the
 * GPU process wait for that link before it does anything else, and the next
 * call that waits for the GPU process waits with it. When the editor went
 * while the terrain and apron programs of its compile-ahead were still
 * linking (seconds each under load), its dispose deleted them and the game's
 * first `getContext` then blocked the main thread 7 to 8.5 s (browser
 * profile, 2026-10-19). A parked delete asks the program's completion status
 * (which does not wait) every POLL_MS and deletes it once it is built; with
 * the context lost meanwhile it is dropped, the program went with it.
 * Without the extension every delete goes through at once.
 *
 * Returns a function that puts deleteProgram back; what is parked goes on
 * waiting for its program.
 */
export function deferPendingProgramDeletes(gl: WebGL2RenderingContext): () => void {
  const ext = gl.getExtension('KHR_parallel_shader_compile') as { COMPLETION_STATUS_KHR: number } | null;
  const methods = gl as unknown as { deleteProgram: (program: WebGLProgram | null) => void };
  const remove = methods.deleteProgram;
  if (!ext) return () => undefined;
  const parked: WebGLProgram[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const built = (program: WebGLProgram): boolean => gl.getProgramParameter(program, ext.COMPLETION_STATUS_KHR) !== false;
  const drain = (): void => {
    timer = null;
    if (gl.isContextLost()) {
      parked.length = 0;
      return;
    }
    for (let k = parked.length - 1; k >= 0; k--) {
      if (!built(parked[k])) continue;
      remove.call(gl, parked[k]);
      parked.splice(k, 1);
    }
    if (parked.length) timer = setTimeout(drain, POLL_MS);
  };

  methods.deleteProgram = (program: WebGLProgram | null): void => {
    if (!program || gl.isContextLost() || built(program)) {
      remove.call(gl, program);
      return;
    }
    parked.push(program);
    timer ??= setTimeout(drain, POLL_MS);
  };

  return () => {
    methods.deleteProgram = remove;
  };
}
