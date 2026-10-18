/**
 * The open map's mirror in the editor's worker (editor/workers/editor-core):
 * the main thread tells it only what changed since it last told it, the
 * worker keeps a document of its own that packs, checks and measures the map
 * without a copy of the whole map on the main thread.
 *
 * What goes over (`MirrorSync`):
 *   - the small parts every time, whole: meta, environment, gameplay, life,
 *     intro, spawns, HQ, the terrain's own fields (layers, cliff, water
 *     levels, rivers). Copying them costs less than tracking them;
 *   - the arrays (heights, splat maps, water masks) by tiles of TILE: the
 *     tiles the document's changes named since the last sync (DocChange
 *     rectangles), an array that is a new one (resize, a new body) whole;
 *   - the objects as a patch against the list sent last: by identity (an
 *     object replaced is a new one) and by the ids the changes named (one
 *     changed in place); the road nodes and edges the same way, those
 *     changed in place found by their fields (a change of the roads names
 *     none; a node dragged moves in place); the prefabs and the surfaces
 *     whole when they changed.
 *
 * Every part has a version (DocPart, doc-change.ts) that rises with each
 * change of it; the mirror holds the versions of the state it was told, and
 * a result computed on it carries them, so the main thread can drop a result
 * of a state gone by (`MirrorTracker.current`).
 *
 * The mirror never shares memory with the document: every array it holds is
 * its own (an undo snapshot or a worker's structured clone of a document
 * array would otherwise alias a buffer two threads write).
 */
import type { CustomMapDocument, MapObject, MapPaths, MapPrefab, MapSurface, MapWater } from '../../world/custom-map/map-document';
import type { GridRect } from '../../map-ops/grid';
import { DOC_PARTS, changedParts, type DocChange, type DocPart } from './doc-change';
import type { EditorDocument } from './editor-document';

/** Side of a tile of the arrays, in samples or texels */
export const TILE = 64;

/** The version of each part of the map */
export type PartVersions = Record<DocPart, number>;

/** Tiles of one array: their indices (row-major over the tile grid) and their samples packed tile after tile */
export interface ArrayTiles<T extends Float32Array | Uint8Array> {
  tiles: Int32Array;
  data: T;
}

/** One array of the map: whole (new or replaced) or the tiles that changed */
export type ArraySync<T extends Float32Array | Uint8Array> = { whole: T } | ArrayTiles<T>;

/** A list against the one sent last: replaced whole, or a window spliced and single entries set (indices of the new list) */
export interface ListPatch<T> {
  whole?: T[];
  splice?: { start: number; remove: number; items: T[] };
  set?: [number, T][];
}

export interface MirrorSync {
  /** The document state (EditorDocument.stateId) and the parts' versions this sync brings the mirror to */
  state: number;
  versions: PartVersions;
  /** A new map (or the first sync): the mirror starts over from this sync alone */
  full: boolean;
  /** The document without its arrays, objects, roads, prefabs and surfaces (their keys in place, see `shellOf`) */
  shell: CustomMapDocument;
  heights?: ArraySync<Float32Array>;
  /** By splat map; a missing entry is unchanged */
  splat?: (ArraySync<Uint8Array> | null)[];
  /** The main water's mask and each further body's, by body; a missing entry is unchanged */
  water?: ArraySync<Uint8Array> | null;
  bodies?: (ArraySync<Uint8Array> | null)[];
  objects?: ListPatch<MapObject>;
  /** The roads whole (a new mirror, a new list), or their nodes and edges as patches */
  paths?: { whole?: MapPaths; nodes?: ListPatch<MapPaths['nodes'][number]>; edges?: ListPatch<MapPaths['edges'][number]> };
  /** The prefabs whole when they changed; null for none */
  prefabs?: MapPrefab[] | null;
  /** The surfaces whole when they changed; null for none */
  surfaces?: MapSurface[] | null;
}

/** What the mirror placed instead of what a sync brings apart from the shell */
const HOLE = 0;

/**
 * The document with its large parts left out but their keys kept in their
 * places (a file packed from the mirror must write its keys in the same
 * order as one packed from the document): arrays, objects, roads, prefabs, surfaces
 */
