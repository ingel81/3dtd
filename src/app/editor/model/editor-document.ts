/**
 * The map being edited, with undo and redo. Every edit is a command that can
 * apply and revert itself and says what it changed (`DocChange`), so the view
 * updates only the touched chunks. Brush strokes write live while the mouse
 * moves (`emit` for each dab) and land as one command at the end (`push`).
 *
 * The document knows whether it differs from the last save (`dirty`): every
 * state gets an id, undo and redo move between them, and a save remembers
 * the id it saved.
 */
import type {
  CustomMapDocument,
  MapEnvironment,
  MapGameplay,
  MapLife,
  MapMeta,
  MapObject,
  MapPaths,
  MapPoint,
  MapSpawn,
  MapTerrain,
} from '../../world/custom-map/map-document';
import { rectUnion, type GridRect } from './grid';
import { applyPatches, patchBytes, type ArrayLayout, type PatchArray, type TilePatch } from './region-patch';

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

export class EditorDocument {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  private state = 0;
  private nextState = 1;
  private savedState = 0;
  private heldBytes = 0;
  private readonly listeners = new Set<ChangeListener>();
  private readonly selectionListeners = new Set<(s: Selection) => void>();
  private currentSelection: Selection = null;

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

  /** Apply a command and keep it */
  execute(command: EditCommand): DocChange {
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
    this.record(command);
    this.emit(change ?? {});
  }

