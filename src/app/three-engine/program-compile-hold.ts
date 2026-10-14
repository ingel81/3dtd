/**
 * Holds the draw while programs compile off the main thread (a change of
 * the quality level, three-tiles-engine applyQuality). A level changes
 * what many programs are built for: the number of point lights every lit
 * material loops over, the output through the composer (FXAA, bloom). A
 * frame drawn before they are ready links each one on the main thread
 * (some 125 ms a program on ANGLE/D3D11, 2.7 to 4.3 s for the harbor town
 * at dusk); held, the picture stands still for the compile and the page
 * stays responsive. A newer hold takes over from an older one; `timeoutMs`
 * lets the draw go on whatever the compile does (a lost context).
 */
export class ProgramCompileHold {
  private run = 0;
  private held = false;

  constructor(private readonly timeoutMs = 5000) {}

  /** Frames skip the draw */
  get holding(): boolean {
    return this.held;
  }

  /** Hold the draw until `compile` settles, at most timeoutMs */
  async hold(compile: () => Promise<unknown>): Promise<void> {
    const run = ++this.run;
    this.held = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        compile().catch(() => undefined),
        new Promise<void>((resolve) => (timer = setTimeout(resolve, this.timeoutMs))),
      ]);
    } finally {
      clearTimeout(timer);
      if (run === this.run) this.held = false;
    }
  }
}
