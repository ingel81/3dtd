/**
 * An AI agent's map script (docs/AGENT_MCP.md): JavaScript against `map`, an
 * object with the map kit's commands (the editor's tools as LevelKit uses
 * them) and a few reads. The script runs in the sandbox worker on a copy of
 * the open map (script-sandbox.worker.ts); every command it calls is checked,
 * run on that copy and kept as plain data. The editor then plays the kept
 * commands on the open map, one after another, as one undo step
 * (script-playback.ts). Reads see the copy as the commands left it, so a
 * script may read a height after raising it.
 *
 * The commands take plain data only (numbers, text, points, options), so a
 * kept command does the same when it is played again: no functions, no
 * references into the map.
 */
import { CatalogIndex, type MapAssetCatalog } from '../catalog/asset-catalog';
import { TERRAIN_PRESETS } from '../ops/generate';
import { BIOMES } from '../ops/landscape/biomes';
import { edgePolyline } from '../ops/path-graph';
import { contentFingerprint } from './agent-reads';
import { dabCentres, facing, MapKit, rng, type Brush, type Where } from '../ops/map-kit';
import { validateMapDocument } from '../../world/custom-map/map-file';
import type { CustomMapDocument, MapPoint } from '../../world/custom-map/map-document';

/** One command of a script, as kept and played */
export interface ScriptCommand {
  op: string;
  args: unknown[];
}

export interface ScriptRunOptions {
  /** Seed of the strokes (the kit's seed) */
  seed: number;
  /** Most commands a script may call */
  maxCommands?: number;
  /** Milliseconds one command may take; the editor plays it again in one frame */
  maxCommandMs?: number;
}

export type ScriptRunResult =
  | {
      ok: true;
      commands: ScriptCommand[];
      /** What the script logged */
      logs: string[];
      /** What the script returned, as plain data */
      value: unknown;
      /** Of the copy after the script: the played map must come out the same */
      fingerprint: string;
      ms: number;
    }
  | { ok: false; error: string; logs: string[] };

export const MAX_SCRIPT_COMMANDS = 5000;
export const MAX_COMMAND_MS = 3000;
/** Most points of one line, dabs of one stroke */
const MAX_POINTS = 2000;
const MAX_DABS = 6000;
const MAX_LOG_LINES = 200;
const MAX_LOG_CHARS = 20_000;

// ---------------------------------------------------------------------------
// The commands

type ArgKind =
  | { kind: 'number'; min?: number; max?: number }
  | { kind: 'int'; min?: number; max?: number }
  | { kind: 'string' }
  | { kind: 'strings' }
  | { kind: 'bool' }
  | { kind: 'point' }
  | { kind: 'line' }
  | { kind: 'where' }
  | { kind: 'brush' }
  | { kind: 'object' }
  | { kind: 'one'; of: readonly string[] };

interface Arg {
  name: string;
  type: ArgKind;
  optional?: boolean;
}

interface OpSpec {
  args: Arg[];
  /** One line for the reference */
  doc: string;
  /** The whole map's ground may change (the view redraws all of it) */
  wholeGround?: boolean;
}

const num = (min?: number, max?: number): ArgKind => ({ kind: 'number', min, max });
const int = (min?: number, max?: number): ArgKind => ({ kind: 'int', min, max });
const one = (of: readonly string[]): ArgKind => ({ kind: 'one', of });
const STRING: ArgKind = { kind: 'string' };
const STRINGS: ArgKind = { kind: 'strings' };
const BOOL: ArgKind = { kind: 'bool' };
const POINT: ArgKind = { kind: 'point' };
const LINE: ArgKind = { kind: 'line' };
const WHERE: ArgKind = { kind: 'where' };
const BRUSH: ArgKind = { kind: 'brush' };
const OBJECT: ArgKind = { kind: 'object' };

const a = (name: string, type: ArgKind, optional = false): Arg => ({ name, type, optional });

