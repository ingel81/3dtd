import { VACANT_LANES } from './lane-choice';
import { DEFAULT_ENVIRONMENT } from './map-create';
import {
  MAP_BIOMES,
  MAP_BRIDGE_STYLES,
  MAP_PATH_KINDS,
  MAP_RIVER_KINDS,
  MAP_SKIES,
  MAP_WATER_KINDS,
  MAP_WAVE_EVENT_KINDS,
  MAP_WEATHERS,
  MASS_ASSET,
  MAP_OBJECT_DAMAGE,
  MAX_MAP_PREFABS,
  MAX_SIGN_TEXT,
  STRUCTURE_HP_SCALE,
  WAVE_EVENT_LIMITS,
  isTypedArray,
  type CustomMapDocument,
  type MapEnvironment,
  type MapLife,
  type MapLifeArea,
  type MapPrefab,
  type MapSurface,
  type MapWaveEvent,
} from './map-document';
import { mapProblemText, type MapProblem, type MapProblemPart, type MapText, type MapThing } from './map-text';
import { introProblems } from './map-intro';
import { massProblem } from './object-mass';
import { BIRD_SPECIES, lifeProblems, MAX_LIFE_AREAS } from './map-life';
import { markingProblems, MAX_SURFACES, surfaceProblems } from './map-surfaces';
import type { Messages } from '../../i18n/messages/en';

/**
 * The content of a map file, checked softly: a file from outside (an
 * import, a coop host, another game version) may carry a value wrong, a
 * value of a list this game does not know (a newer biome, a newer kind of
 * wave event) or a thing that is broken. Reading sets each right and says
 * what it changed (unpackMapFile; the banner in the editor and in the
 * game), the editor's check names them as warnings, saving writes them as
 * they are. The rule: a value of a list falls back to its default, a broken
 * thing (an object, a river, a life area, a surface, a wave event, a prefab,
 * the intro flight) is left out, a number is brought into its range. Nothing here
 * refuses a map: validateMapDocument holds the hard rules of the structure
 * (grid, masks, roads, spawns, HQ, ids of the road graph), which would
 * (docs/CUSTOM_MAPS.md, "Format rules").
 *
 * Coop and replays: what this does depends on the file alone (no clock, no
 * chance), so every client of one build reads one file the same.
 */

/** Most objects a map keeps (an OSM city has some 30 000); the rest is dropped on reading */
export const MAX_MAP_OBJECTS = 100_000;
/** Most road nodes and edges a map should have; more is only reported (dropping some would cut the routes) */
export const MAX_MAP_PATH_PARTS = 100_000;
/** Longest texts of a map's details, characters */
export const MAX_MAP_TEXT = { name: 80, author: 80, description: 2000 } as const;

const COLOR = /^#[0-9a-f]{6}$/i;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * What of `doc` is out of range, of a value this game does not know or
 * broken, as problems of their part; with `fix`, each is set right in place
 * as it says (a number to its range, a value to its default, a doubled
 * spawn id to a new one, a broken thing left out). Once fixed, a document
 * has nothing more to fix
 */
