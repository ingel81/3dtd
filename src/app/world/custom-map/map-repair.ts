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
  MAX_MAP_PREFABS,
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
import type { MapProblem } from './map-file';
import { introProblems } from './map-intro';
import { BIRD_SPECIES, lifeProblems, MAX_LIFE_AREAS } from './map-life';
import { markingProblems, MAX_SURFACES, surfaceProblems } from './map-surfaces';

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
      out.push({ text: `meta.${key} is longer than ${MAX_MAP_TEXT[key]} characters; it is cut there`, part: 'meta' });
      if (fix) meta[key] = text.slice(0, MAX_MAP_TEXT[key]);
    }
  }

  environmentRepairs(doc, fix, out);
  terrainRepairs(doc, fix, out);
  objectRepairs(doc, fix, out);

  const paths = doc.paths;
  if (paths && Array.isArray(paths.nodes) && Array.isArray(paths.edges)) {
    for (const e of paths.edges) {
      if (!e || typeof e !== 'object') continue;
      const at = { kind: 'edge' as const, id: e.id };
      if (!MAP_PATH_KINDS.includes(e.kind)) {
        out.push({ text: `path edge ${e.id}: kind ${String(e.kind)} is unknown; it is a road now`, part: 'paths', at });
        if (fix) e.kind = 'road';
      }
      if (e.style !== undefined && !MAP_BRIDGE_STYLES.includes(e.style)) {
        out.push({ text: `path edge ${e.id}: bridge style ${String(e.style)} is unknown; the default holds`, part: 'paths', at });
        if (fix) delete e.style;
      }
    }
    if (paths.nodes.length > MAX_MAP_PATH_PARTS || paths.edges.length > MAX_MAP_PATH_PARTS) {
      out.push({ text: `the roads have ${paths.nodes.length} nodes and ${paths.edges.length} edges, more than ${MAX_MAP_PATH_PARTS}; the map may load slowly`, part: 'paths' });
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
        out.push({ text: `spawn ${k + 1}: id ${JSON.stringify(sp.id)} is ${sp.id && typeof sp.id === 'string' ? 'twice' : 'missing'}; it is ${id} now`, part: 'spawns', at: { kind: 'spawn', id: typeof sp.id === 'string' ? sp.id : undefined } });
        if (fix) sp.id = id;
        ids.add(id);
      } else ids.add(sp.id);
      if (typeof sp.name !== 'string') {
        out.push({ text: `spawn ${k + 1}: the name is no text; it is Spawn ${k + 1} now`, part: 'spawns' });
        if (fix) sp.name = `Spawn ${k + 1}`;
      }
      if (sp.optional !== undefined && typeof sp.optional !== 'boolean') {
        out.push({ text: `spawn ${k + 1}: optional ${JSON.stringify(sp.optional)} is not true or false; the lane is always open`, part: 'spawns' });
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
    out.push({ text: `${intro[0]}; the map's intro flight is left out, the game flies its own`, part: 'intro' });
    if (fix) delete doc.intro;
  }
  return out;
}

/** What the game and the editor tell the player of a map that reading set right or left parts of (UnpackedMap.repaired) */
export function repairedMapText(name: string, repaired: readonly string[]): string {
  const more = repaired.length > 1 ? ` (and ${repaired.length - 1} more)` : '';
  return `${name} had parts this game does not take; it opened with them set right or left out: ${repaired[0]}${more}.`;
}