export function shellOf(doc: CustomMapDocument): CustomMapDocument {
  const t = doc.terrain;
  const body = (w: MapWater): MapWater => ({ ...w, mask: HOLE as unknown as Uint8Array });
  const terrain = {
    ...t,
    grid: { ...t.grid, heights: HOLE as unknown as Float32Array },
    splat: { ...t.splat, maps: [] },
    water: t.water ? body(t.water) : t.water,
  };
  if (t.waterBodies) terrain.waterBodies = t.waterBodies.map(body);
  const shell = { ...doc, terrain, objects: HOLE as unknown as MapObject[], paths: HOLE as unknown as MapPaths };
  if ('prefabs' in doc) shell.prefabs = HOLE as unknown as MapPrefab[];
  if ('surfaces' in doc) shell.surfaces = HOLE as unknown as MapSurface[];
  return shell;
}

/** Bit per tile of an array, the tiles a change touched */
class DirtyTiles {
  private bits: Uint8Array;
  private any = false;
  readonly across: number;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.across = Math.ceil(width / TILE);
    this.bits = new Uint8Array(this.across * Math.ceil(height / TILE));
  }

  mark(r: GridRect): void {
    const i0 = Math.max(0, Math.floor(r.i0 / TILE));
    const j0 = Math.max(0, Math.floor(r.j0 / TILE));
    const i1 = Math.min(this.across - 1, Math.floor(r.i1 / TILE));
    const j1 = Math.min(this.bits.length / this.across - 1, Math.floor(r.j1 / TILE));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.bits[j * this.across + i] = 1;
    if (i1 >= i0 && j1 >= j0) this.any = true;
  }

  get dirty(): boolean {
    return this.any;
  }

  list(): Int32Array {
    const out: number[] = [];
    for (let k = 0; k < this.bits.length; k++) if (this.bits[k]) out.push(k);
    return Int32Array.from(out);
  }

  clear(): void {
    if (this.any) this.bits.fill(0);
    this.any = false;
  }
}

/** The samples of `tiles` of an array `width` x `height` with `stride` values per sample, packed */
export function copyTiles<T extends Float32Array | Uint8Array>(src: T, width: number, height: number, stride: number, tiles: Int32Array): ArrayTiles<T> {
  const across = Math.ceil(width / TILE);
  let size = 0;
  for (const k of tiles) {
    const i = (k % across) * TILE;
    const j = Math.floor(k / across) * TILE;
    size += (Math.min(width, i + TILE) - i) * (Math.min(height, j + TILE) - j) * stride;
  }
  const data = new (src.constructor as new (n: number) => T)(size);
  let at = 0;
  for (const k of tiles) {
    const i = (k % across) * TILE;
    const j = Math.floor(k / across) * TILE;
    const row = (Math.min(width, i + TILE) - i) * stride;
    for (let y = j, y1 = Math.min(height, j + TILE); y < y1; y++) {
      const from = (y * width + i) * stride;
      data.set(src.subarray(from, from + row), at);
      at += row;
    }
  }
  return { tiles, data };
}

/** Writes packed tiles (copyTiles) back into an array of the same shape */
export function pasteTiles<T extends Float32Array | Uint8Array>(dst: T, width: number, height: number, stride: number, packed: ArrayTiles<T>): void {
  const across = Math.ceil(width / TILE);
  let at = 0;
  for (const k of packed.tiles) {
    const i = (k % across) * TILE;
    const j = Math.floor(k / across) * TILE;
    const row = (Math.min(width, i + TILE) - i) * stride;
    for (let y = j, y1 = Math.min(height, j + TILE); y < y1; y++) {
      dst.set(packed.data.subarray(at, at + row), (y * width + i) * stride);
      at += row;
    }
  }
}

/** The patch from `before` to `after`: identity tells replaced entries, `changed` those changed in place */
export function listPatch<T>(before: readonly T[], after: readonly T[], changed?: (item: T) => boolean): ListPatch<T> | null {
  const n0 = before.length;
  const n1 = after.length;
  let p = 0;
  while (p < n0 && p < n1 && before[p] === after[p]) p++;
  let s = 0;
  while (s < n0 - p && s < n1 - p && before[n0 - 1 - s] === after[n1 - 1 - s]) s++;
  const patch: ListPatch<T> = {};
  const window = n1 - p - s;
  /** Entries replaced in a window as long as before */
  const differ = new Set<number>();
  if (n0 - p - s === window) {
    // As long as before: only the entries that differ (a gizmo moved some objects all over the list)
    for (let k = p; k < p + window; k++) if (before[k] !== after[k]) differ.add(k);
    if (differ.size * 2 > window) {
      patch.splice = { start: p, remove: window, items: after.slice(p, p + window) };
      differ.clear();
    }
  } else patch.splice = { start: p, remove: n0 - p - s, items: after.slice(p, n1 - s) };
  const from = patch.splice?.start ?? 0;
  const to = patch.splice ? from + patch.splice.items.length : 0;
  // Besides the window spliced in: the entries replaced, and those changed in place (the same entry, its fields new)
  const set: [number, T][] = [];
  if (changed) {
    for (let k = 0; k < n1; k++) if ((k < from || k >= to) && (differ.has(k) || changed(after[k]))) set.push([k, after[k]]);
  } else for (const k of differ) set.push([k, after[k]]);
  if (set.length) patch.set = set;
  return patch.splice || patch.set ? patch : null;
}

