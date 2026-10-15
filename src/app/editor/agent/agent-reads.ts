/**
 * What an AI agent reads of a map (docs/AGENT_MCP.md): a summary, heights
 * and objects in a rectangle, the check's findings and the catalogue, as
 * plain data small enough for a tool answer. Numbers are rounded to what a
 * map needs (centimetres, decimetres of height).
 */
import type { CatalogIndex } from '../catalog/asset-catalog';
import { heightAt } from '../model/grid';
import { TERRAIN_PRESETS } from '../ops/generate';
import { BIOMES } from '../ops/landscape/biomes';
import { MAP_TEMPLATES } from '../ops/landscape/templates';
import { edgePolyline, polylineLength, spawnRoutes } from '../ops/path-graph';
import { mapSceneCost } from '../validation/map-budget';
import type { MapIssue } from '../validation/map-validation';
import { SCENE_BUDGET } from '../../world/custom-map/render/objects/scene-cost';
import type { CustomMapDocument, MapObject, MapWater } from '../../world/custom-map/map-document';
import { lifeSwitches } from '../../world/custom-map/map-life';

export interface MapRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Most samples a side of `heightsIn` returns */
export const MAX_HEIGHT_SAMPLES = 128;
/** Most objects `objectsIn` lists */
export const MAX_LISTED_OBJECTS = 1000;

function waterShare(w: MapWater): number {
  let wet = 0;
  for (const m of w.mask) if (m > 127) wet++;
  return Math.round((wet / w.mask.length) * 1000) / 10;
}

/** Everything about the map at a glance */
export function mapSummary(doc: CustomMapDocument, catalog: CatalogIndex): Record<string, unknown> {
  const t = doc.terrain;
  const g = t.grid;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const h of g.heights) {
    if (h < min) min = h;
    if (h > max) max = h;
    sum += h;
  }
  const byCategory = new Map<string, number>();
  const byAsset = new Map<string, number>();
  for (const o of doc.objects) {
    const category = catalog.object(o.asset).category;
    byCategory.set(category, (byCategory.get(category) ?? 0) + 1);
    byAsset.set(o.asset, (byAsset.get(o.asset) ?? 0) + 1);
  }
  const lanes: Record<string, number | null> = {};
  for (const [id, route] of spawnRoutes(doc)) lanes[id] = route ? Math.round(route.length) : null;
  const cost = mapSceneCost(doc, catalog);
  return {
    meta: { id: doc.meta.id, name: doc.meta.name, author: doc.meta.author, description: doc.meta.description },
    size: { width: t.width, depth: t.depth, cellSize: g.cellSize, columns: g.columns, rows: g.rows, splatResolution: t.splat.resolution },
    coordinates: 'metres, x east, y north, (0, 0) the map centre',
    heights: { min: r1(min), max: r1(max), mean: r1(sum / g.heights.length) },
    layers: t.layers.map((l) => l.material),
    cliffs: { material: t.cliffMaterial, angle: t.cliffAngle },
    water: {
      main: t.water ? { level: r2(t.water.level), kind: t.water.kind ?? 'water', coversPercent: waterShare(t.water) } : null,
      bodies: (t.waterBodies ?? []).map((b, index) => ({ index, level: r2(b.level), kind: b.kind ?? 'water', coversPercent: waterShare(b) })),
      rivers: (t.rivers ?? []).map((r) => ({ id: r.id, kind: r.kind, points: r.points.length })),
    },
    roads: {
      nodes: doc.paths.nodes.length,
      edges: doc.paths.edges.map((e) => ({ id: e.id, kind: e.kind, width: e.width, length: Math.round(polylineLength(edgePolyline(doc.paths, e))) })),
    },
    spawns: doc.spawns.map((s) => ({ id: s.id, name: s.name, x: r2(s.x), y: r2(s.y), lane: lanes[s.id] ?? null })),
    hq: { x: r2(doc.hq.x), y: r2(doc.hq.y), ground: r1(heightAt(t, doc.hq.x, doc.hq.y)) },
    objects: {
      total: doc.objects.length,
      byCategory: Object.fromEntries([...byCategory].sort((a, b) => b[1] - a[1])),
      topAssets: Object.fromEntries([...byAsset].sort((a, b) => b[1] - a[1]).slice(0, 20)),
    },
    sceneCost: { points: Math.round(cost), budget: SCENE_BUDGET, percent: Math.round((cost / SCENE_BUDGET) * 100) },
    environment: doc.environment,
    gameplay: doc.gameplay ?? {},
    life: {
      ...lifeSwitches(doc.life),
      ambience: doc.life?.ambience ?? null,
      waveSound: doc.life?.waveSound ?? null,
      areas: (doc.life?.areas ?? []).map((a) => ({ id: a.id, kind: a.kind, shape: a.shape, points: a.points.length, density: a.density ?? 1 })),
    },
  };
}

