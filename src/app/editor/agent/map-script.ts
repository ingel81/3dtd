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
import { connect, deleteEdge, deleteNode, dissolveNode, edgePolyline, mergeNodes, moveNode, nodeById, smoothEdge, splitEdge, straightenEdge } from '../ops/path-graph';
import { alignedToSlope, duplicateObjects, freeGroup } from '../ops/object-ops';
import { removeLayer } from '../ops/paint-ops';
import { meanWidth, insertPoint, movePoint, removePoint, setMeanWidth, simplifyRiver } from '../ops/river-edit';
import { LandscapeStroke } from '../ops/landscape/landscape-stroke';
import { recarveRiver, relevelRiver } from '../ops/landscape/river';
import { editRoads } from '../tools/path-tool';
import { relayRiver, removeWholeRiver } from '../tools/water-tool';
import { contentFingerprint } from './agent-reads';
import { dabCentres, facing, MapKit, rng, type Brush, type Where } from '../ops/map-kit';
import { validateMapDocument } from '../../world/custom-map/map-file';
import type { CustomMapDocument, MapBridgeStyle, MapObject, MapPathKind, MapPoint, MapRiver } from '../../world/custom-map/map-document';
import { LIFE_KINDS } from '../../world/custom-map/map-life';
import { AMBIENT_SOUNDS } from '../../world/custom-map/ambience/ambient-sounds';

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
  | { kind: 'grid' }
  | { kind: 'rect' }
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
const GRID: ArgKind = { kind: 'grid' };
const RECT: ArgKind = { kind: 'rect' };
/** Most samples a side of map.heightGrid */
const MAX_GRID = 257;

const a = (name: string, type: ArgKind, optional = false): Arg => ({ name, type, optional });

const PRESETS = TERRAIN_PRESETS.map((p) => p.id);
const FORMS = ['mountain', 'valley', 'plateau', 'crater', 'dunes'] as const;
const BIOME_IDS = BIOMES.map((b) => b.id);
const WATER_KINDS = ['water', 'sea', 'swamp', 'ice', 'lava'] as const;
const PATH_KINDS = ['road', 'path', 'bridge'] as const;
const BRIDGE_STYLES = ['wood', 'stone', 'lava'] as const;
const SYMMETRIES = ['none', 'x', 'y', 'xy', 'rot2', 'rot4'] as const;
const SOUND_IDS = Object.keys(AMBIENT_SOUNDS).join('|');

const ENVIRONMENT_CHOICES: Record<string, readonly string[]> = {
  sky: ['day', 'dusk', 'night', 'overcast'],
  weather: ['clear', 'rain', 'snow', 'fog'],
  biome: ['temperate', 'hell', 'moon', 'mars', 'arctic', 'apocalypse', 'swamp', 'desert', 'mountain', 'city'],
};
const ENVIRONMENT_NUMBERS = ['sunAzimuth', 'sunElevation', 'fogDensity', 'weatherStrength', 'snowCover', 'moonlight'];

/**
 * Every command a script may call, by the kit's method name (and a few of
 * the editor's own: spawns and objects removed). Order as in the reference.
 */