const PRESETS = TERRAIN_PRESETS.map((p) => p.id);
const FORMS = ['mountain', 'valley', 'plateau', 'crater', 'dunes'] as const;
const BIOME_IDS = BIOMES.map((b) => b.id);
const WATER_KINDS = ['water', 'sea', 'swamp', 'ice', 'lava'] as const;
const PATH_KINDS = ['road', 'path', 'bridge'] as const;
const BRIDGE_STYLES = ['wood', 'stone', 'lava'] as const;
const SYMMETRIES = ['none', 'x', 'y', 'xy', 'rot2', 'rot4'] as const;

/**
 * Every command a script may call, by the kit's method name (and a few of
 * the editor's own: spawns and objects removed). Order as in the reference.
 */
export const SCRIPT_OPS: Readonly<Record<string, OpSpec>> = {
  // Map tool
  generate: { args: [a('preset', one(PRESETS)), a('seed', int()), a('strength', num(0, 1)), a('add', BOOL, true)], doc: 'Terrain generator over the whole map (replace, or add to the ground)', wholeGround: true },
  setSymmetry: { args: [a('mode', one(SYMMETRIES))], doc: 'Symmetry for the commands after it: strokes, lines, objects land at every image' },
  mirrorFrom: { args: [a('from', POINT)], doc: 'Copy the sector of a point (heights, paint, main water) to its symmetric images', wholeGround: true },
  // Landscape tool
  biome: { args: [a('id', one(BIOME_IDS)), a('where', WHERE), a('brush', BRUSH), a('hold', num(0.1, 5), true)], doc: 'Biome brush held `hold` s (0.6) per dab: ground, plants, rocks, houses of the biome' },
  biomeBand: { args: [a('id', one(BIOME_IDS)), a('minY', num(), true), a('maxY', num(), true)], doc: 'A biome over the whole map between two northings', wholeGround: true },
  form: { args: [a('kind', one(FORMS)), a('where', WHERE), a('brush', BRUSH), a('hold', num(0.1, 10), true)], doc: 'Landform held `hold` s (3) per dab' },
  cliff: { args: [a('line', LINE), a('height', num(-200, 200)), a('reach', num(1, 200))], doc: 'Cliff edge: the ground left of the drawing direction rises by `height`' },
  erode: { args: [a('where', WHERE), a('brush', BRUSH), a('rounds', int(1, 30), true)], doc: 'Rain erosion along `where`' },
  cracks: { args: [a('where', WHERE), a('brush', BRUSH), a('hold', num(0.1, 5), true)], doc: 'Glow cracks' },
  river: { args: [a('line', LINE), a('options', OBJECT, true)], doc: 'River or lava flow along a line; options { width 14, depth 2.5, bank 10, reeds, bridges, kind: water|lava }' },
  road: { args: [a('line', LINE), a('options', OBJECT, true)], doc: 'Road along a line, joined at its ends, graded and paved; options { width 8, kind: road|path|bridge, adapt, surface: [materials], lamps, fences, snap 12 }' },
  // Terrain tool
  raise: { args: [a('where', WHERE), a('brush', BRUSH), a('metres', num(-100, 100))], doc: 'Raise (negative: lower) by up to `metres` per dab' },
  smooth: { args: [a('where', WHERE), a('brush', BRUSH), a('passes', int(1, 20), true)], doc: 'Smooth' },
  level: { args: [a('where', WHERE), a('brush', BRUSH), a('height', num()), a('pull', num(0, 1), true)], doc: 'Flatten toward a height' },
  roughen: { args: [a('where', WHERE), a('brush', BRUSH), a('metres', num(0, 50)), a('seed', int(), true)], doc: 'Noise on the ground' },
  slide: { args: [a('where', WHERE), a('brush', BRUSH), a('passes', int(1, 20), true)], doc: 'Thermal erosion: steep slopes slide into scree' },
  terrace: { args: [a('where', WHERE), a('brush', BRUSH), a('step', num(0.5, 100)), a('base', num(), true), a('pull', num(0, 1), true)], doc: 'Terraces of `step` metres' },
  plateau: { args: [a('where', WHERE), a('brush', BRUSH), a('height', num()), a('pull', num(0, 1), true)], doc: 'Cliff brush: a hard-edged plateau at `height`' },
  ramp: { args: [a('from', OBJECT), a('to', OBJECT), a('width', num(1, 200)), a('falloff', num(0, 1), true)], doc: 'Ramp between two points {x, y, h?} at their ground heights or `h`' },
  // Paint tool
  layer: { args: [a('material', STRING)], doc: 'Ground layer of a material, added when missing; returns its index' },
  paint: { args: [a('material', STRING), a('where', WHERE), a('brush', BRUSH), a('amount', num(0, 1), true)], doc: 'Paint a material' },
  autoPaint: { args: [a('rules', OBJECT, true)], doc: 'Auto paint by slope and height; rules [{ material, minSlope, maxSlope, minHeight, maxHeight, blend }] or the panel\'s', wholeGround: true },
  trimLayers: { args: [a('max', int(1, 12))], doc: 'Remove the least used ground layers until `max` are left', wholeGround: true },
  cliffs: { args: [a('material', STRING), a('angle', num(10, 89))], doc: 'Cliff material for slopes steeper than `angle` degrees', wholeGround: true },
  paintRoads: { args: [a('material', STRING), a('edgeIds', STRINGS, true), a('softEdge', num(0, 10), true)], doc: 'Paint a material under roads (all, or the given edges)', wholeGround: true },
  // Water tool
  water: { args: [a('level', num()), a('kind', one(WATER_KINDS), true), a('color', STRING, true)], doc: 'The main water at a level (created when missing); returns -1, its body index', wholeGround: true },
  body: { args: [a('level', num()), a('kind', one(WATER_KINDS)), a('color', STRING, true)], doc: 'A further water body; returns its index', wholeGround: true },
  fill: { args: [a('at', POINT), a('body', int(-1), true)], doc: 'Fill the basin under a point with a body\'s water (-1 the main water)', wholeGround: true },
  lake: { args: [a('where', WHERE), a('brush', BRUSH), a('depth', num(0, 50)), a('body', int(-1), true), a('rounds', int(1, 30), true)], doc: 'Dig a lake bed `depth` under the body\'s level' },
  waterMask: { args: [a('where', WHERE), a('brush', BRUSH), a('on', BOOL), a('body', int(-1), true)], doc: 'Paint or erase a body\'s water' },
  sea: { args: [a('body', int(-1), true)], doc: 'Sea from the map edge at the body\'s level', wholeGround: true },
  // Objects tool
  place: { args: [a('asset', STRING), a('x', num()), a('y', num()), a('options', OBJECT, true)], doc: 'One object; options { rotation, pitch, roll (radians), scale, z, blocksBuild, blocksLos, tint }' },
  scatter: { args: [a('assets', STRINGS), a('where', WHERE), a('brush', BRUSH), a('options', OBJECT, true), a('avoidRoads', BOOL, true), a('hold', num(0.1, 5), true)], doc: 'Scatter brush; options { density 4 per 1000 m2, scaleMin, scaleMax, randomRotation, minDistance, sinkOnSlope, tint, tintVariation, alignToSlope }' },
  row: { args: [a('asset', STRING), a('line', LINE), a('spacing', num(0.5, 500)), a('options', OBJECT, true)], doc: 'Objects one after another along a line, turned along it (walls, fences); options as place plus offset, turn' },
  chimney: { args: [a('house', OBJECT), a('scale', num(0.1, 5), true)], doc: 'Smoke over a placed house (the object place returned)' },
  shoulderWalls: { args: [a('asset', STRING), a('options', OBJECT)], doc: 'Walls where the ground falls away beside roads; options { spacing, offset, minDrop, edges }' },
  clearRoads: { args: [a('keep', STRINGS, true)], doc: 'Delete objects that block building on a road (gates and arches stay)' },
  erase: { args: [a('at', POINT), a('radius', num(0, 5000))], doc: 'Delete objects within a radius' },
  removeObjects: { args: [a('ids', STRINGS)], doc: 'Delete objects by id' },
  settleRocks: { args: [], doc: 'Lower rocks onto the ground shaped under them since' },
  // Paths tool and markers
  path: { args: [a('points', LINE), a('width', num(1, 60)), a('kind', one(PATH_KINDS), true), a('snap', num(0, 50), true), a('style', one(BRIDGE_STYLES), true)], doc: 'A plain path through the points (no grading or paint); returns the edge id' },
  walk: { args: [a('line', LINE), a('options', OBJECT, true)], doc: 'Paths along a line that turn into bridges over water; options { width, bridgeWidth, dry, wetBelow }' },
  bridgeStyle: { args: [a('style', one(BRIDGE_STYLES)), a('near', POINT, true), a('within', num(0, 2000), true)], doc: 'Style of every bridge, or of those near a point' },
  flattenRoads: { args: [a('edgeIds', STRINGS, true), a('shoulder', num(0, 50), true), a('smoothing', num(0, 100), true)], doc: 'Flatten the ground under roads (all, or the given edges)', wholeGround: true },
  spawn: { args: [a('name', STRING), a('x', num()), a('y', num())], doc: 'A spawn portal' },
  removeSpawn: { args: [a('id', STRING)], doc: 'Remove a spawn by id' },
  clearSpawns: { args: [], doc: 'Remove every spawn' },
  hq: { args: [a('x', num()), a('y', num())], doc: 'Move the HQ' },
  // Environment and Gameplay
  environment: { args: [a('patch', OBJECT)], doc: 'Sky and air: { sky: day|dusk|night|overcast, sunAzimuth, sunElevation, fogDensity, tint, weather: clear|rain|snow|fog, weatherStrength, biome, snowCover, moonlight, wind }' },
  gameplay: { args: [a('rules', OBJECT)], doc: 'Rules: { startCredits, hqHealth, towers: [ids], waves, lanes, destructible, difficulty 50..200 }' },
};

