/**
 * The map being edited, with undo and redo. Every edit is a command that can
 * apply and revert itself and says what it changed (`DocChange`), so the view
 * updates only the touched chunks. Brush strokes write live while the mouse
 * moves (`emit` for each dab) and land as one command at the end (`push`).
 *
 * The document knows whether it differs from the last save (`dirty`): every
 * state gets an id, undo and redo move between them, and a save remembers
 * the id it saved.
 *
 * While something else owns the map (a terrain job, an agent's play, another
 * tab) the document is held (`hold`): every new step, undo and redo is
 * refused, a step whose effect is already written is taken back, and the
 * refusal listeners hear why. No caller has to remember the check.
 */
import type { CustomMapDocument } from '../../world/custom-map/map-document';
import { rectUnion, type GridRect } from '../../map-ops/grid';

/** What an edit touched; the view refreshes just that */
export interface DocChange {
  /** Height samples */
  heights?: GridRect;
  /** Splat texels */
  splat?: GridRect;
  /** Water level or mask (all water: main, bodies, rivers) */
  water?: boolean;
  /** Only the masks of these bodies changed (-1 the main water, 0.. further ones), within `bodyRect` (samples); the view redraws just them there */
  bodies?: number[];
  bodyRect?: GridRect;
  /** Object ids added, removed or changed, or all of them */
  objects?: 'all' | string[];
  paths?: boolean;
  /** Spawns and HQ */
  markers?: boolean;
  environment?: boolean;
  /** Life areas and the map's life switches (map-life.ts) */
  life?: boolean;
  meta?: boolean;
  /** Ground layer list (materials, order) */
  layers?: boolean;
  /** The whole terrain was replaced (resize, new grid) */
  terrain?: boolean;
}

export function mergeChanges(a: DocChange, b: DocChange): DocChange {
  const objects =
    a.objects === 'all' || b.objects === 'all'
      ? 'all'
      : a.objects || b.objects
        ? [...new Set([...(a.objects ?? []), ...(b.objects ?? [])])]
        : undefined;
  return {
    heights: rectUnion(a.heights ?? null, b.heights ?? null) ?? undefined,
    splat: rectUnion(a.splat ?? null, b.splat ?? null) ?? undefined,
    water: a.water || b.water || undefined,
    bodies: a.bodies || b.bodies ? [...new Set([...(a.bodies ?? []), ...(b.bodies ?? [])])] : undefined,
    bodyRect: rectUnion(a.bodyRect ?? null, b.bodyRect ?? null) ?? undefined,
    objects,
    paths: a.paths || b.paths || undefined,
    markers: a.markers || b.markers || undefined,
    environment: a.environment || b.environment || undefined,
    life: a.life || b.life || undefined,
    meta: a.meta || b.meta || undefined,
    layers: a.layers || b.layers || undefined,
    terrain: a.terrain || b.terrain || undefined,
  };
}

export interface EditCommand {
  readonly label: string;
  /** Do (or redo) it */
  apply(doc: CustomMapDocument): DocChange;
  /** Undo it */
  revert(doc: CustomMapDocument): DocChange;
  /** Memory it holds, for the history's budget */
  readonly bytes: number;
}

export type Selection =
  | { kind: 'objects'; ids: string[] }
  | { kind: 'node'; id: string }
  | { kind: 'edge'; id: string }
  /** Several road nodes and edges (Shift, box): one of a kind alone is 'node' or 'edge' */
  | { kind: 'paths'; nodes: string[]; edges: string[] }
  | { kind: 'spawn'; id: string }
  /** Several spawns (Shift): one alone is 'spawn' */
  | { kind: 'spawns'; ids: string[] }
  | { kind: 'hq' }
  | null;

/** Something on the map the pointer is over */
export type PickResult =
  | { kind: 'spawn'; id: string }
  | { kind: 'hq' }
  | { kind: 'object'; id: string }
  | { kind: 'node'; id: string }
  | { kind: 'edge'; id: string };

/** The road nodes a selection holds */
export function selectedNodes(s: Selection): string[] {
  return s?.kind === 'node' ? [s.id] : s?.kind === 'paths' ? s.nodes : [];
}

/** The road edges a selection holds */
export function selectedEdges(s: Selection): string[] {
  return s?.kind === 'edge' ? [s.id] : s?.kind === 'paths' ? s.edges : [];
}

/** The spawns a selection holds */
export function selectedSpawns(s: Selection): string[] {
  return s?.kind === 'spawn' ? [s.id] : s?.kind === 'spawns' ? s.ids : [];
}

