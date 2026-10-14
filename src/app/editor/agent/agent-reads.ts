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
import { edgePolyline, polylineLength, spawnRoutes } from '../ops/path-graph';
import { mapSceneCost } from '../validation/map-budget';
import type { MapIssue } from '../validation/map-validation';
import { SCENE_BUDGET } from '../../world/custom-map/render/objects/scene-cost';
import type { CustomMapDocument, MapObject, MapWater } from '../../world/custom-map/map-document';

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

/** What can be painted, placed and brushed, optionally narrowed to a category, a tag or a word */
export function catalogAsData(catalog: CatalogIndex, filter: { category?: string; tag?: string; search?: string } = {}): Record<string, unknown> {
  const word = filter.search?.toLowerCase();
  const matches = (e: { id: string; name: string; tags?: string[]; category?: string }) =>
    (!filter.category || e.category === filter.category) && (!filter.tag || (e.tags ?? []).includes(filter.tag)) && (!word || e.id.includes(word) || e.name.toLowerCase().includes(word));
  return {
    materials: catalog.catalog.materials.filter((m) => !filter.category && matches(m)).map((m) => ({ id: m.id, name: m.name, tags: m.tags ?? [] })),
    objects: catalog.catalog.objects
      .filter((o) => !o.internal && matches(o))
      .map((o) => ({ id: o.id, name: o.name, category: o.category, radius: r2(o.radius), height: r2(o.height), blocksBuild: o.blocksBuild, blocksLos: o.blocksLos, tags: o.tags ?? [] })),
    categories: catalog.categories(),
    tags: catalog.biomes(),
    biomes: BIOMES.map((b) => ({ id: b.id, label: b.label, hint: b.hint })),
    terrainPresets: TERRAIN_PRESETS.map((p) => ({ id: p.id, hint: p.hint })),
    landforms: ['mountain', 'valley', 'plateau', 'crater', 'dunes'],
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
  text(JSON.stringify([doc.objects, doc.paths, doc.spawns, doc.hq, doc.environment, doc.gameplay ?? null]));
  return (h >>> 0).toString(16).padStart(8, '0');
}