export function mapRepairs(doc: CustomMapDocument, fix = false): MapProblem[] {
  const out: MapProblem[] = [];

  const meta = doc.meta;
  if (meta) {
    for (const key of ['name', 'author', 'description'] as const) {
      const text = meta[key];
      if (typeof text !== 'string' || text.length <= MAX_MAP_TEXT[key]) continue;
      out.push({ text: { key: 'cut', v: { what: `meta.${key}`, max: MAX_MAP_TEXT[key] } }, part: 'meta' });
      if (fix) meta[key] = text.slice(0, MAX_MAP_TEXT[key]);
    }
  }

  environmentRepairs(doc, fix, out);
  terrainRepairs(doc, fix, out);
  objectRepairs(doc, fix, out);
  lineRepairs(doc, fix, out);

  const paths = doc.paths;
  if (paths && Array.isArray(paths.nodes) && Array.isArray(paths.edges)) {
    for (const e of paths.edges) {
      if (!e || typeof e !== 'object') continue;
      const at = { kind: 'edge' as const, id: e.id };
      if (!MAP_PATH_KINDS.includes(e.kind)) {
        out.push({ text: { key: 'unknownNow', v: { what: 'kind', value: String(e.kind), now: 'road' }, of: { kind: 'edge', id: e.id } }, part: 'paths', at });
        if (fix) e.kind = 'road';
      }
      if (e.style !== undefined && !MAP_BRIDGE_STYLES.includes(e.style)) {
        out.push({ text: { key: 'unknownDefault', v: { what: 'style', value: String(e.style) }, of: { kind: 'edge', id: e.id } }, part: 'paths', at });
        if (fix) delete e.style;
      }
    }
    if (paths.nodes.length > MAX_MAP_PATH_PARTS || paths.edges.length > MAX_MAP_PATH_PARTS) {
      out.push({ text: { key: 'manyRoads', v: { nodes: paths.nodes.length, edges: paths.edges.length, max: MAX_MAP_PATH_PARTS } }, part: 'paths' });
    }
  }

  if (Array.isArray(doc.spawns)) {
    const ids = new Set<string>();
    doc.spawns.forEach((sp, k) => {
      if (!sp || typeof sp !== 'object') return;
      // Lanes, wave portals and coop lanes go by the id: two spawns of one id are one lane twice
      if (typeof sp.id !== 'string' || !sp.id || ids.has(sp.id)) {
        let id = `spawn-${k + 1}`;
        for (let n = 2; ids.has(id) || doc.spawns.some((other) => other !== sp && other?.id === id); n++) id = `spawn-${k + 1}-${n}`;
        out.push({ text: { key: 'spawnId', v: { n: k + 1, id: String(JSON.stringify(sp.id)), twice: !!sp.id && typeof sp.id === 'string', now: id } }, part: 'spawns', at: { kind: 'spawn', id: typeof sp.id === 'string' ? sp.id : undefined } });
        if (fix) sp.id = id;
        ids.add(id);
      } else ids.add(sp.id);
      if (typeof sp.name !== 'string') {
        out.push({ text: { key: 'spawnName', v: { n: k + 1 } }, part: 'spawns' });
        if (fix) sp.name = `Spawn ${k + 1}`;
      }
      if (sp.optional !== undefined && typeof sp.optional !== 'boolean') {
        out.push({ text: { key: 'spawnOptional', v: { n: k + 1, value: String(JSON.stringify(sp.optional)) } }, part: 'spawns' });
        if (fix) delete sp.optional;
      }
    });
  }

  gameplayRepairs(doc, fix, out);
  prefabRepairs(doc, fix, out);
  lifeRepairs(doc, fix, out);
  surfaceRepairs(doc, fix, out);

  const intro = introProblems(doc.intro);
  if (intro.length) {
    out.push({ text: intro[0], then: 'ownIntro', part: 'intro' });
    if (fix) delete doc.intro;
  }
  return out;
}

/** What the game and the editor tell the player of a map that reading set right or left parts of (UnpackedMap.repaired) */
export function repairedMapText(t: Messages, name: string, repaired: readonly MapProblem[]): string {
  return t.check.repairedMap(name, mapProblemText(t, repaired[0]), repaired.length - 1);
}

/** Pushes the problems of one part */
function sayer(out: MapProblem[], part: MapProblemPart): (text: MapText, then?: MapProblem['then']) => void {
  return (text, then) => out.push(then ? { text, then, part } : { text, part });
}