/** The reference of `map` for the agent (the script_api tool) */
export function scriptReference(): string {
  const lines = Object.entries(SCRIPT_OPS).map(([op, spec]) => {
    const args = spec.args.map((x) => `${x.name}${x.optional ? '?' : ''}${x.type.kind === 'one' ? `: ${x.type.of.join('|')}` : ''}`).join(', ');
    return `map.${op}(${args}): ${spec.doc}`;
  });
  return [
    'Map scripts: plain JavaScript (no imports, no await) run against `map`. Coordinates in metres, x east, y north, (0, 0) the map centre.',
    'A point is { x, y }; a line is [point, ...]; `where` is a point or a line the brush is dragged along; a brush is { radius, strength?: 0..1, falloff?: 0..1 }.',
    'Globals: map, rng(seed) -> () => 0..1, facing(from, to) -> radians, log(...) (or console.log). `return` a value to get it back.',
    'Reads (see the copy as the script left it): map.width, map.depth, map.cellSize, map.half, map.h(x, y), map.slope(x, y),',
    '  map.noise(x, y, wave, octaves?) -> -1..1, map.ridged(x, y, wave, octaves?), map.objects(rect?), map.markers(), map.roads(), map.layers(), map.water(), map.lanes(), map.issues().',
    'Commands (each checked; the whole script lands as one undo step and plays back animated):',
    ...lines,
    'Order that works: ground shape (generate, form, cliff), rivers, roads, spawns and HQ, then biomes and paint, then single objects. Prefer strokes along lines over many single dabs.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Checking

class ScriptError extends Error {
  override name = 'ScriptError';
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;

/** A copy of plain data (numbers, text, booleans, null, arrays, plain objects); throws on anything else */
export function plainData(value: unknown, where: string, depth = 0): unknown {
  if (depth > 8) throw new ScriptError(`${where} nests too deep`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (value === undefined) return undefined;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ScriptError(`${where} is not a finite number`);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_POINTS * 4) throw new ScriptError(`${where} has more than ${MAX_POINTS * 4} entries`);
    return value.map((v, k) => plainData(v, `${where}[${k}]`, depth + 1));
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const copy = plainData(v, `${where}.${k}`, depth + 1);
      if (copy !== undefined) out[k] = copy;
    }
    return out;
  }
  throw new ScriptError(`${where} must be plain data (numbers, text, points, options), not ${typeof value === 'function' ? 'a function' : typeof value}`);
}

function isPoint(v: unknown): v is MapPoint {
  return isPlainObject(v) && typeof v['x'] === 'number' && typeof v['y'] === 'number';
}

function checkArg(op: string, arg: Arg, value: unknown): void {
  const where = `map.${op}: ${arg.name}`;
  const t = arg.type;
  switch (t.kind) {
    case 'number':
    case 'int':
      if (typeof value !== 'number') throw new ScriptError(`${where} must be a number`);
      if (t.kind === 'int' && !Number.isInteger(value)) throw new ScriptError(`${where} must be a whole number`);
      if ((t.min !== undefined && value < t.min) || (t.max !== undefined && value > t.max)) {
        throw new ScriptError(`${where} must lie in ${t.min ?? '-inf'}..${t.max ?? 'inf'}, not ${value}`);
      }
      return;
    case 'string':
      if (typeof value !== 'string' || !value) throw new ScriptError(`${where} must be text`);
      return;
    case 'strings':
      if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) throw new ScriptError(`${where} must be a list of texts`);
      return;
    case 'bool':
      if (typeof value !== 'boolean') throw new ScriptError(`${where} must be true or false`);
      return;
    case 'one':
      if (typeof value !== 'string' || !t.of.includes(value)) throw new ScriptError(`${where} must be one of ${t.of.join(', ')}, not ${JSON.stringify(value)}`);
      return;
    case 'point':
      if (!isPoint(value)) throw new ScriptError(`${where} must be a point { x, y }`);
      return;
    case 'line':
      if (!Array.isArray(value) || value.length < 2 || !value.every(isPoint)) throw new ScriptError(`${where} must be a line of at least two points [{ x, y }, ...]`);
      if (value.length > MAX_POINTS) throw new ScriptError(`${where} has more than ${MAX_POINTS} points`);
      return;
    case 'where':
      if (isPoint(value)) return;
      if (!Array.isArray(value) || !value.length || !value.every(isPoint)) throw new ScriptError(`${where} must be a point { x, y } or a line [{ x, y }, ...]`);
      if (value.length > MAX_POINTS) throw new ScriptError(`${where} has more than ${MAX_POINTS} points`);
      return;
    case 'brush':
      if (!isPlainObject(value) || typeof value['radius'] !== 'number' || value['radius'] <= 0) throw new ScriptError(`${where} must be a brush { radius, strength?, falloff? }`);
      return;
    case 'object':
      if (!isPlainObject(value) && !Array.isArray(value)) throw new ScriptError(`${where} must be an object`);
      return;
  }
}