/**
 * Ground heights over a rectangle, `samples` a side at most (MAX_HEIGHT_SAMPLES),
 * rows from south to north, decimetres
 */
export function heightsIn(doc: CustomMapDocument, rect: MapRect, samples = 32): { x0: number; y0: number; step: number; columns: number; rows: number; heights: number[][] } {
  const t = doc.terrain;
  const half = { x: t.width / 2, y: t.depth / 2 };
  const x0 = Math.max(-half.x, Math.min(rect.x0, rect.x1));
  const x1 = Math.min(half.x, Math.max(rect.x0, rect.x1));
  const y0 = Math.max(-half.y, Math.min(rect.y0, rect.y1));
  const y1 = Math.min(half.y, Math.max(rect.y0, rect.y1));
  const n = Math.max(2, Math.min(MAX_HEIGHT_SAMPLES, Math.round(samples)));
  const step = Math.max(t.grid.cellSize, Math.max(x1 - x0, y1 - y0) / (n - 1));
  const columns = Math.max(1, Math.floor((x1 - x0) / step) + 1);
  const rows = Math.max(1, Math.floor((y1 - y0) / step) + 1);
  const heights: number[][] = [];
  for (let j = 0; j < rows; j++) {
    const row: number[] = [];
    for (let i = 0; i < columns; i++) row.push(r1(heightAt(t, x0 + i * step, y0 + j * step)));
    heights.push(row);
  }
  return { x0: r2(x0), y0: r2(y0), step: r2(step), columns, rows, heights };
}

/** The objects standing in a rectangle (all without one), MAX_LISTED_OBJECTS at most */
export function objectsIn(doc: CustomMapDocument, rect?: MapRect, asset?: string): { total: number; listed: number; objects: MapObject[] } {
  const inside = (o: MapObject) =>
    (!rect || (o.x >= Math.min(rect.x0, rect.x1) && o.x <= Math.max(rect.x0, rect.x1) && o.y >= Math.min(rect.y0, rect.y1) && o.y <= Math.max(rect.y0, rect.y1))) &&
    (!asset || o.asset === asset);
  const all = doc.objects.filter(inside);
  return { total: all.length, listed: Math.min(all.length, MAX_LISTED_OBJECTS), objects: all.slice(0, MAX_LISTED_OBJECTS).map((o) => ({ ...o })) };
}

/** The check's findings as data */
export function issuesAsData(issues: readonly MapIssue[]): { errors: number; warnings: number; issues: Record<string, unknown>[] } {
  return {
    errors: issues.filter((i) => i.severity === 'error').length,
    warnings: issues.filter((i) => i.severity === 'warning').length,
    issues: issues.map((i) => ({
      severity: i.severity,
      code: i.code,
      message: i.message,
      ...(i.focus ? { at: { x: r2(i.focus.x), y: r2(i.focus.y) } } : {}),
      ...(i.target ? { target: i.target } : {}),
    })),
  };
}

/** The category name that lists the ground materials in `catalogAsData` */
export const MATERIALS_CATEGORY = 'Materials';

/**
 * What can be painted, placed and brushed, optionally narrowed to a category
 * (an object category or MATERIALS_CATEGORY), a tag or a word. Without any
 * filter only the ids come back, grouped (the full rows of all of it run to
 * some 80 KB); a filter gives the full rows.
 */