function environmentRepairs(doc: CustomMapDocument, fix: boolean, out: MapProblem[]): void {
  if (!isObject(doc.environment)) {
    out.push({ text: { key: 'noEnvironment' }, part: 'environment' });
    if (fix) doc.environment = { ...DEFAULT_ENVIRONMENT };
    return;
  }
  const env = doc.environment as MapEnvironment;
  const say = sayer(out, 'environment');
  if (!MAP_SKIES.includes(env.sky)) {
    say({ key: 'unknownNow', v: { what: 'environment.sky', value: String(env.sky), now: DEFAULT_ENVIRONMENT.sky } });
    if (fix) env.sky = DEFAULT_ENVIRONMENT.sky;
  }
  if (env.biome !== undefined && !MAP_BIOMES.includes(env.biome)) {
    say({ key: 'unknownTemperate', v: { value: String(env.biome) } });
    if (fix) delete env.biome;
  }
  // An unknown sky id is no problem at all: a map from a newer game shows the procedural sky here
  if (env.skyImage !== undefined && typeof env.skyImage !== 'string') {
    say({ key: 'skyImage' });
    if (fix) delete env.skyImage;
  }
  const planet = env.planet;
  if (planet !== undefined && (!isObject(planet) || !finite(planet.azimuth) || !finite(planet.elevation) || !finite(planet.size) || planet.size < 0)) {
    say({ key: 'planet' });
    if (fix) delete env.planet;
  }
  const wind = env.wind;
  if (wind !== undefined && (!isObject(wind) || !finite(wind.strength) || !finite(wind.direction) || !finite(wind.gusts))) {
    say({ key: 'wind' });
    if (fix) delete env.wind;
  }
  const range = (key: 'sunAzimuth' | 'sunElevation' | 'fogDensity', min: number, max: number) => {
    const v = env[key];
    if (finite(v) && v >= min && v <= max) return;
    const set = finite(v) ? Math.min(max, Math.max(min, v)) : DEFAULT_ENVIRONMENT[key];
    say({ key: 'rangeNow', v: { what: `environment.${key}`, value: String(v), min, max, now: set } });
    if (fix) env[key] = set;
  };
  range('sunAzimuth', -Infinity, Infinity);
  range('sunElevation', -90, 90);
  range('fogDensity', 0, 0.05);
  if (typeof env.tint !== 'string' || !COLOR.test(env.tint)) {
    say({ key: 'tintWhite', v: { what: 'environment.tint', value: String(env.tint) } });
    if (fix) env.tint = DEFAULT_ENVIRONMENT.tint;
  }
  if (env.weather !== undefined && !MAP_WEATHERS.includes(env.weather)) {
    say({ key: 'unknownClear', v: { value: String(env.weather) } });
    if (fix) delete env.weather;
  }
  for (const key of ['weatherStrength', 'snowCover', 'moonlight'] as const) {
    const v = env[key];
    if (v === undefined || (finite(v) && v >= 0 && v <= 1)) continue;
    say({ key: 'unitRange', v: { what: `environment.${key}`, value: String(v), cut: finite(v) } });
    if (fix) {
      if (finite(v)) env[key] = Math.min(1, Math.max(0, v));
      else delete env[key];
    }
  }
}

function terrainRepairs(doc: CustomMapDocument, fix: boolean, out: MapProblem[]): void {
  const t = doc.terrain;
  if (!t) return;
  const say = sayer(out, 'terrain');
  if (Array.isArray(t.layers)) {
    t.layers.forEach((layer, k) => {
      if (!layer || layer.scale === undefined || (finite(layer.scale) && layer.scale > 0)) return;
      say({ key: 'layerScale', v: { value: String(layer.scale) }, of: { kind: 'groundLayer', id: k + 1 } });
      if (fix) delete layer.scale;
    });
  }
  if (typeof t.cliffMaterial !== 'string') {
    say({ key: 'cliffMaterial' });
    if (fix) t.cliffMaterial = 'cliff';
  }
  const bodies = [t.water, ...(Array.isArray(t.waterBodies) ? t.waterBodies : [])];
  bodies.forEach((body, k) => {
    if (!isObject(body) || body.kind === undefined || MAP_WATER_KINDS.includes(body.kind)) return;
    say({ key: 'unknownNow', v: { what: 'kind', value: String(body.kind), now: 'water' }, of: k ? { kind: 'waterBody', id: k } : { kind: 'water' } });
    if (fix) delete body.kind;
  });
  // A crater without a finite middle or a radius is left out, without a word: nothing but its lake hangs on it
  if (Array.isArray(t.craters) && fix) t.craters = t.craters.filter((c) => isObject(c) && Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.radius) && c.radius > 0);
  if (!Array.isArray(t.rivers)) return;
  const kept = t.rivers.filter((river) => {
    const problem = riverProblem(river);
    if (problem) {
      say(problem, 'leftOut');
      return false;
    }
    if (!MAP_RIVER_KINDS.includes(river.kind)) {
      say({ key: 'unknownNow', v: { what: 'kind', value: String(river.kind), now: 'water' }, of: { kind: 'river', id: river.id } });
      if (fix) river.kind = 'water';
    }
    return true;
  });
  if (fix && kept.length !== t.rivers.length) t.rivers = kept;
}