/** Applies a ListPatch to a list (in place) */
export function applyListPatch<T>(list: T[], patch: ListPatch<T>): T[] {
  if (patch.whole) return patch.whole;
  if (patch.splice) list.splice(patch.splice.start, patch.splice.remove, ...patch.splice.items);
  for (const [k, item] of patch.set ?? []) list[k] = item;
  return list;
}

/** Fields of an entry as sent, two levels deep (an edge's dress), to find one changed in place */
type Fields = Record<string, unknown>;

function isPlain(v: unknown): v is Fields {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !ArrayBuffer.isView(v);
}

function fieldsOf(o: object, depth = 2): Fields {
  const out: Fields = {};
  for (const [k, v] of Object.entries(o)) out[k] = depth > 1 && isPlain(v) ? fieldsOf(v, depth - 1) : v;
  return out;
}

function sameFields(o: object, was: Fields, depth = 2): boolean {
  const keys = Object.keys(o);
  if (keys.length !== Object.keys(was).length) return false;
  for (const k of keys) {
    const v = (o as Fields)[k];
    const w = was[k];
    if (v === w) continue;
    if (!(depth > 1 && isPlain(v) && isPlain(w) && sameFields(v, w, depth - 1))) return false;
  }
  return true;
}

/** The fields of the entries of a list as sent, by entry */
class SentFields<T extends object> {
  private readonly fields = new WeakMap<T, Fields>();

  /** Whether `item` changed in place since it was sent (one never seen counts as changed) */
  changed(item: T): boolean {
    const was = this.fields.get(item);
    return !was || !sameFields(item, was);
  }

  keep(items: readonly T[]): void {
    for (const item of items) this.fields.set(item, fieldsOf(item));
  }
}

/** What the tracker sent last, by identity */
interface Sent {
  doc: CustomMapDocument;
  heights: Float32Array;
  splat: Uint8Array[];
  water: Uint8Array | null;
  bodies: Uint8Array[];
  objects: MapObject[];
  nodes: MapPaths['nodes'];
  edges: MapPaths['edges'];
  pathsRef: MapPaths;
  prefabs: MapPrefab[] | undefined;
  surfaces: MapSurface[] | undefined;
}

/**
 * The main thread's side: follows the document's changes and makes the next
 * sync of them. Costs a change a few bit writes; a sync the tiles that
 * changed, one pass over the object list (identities) and the small parts.
 */
export class MirrorTracker {
  private readonly versions = Object.fromEntries(DOC_PARTS.map((p) => [p, 0])) as PartVersions;
  private sent: Sent | null = null;
  private heights: DirtyTiles | null = null;
  private splat: DirtyTiles | null = null;
  private masks = new Map<number, DirtyTiles>();
  private allWater = false;
  private allSplat = false;
  private objectIds = new Set<string>();
  private allObjects = false;
  private paths = false;
  private prefabs = false;
  private surfaces = false;
  private nodeFields = new SentFields<MapPaths['nodes'][number]>();
  private edgeFields = new SentFields<MapPaths['edges'][number]>();
  private readonly unsubscribe: () => void;

  constructor(private readonly editor: EditorDocument) {
    this.unsubscribe = editor.onChange((change) => this.note(change));
  }

  /** The versions of the parts now */
  get now(): Readonly<PartVersions> {
    return this.versions;
  }

  /** Whether `parts` are still as in `versions` (a result computed on them is current) */
  current(versions: Readonly<PartVersions>, parts: readonly DocPart[]): boolean {
    return parts.every((p) => versions[p] === this.versions[p]);
  }

  /** The next sync starts the mirror over (a new worker) */
  reset(): void {
    this.sent = null;
  }

  dispose(): void {
    this.unsubscribe();
  }

