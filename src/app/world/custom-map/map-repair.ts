import { DEFAULT_ENVIRONMENT } from './map-create';
import type { CustomMapDocument, MapEnvironment } from './map-document';
import type { MapProblem } from './map-file';

/**
 * The values a map file is checked for softly: a file from outside (an
 * import, a coop host, another game version) may carry them wrong or too
 * many. Reading sets them right and says what it changed (unpackMapFile),
 * the editor's check names them as warnings. Nothing here refuses a map: a
 * file that opened before still opens (validateMapDocument holds the hard
 * rules, which would).
 */

/** Most objects a map keeps (an OSM city has some 30 000); the rest is dropped on reading */
export const MAX_MAP_OBJECTS = 100_000;
/** Most road nodes and edges a map should have; more is only reported (dropping some would cut the routes) */
export const MAX_MAP_PATH_PARTS = 100_000;
/** Longest texts of a map's details, characters */
export const MAX_MAP_TEXT = { name: 80, author: 80, description: 2000 } as const;

const COLOR = /^#[0-9a-f]{6}$/i;
const PATH_KINDS = ['road', 'path', 'bridge'];
const WEATHERS = ['clear', 'rain', 'snow', 'fog'];

/**
 * What of `doc` is out of range or of the wrong kind, as problems of their
 * part; with `fix`, each is set right in place as it says (a number to its
 * range, a wrong value to the default, a doubled spawn id to a new one)
 */
export function mapRepairs(doc: CustomMapDocument, fix = false): MapProblem[] {
  const out: MapProblem[] = [];
  const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

  const meta = doc.meta;
  if (meta) {
    for (const key of ['name', 'author', 'description'] as const) {
      const text = meta[key];
      if (typeof text !== 'string' || text.length <= MAX_MAP_TEXT[key]) continue;
      out.push({ text: `meta.${key} is longer than ${MAX_MAP_TEXT[key]} characters; it is cut there`, part: 'meta' });
      if (fix) meta[key] = text.slice(0, MAX_MAP_TEXT[key]);
    }
  }

  const env = doc.environment as MapEnvironment | undefined;
  if (env && typeof env === 'object') {
    const range = (key: 'sunAzimuth' | 'sunElevation' | 'fogDensity', min: number, max: number) => {
      const v = env[key];
      if (finite(v) && v >= min && v <= max) return;
      const set = finite(v) ? Math.min(max, Math.max(min, v)) : DEFAULT_ENVIRONMENT[key];
      out.push({ text: `environment ${key} ${String(v)} is not ${min} to ${max}; it is ${set} now`, part: 'environment' });
      if (fix) env[key] = set;
    };
    range('sunAzimuth', -Infinity, Infinity);
    range('sunElevation', -90, 90);
    range('fogDensity', 0, 0.05);
    if (typeof env.tint !== 'string' || !COLOR.test(env.tint)) {
      out.push({ text: `environment tint ${String(env.tint)} is no #rrggbb colour; it is white now`, part: 'environment' });
      if (fix) env.tint = DEFAULT_ENVIRONMENT.tint;
    }
    if (env.weather !== undefined && !WEATHERS.includes(env.weather)) {
      out.push({ text: `environment weather ${String(env.weather)} is unknown; the map is clear now`, part: 'environment' });
      if (fix) delete env.weather;
    }
    for (const key of ['weatherStrength', 'snowCover', 'moonlight'] as const) {
      const v = env[key];
      if (v === undefined || (finite(v) && v >= 0 && v <= 1)) continue;
      out.push({ text: `environment ${key} ${String(v)} is not 0 to 1; ${finite(v) ? 'it is cut to that' : 'the default holds'}`, part: 'environment' });
      if (fix) {
        if (finite(v)) env[key] = Math.min(1, Math.max(0, v));
        else delete env[key];
      }
    }
  }

  const t = doc.terrain;
  if (t && Array.isArray(t.layers)) {
    t.layers.forEach((layer, k) => {
      if (!layer || layer.scale === undefined || (finite(layer.scale) && layer.scale > 0)) return;
      out.push({ text: `ground layer ${k + 1}: scale ${String(layer.scale)} is no size; the material's own holds`, part: 'terrain' });
      if (fix) delete layer.scale;
    });
  }
  if (t && typeof t.cliffMaterial !== 'string') {
    out.push({ text: 'the cliff material is no material id; cliffs show the default', part: 'terrain' });
    if (fix) t.cliffMaterial = 'cliff';
  }

  if (Array.isArray(doc.objects)) {
    for (const o of doc.objects) {
      if (!o || typeof o !== 'object') continue;
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
    }
    if (doc.objects.length > MAX_MAP_OBJECTS) {
      out.push({ text: `the map has ${doc.objects.length} objects, more than ${MAX_MAP_OBJECTS}; the rest past that is dropped`, part: 'objects' });
      if (fix) doc.objects.length = MAX_MAP_OBJECTS;
    }
  }

  const paths = doc.paths;
  if (paths && Array.isArray(paths.nodes) && Array.isArray(paths.edges)) {
    for (const e of paths.edges) {
      if (!e || typeof e !== 'object' || PATH_KINDS.includes(e.kind)) continue;
      out.push({ text: `path edge ${e.id}: kind ${String(e.kind)} is unknown; it is a road now`, part: 'paths', at: { kind: 'edge', id: e.id } });
      if (fix) e.kind = 'road';
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
    });
  }
  return out;
}
