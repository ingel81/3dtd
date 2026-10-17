/**
 * Jobs that change the map over a while: generating terrain and eroding the
 * whole map in the terrain worker, an AI agent's play. One at a time, shown
 * with its progress and Cancel; meanwhile the document is held and the
 * view's tools take no input, so no panel, key or agent call writes under
 * it. Each job writes into a transaction: done, it is one undo step;
 * stopped or failed, the transaction goes back (abort).
 */
import { signal, type NgZone } from '@angular/core';
import { fitSplatMaps } from '../../world/custom-map/map-document';
import type { CatalogIndex } from '../../map-ops/asset-catalog';
import type { GridRect } from '../../map-ops/grid';
import type { GenerateOptions, GenerateResult } from '../../map-ops/generate';
import type { EditorDocument } from '../model/editor-document';
import { ALL_DOC_PARTS } from '../model/commands/snapshot';
import { LandscapeContext } from '../ops/landscape/landscape-context';
import { erodeJob, startTerrainJob, type TerrainJob, type TerrainJobMessage } from '../workers/terrain-job';
import { AGENT_LABEL } from '../agent/editor-agent';
import type { EditorNotices } from './editor-notices';

/** Milliseconds between two looks at the map while it erodes (each redraws all the ground) */
const EROSION_SHOW_MS = 1000;

export interface JobHost {
  readonly editor: EditorDocument | null;
  catalog(): CatalogIndex;
  /** Why the map cannot change now (a stroke, another tab, a job), or null */
  busyReason(): string | null;
  /** The same with a line in the status bar */
  blocked(what: string): boolean;
  /** The view's tools take input or not */
  lockView(on: boolean): void;
  /** Another tab edits the map: the view stays locked after a job */
  readOnly(): boolean;
  /** The panels read the map again */
  refresh(): void;
}

export class JobRunner {
  /** The job running and how far it is */
  readonly job = signal<{ label: string; progress: number } | null>(null);
  private abort: AbortController | null = null;
  /** Settles when the running job ended, however it ended */
  private run: Promise<void> = Promise.resolve();

  constructor(
    private readonly host: JobHost,
    private readonly zone: NgZone,
    private readonly notices: EditorNotices,
  ) {}

  /** Stops the running job; its map goes back to how it was */
  cancel(): void {
    this.abort?.abort();
  }

  /** Stops the running job of the AI agent's, if one runs */
  cancelAgentJob(): void {
    if (this.job()?.label.startsWith(AGENT_LABEL)) this.cancel();
  }

  /** Resolves once the running job (if any) ended */
  settled(): Promise<void> {
    return this.run;
  }

  /**
   * Generates terrain over the whole map as one undo step. The terrain
   * worker builds it in bands that show as they come; Cancel puts the land
   * back. Resolves true when it finished.
   */
  async generate(options: GenerateOptions, repaint: boolean): Promise<boolean> {
    const editor = this.host.editor;
    if (!editor || this.host.blocked('Generating the terrain')) return false;
    const t = editor.doc.terrain;
    const catalog = this.host.catalog();
    const stroke = new LandscapeContext(editor.begin('Generate terrain'), options.seed, catalog);
    const all = { i0: 0, j0: 0, i1: t.grid.columns - 1, j1: t.grid.rows - 1 };
    const texels = { i0: 0, j0: 0, i1: t.splat.resolution - 1, j1: t.splat.resolution - 1 };
    stroke.tx.touch('heights', all);
    stroke.tx.touchSplat(texels);
    const g = t.grid;
    let result: GenerateResult | null = null;
    let finished: Extract<TerrainJobMessage, { kind: 'finished' }> | null = null;
    // The worker finishes the map too (roads levelled, layers, auto paint): over a big map that stood the page
    const { grid: _grid, ...ground } = t;
    const finish = { terrain: ground, paths: editor.doc.paths, materials: [...catalog.materials.keys()], repaint };
    const ok = await this.terrainJob(
      'Generating the terrain',
      stroke,
      { kind: 'generate', width: t.width, depth: t.depth, columns: g.columns, rows: g.rows, cellSize: g.cellSize, heights: g.heights, options, finish },
      (m) => {
        if (m.kind === 'rows') {
          g.heights.set(m.heights, m.j0 * g.columns);
          editor.emit({ heights: { i0: 0, i1: g.columns - 1, j0: m.j0, j1: m.j1 - 1 } });
        } else if (m.kind === 'finished') finished = m;
        else if (m.kind === 'done') result = m.result;
      },
    );
    if (!ok) return false;
    if (!result || !finished) {
      stroke.tx.abort();
      return false;
    }
    this.finishGenerate(stroke, result, finished, all, texels);
    return true;
  }

