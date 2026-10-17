/**
 * The open map's state for the panels, one revision per part of the map
 * (terrain, water, objects, roads …) and the history's signals. Every
 * change of the document says which parts it touched (DocChange); the
 * state gathers them and bumps the revisions of just those parts once per
 * frame, so a panel that reads the objects does not work again after a
 * terrain stroke. A step (a command, an undo) shows in the next frame; the
 * dabs of a running stroke at most every LIVE_MS, as the panels do not need
 * them sooner. No timer runs while nothing changes.
 */
import { computed, signal, type Signal } from '@angular/core';
import type { MapMeta } from '../../world/custom-map/map-document';
import type { DocChange } from '../model/doc-change';
import type { EditorDocument, Selection } from '../model/editor-document';

/** The parts of the map a panel can follow */
export type DocPart = 'terrain' | 'water' | 'objects' | 'paths' | 'markers' | 'environment' | 'life' | 'meta' | 'gameplay' | 'intro' | 'prefabs';

export const DOC_PARTS: readonly DocPart[] = ['terrain', 'water', 'objects', 'paths', 'markers', 'environment', 'life', 'meta', 'gameplay', 'intro', 'prefabs'];

/** Milliseconds at least between two showings of a running stroke's dabs */
export const LIVE_MS = 150;

/** The parts a change touched */
export function changedParts(c: DocChange): DocPart[] {
  const out: DocPart[] = [];
  if (c.terrain || c.heights || c.splat || c.layers) out.push('terrain');
  if (c.terrain || c.water || c.bodies) out.push('water');
  if (c.objects) out.push('objects');
  if (c.paths) out.push('paths');
  if (c.markers) out.push('markers');
  if (c.environment) out.push('environment');
  if (c.life) out.push('life');
  if (c.meta) out.push('meta');
  if (c.gameplay) out.push('gameplay');
  if (c.intro) out.push('intro');
  if (c.prefabs) out.push('prefabs');
  return out;
}

export class EditorState {
  private readonly revs = new Map<DocPart, ReturnType<typeof signal<number>>>(DOC_PARTS.map((p) => [p, signal(0)]));
  /** Bumps with any change of the map */
  readonly anyRev = signal(0);
  readonly meta = signal<MapMeta | null>(null);
  readonly canUndo = signal(false);
  readonly canRedo = signal(false);
  readonly undoLabel = signal<string | null>(null);
  readonly redoLabel = signal<string | null>(null);
  /** The history for its list: steps done and undone */
  readonly steps = signal<{ done: string[]; undone: string[] }>({ done: [], undone: [] });
  readonly selection = signal<Selection>(null);
  private editor: EditorDocument | null = null;
  private unsubscribe: (() => void)[] = [];
  private readonly listeners = new Set<(change: DocChange) => void>();
  /** Parts changed since the last showing */
  private readonly pending = new Set<DocPart>();
  /** The document state shown last; a new one shows in the next frame */
  private shownState = -1;
  private shownAt = 0;
  private frame: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    /** After every showing: saving and the check follow the map */
    private readonly shown: () => void = () => undefined,
  ) {}

  /** The revision of one part, or of several (it rises with any of them) */
  rev(...parts: DocPart[]): Signal<number> {
    if (parts.length === 1) return this.revs.get(parts[0])!;
    const list = parts.length ? parts : DOC_PARTS;
    return computed(() => list.reduce((n, p) => n + this.revs.get(p)!(), 0));
  }

  /** Follows `editor` (null: no map open) */
  attach(editor: EditorDocument | null): void {
    for (const u of this.unsubscribe) u();
    this.unsubscribe = [];
    this.editor = editor;
    this.cancel();
    if (editor) {
      this.unsubscribe.push(
        editor.onChange((change) => this.changed(change)),
        editor.onSelection((s) => this.selection.set(s)),
      );
      this.selection.set(editor.selection);
    } else this.selection.set(null);
    for (const p of DOC_PARTS) this.pending.add(p);
    this.refresh();
  }

  /** Calls `fn` with each change of the open map, as it happens (the tour); returns the unsubscribe */
  onDocChange(fn: (change: DocChange) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Shows what changed now, without waiting for the frame */
  refresh(): void {
    this.cancel();
    const e = this.editor;
    for (const p of this.pending) this.revs.get(p)!.update((n) => n + 1);
    this.pending.clear();
    this.anyRev.update((n) => n + 1);
    const meta = e?.doc.meta ?? null;
    if (meta !== this.meta() || (meta && JSON.stringify(meta) !== JSON.stringify(this.meta()))) this.meta.set(meta ? { ...meta } : null);
    this.canUndo.set(!!e?.canUndo);
    this.canRedo.set(!!e?.canRedo);
    this.undoLabel.set(e?.undoLabel ?? null);
    this.redoLabel.set(e?.redoLabel ?? null);
    if (!e || e.stateId !== this.shownState) this.steps.set(e ? e.history : { done: [], undone: [] });
    this.shownState = e?.stateId ?? -1;
    this.shownAt = performance.now();
    this.shown();
  }

  dispose(): void {
    this.attach(null);
    this.listeners.clear();
  }

  private changed(change: DocChange): void {
    for (const p of changedParts(change)) this.pending.add(p);
    for (const fn of this.listeners) fn(change);
    // A step shows in the next frame, the dabs of a running stroke at most every LIVE_MS
    const step = this.editor !== null && this.editor.stateId !== this.shownState;
    if (step) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.frame ??= nextFrame(() => {
        this.frame = null;
        this.refresh();
      });
    } else if (!this.frame && !this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.refresh();
      }, Math.max(0, this.shownAt + LIVE_MS - performance.now()));
    }
  }

  private cancel(): void {
    if (this.frame !== null) cancelFrame(this.frame);
    this.frame = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

const nextFrame = (fn: () => void): number => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : (setTimeout(fn, 16) as unknown as number));
const cancelFrame = (id: number): void => (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : clearTimeout(id));