/** Checks a call against its command; returns it as plain data to keep */
export function checkCommand(op: string, args: readonly unknown[]): ScriptCommand {
  const spec = Object.prototype.hasOwnProperty.call(SCRIPT_OPS, op) ? SCRIPT_OPS[op] : undefined;
  if (!spec) throw new ScriptError(`map.${op} is no command`);
  if (args.length > spec.args.length) throw new ScriptError(`map.${op} takes ${spec.args.length} arguments, got ${args.length}`);
  const copy = args.map((v, k) => plainData(v, `map.${op}: ${spec.args[k].name}`));
  // Trailing undefined arguments are left out, as if not passed
  while (copy.length && copy[copy.length - 1] === undefined) copy.pop();
  spec.args.forEach((arg, k) => {
    const value = copy[k];
    if (value === undefined) {
      if (!arg.optional) throw new ScriptError(`map.${op}: ${arg.name} is missing`);
      return;
    }
    checkArg(op, arg, value);
  });
  const whereAt = spec.args.findIndex((x) => x.type.kind === 'where');
  const brushAt = spec.args.findIndex((x) => x.type.kind === 'brush');
  if (whereAt >= 0 && brushAt >= 0 && dabCentres(copy[whereAt] as Where, copy[brushAt] as Brush).length > MAX_DABS) {
    throw new ScriptError(`map.${op}: the stroke makes more than ${MAX_DABS} dabs; use a bigger brush or a shorter line`);
  }
  return { op, args: copy };
}