function riverProblem(river: unknown): MapText | null {
  if (!isObject(river)) return { key: 'notObject', v: { what: { kind: 'river' } } };
  const { id, points } = river;
  if (typeof id !== 'string' || !id) return { key: 'noId', v: { what: { kind: 'river' } } };
  const what: MapThing = { kind: 'river', id };
  if (!Array.isArray(points) || points.length < 2) return { key: 'twoPoints', v: { what } };
  if (points.some((q) => !isObject(q) || ![q['x'], q['y'], q['width'], q['height']].every(finite) || (q['width'] as number) <= 0)) return { key: 'badPoint', v: { what } };
  return null;
}

/** The lines (version 5): one without an id of its own or two points is left out; its pieces stand alone */
function lineRepairs(doc: CustomMapDocument, fix: boolean, out: MapProblem[]): void {
  if (doc.lines === undefined) return;
  if (!Array.isArray(doc.lines)) {
    out.push({ text: { key: 'list', v: { what: 'lines' } }, then: 'leftOut', part: 'lines' });
    if (fix) delete doc.lines;
    return;
  }
  const ids = new Set<string>();
  const kept = doc.lines.filter((line) => {
    const problem = lineProblem(line, ids);
    if (problem) {
      out.push({ text: problem, then: 'leftOut', part: 'lines' });
      return false;
    }
    ids.add(line.id);
    return true;
  });
  if (fix && kept.length !== doc.lines.length) doc.lines = kept;
}

function lineProblem(line: unknown, ids: ReadonlySet<string>): MapText | null {
  if (!isObject(line)) return { key: 'notObject', v: { what: { kind: 'line' } } };
  const { id, points } = line;
  if (typeof id !== 'string' || !id || ids.has(id)) return { key: 'idTwice', v: { kind: 'line', id: String(id) } };
  const what: MapThing = { kind: 'line', id };
  if (!Array.isArray(points) || points.length < 2) return { key: 'twoPoints', v: { what } };
  if (points.some((q) => !isObject(q) || ![q['x'], q['y']].every(finite))) return { key: 'badPoint', v: { what } };
  return null;
}

