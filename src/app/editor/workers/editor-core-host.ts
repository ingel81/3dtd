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
import type { CoreInput, CoreJobKind, CoreOutput, CoreReply, CoreRequest } from './editor-core-protocol';
import { PathMaskState } from './path-mask-job';

/** What the jobs work with */
interface CoreContext {
  mirror: DocMirror;
  catalog: CatalogIndex;
  /** Where towers may stand, as judged last (the check reads them) */
  buildAreas: BuildAreas | null;
  pathMask: PathMaskState;
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
  transfer?(output: CoreOutput<K>): ArrayBuffer[];
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
  routes: {
    priority: 40,
    run: (ctx) => spawnRoutes(ctx.mirror.doc),
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

interface Waiting {
  id: number;
  kind: CoreJobKind;
  input: CoreInput<CoreJobKind>;
}

export class EditorCoreHost {
  private readonly ctx: CoreContext = { mirror: new DocMirror(), catalog: new CatalogIndex(EMPTY_CATALOG), buildAreas: null, pathMask: new PathMaskState() };
  private readonly waiting = new Map<CoreJobKind, Waiting>();
  private draining = false;

  constructor(
    private readonly post: (reply: CoreReply, transfer?: ArrayBuffer[]) => void,
    /** Runs `fn` once the messages that came meanwhile are in */
    private readonly later: (fn: () => void) => void,
  ) {}

  receive(msg: CoreRequest): void {
    if (msg.type === 'start') {
      this.ctx.catalog = new CatalogIndex(msg.catalog);
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