/** Whether a command may change the ground all over the map */
export function changesWholeGround(op: string): boolean {
  return !!SCRIPT_OPS[op]?.wholeGround;
}

/** The index of a command's `where` and `brush` arguments, for playing a stroke in runs; null for other commands */
export function strokeArgs(op: string): { where: number; brush: number } | null {
  const spec = SCRIPT_OPS[op];
  if (!spec) return null;
  const where = spec.args.findIndex((x) => x.type.kind === 'where');
  const brush = spec.args.findIndex((x) => x.type.kind === 'brush');
  return where >= 0 && brush >= 0 ? { where, brush } : null;
}

// ---------------------------------------------------------------------------
// Running

/**
 * Runs one checked command on the kit; what it returns, as plain data. The
 * kit's own methods by name, the editor's removals here.
 */
export function applyCommand(kit: MapKit, command: ScriptCommand): unknown {
  const doc = kit.doc;
  const args = command.args;
  switch (command.op) {
    case 'setSymmetry':
      kit.symmetry = args[0] as MapKit['symmetry'];
      return undefined;
    case 'removeObjects': {
      const ids = new Set(args[0] as string[]);
      doc.objects = doc.objects.filter((o) => !ids.has(o.id));
      return undefined;
    }
    case 'removeSpawn': {
      const id = args[0] as string;
      if (!doc.spawns.some((s) => s.id === id)) throw new ScriptError(`map.removeSpawn: there is no spawn ${id}`);
      doc.spawns = doc.spawns.filter((s) => s.id !== id);
      return undefined;
    }
    case 'clearSpawns':
      doc.spawns = [];
      return undefined;
    case 'environment':
      kit.environment(checkEnvironment(args[0] as Record<string, unknown>));
      return undefined;
    case 'gameplay':
      kit.gameplay({ ...(doc.gameplay ?? {}), ...(args[0] as object) });
      return undefined;
    case 'river':
      return (kit.river(args[0] as MapPoint[], args[1] as object) ?? []).map((r) => ({ bridges: r.bridges, waterfalls: r.waterfalls, id: r.river.id }));
    case 'erase':
      kit.erase(args[0] as MapPoint, args[1] as number);
      return undefined;
  }
  const method = (kit as unknown as Record<string, (...x: unknown[]) => unknown>)[command.op];
  if (typeof method !== 'function') throw new ScriptError(`map.${command.op} is no command`);
  return method.apply(kit, args);
}