export const SCRIPT_OPS: Readonly<Record<string, OpSpec>> = {
  // Map tool
  generate: {
    args: [a('preset', one(PRESETS)), a('seed', int()), a('strength', num(0, 1)), a('add', BOOL, true), a('repaint', BOOL, true)],
    doc: 'Terrain generator over the whole map (replace, or add to the ground); repaint: as the Map panel does, with the water the preset wants, its ground layers and an auto paint',
    wholeGround: true,
  },
  mirrorMap: {
    args: [a('mode', one(SYMMETRIES.filter((m) => m !== 'none'))), a('from', POINT)],
    doc: "Mirror now (top bar): the sector of `from` becomes the whole map, ground, water, objects, spawns, roads and rivers; returns { objects, spawns, roads }. Unlike mirrorFrom it needs no setSymmetry",
    wholeGround: true,
  },
  copyArea: {
    args: [a('rect', RECT), a('to', POINT), a('options', OBJECT, true)],
    doc: 'Copy a rectangle { x0, y0, x1, y1 } of the map and paste it centred on `to` (Copy and stamps tool); options { rotation (radians), feather 0..1 (0.25, how far the rim fades into the ground), parts { heights, paint, water, objects, roads, life } (all true) }',
    wholeGround: true,
  },
  setSymmetry: { args: [a('mode', one(SYMMETRIES))], doc: 'Symmetry for the commands after it: strokes, lines, objects land at every image' },
  mirrorFrom: { args: [a('from', POINT)], doc: 'Copy the sector of a point (heights, paint, main water) to its symmetric images', wholeGround: true },
  // Landscape tool
  biome: { args: [a('id', one(BIOME_IDS)), a('where', WHERE), a('brush', BRUSH), a('hold', num(0.1, 5), true)], doc: 'Biome brush held `hold` s (0.6) per dab: ground, plants, rocks, houses of the biome' },
  biomeBand: { args: [a('id', one(BIOME_IDS)), a('minY', num(), true), a('maxY', num(), true)], doc: 'A biome over the whole map between two northings', wholeGround: true },
  form: { args: [a('kind', one(FORMS)), a('where', WHERE), a('brush', BRUSH), a('hold', num(0.1, 10), true)], doc: 'Landform held `hold` s (3) per dab' },
  cliff: { args: [a('line', LINE), a('height', num(-200, 200)), a('reach', num(1, 200))], doc: 'Cliff edge: the ground left of the drawing direction rises by `height`' },
  erode: { args: [a('where', WHERE), a('brush', BRUSH), a('rounds', int(1, 30), true)], doc: 'Rain erosion along `where`' },
  cracks: { args: [a('where', WHERE), a('brush', BRUSH), a('hold', num(0.1, 5), true)], doc: 'Glow cracks' },
  cliffRocks: { args: [a('where', WHERE), a('brush', BRUSH), a('model', STRING, true)], doc: "Cliff rocks: cliff walls on the steep spots under the brush, sized to the drop; model a cliff asset or 'auto' (those of the map's look); returns the ids" },
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
  heightGrid: {
    args: [a('origin', POINT), a('step', num(1, 500)), a('rows', GRID), a('options', OBJECT, true)],
    doc: `Set the ground to a grid of heights in metres: rows from south to north, each west to east, \`step\` metres apart, the first sample at \`origin\` (the south-west corner); smooth between samples, untouched outside. At most ${MAX_GRID} a side. options { blend 0..1 (1 replaces the ground), edge (metres over which the grid fades into the ground around it) }. One command instead of thousands of dabs; symmetry does not apply`,
    wholeGround: true,
  },
  ramp: { args: [a('from', OBJECT), a('to', OBJECT), a('width', num(1, 200)), a('falloff', num(0, 1), true)], doc: 'Ramp between two points {x, y, h?} at their ground heights or `h`' },
  // Paint tool
  layer: { args: [a('material', STRING)], doc: 'Ground layer of a material, added when missing; returns its index' },
  paint: { args: [a('material', STRING), a('where', WHERE), a('brush', BRUSH), a('amount', num(0, 1), true)], doc: 'Paint a material' },
  autoPaint: { args: [a('rules', OBJECT, true)], doc: 'Auto paint by slope and height; rules [{ material, minSlope, maxSlope, minHeight, maxHeight, blend }] or the panel\'s', wholeGround: true },
  trimLayers: { args: [a('max', int(1, 12))], doc: 'Remove the least used ground layers until `max` are left', wholeGround: true },
  removeLayer: { args: [a('material', STRING)], doc: 'Remove the ground layer of a material; its paint goes to the others', wholeGround: true },
  cliffs: { args: [a('material', STRING), a('angle', num(10, 89))], doc: 'Cliff material for slopes steeper than `angle` degrees', wholeGround: true },
  paintRoads: { args: [a('material', STRING), a('edgeIds', STRINGS, true), a('softEdge', num(0, 10), true)], doc: 'Paint a material under roads (all, or the given edges)', wholeGround: true },
  // Water tool
  water: { args: [a('level', num()), a('kind', one(WATER_KINDS), true), a('color', STRING, true)], doc: 'The main water at a level (created when missing); returns -1, its body index', wholeGround: true },
  body: { args: [a('level', num()), a('kind', one(WATER_KINDS)), a('color', STRING, true)], doc: 'A further water body; returns its index', wholeGround: true },
  fill: { args: [a('at', POINT), a('body', int(-1), true)], doc: 'Fill the basin under a point with a body\'s water (-1 the main water)', wholeGround: true },
  lake: { args: [a('where', WHERE), a('brush', BRUSH), a('depth', num(0, 50)), a('body', int(-1), true), a('rounds', int(1, 30), true)], doc: 'Dig a lake bed `depth` under the body\'s level' },
  waterMask: { args: [a('where', WHERE), a('brush', BRUSH), a('on', BOOL), a('body', int(-1), true)], doc: 'Paint or erase a body\'s water' },
  sea: { args: [a('body', int(-1), true)], doc: 'Sea from the map edge at the body\'s level', wholeGround: true },
  pour: { args: [a('at', POINT), a('kind', one(['water', 'lava']), true)], doc: 'Pour water or lava at a dry point: it fills the hollow, spills over and fills every hollow on its way down as new bodies; returns how many', wholeGround: true },
  moveRiverPoint: { args: [a('river', STRING), a('index', int(0)), a('to', POINT)], doc: 'Move a point of a river (map.rivers() lists them); its bed follows' },
  addRiverPoint: { args: [a('river', STRING), a('segment', int(1)), a('t', num(0, 1))], doc: 'A new river point on segment `segment` (between points segment-1 and segment) at share t; returns its index' },
  removeRiverPoint: { args: [a('river', STRING), a('index', int(0))], doc: 'Remove a river point (a river keeps at least two); its bed follows' },
  riverWidth: { args: [a('river', STRING), a('metres', num(1, 200))], doc: 'Scale every width of a river to this mean; its bed follows' },
  riverKind: { args: [a('river', STRING), a('kind', one(['water', 'lava']))], doc: 'A river becomes a lava flow or water' },
  simplifyRiver: { args: [a('river', STRING)], doc: 'Fewer points where a river runs straight' },
  carveRiverBed: { args: [a('river', STRING)], doc: 'Set the surface just below the banks and carve the bed again along the points as they are' },
  removeRiver: { args: [a('river', STRING)], doc: 'Take a river off the map, its bed filled' },
  // Objects tool
  place: { args: [a('asset', STRING), a('x', num()), a('y', num()), a('options', OBJECT, true)], doc: 'One object; options { rotation, pitch, roll (radians), scale, z, blocksBuild, blocksLos, tint }' },
  scatter: { args: [a('assets', STRINGS), a('where', WHERE), a('brush', BRUSH), a('options', OBJECT, true), a('avoidRoads', BOOL, true), a('hold', num(0.1, 5), true)], doc: 'Scatter brush; options { density 4 per 1000 m2, scaleMin, scaleMax, randomRotation, minDistance, sinkOnSlope, tint, tintVariation, alignToSlope }' },
  row: { args: [a('asset', STRING), a('line', LINE), a('spacing', num(0.5, 500)), a('options', OBJECT, true)], doc: 'Objects one after another along a line, turned along it (walls, fences); options as place plus offset, turn' },
  line: {
    args: [a('asset', STRING), a('line', LINE), a('options', OBJECT, true)],
    doc: "The Objects tool's Line: a wall kit's piece builds the kit's wall (blocks or towers at the corners); any other asset every `spacing` metres; options { spacing 4, offset (metres left of the line), bothSides, turn: along|across|random, corners: blocks|towers, front: left|right, alignToSlope }",
  },
  duplicate: { args: [a('ids', STRINGS), a('offset', POINT)], doc: 'Copies of objects moved by offset { x, y }; returns them' },
  changeObjects: { args: [a('ids', STRINGS), a('patch', OBJECT)], doc: 'Change several objects at once: { x, y, z, rotation, scale, pitch, roll, tint, blocksBuild, blocksLos } set, { dx, dy, turn } added' },
  alignToSlope: { args: [a('ids', STRINGS)], doc: 'Tilt objects to the slope under them' },
  group: { args: [a('ids', STRINGS)], doc: 'Group objects (picked and moved together in the editor); returns the group id' },
  ungroup: { args: [a('ids', STRINGS)], doc: 'Take objects out of their group' },
  chimney: { args: [a('house', OBJECT), a('scale', num(0.1, 5), true)], doc: 'Smoke over a placed house (the object place returned)' },
  shoulderWalls: { args: [a('asset', STRING), a('options', OBJECT)], doc: 'Walls where the ground falls away beside roads; options { spacing, offset, minDrop, edges }' },
  clearRoads: { args: [a('keep', STRINGS, true)], doc: 'Delete objects that block building on a road (gates and arches stay)' },
  erase: { args: [a('at', POINT), a('radius', num(0, 5000))], doc: 'Delete objects within a radius' },
  removeObjects: { args: [a('ids', STRINGS)], doc: 'Delete objects by id (map.objects() lists them); an unknown id stops the script' },
  settleRocks: { args: [], doc: 'Lower rocks onto the ground shaped under them since' },
  // Paths tool and markers
  path: { args: [a('points', LINE), a('width', num(1, 60)), a('kind', one(PATH_KINDS), true), a('snap', num(0, 50), true), a('style', one(BRIDGE_STYLES), true)], doc: 'A plain path through the points (no grading or paint); returns the edge id' },
  walk: { args: [a('line', LINE), a('options', OBJECT, true)], doc: 'Paths along a line that turn into bridges over water; options { width, bridgeWidth, dry, wetBelow }' },
  bridgeStyle: { args: [a('style', one(BRIDGE_STYLES)), a('near', POINT, true), a('within', num(0, 2000), true)], doc: 'Style of every bridge, or of those near a point' },
  removeRoads: { args: [a('edgeIds', STRINGS)], doc: 'Delete roads by edge id (map.roads() lists them) and the junctions they leave alone; the ground stays as it is' },
  moveNode: { args: [a('node', STRING), a('to', POINT)], doc: 'Move a road node (map.nodes() lists them); curve points follow, a road the road brush built is laid anew' },
  splitRoad: { args: [a('edge', STRING), a('at', POINT)], doc: 'Split a road at the point nearest `at` into two, joined by a new node to branch from; returns the node id' },
  mergeNodes: { args: [a('from', STRING), a('into', STRING)], doc: 'Join node `from` onto node `into`: its roads end there' },
  removeNode: { args: [a('node', STRING)], doc: 'Delete a road node with its roads' },
  dissolveNode: { args: [a('node', STRING)], doc: 'Remove a node between exactly two roads and join them into one, the curve kept' },
  connectNodes: { args: [a('from', STRING), a('to', STRING), a('options', OBJECT, true)], doc: 'A road between two nodes; options { width 8, kind: road|path|bridge, style: wood|stone|lava }; returns the edge id' },
  editRoads: { args: [a('edgeIds', STRINGS), a('patch', OBJECT)], doc: 'Width, kind or bridge style of roads: { width, kind: road|path|bridge, style: wood|stone|lava }; a road the brush built is laid anew' },
  smoothRoad: { args: [a('edge', STRING), a('spacing', num(1, 100), true)], doc: 'Round a road into a smooth curve (curve points every `spacing` metres, 8)' },
  straightenRoad: { args: [a('edge', STRING)], doc: 'A road straight from node to node' },
  flattenRoads: { args: [a('edgeIds', STRINGS, true), a('shoulder', num(0, 50), true), a('smoothing', num(0, 100), true)], doc: 'Flatten the ground under roads (all, or the given edges)', wholeGround: true },
  spawn: { args: [a('name', STRING), a('x', num()), a('y', num())], doc: 'A spawn portal' },
  removeSpawn: { args: [a('id', STRING)], doc: 'Remove a spawn by id' },
  clearSpawns: { args: [], doc: 'Remove every spawn' },
  moveSpawn: { args: [a('id', STRING), a('x', num()), a('y', num())], doc: 'Move a spawn' },
  renameSpawn: { args: [a('id', STRING), a('name', STRING)], doc: 'Rename a spawn' },
  hq: { args: [a('x', num()), a('y', num())], doc: 'Move the HQ' },
  // Environment and Gameplay
  environment: {
    args: [a('patch', OBJECT)],
    doc: `Sky and air: { sky: ${ENVIRONMENT_CHOICES['sky'].join('|')}, sunAzimuth, sunElevation (degrees), fogDensity, tint '#rrggbb', weather: ${ENVIRONMENT_CHOICES['weather'].join('|')}, weatherStrength 0..1, biome: ${ENVIRONMENT_CHOICES['biome'].join('|')} (the look of sky, light and air; not a landscape biome), snowCover 0..1, moonlight, wind { strength 0..1, direction degrees, gusts 0..1 }, planet { azimuth, elevation, size degrees; 0 none; the Moon look shows the Earth } }`,
  },
  // Life tool
  lifeArea: {
    args: [a('kind', one(LIFE_KINDS)), a('points', LINE), a('options', OBJECT, true)],
    doc: `A life area: an outline (3 or more points) the life fills (birds circle in it, particles over it, boats drift on its water, a sound plays in it); options { density 0.1..3, height (birds: flight height over the ground, 40), color, sound: ${SOUND_IDS}, volume 0..1, asset (boats: a floating prop, rowboat; movers: any asset), species: songbirds|gulls|crows|raptors (birds), speed m/s (movers, 1.5), quality: medium|high }; returns its id`,
  },
  lifeRoute: { args: [a('kind', one(LIFE_KINDS)), a('points', LINE), a('options', OBJECT, true)], doc: 'A life route: a line birds fly along and back, particles follow, boats go up and down or a sound follows (a stream); options as lifeArea; returns its id' },
  lifeSettings: { args: [a('patch', OBJECT)], doc: "The map's own life: { auto: { smoke, fireflies, birds (on unless false), sparks (over lava, off unless true) }, density 0..2 (a factor on all of it), flags (banners wave), ambience: { sound: biome (the look's own by day and night) or a sound, volume 0..1 } }" },
  removeLife: { args: [a('ids', STRINGS)], doc: 'Remove life areas by id (map.life() lists them)' },
  gameplay: { args: [a('rules', OBJECT)], doc: "Rules: { startCredits, hqHealth, towers: [tower ids], destructible: true|false, difficulty 50..200 (percent on the wave budget) }; waves is { kind: 'budget' } (the game's waves, the default) or a map's own table, there is no wave count" },
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
    'Reads (see the copy as the script left it): map.width, map.depth, map.cellSize, map.half, map.h(x, y) (metres), map.slope(x, y),',
    '  map.noise(x, y, wave, octaves?) -> -1..1, map.ridged(x, y, wave, octaves?), map.objects(rect?), map.markers(), map.roads() (edges with their nodes a, b),',
    '  map.nodes(), map.rivers() (points with width and height), map.layers(), map.waterBodies(), map.lanes(), map.issues(), map.life().',
    'An optional argument may be left out or passed as undefined or null; later ones still count by position.',
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
    case 'rect':
      if (!isPlainObject(value) || !['x0', 'y0', 'x1', 'y1'].every((k) => typeof value[k] === 'number')) throw new ScriptError(`${where} must be a rectangle { x0, y0, x1, y1 }`);
      return;
    case 'grid': {
      const rows = value as unknown[];
      const ok =
        Array.isArray(rows) &&
        rows.length >= 2 &&
        rows.length <= MAX_GRID &&
        rows.every((r) => Array.isArray(r) && r.length === (rows[0] as unknown[]).length && r.length >= 2 && r.length <= MAX_GRID && r.every((h) => typeof h === 'number'));
      if (!ok) throw new ScriptError(`${where} must be 2 to ${MAX_GRID} rows of 2 to ${MAX_GRID} heights each, all rows as long`);
      return;
    }
  }
}