/** Nodes and edges as a selection: a single one as 'node' or 'edge', none as null */
export function pathSelection(nodes: readonly string[], edges: readonly string[]): Selection {
  if (!nodes.length && !edges.length) return null;
  if (nodes.length === 1 && !edges.length) return { kind: 'node', id: nodes[0] };
  if (edges.length === 1 && !nodes.length) return { kind: 'edge', id: edges[0] };
  return { kind: 'paths', nodes: [...nodes], edges: [...edges] };
}

/** Spawns as a selection: one as 'spawn', none as null */
export function spawnSelection(ids: readonly string[]): Selection {
  if (!ids.length) return null;
  return ids.length === 1 ? { kind: 'spawn', id: ids[0] } : { kind: 'spawns', ids: [...ids] };
}

interface Entry {
  command: EditCommand;
  before: number;
  after: number;
}

export interface HistoryLimits {
  /** Most commands kept */
  steps: number;
  /** Most bytes the commands may hold together */
  bytes: number;
}

export const DEFAULT_HISTORY_LIMITS: HistoryLimits = { steps: 300, bytes: 192 * 1024 * 1024 };

export type ChangeListener = (change: DocChange, doc: CustomMapDocument) => void;

/** A step refused because the document is held; the map is as it was before the step */
export class EditorHeldError extends Error {
  constructor(
    readonly label: string,
    readonly reason: string,
  ) {
    super(`${label} waits: ${reason}`);
    this.name = 'EditorHeldError';
  }
}

export class EditorDocument {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  private state = 0;
  private nextState = 1;
  private savedState = 0;
  private heldBytes = 0;
  private readonly listeners = new Set<ChangeListener>();
  private readonly selectionListeners = new Set<(s: Selection) => void>();
  private readonly refusalListeners = new Set<(e: EditorHeldError) => void>();
  private currentSelection: Selection = null;
  /** Why the document is held, the latest hold first; empty when free */
  private holds: { reason: string }[] = [];

  constructor(
    private current: CustomMapDocument,
    private readonly limits: HistoryLimits = DEFAULT_HISTORY_LIMITS,
  ) {}

  get doc(): CustomMapDocument {
    return this.current;
  }

