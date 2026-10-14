/**
 * The render benchmark's views, poses and results as text (docs/BENCHMARKS.md
 * "Bildkosten"). Pure: RenderBenchmarkService flies the camera and measures,
 * the panel shows the table, tools/render-bench runs it per world and level.
 *
 * Every world gets the same camera paths around its HQ, so a custom map and
 * a tiles place compare frame for frame: the game's start view, a close view
 * at grass height, a full circle at the start view's distance, and a top view
 * as in the editor.
 */
import { BENCHMARK_FLAG, browserOf, osOf, shortGpu } from './benchmark-report';

/** `benchmark=render`: the page runs the render benchmark on whatever world it opens */
export const RENDER_BENCHMARK_VALUE = 'render';

/** The page was loaded to run the render benchmark (search string of the location) */
export function isRenderBenchmarkSearch(search: string): boolean {
  return new URLSearchParams(search).get(BENCHMARK_FLAG) === RENDER_BENCHMARK_VALUE;
}

/** `href` with the render benchmark's flag; the world (place or map) stays */
export function renderBenchmarkUrl(href: string): string {
  const url = new URL(href);
  url.hash = '';
  url.searchParams.set(BENCHMARK_FLAG, RENDER_BENCHMARK_VALUE);
  return url.toString();
}

export type RenderViewId = 'game' | 'close' | 'pan' | 'top';

export interface RenderView {
  id: RenderViewId;
  label: string;
}

/** The camera paths, in this order */
export const RENDER_VIEWS: readonly RenderView[] = [
  { id: 'game', label: 'Game view' },
  { id: 'close', label: 'Close, grass height' },
  { id: 'pan', label: 'Circle around the HQ' },
  { id: 'top', label: 'Top view' },
];

/** Seconds each view is measured, after it settled */
export const RENDER_VIEW_SECONDS = 5;

export type Vec3 = readonly [number, number, number];

/** Where the camera stands and what it looks at, scene metres */
export interface Pose {
  position: Vec3;
  target: Vec3;
}

/** Close view: this far from the HQ on both ground axes and this high over it, m */
const CLOSE_OFFSET = 30;
const CLOSE_HEIGHT = 12;
/** Top view: this high over the HQ, m; a few metres off the vertical keeps lookAt's up axis defined */
const TOP_HEIGHT = 500;
const TOP_TILT = 5;

/**
 * The camera of `view` at `t` (0 to 1) of its measurement, around `hq` (scene
 * metres, on the ground). `start` is the game's start view: the circle keeps
 * its distance and height. Null for the game view, which keeps the start
 * pose exactly (position and turn).
 */
export function viewPose(view: RenderViewId, t: number, hq: Vec3, start: Pose): Pose | null {
  const [x, y, z] = hq;
  switch (view) {
    case 'game':
      return null;
    case 'close':
      return { position: [x + CLOSE_OFFSET, y + CLOSE_HEIGHT, z + CLOSE_OFFSET], target: [x, y + 2, z] };
    case 'pan': {
      const dx = start.position[0] - x;
      const dz = start.position[2] - z;
      const radius = Math.max(50, Math.hypot(dx, dz));
      const angle = Math.atan2(dz, dx) + t * 2 * Math.PI;
      return { position: [x + radius * Math.cos(angle), start.position[1], z + radius * Math.sin(angle)], target: [x, y, z] };
    }
    case 'top':
      return { position: [x, y + TOP_HEIGHT, z + TOP_TILT], target: [x, y, z] };
  }
}

/** One view measured */
export interface RenderRow {
  view: RenderViewId;
  frames: number;
  /** Mean time between drawn frames, ms (the frame rate's inverse; capped by the display unless uncapped) */
  frameMs: number;
  /** The interval only 5 % of frames were slower than, ms */
  frameP95Ms: number;
  /** GPU time of the draw per frame (timer query), mean and 95th percentile, ms; null without a timer */
  gpuMs: number | null;
  gpuP95Ms: number | null;
  /**
   * The median GPU time, ms: on a machine that does other work meanwhile
   * a few long frames pull the mean up, the median holds
   */
  gpuMedianMs: number | null;
  /** Main thread time of update and draw per frame, ms */
  cpuMs: number;
  /** Draw calls and triangles per frame, over every pass (shadow, scene, post) */
  calls: number;
  triangles: number;
}