function objectRepairs(doc: CustomMapDocument, fix: boolean, out: MapProblem[]): void {
  if (!Array.isArray(doc.objects)) return;
  const ids = new Set<string>();
  const kept = doc.objects.filter((o) => {
    const problem = objectProblem(o, ids);
    if (problem) {
      const id = isObject(o) && typeof o['id'] === 'string' && o['id'] ? o['id'] : undefined;
      out.push({ text: problem, then: 'leftOut', part: 'objects', ...(id ? { at: { kind: 'object' as const, id } } : {}) });
      return false;
    }
    ids.add(o.id);
    const at = { kind: 'object' as const, id: o.id };
    const of: MapThing = { kind: 'object', id: o.id };
    for (const key of ['blocksLos', 'blocksBuild'] as const) {
      if (o[key] === undefined || typeof o[key] === 'boolean') continue;
      out.push({ text: { key: 'boolCatalogue', v: { what: key, value: String(JSON.stringify(o[key])) }, of }, part: 'objects', at });
      if (fix) delete o[key];
    }
    if (o.destructible !== undefined && typeof o.destructible !== 'boolean') {
      out.push({ text: { key: 'boolKind', v: { value: String(JSON.stringify(o.destructible)) }, of }, part: 'objects', at });
      if (fix) delete o.destructible;
    }
    if (o.damage !== undefined && !(MAP_OBJECT_DAMAGE as readonly unknown[]).includes(o.damage)) {
      out.push({ text: { key: 'damage', v: { value: String(JSON.stringify(o.damage)) }, of }, part: 'objects', at });
      if (fix) delete o.damage;
    }
    if (o.damageSeed !== undefined && !Number.isInteger(o.damageSeed)) {
      out.push({ text: { key: 'damageSeed', v: { value: String(JSON.stringify(o.damageSeed)) }, of }, part: 'objects', at });
      if (fix) delete o.damageSeed;
    }
    if (o.tint !== undefined && (typeof o.tint !== 'string' || !COLOR.test(o.tint))) {
      out.push({ text: { key: 'tintNone', v: { value: String(o.tint) }, of }, part: 'objects', at });
      if (fix) delete o.tint;
    }
    if (o.line !== undefined && (typeof o.line !== 'string' || !o.line)) {
      out.push({ text: { key: 'badLine', v: { what: of } }, part: 'objects', at });
      if (fix) delete o.line;
    }
    if (o.sign !== undefined && !goodSign(o.sign)) {
      out.push({ text: { key: 'sign', v: { max: MAX_SIGN_TEXT }, of }, part: 'objects', at });
      if (fix) delete o.sign;
    }
    return true;
  });
  if (kept.length > MAX_MAP_OBJECTS) {
    out.push({ text: { key: 'manyObjects', v: { count: kept.length, max: MAX_MAP_OBJECTS } }, part: 'objects' });
    kept.length = MAX_MAP_OBJECTS;
  }
  if (fix && kept.length !== doc.objects.length) doc.objects = kept;
}

/** A sign of text and pictogram name, both optional strings, the text not longer than MAX_SIGN_TEXT */
function goodSign(sign: unknown): boolean {
  if (!isObject(sign)) return false;
  const { text, icon } = sign;
  return (text === undefined || (typeof text === 'string' && text.length <= MAX_SIGN_TEXT)) && (icon === undefined || (typeof icon === 'string' && icon.length <= 32));
}

/** Why object `o` cannot stand in a map; null when it can. `ids`: the ids of the objects kept before it */
function objectProblem(o: unknown, ids: ReadonlySet<string>): MapText | null {
  if (!isObject(o)) return { key: 'notObject', v: { what: { kind: 'object' } } };
  const id = o['id'];
  if (typeof id !== 'string' || !id || ids.has(id)) return { key: 'idTwice', v: { kind: 'object', id: String(id) } };
  const what: MapThing = { kind: 'object', id };
  if (typeof o['asset'] !== 'string' || !o['asset']) return { key: 'noAsset', v: { what } };
  if (![o['x'], o['y'], o['z'], o['rotation'], o['scale']].every(finite) || (o['scale'] as number) <= 0) return { key: 'badPlacement', v: { what } };
  if (o['stretch'] !== undefined && (!finite(o['stretch']) || (o['stretch'] as number) <= 0)) return { key: 'badPlacement', v: { what } };
  if (o['group'] !== undefined && typeof o['group'] !== 'string') return { key: 'badGroup', v: { what } };
  if ((o['pitch'] !== undefined && !finite(o['pitch'])) || (o['roll'] !== undefined && !finite(o['roll']))) return { key: 'badTilt', v: { what } };
  if (o['mass'] !== undefined || o['asset'] === MASS_ASSET) {
    const problem = massProblem(o['mass']);
    if (problem) return { ...problem, of: what };
  }
  return null;
}