function environmentRepairs(doc: CustomMapDocument, fix: boolean, out: MapProblem[]): void {
  if (!isObject(doc.environment)) {
    out.push({ text: 'the environment is missing; the default day holds', part: 'environment' });
    if (fix) doc.environment = { ...DEFAULT_ENVIRONMENT };
    return;
  }
  const env = doc.environment as MapEnvironment;
  const say = (text: string) => out.push({ text, part: 'environment' });
  if (!MAP_SKIES.includes(env.sky)) {
    say(`environment sky ${String(env.sky)} is unknown; it is ${DEFAULT_ENVIRONMENT.sky} now`);
    if (fix) env.sky = DEFAULT_ENVIRONMENT.sky;
  }
  if (env.biome !== undefined && !MAP_BIOMES.includes(env.biome)) {
    say(`environment biome ${String(env.biome)} is unknown; the map looks temperate`);
    if (fix) delete env.biome;
  }
  // An unknown sky id is no problem at all: a map from a newer game shows the procedural sky here
  if (env.skyImage !== undefined && typeof env.skyImage !== 'string') {
    say('environment skyImage is no sky id; the procedural sky shows');
    if (fix) delete env.skyImage;
  }
  const planet = env.planet;
  if (planet !== undefined && (!isObject(planet) || !finite(planet.azimuth) || !finite(planet.elevation) || !finite(planet.size) || planet.size < 0)) {
    say("environment planet needs azimuth, elevation and a size of 0 or more; the look's own shows");
    if (fix) delete env.planet;
  }
  const wind = env.wind;
  if (wind !== undefined && (!isObject(wind) || !finite(wind.strength) || !finite(wind.direction) || !finite(wind.gusts))) {
    say("environment wind needs strength, direction and gusts; the look's own blows");
    if (fix) delete env.wind;
  }
  const range = (key: 'sunAzimuth' | 'sunElevation' | 'fogDensity', min: number, max: number) => {
    const v = env[key];
    if (finite(v) && v >= min && v <= max) return;
    const set = finite(v) ? Math.min(max, Math.max(min, v)) : DEFAULT_ENVIRONMENT[key];
    say(`environment ${key} ${String(v)} is not ${min} to ${max}; it is ${set} now`);
    if (fix) env[key] = set;
  };
  range('sunAzimuth', -Infinity, Infinity);
  range('sunElevation', -90, 90);
  range('fogDensity', 0, 0.05);
  if (typeof env.tint !== 'string' || !COLOR.test(env.tint)) {
    say(`environment tint ${String(env.tint)} is no #rrggbb colour; it is white now`);
    if (fix) env.tint = DEFAULT_ENVIRONMENT.tint;
  }
  if (env.weather !== undefined && !MAP_WEATHERS.includes(env.weather)) {
    say(`environment weather ${String(env.weather)} is unknown; the map is clear now`);
    if (fix) delete env.weather;
  }
  for (const key of ['weatherStrength', 'snowCover', 'moonlight'] as const) {
    const v = env[key];
    if (v === undefined || (finite(v) && v >= 0 && v <= 1)) continue;
    say(`environment ${key} ${String(v)} is not 0 to 1; ${finite(v) ? 'it is cut to that' : 'the default holds'}`);
    if (fix) {
      if (finite(v)) env[key] = Math.min(1, Math.max(0, v));
      else delete env[key];
    }
  }
}

function terrainRepairs(doc: CustomMapDocument, fix: boolean, out: MapProblem[]): void {
  const t = doc.terrain;
  if (!t) return;
  const say = (text: string) => out.push({ text, part: 'terrain' });
  if (Array.isArray(t.layers)) {
    t.layers.forEach((layer, k) => {
      if (!layer || layer.scale === undefined || (finite(layer.scale) && layer.scale > 0)) return;
      say(`ground layer ${k + 1}: scale ${String(layer.scale)} is no size; the material's own holds`);
      if (fix) delete layer.scale;
    });
  }
  if (typeof t.cliffMaterial !== 'string') {
    say('the cliff material is no material id; cliffs show the default');
    if (fix) t.cliffMaterial = 'cliff';
  }
  const bodies = [t.water, ...(Array.isArray(t.waterBodies) ? t.waterBodies : [])];
  bodies.forEach((body, k) => {
    if (!isObject(body) || body.kind === undefined || MAP_WATER_KINDS.includes(body.kind)) return;
    say(`${k ? `water body ${k}` : 'the water'}: kind ${String(body.kind)} is unknown; it is water now`);
    if (fix) delete body.kind;
  });
  if (!Array.isArray(t.rivers)) return;
  const kept = t.rivers.filter((river) => {
    const problem = riverProblem(river);
    if (problem) {
      say(`${problem}; it is left out`);
      return false;
    }
    if (!MAP_RIVER_KINDS.includes(river.kind)) {
      say(`river ${river.id}: kind ${String(river.kind)} is unknown; it is water now`);
      if (fix) river.kind = 'water';
    }
    return true;
  });
  if (fix && kept.length !== t.rivers.length) t.rivers = kept;
}

function riverProblem(river: unknown): string | null {
  if (!isObject(river)) return 'a river is not an object';
  const { id, points } = river;
  if (typeof id !== 'string' || !id) return 'a river has no id';
  if (!Array.isArray(points) || points.length < 2) return `river ${id} needs two points`;
  if (points.some((q) => !isObject(q) || ![q['x'], q['y'], q['width'], q['height']].every(finite) || (q['width'] as number) <= 0)) return `river ${id} has a bad point`;
  return null;
}

