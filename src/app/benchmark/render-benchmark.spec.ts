import { isBenchmarkSearch } from './benchmark-report';
import { GpuTimer } from './gpu-timer';
import {
  formatRenderBenchmark, isRenderBenchmarkSearch, renderBenchmarkUrl, renderRow, viewPose, type Pose, type RenderBenchEnv,
} from './render-benchmark';

describe('render benchmark (docs/BENCHMARKS.md, Bildkosten)', () => {
  it('runs on any world with benchmark=render, and is not the load benchmark', () => {
    expect(isRenderBenchmarkSearch('?world=map:demo-valley&benchmark=render')).toBe(true);
    expect(isRenderBenchmarkSearch('?devworld&benchmark')).toBe(false);
    expect(isBenchmarkSearch('?devworld&benchmark=render')).toBe(false);
    expect(isBenchmarkSearch('?devworld&benchmark')).toBe(true);
    const url = new URL(renderBenchmarkUrl('http://x/?world=map:harbor-town#a'));
    expect(url.searchParams.get('world')).toBe('map:harbor-town');
    expect(url.searchParams.get('benchmark')).toBe('render');
    expect(url.hash).toBe('');
  });

  it('flies the same paths around the HQ on every world', () => {
    const hq = [100, 20, -50] as const;
    const start: Pose = { position: [100, 220, 150], target: [0, 0, 0] };
    expect(viewPose('game', 0.5, hq, start)).toBeNull();
    expect(viewPose('close', 0, hq, start)).toEqual({ position: [130, 32, -20], target: [100, 22, -50] });
    // The circle keeps the start view's distance and height, and comes back where it began
    const begin = viewPose('pan', 0, hq, start)!;
    const half = viewPose('pan', 0.5, hq, start)!;
    const end = viewPose('pan', 1, hq, start)!;
    expect(begin.position[0]).toBeCloseTo(100);
    expect(begin.position[2]).toBeCloseTo(150);
    expect(half.position[2]).toBeCloseTo(-250);
    expect(half.position[1]).toBe(220);
    expect(end.position[2]).toBeCloseTo(150);
    expect(viewPose('top', 0, hq, start)!.position).toEqual([100, 520, -45]);
  });

  it('sums a view up per frame and writes it as text', () => {
    const row = renderRow('game', [0, 10, 20, 40], [1, 2, 3, 2], 1.5, [100, 102], [1e6, 1e6]);
    expect(row).toMatchObject({ frames: 4, gpuMs: 2, calls: 101, triangles: 1e6, cpuMs: 1.5 });
    expect(row.frameMs).toBeCloseTo(40 / 3);
    expect(row.frameP95Ms).toBe(20);
    expect(renderRow('top', [0, 16], null, 0, [], []).gpuMs).toBeNull();
    const env: RenderBenchEnv = {
      date: '2026-10-14T01:00:00Z', version: 'v0.7.1', commit: 'abc', dirty: false, browser: 'Chrome 152', os: 'Windows',
      gpu: 'RTX', world: 'map:demo-valley', quality: 'high', devicePixelRatio: 1, canvas: [1300, 852], gpuTimer: true,
    };
    const text = formatRenderBenchmark(env, [row]);
    expect(text).toContain('map:demo-valley, quality high');
    expect(text.split('\n').at(-1)).toMatch(/^game\s+13\.33\s+20\.00\s+2\.00\s+3\.00\s+1\.50\s+101\s+1\.00 M$/);
  });
});

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
});
