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
 * Reading checks the file (`validateMapDocument`) and lifts older versions
 * through `MAP_MIGRATIONS` first; a broken file fails with `MapFileError`
 * and a message that says what is wrong.
 */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { MAP_FORMAT, MAP_VERSION, type CustomMapDocument } from './map-document';
import { MAP_ID_PATTERN } from './map-create';

export const MAP_FILE_EXTENSION = '.3dtdmap';
export const MAP_JSON_ENTRY = 'map.json';
export const MAP_PREVIEW_ENTRY = 'preview.png';
/** Most ground layers a map can paint (two RGBA splat maps) */
export const MAX_GROUND_LAYERS = 8;

export class MapFileError extends Error {
  constructor(
    message: string,
    readonly problems: string[] = [message],
  ) {
    super(message);
    this.name = 'MapFileError';
  }
}

/** A migration lifts the parsed `map.json` of version n to n + 1 */
export type MapMigration = (json: Record<string, unknown>) => Record<string, unknown>;

/** Keyed by the version they read */
export const MAP_MIGRATIONS: Readonly<Record<number, MapMigration>> = {
  // 1 to 2: version 2 adds the optional gameplay rules; a version 1 map has none
  1: (json) => json,
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
  water: 'terrain/water-mask.u8',
} as const;

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
}

/** The document as a `.3dtdmap` file */
export function packMapFile(doc: CustomMapDocument, options: PackOptions = {}): Uint8Array {
  const problems = validateMapDocument(doc);
  if (problems.length) throw new MapFileError(`The map is not valid: ${problems[0]}`, problems);
  const { json, binaries } = splitDocument(doc);
  const files: Zippable = { [MAP_JSON_ENTRY]: strToU8(JSON.stringify(json)) };
  for (const [name, bytes] of binaries) files[name] = bytes;
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
  try {
    entries = unzipSync(data);
  } catch {
    throw new MapFileError('This is not a map file (no zip archive).');
  }
  const jsonBytes = entries[MAP_JSON_ENTRY];
  if (!jsonBytes) throw new MapFileError('This is not a map file (map.json is missing).');
  let parsed: unknown;
  try {
    parsed = JSON.parse(strFromU8(jsonBytes));
  } catch (e) {
    throw new MapFileError(`map.json is not valid JSON: ${(e as Error).message}`);
  }
  if (!isRecord(parsed) || parsed['format'] !== MAP_FORMAT) {
    throw new MapFileError('This is not a 3DTD map (format is missing or wrong).');
  }
  const json = migrateMapJson(parsed);
  const doc = joinDocument(json, entries);
  const problems = validateMapDocument(doc);
  if (problems.length) throw new MapFileError(`The map is broken: ${problems[0]}`, problems);
  return { doc, preview: entries[MAP_PREVIEW_ENTRY] ?? null };
}

