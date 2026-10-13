/**
 * GPU time of a stretch of draw calls, through EXT_disjoint_timer_query_webgl2
 * (the render benchmark, docs/BENCHMARKS.md "Bildkosten"). The query's result
 * comes a few frames later: `end` polls the queries in flight and keeps the
 * finished ones. A browser without the extension (Firefox and Safari hide it,
 * Chrome offers it on most desktops) gets no timer: `create` returns null and
 * the benchmark reports the frame time alone.
 */

/** The extension's names, typed (lib.dom does not know it) */
interface TimerQueryExt {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

/** Queries in flight at most; older ones are dropped rather than piling up when the GPU falls behind */
const MAX_IN_FLIGHT = 8;

export class GpuTimer {
  private readonly pool: WebGLQuery[] = [];
  private readonly inFlight: WebGLQuery[] = [];
  private running: WebGLQuery | null = null;
  private results: number[] = [];
  /** Results the GPU marked as unreliable (power state, context switch) and left out */
  disjoint = 0;

  private constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly ext: TimerQueryExt,
  ) {}

  /** A timer on `gl`, null where the browser has no timer queries */
  static create(gl: WebGL2RenderingContext): GpuTimer | null {
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerQueryExt | null;
    return ext ? new GpuTimer(gl, ext) : null;
  }

  begin(): void {
    if (this.running || this.inFlight.length >= MAX_IN_FLIGHT) return;
    const query = this.pool.pop() ?? this.gl.createQuery();
    if (!query) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, query);
    this.running = query;
  }

  end(): void {
    const query = this.running;
    if (query) {
      this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
      this.inFlight.push(query);
      this.running = null;
    }
    this.poll();
  }

  /** The milliseconds measured since the last call, in the order drawn */
  take(): number[] {
    this.poll();
    const out = this.results;
    this.results = [];
    return out;
  }

  /** Forget what is in flight and free the queries */
  dispose(): void {
    const gl = this.gl;
    if (this.running) gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    for (const query of [...this.pool, ...this.inFlight, ...(this.running ? [this.running] : [])]) gl.deleteQuery(query);
    this.pool.length = 0;
    this.inFlight.length = 0;
    this.running = null;
    this.results = [];
  }

  private poll(): void {
    const gl = this.gl;
    while (this.inFlight.length > 0) {
      const query = this.inFlight[0];
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
      const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT) as boolean;
      const ns = gl.getQueryParameter(query, gl.QUERY_RESULT) as number;
      this.inFlight.shift();
      this.pool.push(query);
      if (disjoint) this.disjoint++;
      else this.results.push(ns / 1e6);
    }
  }
}