function gameplayRepairs(doc: CustomMapDocument, fix: boolean, out: MapProblem[]): void {
  const gp = doc.gameplay;
  if (!gp || typeof gp !== 'object') return;
  const say = sayer(out, 'gameplay');
  const lanes = gp.lanes;
  if (lanes && typeof lanes === 'object' && lanes.vacant !== undefined && !VACANT_LANES.includes(lanes.vacant)) {
    say({ key: 'unknownDefault', v: { what: 'gameplay.lanes.vacant', value: String(lanes.vacant) } });
    if (fix) delete lanes.vacant;
  }
  // Destruction beyond `destructible` (docs/DESTRUCTION_PLAN.md): soft, a wrong value plays as without it
  for (const key of ['craters', 'wear'] as const) {
    if (gp[key] === undefined || typeof gp[key] === 'boolean') continue;
    say({ key: 'boolDefault', v: { what: `gameplay.${key}`, value: String(JSON.stringify(gp[key])) } });
    if (fix) delete gp[key];
  }
  const hp = gp.structureHp as unknown;
  if (hp !== undefined && !(typeof hp === 'number' && Number.isFinite(hp) && hp >= STRUCTURE_HP_SCALE.min && hp <= STRUCTURE_HP_SCALE.max)) {
    say({ key: 'structureHp', v: { value: String(JSON.stringify(hp)), min: STRUCTURE_HP_SCALE.min, max: STRUCTURE_HP_SCALE.max } });
    if (fix) delete gp.structureHp;
  }
  const waves = gp.waves as unknown;
  if (waves !== undefined && (!isObject(waves) || (waves['kind'] !== 'budget' && waves['kind'] !== 'table'))) {
    say({ key: 'unknownWaves', v: { value: isObject(waves) ? String(waves['kind']) : String(waves) } });
    if (fix) delete gp.waves;
  }
  const events = gp.events as unknown;
  if (events === undefined) return;
  if (!Array.isArray(events)) {
    say({ key: 'noEvents' });
    if (fix) delete gp.events;
    return;
  }
  const kept = (events as MapWaveEvent[]).filter((e, k) => {
    const problem = waveEventProblem(e, k);
    if (problem) say(problem, 'leftOut');
    return !problem;
  });
  if (kept.length > WAVE_EVENT_LIMITS.events) {
    say({ key: 'manyEvents', v: { count: kept.length, max: WAVE_EVENT_LIMITS.events } });
    kept.length = WAVE_EVENT_LIMITS.events;
  }
  if (fix && kept.length !== events.length) gp.events = kept;
}

/** What is wrong with wave event k of a map, or null (its shape; the editor's check names spawns and objects that are gone) */
function waveEventProblem(e: MapWaveEvent, k: number): MapText | null {
  const of: MapThing = { kind: 'waveEvent', id: k + 1 };
  if (!isObject(e)) return { key: 'notObject', v: { what: of } };
  if (!Number.isInteger(e.wave) || e.wave < 1 || e.wave > WAVE_EVENT_LIMITS.wave) return { key: 'wholeUpTo', v: { what: 'wave', max: WAVE_EVENT_LIMITS.wave }, of };
  if (!MAP_WAVE_EVENT_KINDS.includes(e.kind)) return { key: 'unknown', v: { what: 'kind', value: String(e.kind) }, of };
  switch (e.kind) {
    case 'message':
      return typeof e.text === 'string' && e.text.trim() && e.text.length <= WAVE_EVENT_LIMITS.text ? null : { key: 'message', v: { max: WAVE_EVENT_LIMITS.text }, of };
    case 'weather':
      // No default here: an event the game cannot do is left out, the weather stays as it was
      if (!MAP_WEATHERS.includes(e.weather)) return { key: 'unknown', v: { what: 'weather', value: String(e.weather) }, of };
      return e.strength === undefined || (finite(e.strength) && e.strength >= 0 && e.strength <= 1) ? null : { key: 'range', v: { what: 'strength', min: 0, max: 1 }, of };
    case 'time':
      return finite(e.hour) && e.hour >= 0 && e.hour <= 24 ? null : { key: 'range', v: { what: 'hour', min: 0, max: 24 }, of };
    case 'portal':
      return typeof e.spawn === 'string' && e.spawn ? null : { key: 'noSpawn', v: { what: of } };
    case 'objects':
      if (typeof e.show !== 'boolean') return { key: 'bool', v: { what: 'show' }, of };
      return Array.isArray(e.ids) && e.ids.length > 0 && e.ids.length <= WAVE_EVENT_LIMITS.objects && e.ids.every((id) => typeof id === 'string')
        ? null
        : { key: 'objectCount', v: { what: of, max: WAVE_EVENT_LIMITS.objects } };
  }
}