/** Checks a call against its command; returns it as plain data to keep */
export function checkCommand(op: string, args: readonly unknown[]): ScriptCommand {
  const spec = Object.prototype.hasOwnProperty.call(SCRIPT_OPS, op) ? SCRIPT_OPS[op] : undefined;
  if (!spec) throw new ScriptError(`map.${op} is no command`);
  if (args.length > spec.args.length) throw new ScriptError(`map.${op} takes ${spec.args.length} arguments, got ${args.length}`);
  // null stands for a left-out optional argument, as undefined does
  const copy = args.map((v, k) => (v === null && spec.args[k].optional ? undefined : plainData(v, `map.${op}: ${spec.args[k].name}`)));
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

/** Commands that paint materials or place objects: they need the asset catalogue */
export const ASSET_OPS: ReadonlySet<string> = new Set(['biome', 'biomeBand', 'layer', 'paint', 'autoPaint', 'cliffs', 'paintRoads', 'place', 'scatter', 'row', 'line', 'cliffRocks', 'chimney', 'shoulderWalls']);

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
      const known = new Set(doc.objects.map((o) => o.id));
      const missing = [...ids].filter((id) => !known.has(id));
      if (missing.length) {
        const roads = missing.filter((id) => doc.paths.edges.some((e) => e.id === id));
        const hint = roads.length ? `; ${roads.join(', ')} ${roads.length > 1 ? 'are roads' : 'is a road'}, map.removeRoads deletes roads` : '; map.objects() lists them';
        throw new ScriptError(`map.removeObjects: there are no objects ${missing.slice(0, 10).join(', ')}${hint}`);
      }
      doc.objects = doc.objects.filter((o) => !ids.has(o.id));
      return undefined;
    }
    case 'removeRoads': {
      const ids = args[0] as string[];
      const missing = ids.filter((id) => !doc.paths.edges.some((e) => e.id === id));
      if (missing.length) throw new ScriptError(`map.removeRoads: there are no roads ${missing.slice(0, 10).join(', ')}; roads: ${doc.paths.edges.map((e) => e.id).join(', ') || 'none'}`);
      for (const id of ids) deleteEdge(doc.paths, id);
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
      kit.gameplay({ ...(doc.gameplay ?? {}), ...checkRules(args[0] as Record<string, unknown>) });
      return undefined;
    case 'river':
      return (kit.river(args[0] as MapPoint[], args[1] as object) ?? []).map((r) => ({ bridges: r.bridges, waterfalls: r.waterfalls, id: r.river.id }));
    case 'erase':
      kit.erase(args[0] as MapPoint, args[1] as number);
      return undefined;
    case 'heightGrid':
      applyHeightGrid(doc, args[0] as MapPoint, args[1] as number, args[2] as number[][], (args[3] ?? {}) as { blend?: number; edge?: number });
      return undefined;
    case 'mirrorMap':
      return kit.mirrorMap(args[0] as MapKit['symmetry'], args[1] as MapPoint);
    case 'copyArea':
      kit.copyArea(args[0] as Rect, args[1] as MapPoint, (args[2] ?? {}) as Parameters<MapKit['copyArea']>[2]);
      return undefined;
    case 'line':
      return kit.line(args[0] as string, args[1] as MapPoint[], (args[2] ?? {}) as Parameters<MapKit['line']>[2]);
    case 'duplicate': {
      objectsOf(doc, args[0] as string[], 'duplicate');
      const copies = duplicateObjects(doc, args[0] as string[], args[1] as MapPoint);
      doc.objects.push(...copies);
      return copies;
    }
    case 'changeObjects':
      changeObjects(doc, args[0] as string[], args[1] as Record<string, unknown>);
      return undefined;
    case 'alignToSlope': {
      const ids = new Set(objectsOf(doc, args[0] as string[], 'alignToSlope'));
      doc.objects = doc.objects.map((o) => (ids.has(o.id) ? alignedToSlope(doc.terrain, o) : o));
      return undefined;
    }
    case 'group': {
      const ids = new Set(objectsOf(doc, args[0] as string[], 'group'));
      const group = freeGroup(doc.objects);
      doc.objects = doc.objects.map((o) => (ids.has(o.id) ? { ...o, group } : o));
      return group;
    }
    case 'ungroup': {
      const ids = new Set(objectsOf(doc, args[0] as string[], 'ungroup'));
      doc.objects = doc.objects.map((o) => {
        if (!ids.has(o.id)) return o;
        const next = { ...o };
        delete next.group;
        return next;
      });
      return undefined;
    }
    case 'moveNode': {
      const id = nodeOf(doc, args[0] as string, 'moveNode');
      const to = args[1] as MapPoint;
      editRoads(kit.editor, kit.catalog, 'Move road node', (paths) => moveNode(paths, id, { x: r2(to.x), y: r2(to.y) }));
      return undefined;
    }
    case 'splitRoad': {
      const edge = edgeOf(doc, args[0] as string, 'splitRoad');
      let node: string | null = null;
      editRoads(kit.editor, kit.catalog, 'Split road', (paths) => (node = splitEdge(paths, edge, args[1] as MapPoint)?.id ?? null));
      if (!node) throw new ScriptError(`map.splitRoad: road ${edge} could not be split there`);
      return node;
    }
    case 'mergeNodes': {
      const from = nodeOf(doc, args[0] as string, 'mergeNodes');
      const into = nodeOf(doc, args[1] as string, 'mergeNodes');
      editRoads(kit.editor, kit.catalog, 'Join road nodes', (paths) => mergeNodes(paths, from, into));
      return undefined;
    }
    case 'removeNode': {
      const id = nodeOf(doc, args[0] as string, 'removeNode');
      editRoads(kit.editor, kit.catalog, 'Delete road node', (paths) => deleteNode(paths, id));
      return undefined;
    }
    case 'dissolveNode': {
      const id = nodeOf(doc, args[0] as string, 'dissolveNode');
      let done = false;
      editRoads(kit.editor, kit.catalog, 'Join roads', (paths) => (done = dissolveNode(paths, id)));
      if (!done) throw new ScriptError(`map.dissolveNode: node ${id} does not join exactly two roads`);
      return undefined;
    }
    case 'connectNodes': {
      const from = nodeOf(doc, args[0] as string, 'connectNodes');
      const to = nodeOf(doc, args[1] as string, 'connectNodes');
      const o = roadPatch((args[2] ?? {}) as Record<string, unknown>, 'connectNodes');
      let edge: string | null = null;
      editRoads(kit.editor, kit.catalog, 'Connect road nodes', (paths) => {
        const e = connect(paths, from, to, o.width, o.kind);
        if (e && o.style) e.style = o.style;
        edge = e?.id ?? null;
      });
      if (!edge) throw new ScriptError(`map.connectNodes: ${from} and ${to} are one node or joined already`);
      return edge;
    }
    case 'editRoads': {
      const ids = new Set((args[0] as string[]).map((id) => edgeOf(doc, id, 'editRoads')));
      const patch = roadPatch(args[1] as Record<string, unknown>, 'editRoads');
      editRoads(kit.editor, kit.catalog, 'Road', (paths) => (paths.edges = paths.edges.map((e) => (ids.has(e.id) ? { ...e, ...patch } : e))));
      return undefined;
    }
    case 'smoothRoad': {
      const edge = edgeOf(doc, args[0] as string, 'smoothRoad');
      editRoads(kit.editor, kit.catalog, 'Smooth road', (paths) => smoothEdge(paths, edge, (args[1] as number | undefined) ?? 8));
      return undefined;
    }
    case 'straightenRoad': {
      const edge = edgeOf(doc, args[0] as string, 'straightenRoad');
      editRoads(kit.editor, kit.catalog, 'Straighten road', (paths) => straightenEdge(paths, edge));
      return undefined;
    }
    case 'moveSpawn':
    case 'renameSpawn': {
      const id = args[0] as string;
      if (!doc.spawns.some((s) => s.id === id)) throw new ScriptError(`map.${command.op}: there is no spawn ${id}; spawns: ${doc.spawns.map((s) => s.id).join(', ') || 'none'}`);
      const patch = command.op === 'moveSpawn' ? { x: r2(args[1] as number), y: r2(args[2] as number) } : { name: (args[1] as string).trim().slice(0, 40) };
      doc.spawns = doc.spawns.map((s) => (s.id === id ? { ...s, ...patch } : s));
      return undefined;
    }
    case 'removeLayer': {
      const material = args[0] as string;
      const k = doc.terrain.layers.findIndex((l) => l.material === material);
      if (k < 0) throw new ScriptError(`map.removeLayer: no ground layer is ${material}; layers: ${doc.terrain.layers.map((l) => l.material).join(', ')}`);
      if (doc.terrain.layers.length <= 1) throw new ScriptError('map.removeLayer: the map keeps at least one ground layer');
      removeLayer(doc.terrain, k);
      return undefined;
    }
    case 'moveRiverPoint':
    case 'addRiverPoint':
    case 'removeRiverPoint':
    case 'riverWidth':
    case 'simplifyRiver':
      return reshapeRiver(kit, command);
    case 'riverKind': {
      const k = riverOf(doc, args[0] as string, 'riverKind');
      doc.terrain.rivers![k] = { ...doc.terrain.rivers![k], kind: args[1] as MapRiver['kind'] };
      kit.editor.emit({ water: true });
      return undefined;
    }
    case 'carveRiverBed': {
      const k = riverOf(doc, args[0] as string, 'carveRiverBed');
      const stroke = new LandscapeStroke(kit.editor, 'Carve the river bed', 1, kit.catalog);
      relevelRiver(stroke, doc.terrain.rivers![k]);
      recarveRiver(stroke, doc.terrain.rivers![k]);
      stroke.finish();
      return undefined;
    }
    case 'removeRiver':
      removeWholeRiver(kit.editor, riverOf(doc, args[0] as string, 'removeRiver'), kit.catalog);
      return undefined;
  }
  const method = (kit as unknown as Record<string, (...x: unknown[]) => unknown>)[command.op];
  if (typeof method !== 'function') throw new ScriptError(`map.${command.op} is no command`);
  return method.apply(kit, args);
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** The ids, all of objects on the map; an unknown one stops the script */
function objectsOf(doc: CustomMapDocument, ids: readonly string[], op: string): string[] {
  const known = new Set(doc.objects.map((o) => o.id));
  const missing = ids.filter((id) => !known.has(id));
  if (missing.length) throw new ScriptError(`map.${op}: there are no objects ${missing.slice(0, 10).join(', ')}; map.objects() lists them`);
  return [...ids];
}

