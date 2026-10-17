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
import type { CoreInput, CoreJobKind, CoreOutput, CoreReply, CoreRequest, TerrainStream } from '../workers/editor-core-protocol';
import type { TerrainJobMessage } from '../workers/terrain-job';

/** A job's result and the state of the map it was worked out on */
export interface CoreResult<K extends CoreJobKind> {
  value: CoreOutput<K>;
  state: number;
  versions: PartVersions;
}

interface Pending {
  resolve(reply: CoreReply): void;
  reject(e: Error): void;
  /** A slice of a terrain job; true when it was the last */
  part?(m: TerrainJobMessage): boolean;
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

  post(msg: CoreRequest, transfer: Transferable[] = []): void {
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
    // A terrain job owes more slices until its last
    if ('part' in r && p?.part && !p.part(r.part)) return;
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

  /** The versions of the open map's parts now, null before a map opened */
  get versions(): Readonly<PartVersions> | null {
    return this.closed ? null : (this.tracker?.now ?? null);
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
    const port = this.portFor();
    if (!tracker || !port) return Promise.reject(new Error('No map is open in the editor'));
    const id = this.nextId++;
    const { sync, transfer } = tracker.sync();
    const done = new Promise<CoreResult<K> | null>((resolve, reject) => {
      port.pending.set(id, {
        resolve: (r) => {
          if ('dropped' in r) resolve(null);
          else if ('error' in r) {
            if (r.lost) tracker.reset();
            reject(packReplyError(r.error));
          } else if ('value' in r) resolve({ value: r.value as CoreOutput<K>, state: r.state, versions: r.versions });
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

  /**
   * Runs a terrain job in the worker on the map as it is now, `onPart` with each slice (rows, all heights, the
   * finished map, then 'done'). Resolves after 'done'; rejects with an AbortError at once when `signal` stops it
   * (the worker stops after the slice it is in)
   */
  terrain(input: TerrainStream, onPart: (m: TerrainJobMessage) => void, signal?: AbortSignal): Promise<void> {
    const port = this.portFor();
    if (!port) return Promise.reject(new Error('No map is open in the editor'));
    const tracker = this.tracker!;
    const id = this.nextId++;
    return new Promise<void>((resolve, reject) => {
      const stop = (): void => {
        port.pending.delete(id);
        port.post({ type: 'stop', id });
        reject(new DOMException('The terrain job was stopped', 'AbortError'));
      };
      if (signal?.aborted) return reject(new DOMException('The terrain job was stopped', 'AbortError'));
      signal?.addEventListener('abort', stop, { once: true });
      port.pending.set(id, {
        part: (m) => {
          onPart(m);
          return m.kind === 'done';
        },
        resolve: (r) => {
          signal?.removeEventListener('abort', stop);
          if ('error' in r) {
            if (r.lost) tracker.reset();
            reject(packReplyError(r.error));
          } else if ('dropped' in r) reject(new DOMException('The terrain job was stopped', 'AbortError'));
          else resolve();
        },
        reject: (e) => {
          signal?.removeEventListener('abort', stop);
          reject(e);
        },
      });
      const { sync, transfer } = tracker.sync();
      const copy = input.kind === 'erode' ? input.copy : undefined;
      try {
        port.post({ type: 'stream', id, input, sync }, copy ? [...transfer, copy.heights.buffer as ArrayBuffer] : transfer);
      } catch (e) {
        port.pending.delete(id);
        tracker.reset();
        reject(e as Error);
      }
      if (this.closed) this.close();
    });
  }

  /** The worker to send to (a new one starts over with the whole map), null before a map opened */
  private portFor(): CorePort | null {
    if (!this.tracker || !this.catalog) return null;
    if (!this.port) {
      this.tracker.reset();
      this.port = new CorePort(this.catalog, (port) => {
        if (this.port === port) this.port = null;
      });
    }
    return this.port;
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