function prefabRepairs(doc: CustomMapDocument, fix: boolean, out: MapProblem[]): void {
  const prefabs = doc.prefabs as unknown;
  if (prefabs === undefined) return;
  if (!Array.isArray(prefabs)) {
    out.push({ text: { key: 'noPrefabs' }, part: 'prefabs' });
    if (fix) delete doc.prefabs;
    return;
  }
  const kept = (prefabs as MapPrefab[]).filter((pf, k) => {
    const problems = prefabProblems(pf, k);
    if (problems.length) out.push({ text: problems[0], then: 'leftOut', part: 'prefabs' });
    return !problems.length;
  });
  if (kept.length > MAX_MAP_PREFABS) {
    out.push({ text: { key: 'manyPrefabs', v: { count: kept.length, max: MAX_MAP_PREFABS } }, part: 'prefabs' });
    kept.length = MAX_MAP_PREFABS;
  }
  if (!fix || kept.length === prefabs.length) return;
  if (kept.length) doc.prefabs = kept;
  else delete doc.prefabs;
}

/** What is wrong with prefab k of a map (packMapFile does not write one with problems) */
export function prefabProblems(pf: MapPrefab, k: number): MapText[] {
  const what: MapThing = { kind: 'prefab', id: k + 1 };
  if (!pf || typeof pf !== 'object' || typeof pf.id !== 'string' || typeof pf.name !== 'string' || !pf.stamp) return [{ key: 'pieces', v: { what } }];
  const st = pf.stamp;
  const out: MapText[] = [];
  const whole = (v: unknown, min: number) => Number.isInteger(v) && (v as number) >= min;
  if (![st.width, st.depth, st.cell, st.paintCell].every((v) => finite(v) && v > 0)) out.push({ key: 'noSize', v: { what } });
  if (!whole(st.columns, 2) || !whole(st.rows, 2) || !isTypedArray(st.heights, 'Float32Array') || st.heights.length !== st.columns * st.rows) out.push({ key: 'notItsGrid', v: { what: 'heights' }, of: what });
  const materials = Array.isArray(st.materials) && st.materials.every((m) => typeof m === 'string') ? st.materials.length : -1;
  if (materials < 0) out.push({ key: 'ids', v: { what: 'materials' }, of: what });
  else if (!whole(st.paintColumns, 1) || !whole(st.paintRows, 1) || !isTypedArray(st.paint, 'Uint8Array') || st.paint.length !== st.paintColumns * st.paintRows * materials) {
    out.push({ key: 'notItsGrid', v: { what: 'paint' }, of: what });
  }
  if (st.water && (!finite(st.water.level) || !isTypedArray(st.water.mask, 'Uint8Array') || st.water.mask.length !== st.columns * st.rows)) out.push({ key: 'notItsGrid', v: { what: 'water' }, of: what });
  if (!Array.isArray(st.objects) || st.objects.some((o) => !o || typeof o.asset !== 'string' || ![o.x, o.y, o.z, o.rotation, o.scale].every(finite))) out.push({ key: 'badObject', v: { what } });
  if (!st.roads || !Array.isArray(st.roads.nodes) || !Array.isArray(st.roads.edges)) out.push({ key: 'nodesAndEdges', v: { what: 'roads' }, of: what });
  if (st.life !== undefined && (!Array.isArray(st.life) || st.life.some((a) => !a || !Array.isArray(a.points) || a.points.some((q) => !finite(q?.x) || !finite(q?.y))))) {
    out.push({ key: 'lifeAreas', v: { what: 'life' }, of: what });
  }
  return out;
}