/** The page and machine a run was measured on */
export interface RenderBenchEnv {
  date: string;
  version: string;
  commit: string;
  dirty: boolean | null;
  browser: string;
  os: string;
  gpu: string;
  /** The world measured: `map:<id>`, `tiles <lat>,<lon>` or `devworld` */
  world: string;
  /** The quality level the run used, `-` before there were levels */
  quality: string;
  devicePixelRatio: number;
  /** Drawing buffer in pixels */
  canvas: [number, number];
  /** The GPU column comes from timer queries; false: the browser has none */
  gpuTimer: boolean;
}

export function envOf(
  base: Omit<RenderBenchEnv, 'browser' | 'os' | 'gpu'>,
  userAgent: string,
  rendererName: string,
): RenderBenchEnv {
  return { ...base, browser: browserOf(userAgent), os: osOf(userAgent), gpu: shortGpu(rendererName) };
}

const mean = (values: readonly number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

function quantile(values: readonly number[], q: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

const p95 = (values: readonly number[]) => quantile(values, 0.95);

/** A view's row from what was taken per frame: draw start times, GPU ms, CPU ms, calls, triangles */
export function renderRow(
  view: RenderViewId,
  starts: readonly number[],
  gpu: readonly number[] | null,
  cpuMs: number,
  calls: readonly number[],
  triangles: readonly number[],
): RenderRow {
  const gaps = starts.slice(1).map((t, i) => t - starts[i]);
  return {
    view,
    frames: starts.length,
    frameMs: mean(gaps),
    frameP95Ms: p95(gaps),
    gpuMs: gpu && gpu.length ? mean(gpu) : null,
    gpuP95Ms: gpu && gpu.length ? p95(gpu) : null,
    gpuMedianMs: gpu && gpu.length ? quantile(gpu, 0.5) : null,
    cpuMs,
    calls: Math.round(mean(calls)),
    triangles: Math.round(mean(triangles)),
  };
}

export const RENDER_HEAD = ['View', 'Frame', 'p95', 'GPU', 'GPU med', 'GPU p95', 'CPU', 'Calls', 'Triangles'];

const ms = (value: number | null) => (value === null ? '-' : value.toFixed(2));

/** The numbers of a row as the table shows them */
export function renderCells(row: RenderRow): string[] {
  return [
    row.view,
    ms(row.frameMs),
    ms(row.frameP95Ms),
    ms(row.gpuMs),
    ms(row.gpuMedianMs),
    ms(row.gpuP95Ms),
    ms(row.cpuMs),
    String(row.calls),
    `${(row.triangles / 1e6).toFixed(2)} M`,
  ];
}

function table(head: string[], rows: string[][]): string[] {
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd();
  return [line(head), ...rows.map(line)];
}

/** The results as text: the machine and world in the head, one line per view, times in ms */
export function formatRenderBenchmark(env: RenderBenchEnv, rows: readonly RenderRow[]): string {
  return [
    `3DTD render benchmark ${env.date.slice(0, 16).replace('T', ' ')}`,
    `${env.world}, quality ${env.quality}; ${env.version} (${env.commit}${env.dirty ? '+' : ''}), ${env.browser}, ${env.os}, ${env.gpu}`,
    `canvas ${env.canvas[0]}x${env.canvas[1]} at DPR ${env.devicePixelRatio}; times in ms per frame${env.gpuTimer ? '' : '; no GPU timer in this browser'}`,
    '',
    ...table(RENDER_HEAD, rows.map(renderCells)),
  ].join('\n');
}