export function catalogAsData(catalog: CatalogIndex, filter: { category?: string; tag?: string; search?: string } = {}): Record<string, unknown> {
  const word = filter.search?.toLowerCase();
  const category = filter.category?.toLowerCase();
  const wantsMaterials = !category || category === MATERIALS_CATEGORY.toLowerCase() || category === 'material';
  const matches = (e: { id: string; name: string; tags?: string[] }) =>
    (!filter.tag || (e.tags ?? []).includes(filter.tag)) && (!word || e.id.includes(word) || e.name.toLowerCase().includes(word));
  const materials = wantsMaterials ? catalog.catalog.materials.filter(matches) : [];
  const objects = catalog.catalog.objects.filter((o) => !o.internal && (!category || o.category.toLowerCase() === category) && matches(o));
  const lists = {
    categories: [MATERIALS_CATEGORY, ...catalog.categories()],
    tags: catalog.biomes(),
    biomes: BIOMES.map((b) => ({ id: b.id, label: b.label, hint: b.hint })),
    terrainPresets: TERRAIN_PRESETS.map((p) => ({ id: p.id, hint: p.hint })),
    mapTemplates: MAP_TEMPLATES.map((t) => ({ id: t.id, label: t.label, hint: t.hint })),
    landforms: ['mountain', 'valley', 'plateau', 'crater', 'dunes'],
  };
  if (!filter.category && !filter.tag && !word) {
    const byCategory: Record<string, string[]> = {};
    for (const o of objects) (byCategory[o.category] ??= []).push(o.id);
    return {
      note: 'Ids only. Ask again with category, tag or search for sizes, tags and whether an object blocks building.',
      materials: materials.map((m) => m.id),
      objects: byCategory,
      ...lists,
    };
  }
  const unknownCategory = !!category && !wantsMaterials && !catalog.categories().some((c) => c.toLowerCase() === category);
  return {
    ...(unknownCategory ? { note: `There is no category ${filter.category}; the categories are ${lists.categories.join(', ')}` } : {}),
    materials: materials.map((m) => ({ id: m.id, name: m.name, tags: m.tags ?? [] })),
    objects: objects.map((o) => ({ id: o.id, name: o.name, category: o.category, radius: r2(o.radius), height: r2(o.height), blocksBuild: o.blocksBuild, blocksLos: o.blocksLos, tags: o.tags ?? [] })),
    ...lists,
  };
}

/**
 * A short hash of what a script can change (ground, paint, water, objects,
 * roads, markers, sky, rules): equal maps give equal hashes, so the editor
 * can tell that it played a script to the map the sandbox saw
 */
