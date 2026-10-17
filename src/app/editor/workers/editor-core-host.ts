/**
 * The editor's worker itself, without the worker around it (the same code
 * runs in-process where there are no workers, as in the tests): keeps the
 * mirror of the open map and works off the jobs.
 *
 * A job that must see the map exactly as it was asked for (packing for a
 * save) runs at once, as its message comes; it reads the mirror before its
 * first await, so a sync that comes meanwhile does not reach it. Any other
 * job waits for a quiet moment: of each kind the newest wins (one asked for
 * again before it ran is dropped), the most urgent kind runs first, and a
 * job works on the newest state the mirror knows by then.
 */
import { CatalogIndex, EMPTY_CATALOG } from '../../map-ops/asset-catalog';
import { spawnRoutes } from '../../map-ops/path-graph';
import { buildAreaInput, computeBuildAreas, type BuildAreas } from '../../map-ops/validation/build-areas';
import { assetCosts } from '../../map-ops/validation/map-budget';
import { validateMap } from '../../map-ops/validation/map-validation';
import type { CustomMapDocument } from '../../world/custom-map/map-document';
import { packErrorReply, packForSave } from '../../world/custom-map/map-pack';
import { DocMirror } from '../model/doc-mirror';
import type { CoreInput, CoreJobKind, CoreOutput, CoreReply, CoreRequest, TerrainStream } from './editor-core-protocol';
import { erodeJob, runTerrainJob, transferList, type TerrainJob, type TerrainJobMessage } from './terrain-job';
import { MinimapMarks } from './minimap-job';
import { PathMaskState } from './path-mask-job';
import { HeightField } from '../../world/custom-map/render/height-field';
import { farShadowData, lavaCloseness, lavaSamples, shapePatch } from '../../world/custom-map/render/terrain/ground-shape';
import { contourLines } from '../ops/contours';

/** What the jobs work with */
interface CoreContext {
  mirror: DocMirror;
  catalog: CatalogIndex;
  /** Where towers may stand, as judged last (the check reads them) */
  buildAreas: BuildAreas | null;
  pathMask: PathMaskState;
  /** The ground shape's arrays over the grid, kept between jobs */
  shape: { terrain?: Float32Array; curvature?: Uint8Array };
  minimap: MinimapMarks;
}

/** The mirror's heights as a field */
function fieldOf(doc: CustomMapDocument): HeightField {
  return new HeightField(doc.terrain.grid, doc.terrain.width, doc.terrain.depth);
}

interface JobDef<K extends CoreJobKind> {
  /** Runs as its message comes, on the map as asked for (else in a quiet moment, newest wins) */
  now?: boolean;
  /** Higher runs first */
  priority: number;
  /** What the job brings that must reach the worker even when a newer job takes its place, as it comes */
  take?(ctx: CoreContext, input: CoreInput<K>): void;
  run(ctx: CoreContext, input: CoreInput<K>): CoreOutput<K> | Promise<CoreOutput<K>>;
  /** The buffers of the result that go back transferred */
  transfer?(output: CoreOutput<K>): Transferable[];
}

/** The editor's check of `doc` (map-validation.ts) with the catalogue's answers and the build areas judged */
function checkMap(doc: CustomMapDocument, catalog: CatalogIndex, buildAreas: BuildAreas | null) {
  return validateMap(doc, {
    blocksBuild: (asset) => catalog.object(asset).blocksBuild,
    roadThrough: (asset) => !!catalog.object(asset).roadThrough,
    footingOf: (asset) => catalog.object(asset).footing,
    buildAreas,
    costOf: assetCosts(catalog, doc),
  });
}