const ENVIRONMENT_CHOICES: Record<string, readonly string[]> = {
  sky: ['day', 'dusk', 'night', 'overcast'],
  weather: ['clear', 'rain', 'snow', 'fog'],
  biome: ['temperate', 'hell', 'moon', 'mars', 'arctic', 'apocalypse', 'swamp', 'desert', 'mountain', 'city'],
};
const ENVIRONMENT_NUMBERS = ['sunAzimuth', 'sunElevation', 'fogDensity', 'weatherStrength', 'snowCover', 'moonlight'];

/** An environment patch the map file and the renderer take: known keys, known choices, numbers */
export function checkEnvironment(patch: Record<string, unknown>): Partial<CustomMapDocument['environment']> {
  for (const [key, value] of Object.entries(patch)) {
    const where = `map.environment: ${key}`;
    if (ENVIRONMENT_CHOICES[key]) {
      if (!ENVIRONMENT_CHOICES[key].includes(value as string)) throw new ScriptError(`${where} must be one of ${ENVIRONMENT_CHOICES[key].join(', ')}`);
    } else if (ENVIRONMENT_NUMBERS.includes(key)) {
      if (typeof value !== 'number') throw new ScriptError(`${where} must be a number`);
    } else if (key === 'tint') {
      if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new ScriptError(`${where} must be a colour like #ffeedd`);
    } else if (key === 'wind') {
      const w = value as Record<string, unknown> | null;
      if (!w || typeof w !== 'object' || !['strength', 'direction', 'gusts'].every((k) => typeof w[k] === 'number')) {
        throw new ScriptError(`${where} must be { strength 0..1, direction degrees, gusts 0..1 }`);
      }
    } else throw new ScriptError(`map.environment knows no ${key}`);
  }
  return patch as Partial<CustomMapDocument['environment']>;
}

