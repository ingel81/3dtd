/**
 * The `.3dtdmap` file: a zip (fflate) with `map.json` and the map's big
 * arrays as raw little-endian binaries beside it. `map.json` names each
 * binary where the array sits in the document (`{ "$bin": "terrain/heights.f32" }`).
 *
 * `contentHash` is a SHA-256 over what makes the map a world: the document
 * without its names and times, with keys in a fixed order, followed by the
 * array bytes. Renaming a map or saving it again keeps the hash; moving a
 * tree changes it. Runs, replays and the coop world package carry it in
 * their `WorldRef`.
 *
 * Reading lifts older versions through `MAP_MIGRATIONS` first and refuses
 * a file of a newer `MAP_VERSION` with "update the game". Then it checks in
 * two steps (docs/CUSTOM_MAPS.md, "Format rules"): the content softly
 * (map-repair.ts: an unknown value of a list falls back to its default, a
 * broken object, river, life area or wave event is left out, and
 * `UnpackedMap.repaired` says what), the structure hard
 * (`validateMapDocument`: grid, masks, roads, spawns, HQ). A file whose
 * structure is broken fails with `MapFileError` and a message that says
 * what is wrong.
 */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import {
  MAP_DIFFICULTY,
  MAP_FORMAT,
  MAP_VERSION,
  MAX_GROUND_LAYERS,
  MAX_MAP_PREFABS,
  isTypedArray as isTyped,
  splatMapCount,
  type CustomMapDocument,
  type MapMeta,
} from './map-document';
import { MAP_ID_PATTERN } from './map-create';
import { mapRepairs, prefabProblems } from './map-repair';
import { MapFileError } from './map-file-kind';
import { FOOTPRINTS_FORMAT, footprintsWellFormed } from './map-footprints';
import type { MapFilePart, MapProblem, MapProblemPart, MapText } from './map-text';

export type { MapProblem, MapProblemPart } from './map-text';

export const MAP_JSON_ENTRY = 'map.json';
export const MAP_PREVIEW_ENTRY = 'preview.png';


/** A migration lifts the parsed `map.json` of version n to n + 1 */
export type MapMigration = (json: Record<string, unknown>) => Record<string, unknown>;

/** Keyed by the version they read */
export const MAP_MIGRATIONS: Readonly<Record<number, MapMigration>> = {
  // 1 to 2: version 2 adds the optional gameplay rules; a version 1 map has none
  1: (json) => json,
  // 2 to 3: version 3 may carry a third splat map (layers 9 to 12); a version 2 map has two and at most 8 layers
  2: (json) => json,
  // 3 to 4: version 4 may carry buildings raised from their footprint (MapObject.mass), surfaces laid over the
  // ground (surfaces) and the storm weather, all optional; a version 3 map has none of them. Optional fields that
  // come later and that the soft checks set right (map-repair.ts) fit into version 4 as well
  3: (json) => json,
};

interface BinaryRef {
  $bin: string;
}

/** Zip times start in 1980 */
const ZIP_EPOCH = Date.UTC(1980, 0, 2);

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/** Where the arrays live in the zip */
const BIN = {
  heights: 'terrain/heights.f32',
  splat0: 'terrain/splat0.u8',
  splat1: 'terrain/splat1.u8',
  splat2: 'terrain/splat2.u8',
  water: 'terrain/water-mask.u8',
} as const;

/** Where an OSM world keeps the footprints its import read (CustomMapDocument.footprints), outside the content hash */
const FOOTPRINTS_ENTRY = 'osm/footprints.i16';

/**
 * Limits a file is read within, so a small zip that claims huge entries
 * cannot take the tab down: samples and splat texels per side, bytes per
 * entry (a 4097 x 4097 float grid, just over 67 MB) and for all entries.
 */
export const MAX_GRID_SIDE = 4097;
export const MAX_SPLAT_RESOLUTION = 4096;
export const MAX_ENTRY_BYTES = MAX_GRID_SIDE * MAX_GRID_SIDE * 4;
export const MAX_FILE_BYTES = 512 * 1024 * 1024;
/** Water bodies a file may carry */
export const MAX_WATER_BODIES = 64;

