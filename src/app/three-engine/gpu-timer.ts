/**
 * GPU time of a stretch of draw calls, through EXT_disjoint_timer_query_webgl2
 * (GpuFrameMeter below: the dynamic resolution, Auto's measurement and the
 * graphics benchmark, docs/RENDER_QUALITY.md, docs/BENCHMARKS.md). The query's result
 * comes a few frames later: `end` polls the queries in flight and keeps the
 * finished ones. A browser without the extension (Firefox and Safari hide it,
 * Chrome offers it on most desktops) gets no timer: `create` returns null and
 * its readers fall back to the frame time.
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

/** GPU times of the frames since the last `take`, for one reader of the meter */
export interface GpuTimeReader {
  take(): number[];
  close(): void;
}

/**
 * The engine's GPU timer around every frame's draw, for whoever reads it
 * (the dynamic resolution, Auto's measurement, the graphics benchmark):
 * one timer query a frame however many read, none while nobody does.
 */
export class GpuFrameMeter {
  private timer: GpuTimer | null | undefined;
  private readonly readers = new Set<number[]>();

  constructor(private readonly gl: WebGL2RenderingContext) {}

  /** The browser has timer queries */
  get available(): boolean {
    return this.ensure() !== null;
  }

  /** A reader of the frames from now on; null where the browser has no timer */
  open(): GpuTimeReader | null {
    const timer = this.ensure();
    if (!timer) return null;
    const buffer: number[] = [];
    this.readers.add(buffer);
    return {
      take: () => buffer.splice(0),
      close: () => {
        this.readers.delete(buffer);
        if (this.readers.size === 0) timer.take();
      },
    };
  }

  begin(): void {
    if (this.readers.size) this.timer?.begin();
  }

  end(): void {
    if (!this.readers.size || !this.timer) return;
    this.timer.end();
    const times = this.timer.take();
    if (times.length) for (const buffer of this.readers) buffer.push(...times);
  }

  dispose(): void {
    this.timer?.dispose();
    this.readers.clear();
  }

  private ensure(): GpuTimer | null {
    if (this.timer === undefined) this.timer = GpuTimer.create(this.gl);
    return this.timer;
  }
}
