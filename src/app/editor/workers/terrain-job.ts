/**
 * Heavy terrain work off the page: generating a preset over a big map and
 * eroding the whole map. A job runs in slices; each slice hands back what
 * changed (a band of rows, or all heights), so the editor shows the land
 * as it forms and can stop the job at any time. The same job runs in the
 * terrain worker (`terrain.worker.ts`) or, without workers, in slices on
 * the page.
 */
import { generateRows, presetResult, type GenerateOptions, type GenerateResult } from '../ops/generate';
import { erodeMap } from '../ops/landscape/erosion';

export type TerrainJob =
  | {
      kind: 'generate';
      width: number;
      depth: number;
      columns: number;
      rows: number;
      cellSize: number;
      /** The current heights (the preset adds to them with `options.add`) */
      heights: Float32Array;
      options: GenerateOptions;
    }
  | {
      kind: 'erode';
      columns: number;
      rows: number;
      cellSize: number;
      heights: Float32Array;
      seed: number;
      /** 0..1, how hard each drop erodes */
      strength: number;
      drops: number;
    };

export type TerrainJobMessage =
  /** Rows `j0` to `j1` (exclusive) are final; `heights` holds just them */
  | { kind: 'rows'; j0: number; j1: number; heights: Float32Array; progress: number }
  /** All heights as they stand now */
  | { kind: 'heights'; heights: Float32Array; progress: number }
  | { kind: 'done'; result: GenerateResult | null };

/** Rows a generate slice covers */
const ROWS_PER_SLICE = 48;
/** Drops an erosion slice runs */
const DROPS_PER_SLICE = 4000;

/** The job's slices in order; each message owns its array (it may be transferred) */
export function* runTerrainJob(job: TerrainJob): Generator<TerrainJobMessage> {
  if (job.kind === 'generate') {
    const t = { width: job.width, depth: job.depth, grid: { columns: job.columns, rows: job.rows, cellSize: job.cellSize, heights: job.heights } };
    for (let j0 = 0; j0 < job.rows; j0 += ROWS_PER_SLICE) {
      const j1 = Math.min(job.rows, j0 + ROWS_PER_SLICE);
      generateRows(t, job.options, j0, j1);
      yield { kind: 'rows', j0, j1, heights: job.heights.slice(j0 * job.columns, j1 * job.columns), progress: j1 / job.rows };
    }
    yield { kind: 'done', result: presetResult(job.options) };
    return;
  }
  for (let from = 0; from < job.drops; from += DROPS_PER_SLICE) {
    const to = Math.min(job.drops, from + DROPS_PER_SLICE);
    erodeMap(job.heights, job.columns, job.rows, job.cellSize, job.seed, job.strength, from, to, to === job.drops);
    yield { kind: 'heights', heights: job.heights.slice(), progress: to / job.drops };
  }
  yield { kind: 'done', result: null };
}

/**
 * Runs a job in the terrain worker (or on the page when there are no
 * workers), calling `onMessage` for each slice. Resolves when it is done;
 * rejects with an AbortError when `signal` stops it.
 */
export function startTerrainJob(job: TerrainJob, onMessage: (m: TerrainJobMessage) => void, signal?: AbortSignal): Promise<void> {
  if (typeof Worker === 'undefined') return runInline(job, onMessage, signal);
  return new Promise<void>((resolve, reject) => {
    const worker = new Worker(new URL('./terrain.worker', import.meta.url), { type: 'module' });
    const stop = () => {
      worker.terminate();
      reject(new DOMException('The terrain job was stopped', 'AbortError'));
    };
    if (signal?.aborted) return stop();
    signal?.addEventListener('abort', stop, { once: true });
    worker.onmessage = (e: MessageEvent<TerrainJobMessage | { kind: 'error'; message: string }>) => {
      const m = e.data;
      if (m.kind === 'error') {
        worker.terminate();
        reject(new Error(m.message));
        return;
      }
      onMessage(m);
      if (m.kind === 'done') {
        signal?.removeEventListener('abort', stop);
        worker.terminate();
        resolve();
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'The terrain worker failed'));
    };
    // The worker gets its own copy; the page keeps showing its heights meanwhile
    const copy = { ...job, heights: job.heights.slice() };
    worker.postMessage(copy, [copy.heights.buffer]);
  });
}

async function runInline(job: TerrainJob, onMessage: (m: TerrainJobMessage) => void, signal?: AbortSignal): Promise<void> {
  const copy = { ...job, heights: job.heights.slice() };
  for (const m of runTerrainJob(copy)) {
    if (signal?.aborted) throw new DOMException('The terrain job was stopped', 'AbortError');
    onMessage(m);
    await new Promise((r) => setTimeout(r, 0));
  }
}
