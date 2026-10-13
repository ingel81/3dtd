import { GpuFrameMeter, GpuTimer } from './gpu-timer';

describe('GpuTimer', () => {
  /** A WebGL2 context with a timer extension whose results come one poll after the end */
  function fakeGl(available: boolean, disjoint = false) {
    let made = 0;
    const done = new Set<number>();
    const gl = {
      QUERY_RESULT_AVAILABLE: 1, QUERY_RESULT: 2,
      getExtension: (name: string) => (available && name === 'EXT_disjoint_timer_query_webgl2' ? { TIME_ELAPSED_EXT: 10, GPU_DISJOINT_EXT: 11 } : null),
      createQuery: () => ++made,
      beginQuery: vi.fn(),
      endQuery: (_: number) => undefined,
      deleteQuery: vi.fn(),
      getParameter: () => disjoint,
      getQueryParameter: (q: number, p: number) => (p === 1 ? done.has(q) : q * 1e6),
    };
    return { gl: gl as unknown as WebGL2RenderingContext, finish: (q: number) => done.add(q) };
  }

  it('is null without the extension', () => {
    expect(GpuTimer.create(fakeGl(false).gl)).toBeNull();
  });

  it('keeps the results in order once the GPU has them, and leaves disjoint ones out', () => {
    const { gl, finish } = fakeGl(true);
    const timer = GpuTimer.create(gl)!;
    timer.begin();
    timer.end();
    timer.begin();
    timer.end();
    expect(timer.take()).toEqual([]);
    finish(1);
    finish(2);
    expect(timer.take()).toEqual([1, 2]);
    // The queries come back into the pool
    timer.begin();
    timer.end();
    finish(2);
    expect(timer.take()).toEqual([2]);

    const bad = fakeGl(true, true);
    const skewed = GpuTimer.create(bad.gl)!;
    skewed.begin();
    skewed.end();
    bad.finish(1);
    expect(skewed.take()).toEqual([]);
    expect(skewed.disjoint).toBe(1);
  });

  it('meters every frame for each reader, and none while nobody reads', () => {
    const { gl, finish } = fakeGl(true);
    const begin = gl.beginQuery as unknown as ReturnType<typeof vi.fn>;
    const meter = new GpuFrameMeter(gl);
    meter.begin();
    meter.end();
    expect(begin).not.toHaveBeenCalled();
    const a = meter.open()!;
    const b = meter.open()!;
    meter.begin();
    meter.end();
    finish(1);
    meter.begin();
    meter.end();
    expect(a.take()).toEqual([1]);
    expect(b.take()).toEqual([1]);
    a.close();
    b.close();
    meter.begin();
    expect(begin).toHaveBeenCalledTimes(2);
    expect(new GpuFrameMeter(fakeGl(false).gl).open()).toBeNull();
  });
});