const JOBS: { [K in CoreJobKind]: JobDef<K> } = {
  pack: {
    now: true,
    priority: 100,
    run: (ctx, input) => packForSave({ doc: ctx.mirror.doc, options: input.options, hash: input.hash }),
    transfer: (packed) => [packed.file.buffer as ArrayBuffer],
  },
  check: {
    priority: 50,
    run: (ctx, input) => checkMap(input.doc ?? ctx.mirror.doc, ctx.catalog, input.areas ? ctx.buildAreas : null),
  },
  pathMask: {
    // The ground under a dragged road follows the drag: before the panels' jobs
    priority: 60,
    take: (ctx, input) => ctx.pathMask.take(input),
    run: (ctx, input) => ctx.pathMask.run(ctx.mirror.doc, input),
    transfer: (rect) => (rect ? [rect.data.buffer as ArrayBuffer] : []),
  },
  groundShape: {
    priority: 45,
    run: (ctx, input) => {
      const field = fieldOf(ctx.mirror.doc);
      const n = field.columns * field.rows;
      if (ctx.shape.terrain?.length !== n) ctx.shape = { terrain: new Float32Array(n), curvature: new Uint8Array(n) };
      return shapePatch(field, input.rect, ctx.shape.terrain, ctx.shape.curvature);
    },
    transfer: (p) => [p.terrain.buffer, p.curvature.buffer, ...(p.drainage ? [p.drainage.buffer] : [])] as ArrayBuffer[],
  },
  lava: {
    priority: 45,
    run: (ctx) => {
      const field = fieldOf(ctx.mirror.doc);
      const lava = lavaSamples(ctx.mirror.doc.terrain, field);
      return { closeness: lavaCloseness(lava, field), any: lava.includes(1) };
    },
    transfer: (l) => [l.closeness.buffer as ArrayBuffer],
  },
  farShadow: {
    priority: 20,
    run: (ctx, input) => {
      const t = ctx.mirror.doc.terrain;
      return farShadowData(fieldOf(ctx.mirror.doc), input.sunDir, t.width, t.depth);
    },
    transfer: (f) => [f.data.buffer as ArrayBuffer],
  },
  contours: {
    priority: 35,
    run: (ctx, input) => contourLines(ctx.mirror.doc.terrain, input.step),
    transfer: (c) => [c.minor.buffer, c.major.buffer] as ArrayBuffer[],
  },
  routes: {
    priority: 40,
    run: (ctx) => spawnRoutes(ctx.mirror.doc),
  },
  minimap: {
    priority: 25,
    run: (ctx) => ctx.minimap.run(ctx.mirror.doc),
    transfer: (bitmap) => (bitmap ? [bitmap] : []),
  },
  buildAreas: {
    priority: 30,
    run: (ctx) => {
      const doc = ctx.mirror.doc;
      const routes = spawnRoutes(doc);
      const lanes = doc.spawns.map((s) => ({ spawnId: s.id, name: s.name, points: routes.get(s.id)?.points ?? null }));
      ctx.buildAreas = computeBuildAreas(buildAreaInput(doc, (asset) => ctx.catalog.object(asset), lanes));
      return ctx.buildAreas;
    },
  },
};

/** The terrain job a stream asks for, on the mirror's map (copies: the job writes its own arrays) */
function terrainJob(doc: CustomMapDocument, input: TerrainStream): TerrainJob {
  const t = doc.terrain;
  const g = t.grid;
  if (input.kind === 'erode') {
    const c = input.copy;
    return erodeJob(c ? { ...c, heights: c.heights } : { ...g, heights: g.heights.slice() }, input.strength, input.seed);
  }
  const { grid: _grid, ...ground } = t;
  const finish = input.finish && { terrain: structuredClone(ground), paths: structuredClone(doc.paths), ...input.finish };
  return { kind: 'generate', width: t.width, depth: t.depth, columns: g.columns, rows: g.rows, cellSize: g.cellSize, heights: g.heights.slice(), options: input.options, finish };
}

interface Waiting {
  id: number;
  kind: CoreJobKind;
  input: CoreInput<CoreJobKind>;
}