function nodeOf(doc: CustomMapDocument, id: string, op: string): string {
  if (!nodeById(doc.paths, id)) throw new ScriptError(`map.${op}: there is no road node ${id}; map.nodes() lists them`);
  return id;
}

function edgeOf(doc: CustomMapDocument, id: string, op: string): string {
  if (!doc.paths.edges.some((e) => e.id === id)) throw new ScriptError(`map.${op}: there is no road ${id}; roads: ${doc.paths.edges.map((e) => e.id).join(', ') || 'none'}`);
  return id;
}

function riverOf(doc: CustomMapDocument, id: string, op: string): number {
  const k = (doc.terrain.rivers ?? []).findIndex((r) => r.id === id);
  if (k < 0) throw new ScriptError(`map.${op}: there is no river ${id}; rivers: ${(doc.terrain.rivers ?? []).map((r) => r.id).join(', ') || 'none'}`);
  return k;
}

/** A road's width, kind and bridge style from a script's options, checked */
function roadPatch(o: Record<string, unknown>, op: string): { width?: number; kind?: MapPathKind; style?: MapBridgeStyle } {
  const unknown = Object.keys(o).filter((k) => !['width', 'kind', 'style'].includes(k));
  if (unknown.length) throw new ScriptError(`map.${op}: a road knows no ${unknown.join(', ')}; it has width, kind, style`);
  if (o['width'] !== undefined && (typeof o['width'] !== 'number' || o['width'] < 1 || o['width'] > 60)) throw new ScriptError(`map.${op}: width must lie in 1..60`);
  if (o['kind'] !== undefined && !PATH_KINDS.includes(o['kind'] as never)) throw new ScriptError(`map.${op}: kind must be one of ${PATH_KINDS.join(', ')}`);
  if (o['style'] !== undefined && !BRIDGE_STYLES.includes(o['style'] as never)) throw new ScriptError(`map.${op}: style must be one of ${BRIDGE_STYLES.join(', ')}`);
  return o as { width?: number; kind?: MapPathKind; style?: MapBridgeStyle };
}