export function contentFingerprint(doc: CustomMapDocument): string {
  let h = 0x811c9dc5;
  const bytes = (view: ArrayBufferView) => {
    const b = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    for (const v of b) h = Math.imul(h ^ v, 0x01000193);
  };
  const text = (s: string) => {
    for (let k = 0; k < s.length; k++) h = Math.imul(h ^ s.charCodeAt(k), 0x01000193);
  };
  const t = doc.terrain;
  bytes(t.grid.heights);
  for (const m of t.splat.maps) bytes(m);
  if (t.water) bytes(t.water.mask);
  for (const b of t.waterBodies ?? []) bytes(b.mask);
  text(JSON.stringify({ layers: t.layers, water: t.water?.level, bodies: t.waterBodies?.map((b) => b.level), rivers: t.rivers, cliff: [t.cliffMaterial, t.cliffAngle] }));
  text(JSON.stringify([doc.objects, doc.paths, doc.spawns, doc.hq, doc.environment, doc.gameplay ?? null, doc.life ?? null]));
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * What a change did to a map, `before` against `after`, small enough for a
 * tool answer: ground samples moved (and how far), paint, water, objects
 * added, removed and changed, roads, spawns, the HQ, sky, rules and details.
 * Parts that stayed are left out; `{}` means nothing changed.
 */
export function mapDiff(before: CustomMapDocument, after: CustomMapDocument): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const a = before.terrain;
  const b = after.terrain;
  if (a.width !== b.width || a.depth !== b.depth || a.grid.columns !== b.grid.columns || a.grid.rows !== b.grid.rows) {
    out['size'] = { from: { width: a.width, depth: a.depth, cellSize: a.grid.cellSize }, to: { width: b.width, depth: b.depth, cellSize: b.grid.cellSize } };
  } else {
    let cells = 0;
    let rise = 0;
    let drop = 0;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const g = b.grid;
    for (let k = 0; k < g.heights.length; k++) {
      const d = g.heights[k] - a.grid.heights[k];
      if (Math.abs(d) < 0.005) continue;
      cells++;
      if (d > rise) rise = d;
      if (d < drop) drop = d;
      const x = (k % g.columns) * g.cellSize - b.width / 2;
      const y = Math.floor(k / g.columns) * g.cellSize - b.depth / 2;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    if (cells) out['ground'] = { samples: cells, percent: Math.round((cells / g.heights.length) * 1000) / 10, maxRise: r1(rise), maxDrop: r1(drop), within: { x0: r2(x0), y0: r2(y0), x1: r2(x1), y1: r2(y1) } };
    let texels = 0;
    if (a.splat.resolution === b.splat.resolution && a.splat.maps.length === b.splat.maps.length) {
      for (let m = 0; m < b.splat.maps.length; m++) {
        const ma = a.splat.maps[m];
        const mb = b.splat.maps[m];
        for (let k = 0; k < mb.length; k++) if (ma[k] !== mb[k]) texels++;
      }
    }
    if (texels || JSON.stringify(a.layers) !== JSON.stringify(b.layers)) out['paint'] = { values: texels, layers: b.layers.map((l) => l.material) };
  }
  const water = (t: typeof a) => JSON.stringify([t.water ? [t.water.level, t.water.kind, waterShare(t.water)] : null, (t.waterBodies ?? []).map((w) => [w.level, w.kind, waterShare(w)]), t.rivers ?? []]);
  if (water(a) !== water(b)) {
    out['water'] = {
      main: b.water ? { level: r2(b.water.level), kind: b.water.kind ?? 'water', coversPercent: waterShare(b.water) } : null,
      bodies: (b.waterBodies ?? []).length,
      rivers: (b.rivers ?? []).length,
    };
  }
  const objectsBefore = new Map(before.objects.map((o) => [o.id, JSON.stringify(o)]));
  const objectsAfter = new Map(after.objects.map((o) => [o.id, JSON.stringify(o)]));
  const added = after.objects.filter((o) => !objectsBefore.has(o.id));
  const removed = before.objects.filter((o) => !objectsAfter.has(o.id)).map((o) => o.id);
  const changed = after.objects.filter((o) => objectsBefore.has(o.id) && objectsBefore.get(o.id) !== objectsAfter.get(o.id)).map((o) => o.id);
  if (added.length || removed.length || changed.length) {
    const byAsset: Record<string, number> = {};
    for (const o of added) byAsset[o.asset] = (byAsset[o.asset] ?? 0) + 1;
    out['objects'] = { added: added.length, addedByAsset: byAsset, removed: removed.length, changed: changed.length, ...(changed.length <= 20 && changed.length ? { changedIds: changed } : {}), ...(removed.length <= 20 && removed.length ? { removedIds: removed } : {}) };
  }
  if (JSON.stringify(before.paths) !== JSON.stringify(after.paths)) {
    const ea = new Map(before.paths.edges.map((e) => [e.id, JSON.stringify([edgePolyline(before.paths, e), e.width, e.kind, e.style])]));
    const eb = new Map(after.paths.edges.map((e) => [e.id, JSON.stringify([edgePolyline(after.paths, e), e.width, e.kind, e.style])]));
    out['roads'] = {
      added: [...eb.keys()].filter((id) => !ea.has(id)),
      removed: [...ea.keys()].filter((id) => !eb.has(id)),
      changed: [...eb.keys()].filter((id) => ea.has(id) && ea.get(id) !== eb.get(id)),
      nodes: after.paths.nodes.length,
    };
  }
  if (JSON.stringify(before.spawns) !== JSON.stringify(after.spawns)) out['spawns'] = after.spawns.map((sp) => ({ id: sp.id, name: sp.name, x: r2(sp.x), y: r2(sp.y) }));
  if (before.hq.x !== after.hq.x || before.hq.y !== after.hq.y) out['hq'] = { x: r2(after.hq.x), y: r2(after.hq.y) };
  const keys = (x: object | undefined, y: object | undefined) => {
    const all = new Set([...Object.keys(x ?? {}), ...Object.keys(y ?? {})]);
    return [...all].filter((k) => JSON.stringify((x as Record<string, unknown> | undefined)?.[k]) !== JSON.stringify((y as Record<string, unknown> | undefined)?.[k]));
  };
  const env = keys(before.environment, after.environment);
  if (env.length) out['environment'] = Object.fromEntries(env.map((k) => [k, (after.environment as unknown as Record<string, unknown>)[k] ?? null]));
  const rules = keys(before.gameplay, after.gameplay);
  if (rules.length) out['gameplay'] = Object.fromEntries(rules.map((k) => [k, (after.gameplay as Record<string, unknown> | undefined)?.[k] ?? null]));
  const meta = keys({ name: before.meta.name, description: before.meta.description }, { name: after.meta.name, description: after.meta.description });
  if (meta.length) out['details'] = Object.fromEntries(meta.map((k) => [k, (after.meta as unknown as Record<string, unknown>)[k] ?? null]));
  return out;
}