/** Lift an older `map.json` to `MAP_VERSION`; refuses files from a newer game */
export function migrateMapJson(
  json: Record<string, unknown>,
  migrations: Readonly<Record<number, MapMigration>> = MAP_MIGRATIONS,
  target: number = MAP_VERSION,
): Record<string, unknown> {
  let version = json['version'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new MapFileError('The map has no valid version.');
  }
  if (version > target) {
    throw new MapFileError(`The map is version ${version}, this game reads up to ${target}. Update the game.`);
  }
  let out = json;
  while (version < target) {
    const step = migrations[version];
    if (!step) throw new MapFileError(`No way to read map version ${version}.`);
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
  const world = { ...json, meta: { id: doc.meta.id } };
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

/** Every problem of the document, in words; empty when it is fine */
export function validateMapDocument(doc: CustomMapDocument): string[] {
  const p: string[] = [];
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (doc.format !== MAP_FORMAT) p.push('format is not 3dtd-map');
  if (doc.version !== MAP_VERSION) p.push(`version ${doc.version} is not ${MAP_VERSION}`);
  const meta = doc.meta;
  if (!meta || typeof meta.id !== 'string' || !MAP_ID_PATTERN.test(meta.id)) {
    p.push('meta.id must be lowercase letters, digits and dashes');
  }
  if (!meta || typeof meta.name !== 'string' || !meta.name.trim()) p.push('meta.name is empty');

  const t = doc.terrain;
  if (!t || !t.grid) {
    p.push('terrain is missing');
    return p;
  }
  const g = t.grid;
  if (!Number.isInteger(g.columns) || !Number.isInteger(g.rows) || g.columns < 2 || g.rows < 2) {
    p.push('terrain grid needs at least 2 x 2 samples');
  } else if (!isTyped(g.heights, 'Float32Array') || g.heights.length !== g.columns * g.rows) {
    p.push(`terrain heights hold ${g.heights?.length ?? 0} values, the grid needs ${g.columns * g.rows}`);
  } else {
    for (let k = 0; k < g.heights.length; k++) {
      if (!Number.isFinite(g.heights[k])) {
        p.push(`terrain height ${k} is not a number`);
        break;
      }
    }
  }
  if (!finite(g.cellSize) || g.cellSize <= 0) p.push('terrain cellSize must be above 0');
  else {
    if (Math.abs(t.width - (g.columns - 1) * g.cellSize) > 1e-3) p.push('terrain width does not match the grid');
    if (Math.abs(t.depth - (g.rows - 1) * g.cellSize) > 1e-3) p.push('terrain depth does not match the grid');
  }
  if (!Array.isArray(t.layers) || t.layers.length < 1 || t.layers.length > MAX_GROUND_LAYERS) {
    p.push(`terrain needs 1 to ${MAX_GROUND_LAYERS} ground layers`);
  } else if (t.layers.some((l) => typeof l.material !== 'string' || !l.material)) {
    p.push('a ground layer has no material');
  }
  const s = t.splat;
  const texels = (s?.resolution ?? 0) ** 2 * 4;
  if (!s || !Number.isInteger(s.resolution) || s.resolution < 1) p.push('splat resolution is missing');
  else if (!s.maps || s.maps.length !== 2 || s.maps.some((m) => !isTyped(m, 'Uint8Array') || m.length !== texels)) {
    p.push(`splat needs two maps of ${s.resolution} x ${s.resolution} RGBA`);
  }
  if (t.water) {
    if (!finite(t.water.level)) p.push('water level is not a number');
    if (!isTyped(t.water.mask, 'Uint8Array') || t.water.mask.length !== g.columns * g.rows) {
      p.push('water mask does not match the grid');
    }
  }
  for (const [k, body] of (t.waterBodies ?? []).entries()) {
    if (!finite(body.level)) p.push(`water body ${k + 1}: level is not a number`);
    if (!isTyped(body.mask, 'Uint8Array') || body.mask.length !== g.columns * g.rows) {
      p.push(`water body ${k + 1}: mask does not match the grid`);
    }
  }
  for (const body of [t.water, ...(t.waterBodies ?? [])]) {
    if (body?.kind && !['water', 'sea', 'swamp', 'lava', 'ice'].includes(body.kind)) {
      p.push(`water kind ${body.kind} is unknown`);
    }
  }
  for (const river of t.rivers ?? []) {
    if (!river.id) p.push('a river has no id');
    if (!['water', 'lava'].includes(river.kind)) p.push(`river ${river.id}: kind ${river.kind} is unknown`);
    if (!Array.isArray(river.points) || river.points.length < 2) p.push(`river ${river.id} needs two points`);
    else if (river.points.some((q) => ![q.x, q.y, q.width, q.height].every(finite) || q.width <= 0)) {
      p.push(`river ${river.id} has a bad point`);
    }
  }
  if (!finite(t.cliffAngle)) p.push('cliffAngle is not a number');

  const ids = new Set<string>();
  for (const o of doc.objects ?? []) {
    if (!o.id || ids.has(o.id)) p.push(`object id "${o.id}" is missing or twice`);
    ids.add(o.id);
    if (!o.asset) p.push(`object ${o.id} has no asset`);
    if (![o.x, o.y, o.z, o.rotation, o.scale].every(finite) || o.scale <= 0) p.push(`object ${o.id} has a bad placement`);
    if (o.group !== undefined && typeof o.group !== 'string') p.push(`object ${o.id} has a bad group`);
  }
  const nodes = new Set<string>();
  for (const n of doc.paths?.nodes ?? []) {
    if (!n.id || nodes.has(n.id)) p.push(`path node id "${n.id}" is missing or twice`);
    nodes.add(n.id);
    if (!finite(n.x) || !finite(n.y)) p.push(`path node ${n.id} has no position`);
  }
  const edges = new Set<string>();
  for (const e of doc.paths?.edges ?? []) {
    if (!e.id || edges.has(e.id)) p.push(`path edge id "${e.id}" is missing or twice`);
    edges.add(e.id);
    if (!nodes.has(e.a) || !nodes.has(e.b)) p.push(`path edge ${e.id} names a node that does not exist`);
    if (e.a === e.b) p.push(`path edge ${e.id} starts and ends at one node`);
    if (!finite(e.width) || e.width <= 0) p.push(`path edge ${e.id} has no width`);
    if (e.via && e.via.some((v) => !finite(v.x) || !finite(v.y))) p.push(`path edge ${e.id} has a bad curve point`);
  }
  for (const sp of doc.spawns ?? []) {
    if (!finite(sp.x) || !finite(sp.y)) p.push(`spawn ${sp.id} has no position`);
  }
  if (!doc.hq || !finite(doc.hq.x) || !finite(doc.hq.y)) p.push('the HQ has no position');
  const gp = doc.gameplay;
  if (gp !== undefined) {
    if (gp === null || typeof gp !== 'object') p.push('gameplay is not an object');
    else {
      if (gp.startCredits !== undefined && (!finite(gp.startCredits) || gp.startCredits < 0)) p.push('gameplay.startCredits must be 0 or more');
      if (gp.hqHealth !== undefined && (!finite(gp.hqHealth) || gp.hqHealth <= 0)) p.push('gameplay.hqHealth must be above 0');
      if (gp.towers !== undefined && (!Array.isArray(gp.towers) || gp.towers.some((t) => typeof t !== 'string'))) {
        p.push('gameplay.towers must be a list of tower ids');
      }
      const w = gp.waves;
      if (w !== undefined && w.kind !== 'budget' && w.kind !== 'table') p.push('gameplay.waves.kind must be budget or table');
      if (w?.kind === 'table') {
        const table = w.table;
        if (!table || !Array.isArray(table.waves) || !table.waves.length) p.push('the wave list is empty');
        else {
          table.waves.forEach((row, k) => {
            if (row.wave !== k + 1) p.push(`wave list row ${k + 1} is numbered ${row.wave}`);
            if (!row.enemies || !Object.keys(row.enemies).length) p.push(`wave ${row.wave} has no enemies`);
            if (!finite(row.hpMult) || row.hpMult <= 0) p.push(`wave ${row.wave} has no HP factor`);
            if (!finite(row.spawnDelay) || row.spawnDelay < 0) p.push(`wave ${row.wave} has no spawn delay`);
          });
        }
        if (!table?.cycle || !finite(table.cycle.fromWave) || !finite(table.cycle.hpGrowth) || table.cycle.hpGrowth <= 0) {
          p.push('the wave list has no valid repeat rule');
        }
      }
    }
  }
  const env = doc.environment;
  if (!env || !['day', 'dusk', 'night', 'overcast'].includes(env.sky)) p.push('environment sky is unknown');
  return p;
}

/** The document as JSON with binary refs, and the binaries by zip path */
function splitDocument(doc: CustomMapDocument): { json: Record<string, unknown>; binaries: [string, Uint8Array][] } {
  const t = doc.terrain;
  const binaries: [string, Uint8Array][] = [
    [BIN.heights, floatBytes(t.grid.heights)],
    [BIN.splat0, t.splat.maps[0]],
    [BIN.splat1, t.splat.maps[1]],
  ];
  if (t.water) binaries.push([BIN.water, t.water.mask]);
  const bodies = t.waterBodies ?? [];
  bodies.forEach((body, k) => binaries.push([waterBodyPath(k), body.mask]));
  const ref = (name: string): BinaryRef => ({ $bin: name });
  const terrain = {
    ...t,
    grid: { ...t.grid, heights: ref(BIN.heights) },
    splat: { ...t.splat, maps: [ref(BIN.splat0), ref(BIN.splat1)] },
    water: t.water ? { ...t.water, mask: ref(BIN.water) } : null,
    ...(bodies.length ? { waterBodies: bodies.map((body, k) => ({ ...body, mask: ref(waterBodyPath(k)) })) } : {}),
  };
  return { json: { ...doc, terrain } as unknown as Record<string, unknown>, binaries };
}

function joinDocument(json: Record<string, unknown>, entries: Record<string, Uint8Array>): CustomMapDocument {
  const doc = json as unknown as CustomMapDocument;
  const t = doc.terrain as unknown as Record<string, unknown> | undefined;
  if (!isRecord(t) || !isRecord(t['grid']) || !isRecord(t['splat'])) throw new MapFileError('The map has no terrain.');
  const grid = t['grid'] as Record<string, unknown>;
  const splat = t['splat'] as Record<string, unknown>;
  const bin = (value: unknown, what: string): Uint8Array => {
    const name = isRecord(value) && typeof value['$bin'] === 'string' ? value['$bin'] : null;
    const bytes = name ? entries[name] : undefined;
    if (!bytes) throw new MapFileError(`The map file misses ${what}${name ? ` (${name})` : ''}.`);
    return bytes;
  };
  const heights = bin(grid['heights'], 'the terrain heights');
  if (heights.length % 4) throw new MapFileError('The terrain heights are cut off.');
  grid['heights'] = bytesToFloat(heights);
  const maps = splat['maps'];
  if (!Array.isArray(maps) || maps.length !== 2) throw new MapFileError('The map needs two splat maps.');
  splat['maps'] = [bin(maps[0], 'splat map 1'), bin(maps[1], 'splat map 2')];
  const water = t['water'];
  if (isRecord(water)) water['mask'] = bin(water['mask'], 'the water mask');
  else t['water'] = null;
  const bodies = t['waterBodies'];
  if (Array.isArray(bodies)) {
    bodies.forEach((body, k) => {
      if (!isRecord(body)) throw new MapFileError(`Water body ${k + 1} is not an object.`);
      body['mask'] = bin(body['mask'], `the mask of water body ${k + 1}`);
    });
  } else {
    delete t['waterBodies'];
  }
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

function bytesToFloat(b: Uint8Array): Float32Array {
  const n = b.length / 4;
  if (LITTLE_ENDIAN) return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const out = new Float32Array(n);
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let k = 0; k < n; k++) out[k] = view.getFloat32(k * 4, true);
  return out;
}

/** Typed array check that holds across realms (structuredClone in a test DOM, workers) */
function isTyped(v: unknown, kind: 'Float32Array' | 'Uint8Array'): boolean {
  return Object.prototype.toString.call(v) === `[object ${kind}]`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A deep copy; typed arrays stay typed */
export function cloneMapDocument(doc: CustomMapDocument): CustomMapDocument {
  return structuredClone(doc);
}