const OBJECT_SET = ['x', 'y', 'z', 'rotation', 'scale', 'pitch', 'roll'] as const;

/** map.changeObjects: values set, dx, dy and turn added */
function changeObjects(doc: CustomMapDocument, ids: readonly string[], patch: Record<string, unknown>): void {
  const set = new Set(objectsOf(doc, ids, 'changeObjects'));
  const keys = [...OBJECT_SET, 'tint', 'blocksBuild', 'blocksLos', 'dx', 'dy', 'turn'];
  const unknown = Object.keys(patch).filter((k) => !keys.includes(k));
  if (unknown.length) throw new ScriptError(`map.changeObjects: an object knows no ${unknown.join(', ')}; it has ${keys.join(', ')}`);
  for (const k of [...OBJECT_SET, 'dx', 'dy', 'turn']) if (patch[k] !== undefined && typeof patch[k] !== 'number') throw new ScriptError(`map.changeObjects: ${k} must be a number`);
  if (typeof patch['scale'] === 'number' && patch['scale'] <= 0) throw new ScriptError('map.changeObjects: scale must be above 0');
  for (const k of ['blocksBuild', 'blocksLos']) if (patch[k] !== undefined && typeof patch[k] !== 'boolean') throw new ScriptError(`map.changeObjects: ${k} must be true or false`);
  if (patch['tint'] !== undefined && (typeof patch['tint'] !== 'string' || !/^#[0-9a-f]{6}$/i.test(patch['tint']))) throw new ScriptError('map.changeObjects: tint must be a colour like #aabbcc');
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  doc.objects = doc.objects.map((o) => {
    if (!set.has(o.id)) return o;
    const next: MapObject = { ...o };
    for (const k of OBJECT_SET) if (typeof patch[k] === 'number') next[k] = r3(patch[k] as number);
    if (typeof patch['dx'] === 'number') next.x = r3(next.x + patch['dx']);
    if (typeof patch['dy'] === 'number') next.y = r3(next.y + patch['dy']);
    if (typeof patch['turn'] === 'number') next.rotation = r3(next.rotation + patch['turn']);
    if (typeof patch['tint'] === 'string') next.tint = patch['tint'];
    for (const k of ['blocksBuild', 'blocksLos'] as const) if (typeof patch[k] === 'boolean') next[k] = patch[k] as boolean;
    return next;
  });
}

/** A river's course or width changed in place: its bed follows (relayRiver), as in the Water panel */
function reshapeRiver(kit: MapKit, command: ScriptCommand): unknown {
  const doc = kit.doc;
  const args = command.args;
  const k = riverOf(doc, args[0] as string, command.op);
  const before = structuredClone(doc.terrain.rivers);
  const river = doc.terrain.rivers![k];
  let out: unknown;
  switch (command.op) {
    case 'moveRiverPoint': {
      const index = args[1] as number;
      if (index >= river.points.length) throw new ScriptError(`map.moveRiverPoint: river ${river.id} has points 0..${river.points.length - 1}`);
      movePoint(river, index, args[2] as MapPoint);
      break;
    }
    case 'addRiverPoint': {
      const segment = args[1] as number;
      if (segment >= river.points.length) throw new ScriptError(`map.addRiverPoint: river ${river.id} has segments 1..${river.points.length - 1}`);
      out = insertPoint(river, segment, args[2] as number);
      break;
    }
    case 'removeRiverPoint': {
      const index = args[1] as number;
      if (index >= river.points.length) throw new ScriptError(`map.removeRiverPoint: river ${river.id} has points 0..${river.points.length - 1}`);
      if (!removePoint(river, index)) throw new ScriptError(`map.removeRiverPoint: a river keeps at least two points; map.removeRiver takes it away`);
      break;
    }
    case 'riverWidth':
      setMeanWidth(river, args[1] as number);
      break;
    case 'simplifyRiver':
      simplifyRiver(river, Math.max(1.5, meanWidth(river) / 6));
      break;
  }
  relayRiver(kit.editor, kit.catalog, 'River', k, before);
  return out;
}

/**
 * map.heightGrid: each ground sample inside the grid takes the grid's height
 * there (bilinear between its samples), mixed by `blend` and faded out over
 * `edge` metres toward the grid's border
 */
function applyHeightGrid(doc: CustomMapDocument, origin: MapPoint, step: number, rows: number[][], options: { blend?: number; edge?: number }): void {
  const t = doc.terrain;
  const g = t.grid;
  const blend = Math.min(1, Math.max(0, options.blend ?? 1));
  const edge = Math.max(0, options.edge ?? 0);
  const ny = rows.length;
  const nx = rows[0].length;
  const width = (nx - 1) * step;
  const depth = (ny - 1) * step;
  for (let j = 0; j < g.rows; j++) {
    const y = j * g.cellSize - t.depth / 2;
    const v = (y - origin.y) / step;
    if (v < 0 || v > ny - 1) continue;
    for (let i = 0; i < g.columns; i++) {
      const x = i * g.cellSize - t.width / 2;
      const u = (x - origin.x) / step;
      if (u < 0 || u > nx - 1) continue;
      const i0 = Math.min(Math.floor(u), nx - 2);
      const j0 = Math.min(Math.floor(v), ny - 2);
      const fu = u - i0;
      const fv = v - j0;
      const h = (rows[j0][i0] * (1 - fu) + rows[j0][i0 + 1] * fu) * (1 - fv) + (rows[j0 + 1][i0] * (1 - fu) + rows[j0 + 1][i0 + 1] * fu) * fv;
      let w = blend;
      if (edge > 0) {
        const inside = Math.min(x - origin.x, origin.x + width - x, y - origin.y, origin.y + depth - y);
        const f = Math.min(1, inside / edge);
        w *= f * f * (3 - 2 * f);
      }
      const k = j * g.columns + i;
      g.heights[k] += (h - g.heights[k]) * w;
    }
  }
}

const RULE_KEYS = ['startCredits', 'hqHealth', 'towers', 'waves', 'lanes', 'destructible', 'difficulty'];
const WAVES_EXAMPLE =
  "waves is { kind: 'budget' } (the game's waves, the default) or { kind: 'table', table } with a map's own list (read_map of a shipped map shows one); " +
  "there is no wave count. Example: { waves: { kind: 'budget' }, difficulty: 120 }";

/**
 * A rules patch with known keys and waves in their shape; the map file checks
 * the numbers. The errors say the shape, with an example: agents gave
 * `waves: 30` and lost a whole script to "waves.kind must be budget or table"
 */
export function checkRules(patch: Record<string, unknown>): Partial<NonNullable<CustomMapDocument['gameplay']>> {
  const unknown = Object.keys(patch).filter((k) => !RULE_KEYS.includes(k));
  if (unknown.length) throw new ScriptError(`the rules know no ${unknown.join(', ')}; they are ${RULE_KEYS.join(', ')}`);
  const waves = patch['waves'] as { kind?: unknown; table?: unknown } | undefined;
  if (waves !== undefined) {
    const ok = !!waves && typeof waves === 'object' && (waves.kind === 'budget' || (waves.kind === 'table' && !!waves.table && typeof waves.table === 'object'));
    if (!ok) throw new ScriptError(`rules: ${WAVES_EXAMPLE}, not ${JSON.stringify(waves)}`);
  }
  return patch as Partial<NonNullable<CustomMapDocument['gameplay']>>;
}

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
    } else if (key === 'planet') {
      const p = value as Record<string, unknown> | null;
      if (!p || typeof p !== 'object' || !['azimuth', 'elevation', 'size'].every((k) => typeof p[k] === 'number') || (p['size'] as number) < 0) {
        throw new ScriptError(`${where} must be { azimuth degrees, elevation degrees, size degrees (0 none) }`);
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
  const reads: Record<string, unknown> = {
    h: (x: number, y: number) => kit.h(finite(x, 'map.h: x'), finite(y, 'map.h: y')),
    slope: (x: number, y: number) => kit.slope(finite(x, 'map.slope: x'), finite(y, 'map.slope: y')),
    noise: (x: number, y: number, wave: number, octaves?: number) => kit.noise.fbm(finite(x, 'x'), finite(y, 'y'), finite(wave, 'wave'), Math.min(8, Math.max(1, octaves ?? 4))),
    ridged: (x: number, y: number, wave: number, octaves?: number) => kit.noise.ridged(finite(x, 'x'), finite(y, 'y'), finite(wave, 'wave'), Math.min(8, Math.max(1, octaves ?? 5))),
    objects: (rect?: Rect) => forScript(doc.objects.filter((o) => inRect(o, rect))),
    markers: () => forScript({ hq: doc.hq, spawns: doc.spawns }),
    roads: () => forScript(doc.paths.edges.map((e) => ({ id: e.id, a: e.a, b: e.b, kind: e.kind, width: e.width, ...(e.style ? { style: e.style } : {}), points: edgePolyline(doc.paths, e) }))),
    nodes: () => forScript(doc.paths.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, roads: doc.paths.edges.filter((e) => e.a === n.id || e.b === n.id).map((e) => e.id) }))),
    rivers: () => forScript((t().rivers ?? []).map((r) => ({ id: r.id, kind: r.kind, width: Math.round(meanWidth(r) * 10) / 10, points: r.points }))),
    layers: () => t().layers.map((l) => l.material),
    waterBodies: () =>
      forScript({
        main: t().water ? { level: t().water!.level, kind: t().water!.kind ?? 'water' } : null,
        bodies: (t().waterBodies ?? []).map((b, index) => ({ index, level: b.level, kind: b.kind ?? 'water' })),
        rivers: (t().rivers ?? []).map((r) => ({ id: r.id, kind: r.kind })),
      }),
    lanes: () => kit.lanes(),
    issues: () => kit.issues().map((i) => ({ severity: i.severity, message: i.message })),
    life: () => forScript(doc.life ?? {}),
  };
  // A read named like a command would hide it (map.water once read the water instead of making it)
  for (const name of Object.keys(reads)) if (name in api) throw new Error(`map.${name} is both a command and a read`);
  Object.assign(api, reads);
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