function objectRepairs(doc: CustomMapDocument, fix: boolean, out: MapProblem[]): void {
  if (!Array.isArray(doc.objects)) return;
  const ids = new Set<string>();
  const kept = doc.objects.filter((o) => {
    const problem = objectProblem(o, ids);
    if (problem) {
      const id = isObject(o) && typeof o['id'] === 'string' && o['id'] ? o['id'] : undefined;
      out.push({ text: `${problem}; it is left out`, part: 'objects', ...(id ? { at: { kind: 'object' as const, id } } : {}) });
      return false;
    }
    ids.add(o.id);
    const at = { kind: 'object' as const, id: o.id };
    for (const key of ['blocksLos', 'blocksBuild'] as const) {
      if (o[key] === undefined || typeof o[key] === 'boolean') continue;
      out.push({ text: `object ${o.id}: ${key} ${JSON.stringify(o[key])} is not true or false; the catalogue's holds`, part: 'objects', at });
      if (fix) delete o[key];
    }
    if (o.tint !== undefined && (typeof o.tint !== 'string' || !COLOR.test(o.tint))) {
      out.push({ text: `object ${o.id}: tint ${String(o.tint)} is no #rrggbb colour; it shows untinted`, part: 'objects', at });
      if (fix) delete o.tint;
    }
    return true;
  });
  if (kept.length > MAX_MAP_OBJECTS) {
    out.push({ text: `the map has ${kept.length} objects, more than ${MAX_MAP_OBJECTS}; the rest past that is dropped`, part: 'objects' });
    kept.length = MAX_MAP_OBJECTS;
  }
  if (fix && kept.length !== doc.objects.length) doc.objects = kept;
}

/** Why object `o` cannot stand in a map, in words; null when it can. `ids`: the ids of the objects kept before it */
function objectProblem(o: unknown, ids: ReadonlySet<string>): string | null {
  if (!isObject(o)) return 'an object entry is not an object';
  const id = o['id'];
  if (typeof id !== 'string' || !id || ids.has(id)) return `object id ${JSON.stringify(id)} is missing or twice`;
  if (typeof o['asset'] !== 'string' || !o['asset']) return `object ${id} has no asset`;
  if (![o['x'], o['y'], o['z'], o['rotation'], o['scale']].every(finite) || (o['scale'] as number) <= 0) return `object ${id} has a bad placement`;
  if (o['group'] !== undefined && typeof o['group'] !== 'string') return `object ${id} has a bad group`;
  if ((o['pitch'] !== undefined && !finite(o['pitch'])) || (o['roll'] !== undefined && !finite(o['roll']))) return `object ${id} has a bad tilt`;
  return null;
}

function gameplayRepairs(doc: CustomMapDocument, fix: boolean, out: MapProblem[]): void {
  const gp = doc.gameplay;
  if (!gp || typeof gp !== 'object') return;
  const say = (text: string) => out.push({ text, part: 'gameplay' });
  const lanes = gp.lanes;
  if (lanes && typeof lanes === 'object' && lanes.vacant !== undefined && !VACANT_LANES.includes(lanes.vacant)) {
    say(`gameplay.lanes.vacant ${String(lanes.vacant)} is unknown; the default holds`);
    if (fix) delete lanes.vacant;
  }
  const waves = gp.waves as unknown;
  if (waves !== undefined && (!isObject(waves) || (waves['kind'] !== 'budget' && waves['kind'] !== 'table'))) {
    say(`gameplay.waves.kind ${isObject(waves) ? String(waves['kind']) : String(waves)} is unknown; the game's waves play`);
    if (fix) delete gp.waves;
  }
  const events = gp.events as unknown;
  if (events === undefined) return;
  if (!Array.isArray(events)) {
    say('gameplay.events is not a list; the map has no wave events');
    if (fix) delete gp.events;
    return;
  }
  const kept = (events as MapWaveEvent[]).filter((e, k) => {
    const problem = waveEventProblem(e, k);
    if (problem) say(`${problem}; it is left out`);
    return !problem;
  });
  if (kept.length > WAVE_EVENT_LIMITS.events) {
    say(`the map has ${kept.length} wave events, more than ${WAVE_EVENT_LIMITS.events}; the rest is left out`);
    kept.length = WAVE_EVENT_LIMITS.events;
  }
  if (fix && kept.length !== events.length) gp.events = kept;
}

