/**
 * The in-game benchmark's plan, its URL and its results as text (TODO E74,
 * docs/SIM_WORKER.md "Benchmark im Spiel"). Pure: the service runs it,
 * the panel shows it, the copy button takes formatBenchmark's text.
 */

/** URL flag: the page loads the DevWorld and runs the benchmark once the game stands */
export const BENCHMARK_FLAG = 'benchmark';

/** What the benchmark measures, in this order: every step at every speed */
export interface BenchmarkPlan {
  /** Enemies alive at each step */
  steps: number[];
  speeds: number[];
  /** Seconds of each measurement, after the fill and the settle phase */
  seconds: number;
  towers: number;
}

/**
 * About 2 to 4 minutes: six measurements of 8 s, each after a fill with the
 * call to the simulation and a settle phase of 7 to 30 s (load-scene.ts).
 */
export const DEFAULT_BENCHMARK_PLAN: BenchmarkPlan = {
  steps: [2000, 5000, 10000],
  speeds: [4, 1],
  seconds: 8,
  towers: 40,
};

/** The page and machine a run was measured on */
export interface BenchmarkEnv {
  /** ISO time of the run */
  date: string;
  version: string;
  commit: string;
  /** Built from a working tree with changes */
  dirty: boolean | null;
  browser: string;
  os: string;
  threads: number | null;
  /** navigator.deviceMemory: GB as the browser rounds and caps it; null where there is none (Firefox, Safari) */
  memoryGb: number | null;
  gpu: string;
  devicePixelRatio: number;
  viewport: [number, number];
  /** The simulation's tables in shared memory (cross-origin isolated), else copied per frame */
  sharedMemory: boolean;
  towers: number;
}

/** One measurement */
export interface BenchmarkRow {
  enemiesAsked: number;
  enemies: number;
  speedSet: number;
  fps: number;
  /** The frame time only 5 % of frames were slower than, as frames per second */
  p05: number;
  /** Game ms per wall ms */
  speed: number;
  ticksPerS: number;
  /** Share of the wall time the worker spent in ticks, 0 to 1 */
  workerLoad: number;
  applyPerPacketMs: number;
  /** The settle phase ended by the rule, not by its time limit */
  settled: boolean;
}

/** `href` with the flag and the DevWorld on, the bot off: where the menu's entry sends the page */
export function benchmarkUrl(href: string): string {
  const url = new URL(href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('devworld', '');
  url.searchParams.set('bot', 'manual');
  url.searchParams.set(BENCHMARK_FLAG, '');
  return url.toString();
}

/** The page was loaded to run the benchmark (search string of the location) */
export function isBenchmarkSearch(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.has(BENCHMARK_FLAG) && params.has('devworld');
}

/** Browser and version from the user agent string */
export function browserOf(userAgent: string): string {
  const pick = (re: RegExp, name: string) => {
    const match = re.exec(userAgent);
    return match ? `${name} ${match[1]}` : null;
  };
  return pick(/Firefox\/(\d+(?:\.\d+)?)/, 'Firefox')
    ?? pick(/Edg\/(\d+)/, 'Edge')
    ?? pick(/OPR\/(\d+)/, 'Opera')
    ?? pick(/Chrome\/(\d+)/, 'Chrome')
    ?? pick(/Version\/(\d+(?:\.\d+)?).*Safari/, 'Safari')
    ?? 'unknown browser';
}

/** Operating system from the user agent string */
export function osOf(userAgent: string): string {
  if (/Windows/.test(userAgent)) return 'Windows';
  if (/Android/.test(userAgent)) return 'Android';
  if (/iPhone|iPad/.test(userAgent)) return 'iOS';
  if (/Mac OS X/.test(userAgent)) return 'macOS';
  if (/Linux/.test(userAgent)) return 'Linux';
  return 'unknown OS';
}

/**
 * The GPU name out of what WebGL reports: ANGLE wraps it as
 * "ANGLE (Vendor, Name (0x…) Direct3D11 …, D3D11)"; the rest comes as it is.
 */
export function shortGpu(renderer: string): string {
  const angle = /^ANGLE \([^,]+, (.+?)(?: \(0x[0-9A-Fa-f]+\))?(?: Direct3D.*| OpenGL.*| Vulkan.*| Metal.*)?, [^,]+\)$/.exec(renderer);
  return (angle ? angle[1] : renderer).trim();
}

/** The machine columns every result line carries, so lines of several machines fit one table */
const MACHINE_COLUMNS = ['Version', 'Commit', 'Browser', 'OS', 'Threads', 'Memory', 'GPU', 'DPR', 'Viewport'];
const NUMBER_COLUMNS = ['Enemies', 'Speed', 'FPS', 'p05', 'Reached', 'Ticks/s', 'Worker', 'Apply/packet'];

function machineCells(env: BenchmarkEnv): string[] {
  return [
    env.version,
    env.commit + (env.dirty ? '+' : ''),
    env.browser,
    env.os,
    env.threads === null ? '?' : String(env.threads),
    env.memoryGb === null ? '?' : `${env.memoryGb} GB`,
    env.gpu,
    String(env.devicePixelRatio),
    `${env.viewport[0]}x${env.viewport[1]}`,
  ];
}

/** The numbers of a row as the table shows them */
export function numberCells(row: BenchmarkRow): string[] {
  return [
    String(row.enemies),
    `${row.speedSet}x`,
    row.fps.toFixed(0),
    row.p05.toFixed(0),
    row.speed.toFixed(2) + (row.settled ? '' : '*'),
    row.ticksPerS.toFixed(0),
    `${(row.workerLoad * 100).toFixed(0)} %`,
    `${row.applyPerPacketMs.toFixed(2)} ms`,
  ];
}

function table(head: string[], rows: string[][]): string[] {
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd();
  return [line(head), ...rows.map(line)];
}

/** The results as readable text to send: a head, then one line per measurement with the machine in every line */
export function formatBenchmark(env: BenchmarkEnv, rows: readonly BenchmarkRow[]): string {
  const machine = machineCells(env);
  const lines = [
    `3DTD benchmark ${env.date.slice(0, 16).replace('T', ' ')}`,
    `DevWorld, ${env.towers} towers, enemies with 1,000,000 HP; memory ${env.sharedMemory ? 'shared (SharedArrayBuffer)' : 'copied per frame (not cross-origin isolated)'}`,
    'CPU: the browser cannot read the CPU model, please add it by hand. Memory is what the browser reports (rounded, capped).',
    ...(rows.some((row) => !row.settled) ? ['* frame rate had not settled after 30 s, measured anyway'] : []),
    '',
    ...table([...MACHINE_COLUMNS, ...NUMBER_COLUMNS], rows.map((row) => [...machine, ...numberCells(row)])),
  ];
  return lines.join('\n');
}