  get dirty(): boolean {
    return this.state !== this.savedState;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoLabel(): string | null {
    return this.undoStack.at(-1)?.command.label ?? null;
  }

  get redoLabel(): string | null {
    return this.redoStack.at(-1)?.command.label ?? null;
  }

  /** The steps done (oldest first) and those undone (the next redo first), by label */
  get history(): { done: string[]; undone: string[] } {
    return { done: this.undoStack.map((e) => e.command.label), undone: this.redoStack.map((e) => e.command.label).reverse() };
  }

  /** Undoes or redoes until `steps` steps are done; false when that is not in the history */
  jumpTo(steps: number): boolean {
    if (this.holds.length) return false;
    if (steps < 0 || steps > this.undoStack.length + this.redoStack.length) return false;
    while (this.undoStack.length > steps) this.undo();
    while (this.undoStack.length < steps) this.redo();
    return true;
  }

  get historyBytes(): number {
    return this.heldBytes;
  }

  get historySteps(): number {
    return this.undoStack.length;
  }

  /** Id of the current state; equal ids mean equal content */
  get stateId(): number {
    return this.state;
  }

  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Hears every step the hold refused (after the map is back as it was) */
  onRefused(listener: (e: EditorHeldError) => void): () => void {
    this.refusalListeners.add(listener);
    return () => this.refusalListeners.delete(listener);
  }

  /**
   * Holds the document for `reason` until the returned release runs: steps,
   * undo and redo are refused meanwhile. The holder writes through `emit`
   * and keeps its own step after the release. Holds nest.
   */
  hold(reason: string): () => void {
    const entry = { reason };
    this.holds.push(entry);
    return () => {
      this.holds = this.holds.filter((h) => h !== entry);
    };
  }

  /** Why the document is held now, null when free */
  get heldReason(): string | null {
    return this.holds.at(-1)?.reason ?? null;
  }

  onSelection(listener: (s: Selection) => void): () => void {
    this.selectionListeners.add(listener);
    return () => this.selectionListeners.delete(listener);
  }

  /** Replace the whole map (open another one); forgets the history */
  replace(doc: CustomMapDocument, saved = true): void {
    this.current = doc;
    this.undoStack = [];
    this.redoStack = [];
    this.heldBytes = 0;
    this.state = this.nextState++;
    this.savedState = saved ? this.state : -1;
    this.select(null);
    this.emit({ terrain: true, objects: 'all', paths: true, markers: true, environment: true, life: true, meta: true, layers: true, water: true });
  }

  /**
   * Apply a command and keep it. Held, it is refused: applied and reverted
   * at once, so a step whose edit already ran (SnapshotCommand.record) is
   * taken back too, and EditorHeldError is thrown.
   */
  execute(command: EditCommand): DocChange {
    if (this.holds.length) {
      this.refuse(command, mergeChanges(command.apply(this.current), command.revert(this.current)));
    }
    const change = command.apply(this.current);
    this.record(command);
    this.emit(change);
    return change;
  }

  /**
   * Keep a command whose effect is already in the document (a finished
   * stroke). The listeners hear of it even when its dabs told them all (an
   * empty change): the state moved, which saving, the check and the build
   * areas wait for.
   */
  push(command: EditCommand, change?: DocChange): void {
    if (this.holds.length) this.refuse(command, mergeChanges(change ?? {}, command.revert(this.current)));
    this.record(command);
    this.emit(change ?? {});
  }

  /** Held, nothing is undone (false) */
  undo(): boolean {
    if (this.holds.length) return false;
    const entry = this.undoStack.pop();
    if (!entry) return false;
    const change = entry.command.revert(this.current);
    this.redoStack.push(entry);
    this.state = entry.before;
    this.fixSelection();
    this.emit(change);
    return true;
  }

  redo(): boolean {
    if (this.holds.length) return false;
    const entry = this.redoStack.pop();
    if (!entry) return false;
    const change = entry.command.apply(this.current);
    this.undoStack.push(entry);
    this.state = entry.after;
    this.fixSelection();
    this.emit(change);
    return true;
  }

  markSaved(): void {
    this.savedState = this.state;
  }

  /** Tell the listeners about a change that is not a command (a dab of a running stroke) */
  emit(change: DocChange): void {
    for (const l of this.listeners) l(change, this.current);
  }

  get selection(): Selection {
    return this.currentSelection;
  }

  select(selection: Selection): void {
    if (sameSelection(selection, this.currentSelection)) return;
    this.currentSelection = selection;
    for (const l of this.selectionListeners) l(selection);
  }

  /** The map is back as it was before `command`; tell the view and the refusal listeners, and stop the caller */
  private refuse(command: EditCommand, change: DocChange): never {
    this.emit(change);
    const error = new EditorHeldError(command.label, this.heldReason!);
    for (const l of this.refusalListeners) l(error);
    throw error;
  }

  private record(command: EditCommand): void {
    const before = this.state;
    this.state = this.nextState++;
    this.undoStack.push({ command, before, after: this.state });
    for (const e of this.redoStack) this.heldBytes -= e.command.bytes;
    this.redoStack = [];
    this.heldBytes += command.bytes;
    while (
      this.undoStack.length > 1 &&
      (this.undoStack.length > this.limits.steps || this.heldBytes > this.limits.bytes)
    ) {
      const dropped = this.undoStack.shift()!;
      this.heldBytes -= dropped.command.bytes;
    }
  }

  /** Drop a selection whose thing an undo or redo took away */
  private fixSelection(): void {
    const s = this.currentSelection;
    if (!s) return;
    const d = this.current;
    let next: Selection = s;
    if (s.kind === 'objects') {
      const ids = s.ids.filter((id) => d.objects.some((o) => o.id === id));
      next = ids.length ? { kind: 'objects', ids } : null;
    } else if (s.kind === 'paths') {
      next = pathSelection(
        s.nodes.filter((id) => d.paths.nodes.some((n) => n.id === id)),
        s.edges.filter((id) => d.paths.edges.some((e) => e.id === id)),
      );
    } else if (s.kind === 'spawns') {
      next = spawnSelection(s.ids.filter((id) => d.spawns.some((sp) => sp.id === id)));
    } else if (s.kind === 'node' && !d.paths.nodes.some((n) => n.id === s.id)) next = null;
    else if (s.kind === 'edge' && !d.paths.edges.some((e) => e.id === s.id)) next = null;
    else if (s.kind === 'spawn' && !d.spawns.some((sp) => sp.id === s.id)) next = null;
    this.select(next);
  }
}

function sameSelection(a: Selection, b: Selection): boolean {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind) return false;
  const same = (x: readonly string[], y: readonly string[]) => x.length === y.length && x.every((id, k) => id === y[k]);
  if (a.kind === 'objects' && b.kind === 'objects') return same(a.ids, b.ids);
  if (a.kind === 'spawns' && b.kind === 'spawns') return same(a.ids, b.ids);
  if (a.kind === 'paths' && b.kind === 'paths') return same(a.nodes, b.nodes) && same(a.edges, b.edges);
  if (a.kind === 'hq') return true;
  return (a as { id: string }).id === (b as { id: string }).id;
}