/** A broken life area is left out, a broken switch or sound falls back to its default; the rest of the life stays */
function lifeRepairs(doc: CustomMapDocument, fix: boolean, out: MapProblem[]): void {
  const life = doc.life as unknown;
  if (life === undefined) return;
  const say = sayer(out, 'life');
  if (!isObject(life)) {
    say({ key: 'noLife' });
    if (fix) delete doc.life;
    return;
  }
  const l = life as MapLife;
  for (const key of ['auto', 'density', 'flags', 'ambience', 'waveSound'] as const) {
    const problem = l[key] === undefined ? undefined : lifeProblems({ [key]: l[key] })[0];
    if (!problem) continue;
    say(problem, 'defaultHolds');
    if (fix) delete l[key];
  }
  const areas = l.areas as unknown;
  if (areas === undefined) return;
  if (!Array.isArray(areas)) {
    say({ key: 'noLifeAreas' });
    if (fix) delete l.areas;
    return;
  }
  const ids = new Set<string>();
  const kept = (areas as MapLifeArea[]).filter((a) => {
    // A bird or a quality this game does not know: the default one flies
    if (isObject(a) && a.species !== undefined && !BIRD_SPECIES.includes(a.species)) {
      say({ key: 'unknownBirds', v: { value: String(a.species) }, of: { kind: 'lifeArea', id: a.id } });
      if (fix) delete a.species;
    }
    if (isObject(a) && a.quality !== undefined && a.quality !== 'medium' && a.quality !== 'high') {
      say({ key: 'unknownDefault', v: { what: 'quality', value: String(a.quality) }, of: { kind: 'lifeArea', id: a.id } });
      if (fix) delete a.quality;
    }
    const check = isObject(a) ? { ...a, species: undefined, quality: undefined } : a;
    const problem: MapText | undefined = lifeProblems({ areas: [check] })[0] ?? (ids.has(a.id) ? { key: 'idTwice', v: { kind: 'lifeArea', id: String(a.id) } } : undefined);
    if (problem) {
      say(problem, 'leftOut');
      return false;
    }
    ids.add(a.id);
    return true;
  });
  if (kept.length > MAX_LIFE_AREAS) {
    say({ key: 'manyLifeAreas', v: { count: kept.length, max: MAX_LIFE_AREAS } });
    kept.length = MAX_LIFE_AREAS;
  }
  if (fix && kept.length !== areas.length) l.areas = kept;
}

/** A broken surface is left out, a marking this game does not know or a broken one loses its lines; the rest stays */
function surfaceRepairs(doc: CustomMapDocument, fix: boolean, out: MapProblem[]): void {
  const surfaces = doc.surfaces as unknown;
  if (surfaces === undefined) return;
  const say = sayer(out, 'surfaces');
  if (!Array.isArray(surfaces)) {
    say({ key: 'noSurfaces' });
    if (fix) delete doc.surfaces;
    return;
  }
  const ids = new Set<string>();
  const kept = (surfaces as MapSurface[]).filter((s) => {
    const marking = isObject(s) ? markingProblems(s.marking)[0] : undefined;
    if (isObject(s) && s.marking !== undefined && marking) {
      say({ ...marking, of: { kind: 'surface', id: String(s.id) } }, 'noLines');
      if (fix) delete s.marking;
    }
    const check = isObject(s) ? { ...s, marking: undefined } : s;
    const problem: MapText | undefined = surfaceProblems(check)[0] ?? (ids.has(s.id) ? { key: 'idDouble', v: { kind: 'surface', id: String(s.id) } } : undefined);
    if (problem) {
      say(problem, 'leftOut');
      return false;
    }
    ids.add(s.id);
    return true;
  });
  if (kept.length > MAX_SURFACES) {
    say({ key: 'manySurfaces', v: { count: kept.length, max: MAX_SURFACES } });
    kept.length = MAX_SURFACES;
  }
  if (fix && kept.length !== surfaces.length) doc.surfaces = kept;
}
