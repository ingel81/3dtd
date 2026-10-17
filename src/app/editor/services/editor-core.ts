/**
 * The editor's worker on the main thread's side: started with a map, ended
 * when it closes (MapLifecycle). It follows the open map's changes
 * (MirrorTracker) and sends each job with what changed since the last one,
 * so the worker's mirror is the map as it was when the job was asked for;
 * the main thread copies only the tiles and objects that changed, never the
 * whole map.
 *
 * `run` resolves the job's result with the versions of the parts it was
 * worked out on (`current` tells whether they still hold), or null when a
 * newer job of its kind took its place or the map closed. Where there are no
 * workers (tests) the same worker code runs in-process, its messages cloned
 * as a worker's would be.
 */
import type { MapAssetCatalog } from '../../map-ops/asset-catalog';
import { packReplyError } from '../../world/custom-map/map-pack';
import type { DocPart } from '../model/doc-change';
import { MirrorTracker, type PartVersions } from '../model/doc-mirror';
import type { EditorDocument } from '../model/editor-document';
import { EditorCoreHost } from '../workers/editor-core-host';
import type { CoreInput, CoreJobKind, CoreOutput, CoreReply, CoreRequest } from '../workers/editor-core-protocol';

/** A job's result and the state of the map it was worked out on */
export interface CoreResult<K extends CoreJobKind> {
  value: CoreOutput<K>;
  state: number;
  versions: PartVersions;
}

interface Pending {
  resolve(reply: CoreReply): void;
  reject(e: Error): void;
}

/** One worker (or its in-process stand-in) with the replies it owes */
class CorePort {
  readonly pending = new Map<number, Pending>();
  private worker: Worker | null = null;
  private host: EditorCoreHost | null = null;
  private closing = false;

  constructor(
    catalog: MapAssetCatalog,
    /** The worker went down: what it owed fails, the next job starts a new one */
    private readonly failed: (port: CorePort) => void,
  ) {
    if (typeof Worker === 'undefined') {
      const reply = (r: CoreReply) => queueMicrotask(() => this.reply(structuredClone(r)));
      this.host = new EditorCoreHost(reply, queueMicrotask);
    } else {
      this.worker = new Worker(new URL('../workers/editor-core.worker', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<CoreReply>) => this.reply(e.data);
      this.worker.onerror = (e) => {
        e.preventDefault();
        this.fail(new Error(e.message || 'The editor worker failed'));
      };
    }
    this.post({ type: 'start', catalog });
  }

  post(msg: CoreRequest, transfer: ArrayBuffer[] = []): void {
    if (this.worker) this.worker.postMessage(msg, transfer);
    else {
      const copy = structuredClone(msg, { transfer });
      queueMicrotask(() => this.host?.receive(copy));
    }
  }

  /** Ends the worker once it has answered what it owes */
  close(): void {
    this.closing = true;
    if (!this.pending.size) this.end();
  }

  private reply(r: CoreReply): void {
    const p = this.pending.get(r.id);
    this.pending.delete(r.id);
    p?.resolve(r);
    if (this.closing && !this.pending.size) this.end();
  }

  private fail(e: Error): void {
    for (const p of this.pending.values()) p.reject(e);
    this.pending.clear();
    this.end();
    this.failed(this);
  }

  private end(): void {
    this.worker?.terminate();
    this.worker = null;
    this.host = null;
  }
}

export class EditorCore {
  private port: CorePort | null = null;
  private tracker: MirrorTracker | null = null;
  private editor: EditorDocument | null = null;
  private catalog: MapAssetCatalog | null = null;
  private nextId = 1;
  /** No map is open: a job asked for after the close (a save on leaving) gets a worker of its own */
  private closed = true;

  /** The worker for `editor`'s map (again after a close); the catalogue the checks read */
  open(editor: EditorDocument, catalog: MapAssetCatalog): void {
    if (this.editor !== editor) {
      this.tracker?.dispose();
      this.tracker = new MirrorTracker(editor);
      this.editor = editor;
    }
    if (this.port && this.catalog !== catalog) this.close();
    this.catalog = catalog;
    this.closed = false;
  }

  /** The map closed: the worker ends once it has answered what it owes */
  close(): void {
    this.closed = true;
    this.port?.close();
    this.port = null;
    this.tracker?.reset();
  }

  /** Whether `parts` of the open map are still as `versions` says (a result worked out on them is current) */
  current(versions: Readonly<PartVersions>, parts: readonly DocPart[]): boolean {
    return !!this.tracker?.current(versions, parts);
  }

  /**
   * Runs a job on the map as it is now. Resolves its result, or null when a
   * newer job of its kind took its place; rejects with the job's error (an
   * invalid map comes back as a MapFileError)
   */
  run<K extends CoreJobKind>(kind: K, input: CoreInput<K>): Promise<CoreResult<K> | null> {
    const tracker = this.tracker;
    if (!tracker || !this.catalog) return Promise.reject(new Error('No map is open in the editor'));
    if (!this.port) {
      tracker.reset();
      this.port = new CorePort(this.catalog, (port) => {
        if (this.port === port) this.port = null;
      });
    }
    const port = this.port;
    const id = this.nextId++;
    const { sync, transfer } = tracker.sync();
    const done = new Promise<CoreResult<K> | null>((resolve, reject) => {
      port.pending.set(id, {
        resolve: (r) => {
          if ('dropped' in r) resolve(null);
          else if ('error' in r) {
            if (r.lost) tracker.reset();
            reject(packReplyError(r.error));
          } else resolve({ value: r.value as CoreOutput<K>, state: r.state, versions: r.versions });
        },
        reject,
      });
    });
    try {
      port.post({ type: 'job', id, kind, input, sync }, transfer);
    } catch (e) {
      // Not sent: the mirror did not get this sync, the next job brings the whole map
      port.pending.get(id)?.reject(e as Error);
      port.pending.delete(id);
      tracker.reset();
    }
    if (this.closed) this.close();
    return done;
  }

  /** Jobs of `kind` asked for and not begun are dropped (they resolve null) */
  cancel(kind: CoreJobKind): void {
    this.port?.post({ type: 'cancel', kind });
  }

  dispose(): void {
    this.close();
    this.tracker?.dispose();
  }
}