/** Whether a zip entry is one a map file has */
function knownEntry(name: string): boolean {
  return (
    name === MAP_JSON_ENTRY ||
    name === MAP_PREVIEW_ENTRY ||
    name === FOOTPRINTS_ENTRY ||
    (Object.values(BIN) as string[]).includes(name) ||
    /^terrain\/water-([1-9]\d?)-mask\.u8$/.test(name) ||
    /^prefabs\/\d{1,2}\/(heights\.f32|paint\.u8|water\.u8)$/.test(name)
  );
}

/** Zip path of an array of prefab k (CustomMapDocument.prefabs) */
function prefabPath(k: number, part: 'heights.f32' | 'paint.u8' | 'water.u8'): string {
  return `prefabs/${k}/${part}`;
}

/** Zip path of further water body k's mask */
function waterBodyPath(k: number): string {
  return `terrain/water-${k + 1}-mask.u8`;
}

export interface PackOptions {
  /** A PNG to carry as `preview.png` (map lists, the file browser) */
  preview?: Uint8Array;
  /** Deflate level, 0 to 9 (default 6) */
  level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
}

export interface UnpackedMap {
  doc: CustomMapDocument;
  preview: Uint8Array | null;
  /** What reading set right or left out (map-repair.ts), for the player to see */
  repaired: MapProblem[];
}

/** The document as a `.3dtdmap` file */
export function packMapFile(doc: CustomMapDocument, options: PackOptions = {}): Uint8Array {
  const problems = validateMapDocument(doc);
  if (problems.length) throw new MapFileError({ key: 'invalid' }, problems);
  const { json, binaries, editorBinaries } = splitDocument(doc);
  const files: Zippable = { [MAP_JSON_ENTRY]: strToU8(JSON.stringify(json)) };
  for (const [name, bytes] of [...binaries, ...editorBinaries]) files[name] = bytes;
  if (options.preview) files[MAP_PREVIEW_ENTRY] = [options.preview, { level: 0 }];
  // The zip's file times come from the map, so packing the same map gives the same bytes
  const updated = Date.parse(doc.meta.updatedAt);
  const mtime = Math.max(Number.isFinite(updated) ? updated : 0, ZIP_EPOCH);
  return zipSync(files, { level: options.level ?? 6, mtime });
}

/** A `.3dtdmap` file back into a document; throws `MapFileError` when it is not one */
export function unpackMapFile(bytes: Uint8Array | ArrayBuffer): UnpackedMap {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let entries: Record<string, Uint8Array>;
  let total = 0;
  let tooBig: string | null = null;
  try {
    // Only the entries a map has, each and all together within the limits, checked before anything is inflated
    entries = unzipSync(data, {
      filter: (f) => {
        if (!knownEntry(f.name)) return false;
        total += f.originalSize;
        if (f.originalSize > MAX_ENTRY_BYTES || total > MAX_FILE_BYTES) {
          tooBig = f.name;
          return false;
        }
        return true;
      },
    });
  } catch {
    throw new MapFileError({ key: 'notZip' });
  }
  if (tooBig) throw new MapFileError({ key: 'tooLarge', v: { size: tooBig } });
  const jsonBytes = entries[MAP_JSON_ENTRY];
  if (!jsonBytes) throw new MapFileError({ key: 'noMapJson' });
  let parsed: unknown;
  try {
    parsed = JSON.parse(strFromU8(jsonBytes));
  } catch (e) {
    throw new MapFileError({ key: 'badJson', v: { detail: (e as Error).message } });
  }
  if (!isRecord(parsed) || parsed['format'] !== MAP_FORMAT) {
    throw new MapFileError({ key: 'notMap' });
  }
  const json = migrateMapJson(parsed);
  const doc = joinDocument(json, entries);
  // The content first, softly (set right, left out, said): a file that opened before a check was added still opens
  const repaired = mapRepairs(doc, true);
  const problems = validateMapDocument(doc);
  if (problems.length) throw new MapFileError({ key: 'broken' }, problems);
  return { doc, preview: entries[MAP_PREVIEW_ENTRY] ?? null, repaired };
}

/**
 * The `meta` of a map file without reading the rest or checking it: what
 * the store needs to move a map (its creation date) even when the map
 * itself no longer passes the check. Null when there is none to read
 */