/** A copy of what a command or read returned, for the script; nothing of the map itself */
function forScript(value: unknown): unknown {
  return value === undefined ? undefined : structuredClone(value);
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function inRect(p: MapPoint, r: Rect | undefined): boolean {
  return !r || (p.x >= Math.min(r.x0, r.x1) && p.x <= Math.max(r.x0, r.x1) && p.y >= Math.min(r.y0, r.y1) && p.y <= Math.max(r.y0, r.y1));
}

/** The `map` a script sees: every command checked, run and kept in `kept`, and the reads */
export function scriptMap(kit: MapKit, kept: ScriptCommand[], options: Required<Pick<ScriptRunOptions, 'maxCommands' | 'maxCommandMs'>>): Record<string, unknown> {
  const api: Record<string, unknown> = {};
  for (const op of Object.keys(SCRIPT_OPS)) {
    api[op] = (...args: unknown[]) => {
      if (kept.length >= options.maxCommands) throw new ScriptError(`a script may call at most ${options.maxCommands} commands`);
      const command = checkCommand(op, args);
      const start = performance.now();
      const out = applyCommand(kit, command);
      const ms = performance.now() - start;
      if (ms > options.maxCommandMs) throw new ScriptError(`map.${op} took ${Math.round(ms)} ms; the editor plays each command in one frame, so split it (shorter lines, fewer rounds) to stay under ${options.maxCommandMs} ms`);
      kept.push(command);
      return forScript(out);
    };
  }
  const doc = kit.doc;
  const t = () => doc.terrain;
  Object.defineProperties(api, {
    width: { get: () => t().width, enumerable: true },
    depth: { get: () => t().depth, enumerable: true },
    cellSize: { get: () => t().grid.cellSize, enumerable: true },
    half: { get: () => t().width / 2, enumerable: true },
  });
  const finite = (v: unknown, name: string) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new ScriptError(`${name} must be a number`);
    return v;
  };
  Object.assign(api, {
    h: (x: number, y: number) => kit.h(finite(x, 'map.h: x'), finite(y, 'map.h: y')),
    slope: (x: number, y: number) => kit.slope(finite(x, 'map.slope: x'), finite(y, 'map.slope: y')),
    noise: (x: number, y: number, wave: number, octaves?: number) => kit.noise.fbm(finite(x, 'x'), finite(y, 'y'), finite(wave, 'wave'), Math.min(8, Math.max(1, octaves ?? 4))),
    ridged: (x: number, y: number, wave: number, octaves?: number) => kit.noise.ridged(finite(x, 'x'), finite(y, 'y'), finite(wave, 'wave'), Math.min(8, Math.max(1, octaves ?? 5))),
    objects: (rect?: Rect) => forScript(doc.objects.filter((o) => inRect(o, rect))),
    markers: () => forScript({ hq: doc.hq, spawns: doc.spawns }),
    roads: () => forScript(doc.paths.edges.map((e) => ({ id: e.id, kind: e.kind, width: e.width, points: edgePolyline(doc.paths, e) }))),
    layers: () => t().layers.map((l) => l.material),
    water: () =>
      forScript({
        main: t().water ? { level: t().water!.level, kind: t().water!.kind ?? 'water' } : null,
        bodies: (t().waterBodies ?? []).map((b, index) => ({ index, level: b.level, kind: b.kind ?? 'water' })),
        rivers: (t().rivers ?? []).map((r) => ({ id: r.id, kind: r.kind })),
      }),
    lanes: () => kit.lanes(),
    issues: () => kit.issues().map((i) => ({ severity: i.severity, message: i.message })),
  });
  return Object.freeze(api);
}