/** What is wrong with wave event k of a map, in words, or null (its shape; the editor's check names spawns and objects that are gone) */
function waveEventProblem(e: MapWaveEvent, k: number): string | null {
  const what = `wave event ${k + 1}`;
  if (!isObject(e)) return `${what} is not an object`;
  if (!Number.isInteger(e.wave) || e.wave < 1 || e.wave > WAVE_EVENT_LIMITS.wave) return `${what}: wave must be a whole number from 1 to ${WAVE_EVENT_LIMITS.wave}`;
  if (!MAP_WAVE_EVENT_KINDS.includes(e.kind)) return `${what}: kind ${String(e.kind)} is unknown`;
  switch (e.kind) {
    case 'message':
      return typeof e.text === 'string' && e.text.trim() && e.text.length <= WAVE_EVENT_LIMITS.text ? null : `${what}: a message of 1 to ${WAVE_EVENT_LIMITS.text} characters`;
    case 'weather':
      // No default here: an event the game cannot do is left out, the weather stays as it was
      if (!MAP_WEATHERS.includes(e.weather)) return `${what}: weather ${String(e.weather)} is unknown`;
      return e.strength === undefined || (finite(e.strength) && e.strength >= 0 && e.strength <= 1) ? null : `${what}: strength must be 0 to 1`;
    case 'time':
      return finite(e.hour) && e.hour >= 0 && e.hour <= 24 ? null : `${what}: hour must be 0 to 24`;
    case 'portal':
      return typeof e.spawn === 'string' && e.spawn ? null : `${what} names no spawn`;
    case 'objects':
      if (typeof e.show !== 'boolean') return `${what}: show must be true or false`;
      return Array.isArray(e.ids) && e.ids.length > 0 && e.ids.length <= WAVE_EVENT_LIMITS.objects && e.ids.every((id) => typeof id === 'string') ? null : `${what} names 1 to ${WAVE_EVENT_LIMITS.objects} objects`;
  }
}

function prefabRepairs(doc: CustomMapDocument, fix: boolean, out: MapProblem[]): void {
  const prefabs = doc.prefabs as unknown;
  if (prefabs === undefined) return;
  if (!Array.isArray(prefabs)) {
    out.push({ text: 'prefabs is not a list; the map keeps none', part: 'prefabs' });
    if (fix) delete doc.prefabs;
    return;
  }
  const kept = (prefabs as MapPrefab[]).filter((pf, k) => {
    const problems = prefabProblems(pf, k);
    if (problems.length) out.push({ text: `${problems[0]}; it is left out`, part: 'prefabs' });
    return !problems.length;
  });
  if (kept.length > MAX_MAP_PREFABS) {
    out.push({ text: `the map keeps ${kept.length} prefabs, more than ${MAX_MAP_PREFABS}; the rest is left out`, part: 'prefabs' });
    kept.length = MAX_MAP_PREFABS;
  }
  if (!fix || kept.length === prefabs.length) return;
  if (kept.length) doc.prefabs = kept;
  else delete doc.prefabs;
}

/** What is wrong with prefab k of a map, in words (packMapFile does not write one with problems) */
export function prefabProblems(pf: MapPrefab, k: number): string[] {
  const what = `prefab ${k + 1}`;
  if (!pf || typeof pf !== 'object' || typeof pf.id !== 'string' || typeof pf.name !== 'string' || !pf.stamp) return [`${what} needs an id, a name and its piece`];
  const st = pf.stamp;
  const out: string[] = [];
  const whole = (v: unknown, min: number) => Number.isInteger(v) && (v as number) >= min;
  if (![st.width, st.depth, st.cell, st.paintCell].every((v) => finite(v) && v > 0)) out.push(`${what} has no size`);
  if (!whole(st.columns, 2) || !whole(st.rows, 2) || !isTypedArray(st.heights, 'Float32Array') || st.heights.length !== st.columns * st.rows) out.push(`${what}: heights do not match its grid`);
  const materials = Array.isArray(st.materials) && st.materials.every((m) => typeof m === 'string') ? st.materials.length : -1;
  if (materials < 0) out.push(`${what}: materials must be a list of ids`);
  else if (!whole(st.paintColumns, 1) || !whole(st.paintRows, 1) || !isTypedArray(st.paint, 'Uint8Array') || st.paint.length !== st.paintColumns * st.paintRows * materials) {
    out.push(`${what}: paint does not match its grid`);
  }
  if (st.water && (!finite(st.water.level) || !isTypedArray(st.water.mask, 'Uint8Array') || st.water.mask.length !== st.columns * st.rows)) out.push(`${what}: water does not match its grid`);
  if (!Array.isArray(st.objects) || st.objects.some((o) => !o || typeof o.asset !== 'string' || ![o.x, o.y, o.z, o.rotation, o.scale].every(finite))) out.push(`${what} has a bad object`);
  if (!st.roads || !Array.isArray(st.roads.nodes) || !Array.isArray(st.roads.edges)) out.push(`${what}: roads must have lists of nodes and edges`);
  if (st.life !== undefined && (!Array.isArray(st.life) || st.life.some((a) => !a || !Array.isArray(a.points) || a.points.some((q) => !finite(q?.x) || !finite(q?.y))))) {
    out.push(`${what}: life must be a list of areas with points`);
  }
  return out;
}