export function mapFileMeta(bytes: Uint8Array): Partial<MapMeta> | null {
  try {
    const entries = unzipSync(bytes, { filter: (f) => f.name === MAP_JSON_ENTRY && f.originalSize <= MAX_ENTRY_BYTES });
    const parsed: unknown = JSON.parse(strFromU8(entries[MAP_JSON_ENTRY]));
    return isRecord(parsed) && isRecord(parsed['meta']) ? (parsed['meta'] as Partial<MapMeta>) : null;
  } catch {
    return null;
  }
}

/**
 * The file with `meta` changed in its `map.json`, the rest neither read nor
 * checked: what the store needs to move a map that no longer opens (back
 * from the trash under another id). Null when the file has no map.json
 */
export function withMapFileMeta(bytes: Uint8Array, meta: Partial<MapMeta>): Uint8Array | null {
  try {
    let total = 0;
    const entries = unzipSync(bytes, {
      filter: (f) => knownEntry(f.name) && f.originalSize <= MAX_ENTRY_BYTES && (total += f.originalSize) <= MAX_FILE_BYTES,
    });
    const parsed: unknown = JSON.parse(strFromU8(entries[MAP_JSON_ENTRY]));
    if (!isRecord(parsed) || !isRecord(parsed['meta'])) return null;
    const changed = { ...parsed['meta'], ...meta };
    entries[MAP_JSON_ENTRY] = strToU8(JSON.stringify({ ...parsed, meta: changed }));
    const updated = typeof changed['updatedAt'] === 'string' ? Date.parse(changed['updatedAt']) : NaN;
    return zipSync(entries, { level: 6, mtime: Math.max(Number.isFinite(updated) ? updated : 0, ZIP_EPOCH) });
  } catch {
    return null;
  }
}

/** Lift an older `map.json` to `MAP_VERSION`; refuses files from a newer game */
export function migrateMapJson(
  json: Record<string, unknown>,
  migrations: Readonly<Record<number, MapMigration>> = MAP_MIGRATIONS,
  target: number = MAP_VERSION,
): Record<string, unknown> {
  let version = json['version'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new MapFileError({ key: 'noVersion' });
  }
  if (version > target) {
    throw new MapFileError({ key: 'newer', v: { version, max: target } });
  }
  let out = json;
  while (version < target) {
    const step = migrations[version];
    if (!step) throw new MapFileError({ key: 'noMigration', v: { version } });
    out = { ...step(out), version: version + 1 };
    version += 1;
  }
  return out;
}