  private note(c: DocChange): void {
    for (const p of changedParts(c)) this.versions[p]++;
    if (!this.sent) return;
    if (c.terrain) {
      this.sent = null;
      return;
    }
    if (c.heights) this.heights?.mark(c.heights);
    if (c.splat) this.splat?.mark(c.splat);
    if (c.layers) this.allSplat = true;
    if (c.water) this.allWater = true;
    else if (c.bodies) {
      for (const b of c.bodies) {
        if (!c.bodyRect) {
          this.allWater = true;
          break;
        }
        let tiles = this.masks.get(b);
        if (!tiles) this.masks.set(b, (tiles = new DirtyTiles(this.heights!.width, this.heights!.height)));
        tiles.mark(c.bodyRect);
      }
    }
    if (c.objects === 'all') this.allObjects = true;
    else if (c.objects) for (const id of c.objects) this.objectIds.add(id);
    if (c.paths) this.paths = true;
    if (c.prefabs) this.prefabs = true;
    if (c.surfaces) this.surfaces = true;
  }

  /** The sync from what was sent last to the document now, with the buffers it may transfer */
  sync(): { sync: MirrorSync; transfer: ArrayBuffer[] } {
    const doc = this.editor.doc;
    const t = doc.terrain;
    const g = t.grid;
    const transfer: ArrayBuffer[] = [];
    const take = <T extends Float32Array | Uint8Array>(a: ArraySync<T>): ArraySync<T> => {
      transfer.push(('whole' in a ? a.whole : a.data).buffer as ArrayBuffer);
      if ('tiles' in a) transfer.push(a.tiles.buffer as ArrayBuffer);
      return a;
    };
    const sent = this.sent?.doc === doc && this.sent.heights.length === g.heights.length ? this.sent : null;
    const res = t.splat.resolution;
    const sync: MirrorSync = { state: this.editor.stateId, versions: { ...this.versions }, full: !sent, shell: shellOf(doc) };
    const array = <T extends Float32Array | Uint8Array>(now: T, was: T | null, tiles: DirtyTiles | null, all: boolean, w: number, h: number, stride: number): ArraySync<T> | null => {
      if (!was || was !== now || all) return take({ whole: now.slice() as T });
      if (!tiles?.dirty) return null;
      return take(copyTiles(now, w, h, stride, tiles.list()));
    };
    sync.heights = array(g.heights, sent?.heights ?? null, this.heights, false, g.columns, g.rows, 1) ?? undefined;
    const splat = t.splat.maps.map((m, k) => array(m, sent?.splat.length === t.splat.maps.length ? sent.splat[k] : null, this.splat, this.allSplat, res, res, 4));
    if (splat.some((m) => m)) sync.splat = splat;
    const mask = (now: Uint8Array | null, was: Uint8Array | null | undefined, body: number): ArraySync<Uint8Array> | null =>
      now ? array(now, was ?? null, this.masks.get(body) ?? null, this.allWater, g.columns, g.rows, 1) : null;
    const water = mask(t.water?.mask ?? null, sent?.water, -1);
    if (water || !sent || (sent.water !== null) !== !!t.water) sync.water = water;
    const bodies = (t.waterBodies ?? []).map((b, k) => mask(b.mask, sent?.bodies.length === t.waterBodies!.length ? sent.bodies[k] : null, k));
    if (bodies.some((b) => b) || !sent || sent.bodies.length !== bodies.length) sync.bodies = bodies;
    // Objects: whole for a new mirror or when all changed, else what differs from the list sent
    if (!sent || this.allObjects) sync.objects = { whole: doc.objects };
    else {
      const ids = this.objectIds;
      const patch = listPatch(sent.objects, doc.objects, ids.size ? (o) => ids.has(o.id) : undefined);
      if (patch) sync.objects = patch;
    }
    const p = doc.paths;
    if (!sent || sent.pathsRef !== p) {
      sync.paths = { whole: p };
      this.nodeFields = new SentFields();
      this.edgeFields = new SentFields();
      this.nodeFields.keep(p.nodes);
      this.edgeFields.keep(p.edges);
    } else {
      // A change of the roads names no node or edge: their fields tell, only then worth the walk
      const roads = <T extends object>(before: readonly T[], after: readonly T[], fields: SentFields<T>): ListPatch<T> | undefined => {
        const patch = listPatch(before, after, this.paths ? (item) => fields.changed(item) : undefined);
        if (!patch) return undefined;
        if (patch.splice) fields.keep(patch.splice.items);
        if (patch.set) fields.keep(patch.set.map(([, item]) => item));
        return patch;
      };
      const nodes = roads(sent.nodes, p.nodes, this.nodeFields);
      const edges = roads(sent.edges, p.edges, this.edgeFields);
      if (nodes || edges) sync.paths = { ...(nodes ? { nodes } : {}), ...(edges ? { edges } : {}) };
    }
    if (!sent || this.prefabs || sent.prefabs !== doc.prefabs) sync.prefabs = doc.prefabs ?? null;
    if (!sent || this.surfaces || sent.surfaces !== doc.surfaces) sync.surfaces = doc.surfaces ?? null;
    this.sent = {
      doc,
      heights: g.heights,
      splat: [...t.splat.maps],
      water: t.water?.mask ?? null,
      bodies: (t.waterBodies ?? []).map((b) => b.mask),
      // The lists by identity: an entry replaced shows next time
      objects: doc.objects.slice(),
      nodes: p.nodes.slice(),
      edges: p.edges.slice(),
      pathsRef: p,
      prefabs: doc.prefabs,
      surfaces: doc.surfaces,
    };
    this.clear(g.columns, g.rows, res);
    return { sync, transfer };
  }

