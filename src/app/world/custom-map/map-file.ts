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
import { VACANT_LANES } from './lane-choice';
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { MAP_DIFFICULTY, MAP_FORMAT, MAP_VERSION, MAX_GROUND_LAYERS, splatMapCount, type CustomMapDocument } from './map-document';
import { MAP_ID_PATTERN } from './map-create';
import { lifeProblems } from './map-life';

export const MAP_FILE_EXTENSION = '.3dtdmap';
export const MAP_JSON_ENTRY = 'map.json';
export const MAP_PREVIEW_ENTRY = 'preview.png';

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
  // 2 to 3: version 3 may carry a third splat map (layers 9 to 12); a version 2 map has two and at most 8 layers
  2: (json) => json,
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
    (Object.values(BIN) as string[]).includes(name) ||
    /^terrain\/water-([1-9]\d?)-mask\.u8$/.test(name)
  );
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
    throw new MapFileError('This is not a map file (no zip archive).');
  }
  if (tooBig) throw new MapFileError(`The map file is too large to read (${tooBig}).`);
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
  // Neither the file's version nor its format is world content: a new file version keeps the hashes of unchanged maps
  const { version: _version, format: _format, ...rest } = json;
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
  if (meta) {
    for (const key of ['author', 'description', 'uid'] as const) {
      if (meta[key] !== undefined && typeof meta[key] !== 'string') p.push(`meta.${key} must be text`);
    }
    if (meta.copyOf !== undefined && (typeof meta.copyOf?.id !== 'string' || typeof meta.copyOf?.hash !== 'string')) p.push('meta.copyOf must name an id and a hash');
    for (const key of ['createdAt', 'updatedAt'] as const) {
      if (typeof meta[key] !== 'string' || !Number.isFinite(Date.parse(meta[key]))) p.push(`meta.${key} must be a date`);
    }
  }

  const t = doc.terrain;
  if (!t || !t.grid) {
    p.push('terrain is missing');
    return p;
  }
  const g = t.grid;
  if (!Number.isInteger(g.columns) || !Number.isInteger(g.rows) || g.columns < 2 || g.rows < 2) {
    p.push('terrain grid needs at least 2 x 2 samples');
  } else if (g.columns > MAX_GRID_SIDE || g.rows > MAX_GRID_SIDE) {
    p.push(`terrain grid has more than ${MAX_GRID_SIDE} samples on a side`);
    return p;
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
  else if (s.resolution > MAX_SPLAT_RESOLUTION) p.push(`splat resolution is above ${MAX_SPLAT_RESOLUTION}`);
  else {
    const count = splatMapCount(t.layers?.length ?? 0);
    if (!Array.isArray(s.maps) || s.maps.length !== count || s.maps.some((m) => !isTyped(m, 'Uint8Array') || m.length !== texels)) {
      p.push(`splat needs ${count === 3 ? 'three' : 'two'} maps of ${s.resolution} x ${s.resolution} RGBA`);
    }
  }
  if (t.water) {
    if (!finite(t.water.level)) p.push('water level is not a number');
    if (!isTyped(t.water.mask, 'Uint8Array') || t.water.mask.length !== g.columns * g.rows) {
      p.push('water mask does not match the grid');
    }
  }
  if (t.waterBodies !== undefined && (!Array.isArray(t.waterBodies) || t.waterBodies.length > MAX_WATER_BODIES)) {
    p.push(`waterBodies must be a list of at most ${MAX_WATER_BODIES}`);
    return p;
  }
  if (t.rivers !== undefined && !Array.isArray(t.rivers)) {
    p.push('rivers must be a list');
    return p;
  }
  for (const [k, body] of (t.waterBodies ?? []).entries()) {
    if (!body || typeof body !== 'object') {
      p.push(`water body ${k + 1} is not an object`);
      continue;
    }
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
    if (!river || typeof river !== 'object') {
      p.push('a river is not an object');
      continue;
    }
    if (!river.id) p.push('a river has no id');
    if (!['water', 'lava'].includes(river.kind)) p.push(`river ${river.id}: kind ${river.kind} is unknown`);
    if (!Array.isArray(river.points) || river.points.length < 2) p.push(`river ${river.id} needs two points`);
    else if (river.points.some((q) => ![q.x, q.y, q.width, q.height].every(finite) || q.width <= 0)) {
      p.push(`river ${river.id} has a bad point`);
    }
  }
  if (!finite(t.cliffAngle)) p.push('cliffAngle is not a number');

  if (!Array.isArray(doc.objects)) {
    p.push('objects must be a list');
    return p;
  }
  if (!doc.paths || !Array.isArray(doc.paths.nodes) || !Array.isArray(doc.paths.edges)) {
    p.push('paths must have lists of nodes and edges');
    return p;
  }
  if (!Array.isArray(doc.spawns)) {
    p.push('spawns must be a list');
    return p;
  }
  const ids = new Set<string>();
  for (const o of doc.objects) {
    if (!o || typeof o !== 'object') {
      p.push('an object entry is not an object');
      continue;
    }
    if (!o.id || ids.has(o.id)) p.push(`object id "${o.id}" is missing or twice`);
    ids.add(o.id);
    if (!o.asset) p.push(`object ${o.id} has no asset`);
    if (![o.x, o.y, o.z, o.rotation, o.scale].every(finite) || o.scale <= 0) p.push(`object ${o.id} has a bad placement`);
    if (o.group !== undefined && typeof o.group !== 'string') p.push(`object ${o.id} has a bad group`);
    if ((o.pitch !== undefined && !finite(o.pitch)) || (o.roll !== undefined && !finite(o.roll))) p.push(`object ${o.id} has a bad tilt`);
  }
  const nodes = new Set<string>();
  for (const n of doc.paths.nodes) {
    if (!n || typeof n !== 'object') {
      p.push('a path node is not an object');
      continue;
    }
    if (!n.id || nodes.has(n.id)) p.push(`path node id "${n.id}" is missing or twice`);
    nodes.add(n.id);
    if (!finite(n.x) || !finite(n.y)) p.push(`path node ${n.id} has no position`);
  }
  const edges = new Set<string>();
  for (const e of doc.paths.edges) {
    if (!e || typeof e !== 'object') {
      p.push('a path edge is not an object');
      continue;
    }
    if (!e.id || edges.has(e.id)) p.push(`path edge id "${e.id}" is missing or twice`);
    edges.add(e.id);
    if (!nodes.has(e.a) || !nodes.has(e.b)) p.push(`path edge ${e.id} names a node that does not exist`);
    if (e.a === e.b) p.push(`path edge ${e.id} starts and ends at one node`);
    if (!finite(e.width) || e.width <= 0) p.push(`path edge ${e.id} has no width`);
    if (e.via !== undefined && (!Array.isArray(e.via) || e.via.some((v) => !finite(v?.x) || !finite(v?.y)))) p.push(`path edge ${e.id} has a bad curve point`);
    if (e.style !== undefined && !['wood', 'stone', 'lava'].includes(e.style)) p.push(`path edge ${e.id} has an unknown bridge style`);
    if ((e.street !== undefined && typeof e.street !== 'string') || (e.surface !== undefined && typeof e.surface !== 'string')) p.push(`path edge ${e.id} has a bad street type or surface`);
  }
  for (const sp of doc.spawns) {
    if (!sp || !finite(sp.x) || !finite(sp.y)) p.push(`spawn ${sp.id} has no position`);
    if (sp?.optional !== undefined && typeof sp.optional !== 'boolean') p.push(`spawn ${sp.id} has a bad optional flag`);
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
      if (gp.destructible !== undefined && typeof gp.destructible !== 'boolean') p.push('gameplay.destructible must be true or false');
      if (gp.difficulty !== undefined && (!finite(gp.difficulty) || gp.difficulty < MAP_DIFFICULTY.min || gp.difficulty > MAP_DIFFICULTY.max)) {
        p.push(`gameplay.difficulty must be ${MAP_DIFFICULTY.min} to ${MAP_DIFFICULTY.max} (percent)`);
      }
      const lanes = gp.lanes;
      if (lanes !== undefined) {
        const count = (v: unknown) => v === undefined || (Number.isInteger(v) && (v as number) >= 1);
        if (lanes === null || typeof lanes !== 'object') p.push('gameplay.lanes is not an object');
        else {
          if (!count(lanes.min)) p.push('gameplay.lanes.min must be a whole number from 1');
          if (!count(lanes.max)) p.push('gameplay.lanes.max must be a whole number from 1');
          if (lanes.min !== undefined && lanes.max !== undefined && lanes.min > lanes.max) p.push('gameplay.lanes.min is above max');
          if (lanes.vacant !== undefined && !VACANT_LANES.includes(lanes.vacant)) p.push('gameplay.lanes.vacant must be close, host or split');
        }
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
  const looks = ['temperate', 'hell', 'moon', 'mars', 'arctic', 'apocalypse', 'swamp', 'desert', 'mountain', 'city'];
  if (env?.biome !== undefined && !looks.includes(env.biome)) p.push(`environment biome ${String(env.biome)} is unknown`);
  // An unknown id is no error: a map from a newer game shows the procedural sky here
  if (env?.skyImage !== undefined && typeof env.skyImage !== 'string') p.push('environment skyImage must be a sky id');
  const planet = env?.planet;
  if (planet !== undefined && (!planet || typeof planet !== 'object' || !finite(planet.azimuth) || !finite(planet.elevation) || !finite(planet.size) || planet.size < 0)) {
    p.push('environment planet needs azimuth, elevation and a size of 0 or more');
  }
  const wind = env?.wind;
  if (wind !== undefined && (!wind || typeof wind !== 'object' || !finite(wind.strength) || !finite(wind.direction) || !finite(wind.gusts))) {
    p.push('environment wind needs strength, direction and gusts');
  }
  p.push(...lifeProblems(doc.life));
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
  if (!Array.isArray(maps) || maps.length < 2 || maps.length > 3) throw new MapFileError('The map needs two or three splat maps.');
  splat['maps'] = maps.map((m, k) => bin(m, `splat map ${k + 1}`));
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