export class EditorCoreHost {
  private readonly ctx: CoreContext = { mirror: new DocMirror(), catalog: new CatalogIndex(EMPTY_CATALOG), buildAreas: null, pathMask: new PathMaskState(), shape: {}, minimap: new MinimapMarks() };
  private readonly waiting = new Map<CoreJobKind, Waiting>();
  private draining = false;
  /** Terrain jobs under way, by id: true once told to stop */
  private readonly streams = new Map<number, boolean>();

  constructor(
    private readonly post: (reply: CoreReply, transfer?: Transferable[]) => void,
    /** Runs `fn` once the messages that came meanwhile are in */
    private readonly later: (fn: () => void) => void,
  ) {}

  receive(msg: CoreRequest): void {
    if (msg.type === 'start') {
      this.ctx.catalog = new CatalogIndex(msg.catalog);
      return;
    }
    if (msg.type === 'stop') {
      if (this.streams.has(msg.id)) this.streams.set(msg.id, true);
      return;
    }
    if (msg.type === 'stream') {
      this.stream(msg);
      return;
    }
    if (msg.type === 'cancel') {
      const w = this.waiting.get(msg.kind);
      if (w) this.post({ id: w.id, dropped: true });
      this.waiting.delete(msg.kind);
      return;
    }
    try {
      this.ctx.mirror.apply(msg.sync);
    } catch (e) {
      // A sync that does not fit what the mirror holds: the main thread starts it over with the next job
      this.post({ id: msg.id, error: packErrorReply(e), lost: true });
      return;
    }
    const job = { id: msg.id, kind: msg.kind, input: msg.input };
    (JOBS[msg.kind] as JobDef<CoreJobKind>).take?.(this.ctx, msg.input);
    if (JOBS[msg.kind].now) {
      void this.run(job);
      return;
    }
    const before = this.waiting.get(msg.kind);
    if (before) this.post({ id: before.id, dropped: true });
    this.waiting.set(msg.kind, job);
    if (!this.draining) {
      this.draining = true;
      this.later(() => this.drain());
    }
  }

  /**
   * A terrain job slice by slice, a quiet moment between two: the messages that come meanwhile (a stop, a sync,
   * another job) are in before the next slice
   */
  private stream(msg: Extract<CoreRequest, { type: 'stream' }>): void {
    const id = msg.id;
    let slices: Generator<TerrainJobMessage>;
    try {
      this.ctx.mirror.apply(msg.sync);
      slices = runTerrainJob(terrainJob(this.ctx.mirror.doc, msg.input));
    } catch (e) {
      this.post({ id, error: packErrorReply(e), lost: true });
      return;
    }
    this.streams.set(id, false);
    const step = (): void => {
      if (this.streams.get(id)) {
        this.streams.delete(id);
        this.post({ id, dropped: true });
        return;
      }
      try {
        const next = slices.next();
        if (next.done) {
          this.streams.delete(id);
          return;
        }
        this.post({ id, part: next.value }, transferList(next.value));
        if (next.value.kind === 'done') this.streams.delete(id);
        else this.later(step);
      } catch (e) {
        this.streams.delete(id);
        this.post({ id, error: packErrorReply(e) });
      }
    };
    this.later(step);
  }

  /** The most urgent job waiting, then the next in another quiet moment */
  private drain(): void {
    let next: Waiting | null = null;
    for (const w of this.waiting.values()) if (!next || JOBS[w.kind].priority > JOBS[next.kind].priority) next = w;
    if (!next) {
      this.draining = false;
      return;
    }
    this.waiting.delete(next.kind);
    void this.run(next).finally(() => this.later(() => this.drain()));
  }

  private async run(job: Waiting): Promise<void> {
    const def = JOBS[job.kind] as JobDef<CoreJobKind>;
    const state = this.ctx.mirror.state;
    const versions = this.ctx.mirror.versions!;
    try {
      const value = await def.run(this.ctx, job.input);
      this.post({ id: job.id, value, state, versions }, def.transfer?.(value));
    } catch (e) {
      this.post({ id: job.id, error: packErrorReply(e) });
    }
  }
}