  private clear(columns: number, rows: number, res: number): void {
    if (this.heights?.width !== columns || this.heights.height !== rows) this.heights = new DirtyTiles(columns, rows);
    else this.heights.clear();
    if (this.splat?.width !== res) this.splat = new DirtyTiles(res, res);
    else this.splat.clear();
    this.masks.clear();
    this.allWater = this.allSplat = this.allObjects = this.paths = this.prefabs = this.surfaces = false;
    this.objectIds.clear();
  }
}

/** The worker's side: the document as the syncs told it */
export class DocMirror {
  private current: CustomMapDocument | null = null;
  state = -1;
  versions: PartVersions | null = null;

  get doc(): CustomMapDocument {
    if (!this.current) throw new Error('The mirror holds no map yet');
    return this.current;
  }

  get ready(): boolean {
    return this.current !== null;
  }

  apply(sync: MirrorSync): void {
    const was = sync.full ? null : this.current;
    if (!sync.full && !was) throw new Error('The mirror missed the start of the map');
    const doc = sync.shell;
    const t = doc.terrain;
    const g = t.grid;
    const res = t.splat.resolution;
    const array = <T extends Float32Array | Uint8Array>(s: ArraySync<T> | null | undefined, old: T | undefined, w: number, h: number, stride: number, what: string): T => {
      if (s && 'whole' in s) return s.whole;
      if (!old) throw new Error(`The mirror misses ${what}`);
      if (s) pasteTiles(old, w, h, stride, s);
      return old;
    };
    g.heights = array(sync.heights, was?.terrain.grid.heights, g.columns, g.rows, 1, 'the heights');
    const maps = was?.terrain.splat.maps ?? [];
    const count = sync.splat?.length ?? maps.length;
    t.splat.maps = Array.from({ length: count }, (_, k) => array(sync.splat?.[k], maps[k], res, res, 4, `splat map ${k + 1}`));
    if (t.water) t.water.mask = array(sync.water, was?.terrain.water?.mask, g.columns, g.rows, 1, 'the water mask');
    t.waterBodies?.forEach((b, k) => (b.mask = array(sync.bodies?.[k], was?.terrain.waterBodies?.[k]?.mask, g.columns, g.rows, 1, `the mask of body ${k + 1}`)));
    if (!sync.objects && !was) throw new Error('The mirror misses the objects');
    doc.objects = sync.objects ? applyListPatch(was?.objects ?? [], sync.objects) : was!.objects;
    const roads = sync.paths;
    if (roads?.whole) doc.paths = roads.whole;
    else {
      doc.paths = was!.paths;
      if (roads?.nodes) doc.paths.nodes = applyListPatch(doc.paths.nodes, roads.nodes);
      if (roads?.edges) doc.paths.edges = applyListPatch(doc.paths.edges, roads.edges);
    }
    if ('prefabs' in doc) doc.prefabs = (sync.prefabs !== undefined ? sync.prefabs : was?.prefabs) ?? undefined;
    if ('surfaces' in doc) doc.surfaces = (sync.surfaces !== undefined ? sync.surfaces : was?.surfaces) ?? undefined;
    this.current = doc;
    this.state = sync.state;
    this.versions = sync.versions;
  }
}