/** A broken life area is left out, a broken switch or sound falls back to its default; the rest of the life stays */
function lifeRepairs(doc: CustomMapDocument, fix: boolean, out: MapProblem[]): void {
  const life = doc.life as unknown;
  if (life === undefined) return;
  const say = (text: string) => out.push({ text, part: 'life' });
  if (!isObject(life)) {
    say("life is not an object; the map's own life is left out");
    if (fix) delete doc.life;
    return;
  }
  const l = life as MapLife;
  for (const key of ['auto', 'density', 'flags', 'ambience', 'waveSound'] as const) {
    const problem = l[key] === undefined ? undefined : lifeProblems({ [key]: l[key] })[0];
    if (!problem) continue;
    say(`${problem}; the default holds`);
    if (fix) delete l[key];
  }
  const areas = l.areas as unknown;
  if (areas === undefined) return;
  if (!Array.isArray(areas)) {
    say('life.areas is not a list; the map has no life areas');
    if (fix) delete l.areas;
    return;
  }
  const ids = new Set<string>();
  const kept = (areas as MapLifeArea[]).filter((a) => {
    // A bird or a quality this game does not know: the default one flies
    if (isObject(a) && a.species !== undefined && !BIRD_SPECIES.includes(a.species)) {
      say(`life area ${a.id}: species ${String(a.species)} is unknown; the default birds fly`);
      if (fix) delete a.species;
    }
    if (isObject(a) && a.quality !== undefined && a.quality !== 'medium' && a.quality !== 'high') {
      say(`life area ${a.id}: quality ${String(a.quality)} is unknown; the default holds`);
      if (fix) delete a.quality;
    }
    const check = isObject(a) ? { ...a, species: undefined, quality: undefined } : a;
    const problem = lifeProblems({ areas: [check] })[0] ?? (ids.has(a.id) ? `life area id "${a.id}" is missing or twice` : undefined);
    if (problem) {
      say(`${problem}; it is left out`);
      return false;
    }
    ids.add(a.id);
    return true;
  });
  if (kept.length > MAX_LIFE_AREAS) {
    say(`the map has ${kept.length} life areas, more than ${MAX_LIFE_AREAS}; the rest is left out`);
    kept.length = MAX_LIFE_AREAS;
  }
  if (fix && kept.length !== areas.length) l.areas = kept;
}

/** A broken surface is left out, a marking this game does not know or a broken one loses its lines; the rest stays */
function surfaceRepairs(doc: CustomMapDocument, fix: boolean, out: MapProblem[]): void {
  const surfaces = doc.surfaces as unknown;
  if (surfaces === undefined) return;
  const say = (text: string) => out.push({ text, part: 'surfaces' });
  if (!Array.isArray(surfaces)) {
    say('surfaces is not a list; the map has no surfaces');
    if (fix) delete doc.surfaces;
    return;
  }
  const ids = new Set<string>();
  const kept = (surfaces as MapSurface[]).filter((s) => {
    const marking = isObject(s) ? markingProblems(s.marking)[0] : undefined;
    if (isObject(s) && s.marking !== undefined && marking) {
      say(`surface ${String(s.id)}: ${marking}; it is drawn without lines`);
      if (fix) delete s.marking;
    }
    const check = isObject(s) ? { ...s, marking: undefined } : s;
    const problem = surfaceProblems(check)[0] ?? (ids.has(s.id) ? `surface id "${s.id}" is twice` : undefined);
    if (problem) {
      say(`${problem}; it is left out`);
      return false;
    }
    ids.add(s.id);
    return true;
  });
  if (kept.length > MAX_SURFACES) {
    say(`the map has ${kept.length} surfaces, more than ${MAX_SURFACES}; the rest is left out`);
    kept.length = MAX_SURFACES;
  }
  if (fix && kept.length !== surfaces.length) doc.surfaces = kept;
}
