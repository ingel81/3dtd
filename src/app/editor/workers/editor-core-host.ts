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
import { packErrorReply, packForSave } from '../../world/custom-map/map-pack';
import { DocMirror } from '../model/doc-mirror';
import type { CoreInput, CoreJobKind, CoreOutput, CoreReply, CoreRequest } from './editor-core-protocol';

interface JobDef<K extends CoreJobKind> {
  /** Runs as its message comes, on the map as asked for (else in a quiet moment, newest wins) */
  now?: boolean;
  /** Higher runs first */
  priority: number;
  run(mirror: DocMirror, input: CoreInput<K>, catalog: CatalogIndex): CoreOutput<K> | Promise<CoreOutput<K>>;
  /** The buffers of the result that go back transferred */
  transfer?(output: CoreOutput<K>): ArrayBuffer[];
}

const JOBS: { [K in CoreJobKind]: JobDef<K> } = {
  pack: {
    now: true,
    priority: 100,
    run: (mirror, input) => packForSave({ doc: mirror.doc, options: input.options, hash: input.hash }),
    transfer: (packed) => [packed.file.buffer as ArrayBuffer],
  },
};

interface Waiting {
  id: number;
  kind: CoreJobKind;
  input: CoreInput<CoreJobKind>;
}

export class EditorCoreHost {
  private readonly mirror = new DocMirror();
  private catalog = new CatalogIndex(EMPTY_CATALOG);
  private readonly waiting = new Map<CoreJobKind, Waiting>();
  private draining = false;

  constructor(
    private readonly post: (reply: CoreReply, transfer?: ArrayBuffer[]) => void,
    /** Runs `fn` once the messages that came meanwhile are in */
    private readonly later: (fn: () => void) => void,
  ) {}

  receive(msg: CoreRequest): void {
    if (msg.type === 'start') {
      this.catalog = new CatalogIndex(msg.catalog);
      return;
    }
    if (msg.type === 'cancel') {
      const w = this.waiting.get(msg.kind);
      if (w) this.post({ id: w.id, dropped: true });
      this.waiting.delete(msg.kind);
      return;
    }
    try {
      this.mirror.apply(msg.sync);
    } catch (e) {
      // A sync that does not fit what the mirror holds: the main thread starts it over with the next job
      this.post({ id: msg.id, error: packErrorReply(e), lost: true });
      return;
    }
    const job = { id: msg.id, kind: msg.kind, input: msg.input };
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
    const state = this.mirror.state;
    const versions = this.mirror.versions!;
    try {
      const value = await def.run(this.mirror, job.input, this.catalog);
      this.post({ id: job.id, value, state, versions }, def.transfer?.(value));
    } catch (e) {
      this.post({ id: job.id, error: packErrorReply(e) });
    }
  }
}