/** Names a script sees as undefined: what reaches past the map (the worker also takes them away itself) */
const SHADOWED = [
  'self', 'globalThis', 'window', 'postMessage', 'onmessage', 'close', 'importScripts', 'fetch', 'XMLHttpRequest', 'WebSocket',
  'EventSource', 'indexedDB', 'caches', 'navigator', 'location', 'Worker', 'SharedWorker', 'BroadcastChannel', 'MessageChannel',
  'WebAssembly', 'Function', 'setTimeout', 'setInterval', 'queueMicrotask', 'requestAnimationFrame', 'process', 'require',
];

/**
 * Runs a script on `doc` (a copy: the script changes it) and keeps its
 * commands. Plain JavaScript in strict mode; `map`, `rng`, `facing`, `log`
 * and `console` are its globals, the names in SHADOWED read undefined.
 */
export function runMapScript(source: string, doc: CustomMapDocument, catalog: MapAssetCatalog, options: ScriptRunOptions): ScriptRunResult {
  const logs: string[] = [];
  let logChars = 0;
  const log = (...parts: unknown[]) => {
    if (logs.length >= MAX_LOG_LINES || logChars >= MAX_LOG_CHARS) return;
    const line = parts.map((p) => (typeof p === 'string' ? p : safeJson(p))).join(' ').slice(0, 2000);
    logChars += line.length;
    logs.push(line);
  };
  const kept: ScriptCommand[] = [];
  const start = performance.now();
  try {
    const kit = new MapKit(doc, new CatalogIndex(catalog), { name: 'script', seed: options.seed });
    const map = scriptMap(kit, kept, { maxCommands: options.maxCommands ?? MAX_SCRIPT_COMMANDS, maxCommandMs: options.maxCommandMs ?? MAX_COMMAND_MS });
    const consoleLike = Object.freeze({ log, info: log, warn: log, error: log });
    const value = compile(source)(map, rng, facing, log, consoleLike);
    const problems = validateMapDocument(doc);
    if (problems.length) throw new ScriptError(`the map would not save: ${problems.slice(0, 5).join('; ')}`);
    let returned: unknown;
    try {
      returned = plainData(value, 'the returned value');
    } catch {
      returned = safeJson(value);
    }
    return { ok: true, commands: kept, logs, value: returned, fingerprint: contentFingerprint(doc), ms: Math.round(performance.now() - start) };
  } catch (e) {
    return { ok: false, error: describeError(e, kept.length), logs };
  }
}

/** The script's name in error stacks */
const SCRIPT_URL = 'agent-script.js';

/** The script as a function of its globals */
function compile(source: string): (...globals: unknown[]) => unknown {
  return new Function('map', 'rng', 'facing', 'log', 'console', ...SHADOWED, `'use strict';\n${source}\n//# sourceURL=${SCRIPT_URL}`) as (...globals: unknown[]) => unknown;
}

const lineOf = (stack: string | undefined): number | null => {
  const at = new RegExp(`${SCRIPT_URL.replace('.', '\\.')}:(\\d+):\\d+`).exec(stack ?? '');
  return at ? Number(at[1]) : null;
};

/** The line a script's first line has in its stack (the engine puts the function's head before it) */
let firstLine: number | null = null;

function scriptLine(stack: string | undefined): number | null {
  if (firstLine === null) {
    try {
      compile('throw new Error()')();
    } catch (probe) {
      firstLine = lineOf((probe as Error).stack) ?? 0;
    }
  }
  const line = lineOf(stack);
  return line !== null && firstLine ? line - firstLine + 1 : null;
}

function describeError(e: unknown, commands: number): string {
  const err = e as { name?: string; message?: string; stack?: string } | null;
  const message = err?.message ?? String(e);
  const at = scriptLine(err?.stack);
  const line = at !== null ? ` (line ${at})` : '';
  const kind = err?.name && err.name !== 'Error' && err.name !== 'ScriptError' ? `${err.name}: ` : '';
  return `${kind}${message}${line}; ${commands} commands ran before it, none of them is kept`;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)?.slice(0, 2000) ?? String(value);
  } catch {
    return String(value);
  }
}