/** SHA-256 over the map's world content as hex; equal for equal worlds */
export async function contentHash(doc: CustomMapDocument): Promise<string> {
  const bytes = contentBytes(doc);
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The bytes `contentHash` digests: canonical JSON of the world, then the arrays */
export function contentBytes(doc: CustomMapDocument): Uint8Array {
  const { json, binaries } = splitDocument(doc);
  // Neither the file's version nor its format is world content: a new file version keeps the hashes of unchanged maps.
  // Nor are the prefabs the map keeps for its editor, nor the footprints an OSM world keeps for the developer layer
  const { version: _version, format: _format, prefabs: _prefabs, footprints: _footprints, ...rest } = json;
  const world = { ...rest, meta: { id: doc.meta.id } };
  const head = strToU8(canonicalJson(world));
  let size = head.length;
  for (const [, b] of binaries) size += b.length;
  const out = new Uint8Array(size);
  out.set(head, 0);
  let at = head.length;
  for (const [, b] of binaries) {
    out.set(b, at);
    at += b.length;
  }
  return out;
}

/** JSON with object keys sorted, so equal content gives equal text */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(',')}}`;
}

/**
 * Every problem of the document's structure; empty when it is fine. Such a
 * map is neither written nor read; what is only content is set right on
 * reading (map-repair.ts)
 */
export function validateMapDocument(doc: CustomMapDocument): MapProblem[] {
  return mapProblems(doc);
}

/**
 * What a map made by code (the agent, a script) must not have: the
 * problems of its structure and what reading it back would set right or
 * leave out (map-repair.ts). A map read from a file has none of the latter
 */
export function strictMapProblems(doc: CustomMapDocument): MapProblem[] {
  return [...validateMapDocument(doc), ...mapRepairs(doc)];
}

/** Collects the problems with the part and the thing being checked when they were found */
class ProblemList {
  readonly list: MapProblem[] = [];
  part: MapProblemPart = 'meta';
  at: MapProblem['at'] = undefined;

  push(text: MapText): void {
    this.list.push(this.at ? { text, part: this.part, at: this.at } : { text, part: this.part });
  }
}

/** Every problem of the document with where it lies */
export function mapProblems(doc: CustomMapDocument): MapProblem[] {
  const p = new ProblemList();
  checkDocument(doc, p);
  return p.list;
}

function checkDocument(doc: CustomMapDocument, p: ProblemList): void {
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (doc.format !== MAP_FORMAT) p.push({ key: 'isNot', v: { what: 'format', value: MAP_FORMAT } });
  if (doc.version !== MAP_VERSION) p.push({ key: 'isNot', v: { what: `version ${doc.version}`, value: MAP_VERSION } });
  const meta = doc.meta;
  if (!meta || typeof meta.id !== 'string' || !MAP_ID_PATTERN.test(meta.id)) p.push({ key: 'idPattern', v: { what: 'meta.id' } });
  if (!meta || typeof meta.name !== 'string' || !meta.name.trim()) p.push({ key: 'empty', v: { what: 'meta.name' } });
  if (meta) {
    for (const key of ['author', 'description', 'uid'] as const) {
      if (meta[key] !== undefined && typeof meta[key] !== 'string') p.push({ key: 'text', v: { what: `meta.${key}` } });
    }
    if (meta.copyOf !== undefined && (typeof meta.copyOf?.id !== 'string' || typeof meta.copyOf?.hash !== 'string')) p.push({ key: 'idAndHash', v: { what: 'meta.copyOf' } });
    if (meta.generated !== undefined && typeof meta.generated !== 'boolean') p.push({ key: 'bool', v: { what: 'meta.generated' } });
    for (const key of ['createdAt', 'updatedAt'] as const) {
      if (typeof meta[key] !== 'string' || !Number.isFinite(Date.parse(meta[key]))) p.push({ key: 'date', v: { what: `meta.${key}` } });
    }
  }

  p.part = 'terrain';
  const t = doc.terrain;
  if (!t || !t.grid) {
    p.push({ key: 'missing', v: { what: 'terrain' } });
    return;
  }
  const g = t.grid;
  if (!Number.isInteger(g.columns) || !Number.isInteger(g.rows) || g.columns < 2 || g.rows < 2) {
    p.push({ key: 'gridTooSmall' });
  } else if (g.columns > MAX_GRID_SIDE || g.rows > MAX_GRID_SIDE) {
    p.push({ key: 'gridTooLarge', v: { max: MAX_GRID_SIDE } });
    return;
  } else if (!isTyped(g.heights, 'Float32Array') || g.heights.length !== g.columns * g.rows) {
    p.push({ key: 'heightCount', v: { have: g.heights?.length ?? 0, need: g.columns * g.rows } });
  } else {
    for (let k = 0; k < g.heights.length; k++) {
      if (!Number.isFinite(g.heights[k])) {
        p.push({ key: 'notNumber', v: { what: `terrain.grid.heights[${k}]` } });
        break;
      }
    }
  }
  if (!finite(g.cellSize) || g.cellSize <= 0) p.push({ key: 'aboveZero', v: { what: 'terrain.grid.cellSize' } });
  else {
    if (Math.abs(t.width - (g.columns - 1) * g.cellSize) > 1e-3) p.push({ key: 'notGrid', v: { what: 'terrain.width' } });
    if (Math.abs(t.depth - (g.rows - 1) * g.cellSize) > 1e-3) p.push({ key: 'notGrid', v: { what: 'terrain.depth' } });
  }
  if (!Array.isArray(t.layers) || t.layers.length < 1 || t.layers.length > MAX_GROUND_LAYERS) {
    p.push({ key: 'groundLayers', v: { max: MAX_GROUND_LAYERS } });
  } else if (t.layers.some((l) => typeof l.material !== 'string' || !l.material)) {
    p.push({ key: 'layerMaterial' });
  }
  const s = t.splat;
  const texels = (s?.resolution ?? 0) ** 2 * 4;
  if (!s || !Number.isInteger(s.resolution) || s.resolution < 1) p.push({ key: 'missing', v: { what: 'terrain.splat.resolution' } });
  else if (s.resolution > MAX_SPLAT_RESOLUTION) p.push({ key: 'above', v: { what: 'terrain.splat.resolution', max: MAX_SPLAT_RESOLUTION } });
  else {
    const count = splatMapCount(t.layers?.length ?? 0);
    if (!Array.isArray(s.maps) || s.maps.length !== count || s.maps.some((m) => !isTyped(m, 'Uint8Array') || m.length !== texels)) {
      p.push({ key: 'splatMaps', v: { count, size: s.resolution } });
    }
  }
  if (t.water) {
    if (!finite(t.water.level)) p.push({ key: 'notNumber', v: { what: 'terrain.water.level' } });
    if (!isTyped(t.water.mask, 'Uint8Array') || t.water.mask.length !== g.columns * g.rows) p.push({ key: 'notGrid', v: { what: 'terrain.water.mask' } });
  }
  if (t.waterBodies !== undefined && (!Array.isArray(t.waterBodies) || t.waterBodies.length > MAX_WATER_BODIES)) {
    p.push({ key: 'listAtMost', v: { what: 'terrain.waterBodies', max: MAX_WATER_BODIES } });
    return;
  }
  if (t.rivers !== undefined && !Array.isArray(t.rivers)) {
    p.push({ key: 'list', v: { what: 'terrain.rivers' } });
    return;
  }
  if (t.craters !== undefined && !Array.isArray(t.craters)) {
    p.push({ key: 'list', v: { what: 'terrain.craters' } });
    return;
  }
  for (const [k, body] of (t.waterBodies ?? []).entries()) {
    const what = { kind: 'waterBody' as const, id: k + 1 };
    if (!body || typeof body !== 'object') {
      p.push({ key: 'notObject', v: { what } });
      continue;
    }
    if (!finite(body.level)) p.push({ key: 'notNumber', v: { what: 'level' }, of: what });
    if (!isTyped(body.mask, 'Uint8Array') || body.mask.length !== g.columns * g.rows) p.push({ key: 'notGrid', v: { what: 'mask' }, of: what });
  }
  if (!finite(t.cliffAngle)) p.push({ key: 'notNumber', v: { what: 'terrain.cliffAngle' } });

  p.part = 'objects';
  if (!Array.isArray(doc.objects)) {
    p.push({ key: 'list', v: { what: 'objects' } });
    return;
  }
  p.part = 'paths';
  if (!doc.paths || !Array.isArray(doc.paths.nodes) || !Array.isArray(doc.paths.edges)) {
    p.push({ key: 'nodesAndEdges', v: { what: 'paths' } });
    return;
  }
  p.part = 'spawns';
  if (!Array.isArray(doc.spawns)) {
    p.push({ key: 'list', v: { what: 'spawns' } });
    return;
  }
  p.part = 'paths';
  const nodes = new Set<string>();
  for (const n of doc.paths.nodes) {
    p.at = undefined;
    if (!n || typeof n !== 'object') {
      p.push({ key: 'notObject', v: { what: { kind: 'node' } } });
      continue;
    }
    if (n.id) p.at = { kind: 'node', id: n.id };
    if (!n.id || nodes.has(n.id)) p.push({ key: 'idTwice', v: { kind: 'node', id: String(n.id) } });
    nodes.add(n.id);
    if (!finite(n.x) || !finite(n.y)) p.push({ key: 'noPosition', v: { what: { kind: 'node', id: n.id } } });
  }
  const edges = new Set<string>();
  for (const e of doc.paths.edges) {
    p.at = undefined;
    if (!e || typeof e !== 'object') {
      p.push({ key: 'notObject', v: { what: { kind: 'edge' } } });
      continue;
    }
    if (e.id) p.at = { kind: 'edge', id: e.id };
    const what = { kind: 'edge' as const, id: e.id };
    if (!e.id || edges.has(e.id)) p.push({ key: 'idTwice', v: { kind: 'edge', id: String(e.id) } });
    edges.add(e.id);
    if (!nodes.has(e.a) || !nodes.has(e.b)) p.push({ key: 'noNode', v: { what } });
    if (e.a === e.b) p.push({ key: 'loop', v: { what } });
    if (!finite(e.width) || e.width <= 0) p.push({ key: 'noWidth', v: { what } });
    if (e.via !== undefined && (!Array.isArray(e.via) || e.via.some((v) => !finite(v?.x) || !finite(v?.y)))) p.push({ key: 'badCurve', v: { what } });
    if ((e.tunnel !== undefined && typeof e.tunnel !== 'boolean') || (e.covered !== undefined && typeof e.covered !== 'boolean')) p.push({ key: 'badTunnel', v: { what } });
    if ((e.street !== undefined && typeof e.street !== 'string') || (e.surface !== undefined && typeof e.surface !== 'string')) p.push({ key: 'badStreet', v: { what } });
    if (e.sidewalk !== undefined && !(typeof e.sidewalk === 'number' && e.sidewalk >= 0 && e.sidewalk <= 8)) p.push({ key: 'badSidewalk', v: { what } });
  }
  p.part = 'spawns';
  for (const sp of doc.spawns) {
    p.at = sp?.id ? { kind: 'spawn', id: sp.id } : undefined;
    if (!sp || !finite(sp.x) || !finite(sp.y)) p.push({ key: 'noPosition', v: { what: { kind: 'spawn', id: sp?.id } } });
  }
  p.part = 'hq';
  p.at = { kind: 'hq' };
  if (!doc.hq || !finite(doc.hq.x) || !finite(doc.hq.y)) p.push({ key: 'noPosition', v: { what: { kind: 'hq' } } });
  p.at = undefined;
  p.part = 'gameplay';
  const gp = doc.gameplay;
  if (gp !== undefined) {
    if (gp === null || typeof gp !== 'object') p.push({ key: 'notObject', v: { what: 'gameplay' } });
    else {
      if (gp.startCredits !== undefined && (!finite(gp.startCredits) || gp.startCredits < 0)) p.push({ key: 'zeroOrMore', v: { what: 'gameplay.startCredits' } });
      if (gp.hqHealth !== undefined && (!finite(gp.hqHealth) || gp.hqHealth <= 0)) p.push({ key: 'aboveZero', v: { what: 'gameplay.hqHealth' } });
      if (gp.towers !== undefined && (!Array.isArray(gp.towers) || gp.towers.some((t) => typeof t !== 'string'))) {
        p.push({ key: 'towerIds', v: { what: 'gameplay.towers' } });
      }
      if (gp.destructible !== undefined && typeof gp.destructible !== 'boolean') p.push({ key: 'bool', v: { what: 'gameplay.destructible' } });
      if (gp.difficulty !== undefined && (!finite(gp.difficulty) || gp.difficulty < MAP_DIFFICULTY.min || gp.difficulty > MAP_DIFFICULTY.max)) {
        p.push({ key: 'range', v: { what: 'gameplay.difficulty', min: MAP_DIFFICULTY.min, max: MAP_DIFFICULTY.max, unit: 'percent' } });
      }
      const lanes = gp.lanes;
      if (lanes !== undefined) {
        const count = (v: unknown) => v === undefined || (Number.isInteger(v) && (v as number) >= 1);
        if (lanes === null || typeof lanes !== 'object') p.push({ key: 'notObject', v: { what: 'gameplay.lanes' } });
        else {
          if (!count(lanes.min)) p.push({ key: 'wholeFromOne', v: { what: 'gameplay.lanes.min' } });
          if (!count(lanes.max)) p.push({ key: 'wholeFromOne', v: { what: 'gameplay.lanes.max' } });
          if (lanes.min !== undefined && lanes.max !== undefined && lanes.min > lanes.max) p.push({ key: 'lanesMinMax' });
        }
      }
      const w = gp.waves;
      if (w?.kind === 'table') {
        const table = w.table;
        if (!table || !Array.isArray(table.waves) || !table.waves.length) p.push({ key: 'waveListEmpty' });
        else {
          table.waves.forEach((row, k) => {
            if (row.wave !== k + 1) p.push({ key: 'waveRow', v: { row: k + 1, wave: row.wave } });
            if (!row.enemies || !Object.keys(row.enemies).length) p.push({ key: 'waveNoEnemies', v: { wave: row.wave } });
            if (!finite(row.hpMult) || row.hpMult <= 0) p.push({ key: 'waveNoHp', v: { wave: row.wave } });
            if (!finite(row.spawnDelay) || row.spawnDelay < 0) p.push({ key: 'waveNoDelay', v: { wave: row.wave } });
          });
        }
        if (!table?.cycle || !finite(table.cycle.fromWave) || !finite(table.cycle.hpGrowth) || table.cycle.hpGrowth <= 0) {
          p.push({ key: 'waveRepeat' });
        }
      }
    }
  }
}

/**
 * The document as JSON with binary refs, and the binaries by zip path: the
 * world's, and those outside the content hash (the editor's prefabs' arrays,
 * an OSM world's footprints)
 */
function splitDocument(doc: CustomMapDocument): { json: Record<string, unknown>; binaries: [string, Uint8Array][]; editorBinaries: [string, Uint8Array][] } {
  const t = doc.terrain;
  const binaries: [string, Uint8Array][] = [
    [BIN.heights, floatBytes(t.grid.heights)],
    [BIN.splat0, t.splat.maps[0]],
    [BIN.splat1, t.splat.maps[1]],
  ];
  // The third splat map only when the map has one: files and hashes of maps with up to 8 layers stay as they were
  if (t.splat.maps[2]) binaries.push([BIN.splat2, t.splat.maps[2]]);
  if (t.water) binaries.push([BIN.water, t.water.mask]);
  const bodies = t.waterBodies ?? [];
  bodies.forEach((body, k) => binaries.push([waterBodyPath(k), body.mask]));
  const ref = (name: string): BinaryRef => ({ $bin: name });
  const terrain = {
    ...t,
    grid: { ...t.grid, heights: ref(BIN.heights) },
    splat: { ...t.splat, maps: [BIN.splat0, BIN.splat1, BIN.splat2].slice(0, t.splat.maps.length).map(ref) },
    water: t.water ? { ...t.water, mask: ref(BIN.water) } : null,
    ...(bodies.length ? { waterBodies: bodies.map((body, k) => ({ ...body, mask: ref(waterBodyPath(k)) })) } : {}),
  };
  const editorBinaries: [string, Uint8Array][] = [];
  // A prefab whose arrays do not hold is not written: reading would leave it out all the same (map-repair.ts)
  const kept = Array.isArray(doc.prefabs) ? doc.prefabs.filter((p, k) => k < MAX_MAP_PREFABS && !prefabProblems(p, k).length) : undefined;
  const prefabs = kept?.map((p, k) => {
    const st = p.stamp;
    editorBinaries.push([prefabPath(k, 'heights.f32'), floatBytes(st.heights)], [prefabPath(k, 'paint.u8'), st.paint]);
    if (st.water) editorBinaries.push([prefabPath(k, 'water.u8'), st.water.mask]);
    const stamp = {
      ...st,
      heights: ref(prefabPath(k, 'heights.f32')),
      paint: ref(prefabPath(k, 'paint.u8')),
      water: st.water ? { ...st.water, mask: ref(prefabPath(k, 'water.u8')) } : null,
    };
    return { ...p, stamp };
  });
  // Footprints of another format or whose rings do not hold are not written: reading would leave them out all the same
  const rings = doc.footprints?.format === FOOTPRINTS_FORMAT ? doc.footprints.rings : undefined;
  const footprints = rings && isTyped(rings, 'Int16Array') && rings.length && footprintsWellFormed(rings) ? ref(FOOTPRINTS_ENTRY) : undefined;
  if (footprints) editorBinaries.push([FOOTPRINTS_ENTRY, int16Bytes(rings!)]);
  // No key at all without prefabs or footprints: files of maps without them stay as they were
  const json = { ...doc, terrain, prefabs: prefabs?.length ? prefabs : undefined, footprints: footprints && { format: FOOTPRINTS_FORMAT, rings: footprints } };
  return { json: json as unknown as Record<string, unknown>, binaries, editorBinaries };
}

function joinDocument(json: Record<string, unknown>, entries: Record<string, Uint8Array>): CustomMapDocument {
  const doc = json as unknown as CustomMapDocument;
  const t = doc.terrain as unknown as Record<string, unknown> | undefined;
  if (!isRecord(t) || !isRecord(t['grid']) || !isRecord(t['splat'])) throw new MapFileError({ key: 'noTerrain' });
  const grid = t['grid'] as Record<string, unknown>;
  const splat = t['splat'] as Record<string, unknown>;
  const bin = (value: unknown, part: MapFilePart, n = 0): Uint8Array => {
    const name = isRecord(value) && typeof value['$bin'] === 'string' ? value['$bin'] : null;
    const bytes = name ? entries[name] : undefined;
    if (!bytes) throw new MapFileError({ key: 'misses', v: { part, n, entry: name } });
    return bytes;
  };
  const heights = bin(grid['heights'], 'heights');
  if (heights.length % 4) throw new MapFileError({ key: 'heightsCut', v: { prefab: null } });
  grid['heights'] = bytesToFloat(heights);
  const maps = splat['maps'];
  if (!Array.isArray(maps) || maps.length < 2 || maps.length > 3) throw new MapFileError({ key: 'splatCount' });
  splat['maps'] = maps.map((m, k) => bin(m, 'splat', k + 1));
  const water = t['water'];
  if (isRecord(water)) water['mask'] = bin(water['mask'], 'water');
  else t['water'] = null;
  const bodies = t['waterBodies'];
  if (Array.isArray(bodies)) {
    bodies.forEach((body, k) => {
      if (!isRecord(body)) throw new MapFileError({ key: 'waterBody', v: { n: k + 1 } });
      body['mask'] = bin(body['mask'], 'waterBody', k + 1);
    });
  } else {
    delete t['waterBodies'];
  }
  const prefabs = (doc as unknown as Record<string, unknown>)['prefabs'];
  if (Array.isArray(prefabs)) {
    // The editor's prefabs are no part of the world: one whose arrays are missing becomes a gap that reading leaves out
    prefabs.forEach((p, k) => {
      const st = isRecord(p) && isRecord(p['stamp']) ? p['stamp'] : null;
      try {
        if (!st) throw new MapFileError({ key: 'prefab', v: { n: k + 1 } });
        const heights = bin(st['heights'], 'prefabHeights', k + 1);
        if (heights.length % 4) throw new MapFileError({ key: 'heightsCut', v: { prefab: k + 1 } });
        st['heights'] = bytesToFloat(heights);
        st['paint'] = bin(st['paint'], 'prefabPaint', k + 1);
        const water = st['water'];
        if (isRecord(water)) water['mask'] = bin(water['mask'], 'prefabWater', k + 1);
        else st['water'] = null;
      } catch {
        prefabs[k] = null;
      }
    });
  } else {
    delete doc.prefabs;
  }
  // The footprints are no part of the world either: missing, cut or of another format (E290's first had none), they are left out
  const footprints = (doc as unknown as Record<string, unknown>)['footprints'];
  const ringsRef = isRecord(footprints) && footprints['format'] === FOOTPRINTS_FORMAT ? footprints['rings'] : undefined;
  const ringsName = isRecord(ringsRef) && typeof ringsRef['$bin'] === 'string' ? ringsRef['$bin'] : null;
  const ringBytes = ringsName ? entries[ringsName] : undefined;
  const rings = ringBytes && ringBytes.length % 2 === 0 ? bytesToInt16(ringBytes) : null;
  if (rings && rings.length && footprintsWellFormed(rings)) doc.footprints = { format: FOOTPRINTS_FORMAT, rings };
  else delete doc.footprints;
  doc.objects ??= [];
  doc.paths ??= { nodes: [], edges: [] };
  doc.spawns ??= [];
  return doc;
}

function floatBytes(a: Float32Array): Uint8Array {
  if (LITTLE_ENDIAN) return new Uint8Array(a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength));
  const out = new Uint8Array(a.length * 4);
  const view = new DataView(out.buffer);
  for (let k = 0; k < a.length; k++) view.setFloat32(k * 4, a[k], true);
  return out;
}

function int16Bytes(a: Int16Array): Uint8Array {
  if (LITTLE_ENDIAN) return new Uint8Array(a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength));
  const out = new Uint8Array(a.length * 2);
  const view = new DataView(out.buffer);
  for (let k = 0; k < a.length; k++) view.setInt16(k * 2, a[k], true);
  return out;
}

function bytesToInt16(b: Uint8Array): Int16Array {
  const n = b.length / 2;
  if (LITTLE_ENDIAN) return new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const out = new Int16Array(n);
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let k = 0; k < n; k++) out[k] = view.getInt16(k * 2, true);
  return out;
}

function bytesToFloat(b: Uint8Array): Float32Array {
  const n = b.length / 4;
  if (LITTLE_ENDIAN) return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const out = new Float32Array(n);
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let k = 0; k < n; k++) out[k] = view.getFloat32(k * 4, true);
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A deep copy; typed arrays stay typed */
export function cloneMapDocument(doc: CustomMapDocument): CustomMapDocument {
  return structuredClone(doc);
}