  undo(): boolean {
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

// ---------------------------------------------------------------------------
// Commands

/** `water` is the main water body's mask, `body0`, `body1` … the further bodies' masks */
export type PatchTarget = 'heights' | SplatTarget | 'water' | `body${number}`;

/** A splat map; `splat2` only on maps with more than 8 layers */
export type SplatTarget = 'splat0' | 'splat1' | 'splat2';

/** The splat maps the map has now */
export function splatTargets(doc: CustomMapDocument): SplatTarget[] {
  return (['splat0', 'splat1', 'splat2'] as const).slice(0, doc.terrain.splat.maps.length);
}

export function patchArray(doc: CustomMapDocument, target: PatchTarget): PatchArray {
  const t = doc.terrain;
  switch (target) {
    case 'heights':
      return t.grid.heights;
    case 'splat0':
    case 'splat1':
    case 'splat2': {
      const map = t.splat.maps[Number(target.slice(5))];
      if (!map) throw new Error(`The map has no ${target}`);
      return map;
    }
    case 'water':
      if (!t.water) throw new Error('The map has no water');
      return t.water.mask;
    default: {
      const body = t.waterBodies?.[Number(target.slice(4))];
      if (!body) throw new Error(`The map has no water body ${target}`);
      return body.mask;
    }
  }
}

export function patchLayout(doc: CustomMapDocument, target: PatchTarget): ArrayLayout {
  const t = doc.terrain;
  if (target.startsWith('splat')) {
    return { columns: t.splat.resolution, rows: t.splat.resolution, channels: 4 };
  }
  return { columns: t.grid.columns, rows: t.grid.rows, channels: 1 };
}

/** A stroke over one or more arrays, as tile patches */
export class PatchCommand implements EditCommand {
  readonly bytes: number;

  constructor(
    readonly label: string,
    private readonly parts: readonly { target: PatchTarget; patches: TilePatch[] }[],
  ) {
    this.bytes = parts.reduce((n, p) => n + patchBytes(p.patches), 0);
  }

  get empty(): boolean {
    return this.parts.every((p) => p.patches.length === 0);
  }

  apply(doc: CustomMapDocument): DocChange {
    return this.write(doc, 'after');
  }

  revert(doc: CustomMapDocument): DocChange {
    return this.write(doc, 'before');
  }

  private write(doc: CustomMapDocument, side: 'before' | 'after'): DocChange {
    let change: DocChange = {};
    for (const part of this.parts) {
      const rect = applyPatches(patchArray(doc, part.target), patchLayout(doc, part.target), part.patches, side);
      if (!rect) continue;
      if (part.target === 'heights') change = mergeChanges(change, { heights: rect });
      else if (part.target === 'water' || part.target.startsWith('body')) change = mergeChanges(change, { water: true });
      else change = mergeChanges(change, { splat: rect });
    }
    return change;
  }
}

/** Parts of the document small enough to keep whole before and after */
export interface DocParts {
  objects: MapObject[];
  gameplay: MapGameplay | undefined;
  paths: MapPaths;
  spawns: MapSpawn[];
  hq: MapPoint;
  environment: MapEnvironment;
  life: MapLife | undefined;
  meta: MapMeta;
  terrain: MapTerrain;
}

const PART_CHANGE: Record<keyof DocParts, DocChange> = {
  objects: { objects: 'all' },
  gameplay: { meta: true },
  paths: { paths: true },
  spawns: { markers: true },
  hq: { markers: true },
  environment: { environment: true },
  life: { life: true },
  meta: { meta: true },
  terrain: { terrain: true, layers: true, water: true },
};

/** Swaps parts of the document between two copies */
export class SnapshotCommand implements EditCommand {
  readonly bytes: number;

  constructor(
    readonly label: string,
    private readonly before: Partial<DocParts>,
    private readonly after: Partial<DocParts>,
    private readonly extra: DocChange = {},
  ) {
    this.bytes = estimateBytes(before) + estimateBytes(after);
  }

  /** Copies of `keys` as they are now, for a command made of two captures (an edit that takes a while) */
  static capture<K extends keyof DocParts>(doc: CustomMapDocument, keys: readonly K[]): Partial<DocParts> {
    return pick(doc, keys);
  }

  /** Captures `keys` now, runs `edit`, captures again */
  static record<K extends keyof DocParts>(
    doc: CustomMapDocument,
    label: string,
    keys: readonly K[],
    edit: (doc: CustomMapDocument) => void,
    extra: DocChange = {},
  ): SnapshotCommand {
    const before = pick(doc, keys);
    edit(doc);
    return new SnapshotCommand(label, before, pick(doc, keys), extra);
  }

  apply(doc: CustomMapDocument): DocChange {
    return this.write(doc, this.after);
  }

  revert(doc: CustomMapDocument): DocChange {
    return this.write(doc, this.before);
  }

  private write(doc: CustomMapDocument, parts: Partial<DocParts>): DocChange {
    let change: DocChange = { ...this.extra };
    for (const key of Object.keys(parts) as (keyof DocParts)[]) {
      (doc as unknown as Record<string, unknown>)[key] = structuredClone(parts[key]);
      change = mergeChanges(change, PART_CHANGE[key]);
      if (key === 'terrain') change = { ...change, objects: 'all', paths: true, markers: true };
    }
    return change;
  }
}

function pick<K extends keyof DocParts>(doc: CustomMapDocument, keys: readonly K[]): Partial<DocParts> {
  const out: Partial<DocParts> = {};
  for (const k of keys) (out as Record<string, unknown>)[k] = structuredClone(doc[k]);
  return out;
}

function estimateBytes(parts: Partial<DocParts>): number {
  let n = 0;
  for (const value of Object.values(parts)) {
    if (!value) continue;
    if ((value as MapTerrain).grid) {
      const t = value as MapTerrain;
      n += t.grid.heights.byteLength + t.splat.maps[0].byteLength * t.splat.maps.length + (t.water?.mask.byteLength ?? 0);
    } else n += JSON.stringify(value).length;
  }
  return n;
}

/** Objects added, removed or changed; each keeps its place in the list */
export interface ObjectEdit {
  before: MapObject | null;
  after: MapObject | null;
  /** Index in the list where it stands (before for removal, after for insertion) */
  index: number;
}

export class ObjectsCommand implements EditCommand {
  readonly bytes: number;

  constructor(
    readonly label: string,
    private readonly edits: readonly ObjectEdit[],
  ) {
    this.bytes = edits.length * 160;
  }

  static add(label: string, doc: CustomMapDocument, objects: MapObject[]): ObjectsCommand {
    const start = doc.objects.length;
    return new ObjectsCommand(
      label,
      objects.map((o, k) => ({ before: null, after: { ...o }, index: start + k })),
    );
  }

  static remove(label: string, doc: CustomMapDocument, ids: readonly string[]): ObjectsCommand {
    const set = new Set(ids);
    const edits: ObjectEdit[] = [];
    doc.objects.forEach((o, index) => {
      if (set.has(o.id)) edits.push({ before: { ...o }, after: null, index });
    });
    return new ObjectsCommand(label, edits);
  }

  /** Changes objects in place; `update` returns the new object */
  static change(label: string, doc: CustomMapDocument, ids: readonly string[], update: (o: MapObject) => MapObject): ObjectsCommand {
    const set = new Set(ids);
    const edits: ObjectEdit[] = [];
    doc.objects.forEach((o, index) => {
      if (set.has(o.id)) edits.push({ before: { ...o }, after: { ...update({ ...o }) }, index });
    });
    return new ObjectsCommand(label, edits);
  }

  /** Before and after of objects already changed in place */
  static fromStates(label: string, doc: CustomMapDocument, before: ReadonlyMap<string, MapObject>): ObjectsCommand {
    const edits: ObjectEdit[] = [];
    doc.objects.forEach((o, index) => {
      const b = before.get(o.id);
      if (b && !sameObject(b, o)) edits.push({ before: { ...b }, after: { ...o }, index });
    });
    return new ObjectsCommand(label, edits);
  }

  get empty(): boolean {
    return this.edits.length === 0;
  }

  apply(doc: CustomMapDocument): DocChange {
    // Removals from the back so indices hold, then insertions from the front
    const list = doc.objects;
    const removals = this.edits.filter((e) => e.before && !e.after).sort((a, b) => b.index - a.index);
    for (const e of removals) list.splice(indexOf(list, e.before!.id, e.index), 1);
    for (const e of this.edits) {
      if (e.before && e.after) list[indexOf(list, e.before.id, e.index)] = { ...e.after };
    }
    const inserts = this.edits.filter((e) => !e.before && e.after).sort((a, b) => a.index - b.index);
    for (const e of inserts) list.splice(Math.min(e.index, list.length), 0, { ...e.after! });
    return { objects: this.ids() };
  }

  revert(doc: CustomMapDocument): DocChange {
    const list = doc.objects;
    const inserted = this.edits.filter((e) => !e.before && e.after).sort((a, b) => b.index - a.index);
    for (const e of inserted) list.splice(indexOf(list, e.after!.id, e.index), 1);
    for (const e of this.edits) {
      if (e.before && e.after) list[indexOf(list, e.after.id, e.index)] = { ...e.before };
    }
    const removed = this.edits.filter((e) => e.before && !e.after).sort((a, b) => a.index - b.index);
    for (const e of removed) list.splice(Math.min(e.index, list.length), 0, { ...e.before! });
    return { objects: this.ids() };
  }

  private ids(): string[] {
    return this.edits.map((e) => (e.after ?? e.before)!.id);
  }
}

function indexOf(list: MapObject[], id: string, hint: number): number {
  if (list[hint]?.id === id) return hint;
  const k = list.findIndex((o) => o.id === id);
  if (k < 0) throw new Error(`Object ${id} is not in the map`);
  return k;
}

export function sameObject(a: MapObject, b: MapObject): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.z === b.z &&
    a.rotation === b.rotation &&
    a.scale === b.scale &&
    a.asset === b.asset &&
    a.blocksLos === b.blocksLos &&
    a.blocksBuild === b.blocksBuild &&
    a.tint === b.tint &&
    a.pitch === b.pitch &&
    a.roll === b.roll &&
    a.group === b.group
  );
}

/** Several commands as one step */
export class CompoundCommand implements EditCommand {
  readonly bytes: number;

  constructor(
    readonly label: string,
    private readonly commands: readonly EditCommand[],
  ) {
    this.bytes = commands.reduce((n, c) => n + c.bytes, 0);
  }

  apply(doc: CustomMapDocument): DocChange {
    return this.commands.reduce<DocChange>((change, c) => mergeChanges(change, c.apply(doc)), {});
  }

  revert(doc: CustomMapDocument): DocChange {
    let change: DocChange = {};
    for (let k = this.commands.length - 1; k >= 0; k--) change = mergeChanges(change, this.commands[k].revert(doc));
    return change;
  }
}