  /**
   * Erodes the whole map in the terrain worker: rain drops carve gullies and
   * fans everywhere, `strength` 0..1 sets how many and how hard. Shows the
   * land between slices; Cancel puts it back; one undo step.
   */
  async erodeWholeMap(strength: number, seed = Math.floor(Math.random() * 1e9), label = 'Erode the map'): Promise<boolean> {
    const editor = this.host.editor;
    if (!editor || this.host.blocked('Eroding the map')) return false;
    const g = editor.doc.terrain.grid;
    const stroke = new LandscapeContext(editor.begin(label), seed, this.host.catalog());
    const all = { i0: 0, j0: 0, i1: g.columns - 1, j1: g.rows - 1 };
    stroke.tx.touch('heights', all);
    let latest: Float32Array | null = null;
    let shownAt = performance.now();
    const ok = await this.terrainJob(label.startsWith(AGENT_LABEL) ? label : 'Eroding the map', stroke, erodeJob(g, strength, seed), (m) => {
      // The whole ground redraws for each look: about one a second, and the last one always
      if (m.kind === 'heights') {
        latest = m.heights;
        if (performance.now() - shownAt < EROSION_SHOW_MS) return;
      } else if (!latest) return;
      g.heights.set(latest);
      latest = null;
      shownAt = performance.now();
      this.redrawInBands(editor, g.columns, g.rows);
    });
    if (!ok) return false;
    stroke.finish();
    this.host.refresh();
    return true;
  }

  /**
   * An AI agent's edit that plays over a while (docs/AGENT_MCP.md), like a
   * terrain job: the view locked, the job shown with Cancel, the map put back
   * on Cancel or an error. Done, it is one undo step named `label`.
   */
  async agentEdit<T>(label: string, play: (editor: EditorDocument, signal: AbortSignal, progress: (share: number) => void) => Promise<T>): Promise<T> {
    const editor = this.host.editor;
    if (!editor) throw new Error('No map is open in the editor');
    const busy = this.host.busyReason();
    if (busy) throw new Error(`The map cannot change now: ${busy}`);
    const tx = editor.begin(label);
    tx.snapshot(...ALL_DOC_PARTS);
    let out: T;
    try {
      out = await this.withJob(editor, label, (signal) => play(editor, signal, (progress) => this.job.set({ label, progress })));
    } catch (e) {
      tx.abort();
      const stopped = (e as Error).name === 'AbortError';
      this.notices.flash(stopped ? `${label} stopped; the map is as it was` : `${label} failed; the map is as it was`);
      this.host.refresh();
      throw stopped ? new Error('The player stopped it; the map is as it was') : e;
    }
    tx.commit();
    this.notices.flash(`${label} done; Ctrl+Z takes it back`);
    this.host.refresh();
    return out;
  }

  /**
   * The frame of every job: one at a time, shown with Cancel, the view locked
   * and the document held, so no panel, key or agent call writes under it.
   * The job keeps its own step after it, once the hold is gone. A stopped
   * job rejects with an AbortError.
   */
  private withJob<T>(editor: EditorDocument, label: string, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const abort = new AbortController();
    const release = editor.hold('a job runs (Cancel stops it)');
    this.abort = abort;
    this.job.set({ label, progress: 0 });
    this.host.lockView(true);
    const job = (async () => {
      try {
        const out = await run(abort.signal);
        if (abort.signal.aborted) throw new DOMException('The job was stopped', 'AbortError');
        return out;
      } finally {
        release();
        this.abort = null;
        this.job.set(null);
        if (!this.host.readOnly()) this.host.lockView(false);
      }
    })();
    this.run = job.then(
      () => undefined,
      () => undefined,
    );
    return job;
  }

  /** Runs a terrain job in the worker (withJob) into `stroke`; on Cancel or an error the stroke goes back */
  private async terrainJob(label: string, stroke: LandscapeContext, job: TerrainJob, onMessage: (m: TerrainJobMessage) => void): Promise<boolean> {
    try {
      await this.withJob(stroke.tx.editor, label, (signal) =>
        startTerrainJob(
          job,
          (m) =>
            this.zone.run(() => {
              if (m.kind !== 'done') this.job.set({ label, progress: m.progress });
              onMessage(m);
            }),
          signal,
        ),
      );
      return true;
    } catch (e) {
      stroke.tx.abort();
      if ((e as Error).name === 'AbortError') this.notices.flash(`${label.replace(/^\w/, (c) => c.toUpperCase())} stopped; the land is as it was`);
      else this.notices.error.set(`${label} failed (${(e as Error).message}); the land is as it was.`);
      return false;
    }
  }

  /** Lands the map the terrain worker finished: its water, heights, layers and paint, as one undo step */
  private finishGenerate(
    stroke: LandscapeContext,
    result: GenerateResult,
    finished: Extract<TerrainJobMessage, { kind: 'finished' }>,
    all: GridRect,
    texels: GridRect,
  ): void {
    const t = stroke.doc.terrain;
    if (result.water !== null) {
      stroke.ensureWater(result.water);
      stroke.touchWater(all);
      t.water!.mask.fill(255);
    }
    t.grid.heights.set(finished.heights);
    t.layers = finished.layers;
    fitSplatMaps(t);
    finished.splat.forEach((map, k) => t.splat.maps[k].set(map));
    stroke.changed({ heights: all, splat: texels, water: true, layers: true });
    stroke.finish();
    this.host.refresh();
  }

  /**
   * Tells the view about new heights all over the map a band of rows per
   * frame: one whole-map update stalls a big map's frame for a quarter of
   * a second, bands spread it out
   */
  private redrawInBands(editor: EditorDocument, columns: number, rows: number, band = 64): void {
    let j0 = 0;
    const next = () => {
      if (this.host.editor !== editor || j0 >= rows) return;
      const j1 = Math.min(rows - 1, j0 + band - 1);
      editor.emit({ heights: { i0: 0, i1: columns - 1, j0, j1 } });
      j0 = j1 + 1;
      requestAnimationFrame(next);
    };
    next();
  }
}
