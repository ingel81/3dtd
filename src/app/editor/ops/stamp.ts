/**
 * Copy and paste of map pieces, and stamps (saved pieces): a rectangle of
 * the map with its heights, ground paint, water, objects, roads and life
 * areas, independent of the map it came from. A prefab is a piece taken
 * from a selection of objects (capturePrefab): those objects, the life
 * areas around them, and the ground under them when asked; a paste puts
 * its objects down as one group.
 *
 * Heights are kept relative to the piece's rim (the mean height of its
 * border), so a hill pasted onto a plateau stands on the plateau. Ground
 * paint is kept per material id, not per layer slot, so it lands on the
 * right layer of any map (layers are added when there is room). Pasting
 * turns the piece by any angle and fades its rim into the ground.
 */
import type { CustomMapDocument, MapObject, MapPathEdge, MapPieceParts, MapPiece, MapPoint } from '../../world/custom-map/map-document';
import { clamp, heightAt, sampleX, sampleY, texelX, texelY, type GridRect } from '../model/grid';
import { MAX_LAYERS, readWeights, writeWeights } from './paint-ops';
import { freeGroup } from './object-ops';
import { edgePolyline, newId } from './path-graph';
import type { LandscapeStroke } from './landscape/landscape-stroke';
import { smooth } from './landscape/landscape-noise';
import { MAX_LIFE_AREAS, newLifeId } from '../../world/custom-map/map-life';

export type StampParts = Required<MapPieceParts>;

export const ALL_PARTS: StampParts = { heights: true, paint: true, water: true, objects: true, roads: true, life: true };

/** A piece of a map, centred on its own middle (map-document.ts) */
export type Stamp = MapPiece;

export interface StampRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Copies a rectangle of the map into a stamp */
export function captureStamp(doc: CustomMapDocument, rect: StampRect): Stamp {
  const t = doc.terrain;
  const g = t.grid;
  const x0 = Math.min(rect.x0, rect.x1);
  const x1 = Math.max(rect.x0, rect.x1);
  const y0 = Math.min(rect.y0, rect.y1);
  const y1 = Math.max(rect.y0, rect.y1);
  const width = Math.max(g.cellSize, x1 - x0);
  const depth = Math.max(g.cellSize, y1 - y0);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const cell = g.cellSize;
  const columns = Math.max(2, Math.round(width / cell) + 1);
  const rows = Math.max(2, Math.round(depth / cell) + 1);
  const at = (i: number, j: number) => ({ x: cx - width / 2 + (i * width) / (columns - 1), y: cy - depth / 2 + (j * depth) / (rows - 1) });

  // The rim's mean height is the stamp's zero
  let rim = 0;
  let n = 0;
  for (let i = 0; i < columns; i++) {
    for (const j of [0, rows - 1]) {
      const p = at(i, j);
      rim += heightAt(t, p.x, p.y);
      n++;
    }
  }
  for (let j = 1; j < rows - 1; j++) {
    for (const i of [0, columns - 1]) {
      const p = at(i, j);
      rim += heightAt(t, p.x, p.y);
      n++;
    }
  }
  rim /= n;
  const heights = new Float32Array(columns * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) {
    const p = at(i, j);
    heights[j * columns + i] = heightAt(t, p.x, p.y) - rim;
  }

  // Paint at the source's texel size
  const paintCell = t.width / t.splat.resolution;
  const paintColumns = Math.max(1, Math.round(width / paintCell));
  const paintRows = Math.max(1, Math.round(depth / paintCell));
  const materials = t.layers.map((l) => l.material);
  const paint = new Uint8Array(paintColumns * paintRows * materials.length);
  const w8 = new Float32Array(MAX_LAYERS);
  const res = t.splat.resolution;
  for (let v = 0; v < paintRows; v++) {
    for (let u = 0; u < paintColumns; u++) {
      const x = cx - width / 2 + (u + 0.5) * (width / paintColumns);
      const y = cy - depth / 2 + (v + 0.5) * (depth / paintRows);
      const tu = clamp(Math.floor(((x + t.width / 2) / t.width) * res), 0, res - 1);
      const tv = clamp(Math.floor(((y + t.depth / 2) / t.depth) * res), 0, res - 1);
      readWeights(t, tv * res + tu, w8);
      for (let k = 0; k < materials.length; k++) paint[(v * paintColumns + u) * materials.length + k] = w8[k];
    }
  }

  // Water on the height samples
  let water: Stamp['water'] = null;
  if (t.water) {
    const mask = new Uint8Array(columns * rows);
    let any = false;
    for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) {
      const p = at(i, j);
      const si = clamp(Math.round((p.x + t.width / 2) / g.cellSize), 0, g.columns - 1);
      const sj = clamp(Math.round((p.y + t.depth / 2) / g.cellSize), 0, g.rows - 1);
      if (t.water.mask[sj * g.columns + si]) {
        mask[j * columns + i] = 255;
        any = true;
      }
    }
    if (any) water = { mask, level: t.water.level - rim, color: t.water.color };
  }

  const inside = (p: MapPoint) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
  const objects = doc.objects.filter(inside).map(({ id: _id, ...o }) => ({ ...o, x: o.x - cx, y: o.y - cy }));
  // Roads whose both ends lie inside
  const keep = new Set(doc.paths.nodes.filter(inside).map((nd) => nd.id));
  const edges = doc.paths.edges.filter((e) => keep.has(e.a) && keep.has(e.b));
  const used = new Set(edges.flatMap((e) => [e.a, e.b]));
  const roads = {
    nodes: doc.paths.nodes.filter((nd) => used.has(nd.id)).map((nd) => ({ ...nd, x: nd.x - cx, y: nd.y - cy })),
    // Without the road brush's record (its objects and kept ground are those of this place): a pasted road reads it off the map when edited
    edges: edges.map(({ dress: _dress, ...e }) => ({ ...e, via: e.via?.map((v) => ({ x: v.x - cx, y: v.y - cy })) })),
  };
  const life = (doc.life?.areas ?? [])
    .filter((a) => a.points.every(inside))
    .map(({ id: _id, ...a }) => ({ ...structuredClone(a), points: a.points.map((p) => ({ x: p.x - cx, y: p.y - cy })) }));
  return { width, depth, cell, columns, rows, heights, paintCell, paintColumns, paintRows, materials, paint, water, objects, roads, life };
}

/** Metres a prefab's ground reaches past its objects' footprints */
const PREFAB_MARGIN = 2;

/**
 * A prefab of the objects `ids`: just them, centred on the middle of their
 * footprints (`radiusOf` an asset's ground radius at scale 1), turned as
 * they stand, and with `ground` the heights, paint and water under them
 * (the rectangle around the footprints and PREFAB_MARGIN). No roads.
 */
export function capturePrefab(doc: CustomMapDocument, ids: readonly string[], ground: boolean, radiusOf: (asset: string) => number = () => 1): { stamp: Stamp; rect: StampRect } | null {
  const keep = new Set(ids);
  const chosen = doc.objects.filter((o) => keep.has(o.id));
  if (!chosen.length) return null;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const o of chosen) {
    const r = Math.max(0.5, radiusOf(o.asset) * o.scale) + PREFAB_MARGIN;
    x0 = Math.min(x0, o.x - r);
    x1 = Math.max(x1, o.x + r);
    y0 = Math.min(y0, o.y - r);
    y1 = Math.max(y1, o.y + r);
  }
  const t = doc.terrain;
  const rect = { x0: Math.max(x0, -t.width / 2), x1: Math.min(x1, t.width / 2), y0: Math.max(y0, -t.depth / 2), y1: Math.min(y1, t.depth / 2) };
  const piece = captureStamp(doc, rect);
  const cx = (rect.x0 + rect.x1) / 2;
  const cy = (rect.y0 + rect.y1) / 2;
  const objects = chosen.map(({ id: _id, ...o }) => ({ ...o, x: Math.round((o.x - cx) * 100) / 100, y: Math.round((o.y - cy) * 100) / 100 }));
  const roads = { nodes: [], edges: [] };
  // The life areas wholly around them come along, with the ground or without
  const life = !!piece.life?.length;
  if (ground) return { rect, stamp: { ...piece, objects, roads, prefab: true, parts: { heights: true, paint: true, water: !!piece.water, objects: true, roads: false, life } } };
  // Objects only: no ground to carry, a flat piece of the same size for its outline
  const stamp: Stamp = {
    ...piece,
    cell: piece.width,
    columns: 2,
    rows: 2,
    heights: new Float32Array(4),
    paintColumns: 1,
    paintRows: 1,
    materials: [],
    paint: new Uint8Array(0),
    water: null,
    objects,
    roads,
    prefab: true,
    parts: { heights: false, paint: false, water: false, objects: true, roads: false, life },
  };
  return { stamp, rect };
}

export interface PasteOptions {
  parts: StampParts;
  /** Turn counter-clockwise, radians */
  rotation: number;
  /** Share of the half size over which the rim fades into the ground, 0..1 */
  feather: number;
}

/** A pasted point in map space from a stamp point */
function place(p: MapPoint, center: MapPoint, cos: number, sin: number): MapPoint {
  return { x: center.x + p.x * cos - p.y * sin, y: center.y + p.x * sin + p.y * cos };
}

/** Stamp coordinates of a map point, and how far inside (1 deep inside, 0 at the rim or out) */
function local(stamp: Stamp, p: MapPoint, center: MapPoint, cos: number, sin: number, feather: number): { x: number; y: number; w: number } {
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  const x = dx * cos + dy * sin;
  const y = -dx * sin + dy * cos;
  const fx = 1 - Math.abs(x) / (stamp.width / 2);
  const fy = 1 - Math.abs(y) / (stamp.depth / 2);
  const inner = Math.min(fx, fy);
  const w = inner < 0 ? 0 : feather <= 0 ? 1 : smooth(0, feather, inner);
  return { x, y, w };
}

function sampleStampHeight(stamp: Stamp, x: number, y: number): number {
  const fi = clamp(((x + stamp.width / 2) / stamp.width) * (stamp.columns - 1), 0, stamp.columns - 1);
  const fj = clamp(((y + stamp.depth / 2) / stamp.depth) * (stamp.rows - 1), 0, stamp.rows - 1);
  const i = Math.min(Math.floor(fi), stamp.columns - 2);
  const j = Math.min(Math.floor(fj), stamp.rows - 2);
  const u = fi - i;
  const v = fj - j;
  const h = stamp.heights;
  const c = stamp.columns;
  return (h[j * c + i] * (1 - u) + h[j * c + i + 1] * u) * (1 - v) + (h[(j + 1) * c + i] * (1 - u) + h[(j + 1) * c + i + 1] * u) * v;
}

/** The map rectangle (axis-aligned) a turned stamp covers */
export function stampBounds(stamp: Stamp, center: MapPoint, rotation: number): StampRect {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([a, b]) => place({ x: (a * stamp.width) / 2, y: (b * stamp.depth) / 2 }, center, cos, sin));
  return {
    x0: Math.min(...corners.map((p) => p.x)),
    x1: Math.max(...corners.map((p) => p.x)),
    y0: Math.min(...corners.map((p) => p.y)),
    y1: Math.max(...corners.map((p) => p.y)),
  };
}

/** The four corners of a turned stamp on the map, for the outline under the cursor */
export function stampOutline(stamp: Stamp, center: MapPoint, rotation: number): MapPoint[] {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
    [-1, -1],
  ].map(([a, b]) => place({ x: (a * stamp.width) / 2, y: (b * stamp.depth) / 2 }, center, cos, sin));
}

/** Pastes a stamp centred on `center`; returns what changed (the stroke keeps it as one undo step) */
export function pasteStamp(stroke: LandscapeStroke, stamp: Stamp, center: MapPoint, options: PasteOptions): void {
  const doc = stroke.doc;
  const t = doc.terrain;
  const g = t.grid;
  const cos = Math.cos(options.rotation);
  const sin = Math.sin(options.rotation);
  const b = stampBounds(stamp, center, options.rotation);
  const feather = clamp(options.feather, 0, 1);
  // What the paste asks for of what the piece holds
  const holds = stamp.parts ?? ALL_PARTS;
  const parts: StampParts = {
    heights: options.parts.heights && holds.heights,
    paint: options.parts.paint && holds.paint,
    water: options.parts.water && holds.water,
    objects: options.parts.objects && holds.objects,
    roads: options.parts.roads && holds.roads,
    // A piece kept before life areas travelled holds none
    life: options.parts.life && holds.life === true,
  };
  // The stamp's rim sits at the mean height of the ground along its outline
  const outline = stampOutline(stamp, center, options.rotation);
  let zero = 0;
  const samples = 32;
  for (let k = 0; k < samples; k++) {
    const s0 = (k / samples) * 4;
    const a = outline[Math.floor(s0)];
    const c = outline[Math.floor(s0) + 1];
    const f = s0 - Math.floor(s0);
    zero += heightAt(t, a.x + (c.x - a.x) * f, a.y + (c.y - a.y) * f);
  }
  zero /= samples;
  const rect: GridRect = {
    i0: clamp(Math.floor((b.x0 + t.width / 2) / g.cellSize), 0, g.columns - 1),
    i1: clamp(Math.ceil((b.x1 + t.width / 2) / g.cellSize), 0, g.columns - 1),
    j0: clamp(Math.floor((b.y0 + t.depth / 2) / g.cellSize), 0, g.rows - 1),
    j1: clamp(Math.ceil((b.y1 + t.depth / 2) / g.cellSize), 0, g.rows - 1),
  };

  if (parts.heights) {
    stroke.touchHeights(rect);
    for (let j = rect.j0; j <= rect.j1; j++) {
      for (let i = rect.i0; i <= rect.i1; i++) {
        const l = local(stamp, { x: sampleX(t, i), y: sampleY(t, j) }, center, cos, sin, feather);
        if (l.w <= 0) continue;
        const k = j * g.columns + i;
        const target = zero + sampleStampHeight(stamp, l.x, l.y);
        g.heights[k] += (target - g.heights[k]) * l.w;
      }
    }
    stroke.changed({ heights: rect });
  }

  if (parts.water && stamp.water) {
    const level = stroke.ensureWater(zero + stamp.water.level);
    stroke.touchWater(rect);
    const mask = t.water!.mask;
    for (let j = rect.j0; j <= rect.j1; j++) {
      for (let i = rect.i0; i <= rect.i1; i++) {
        const l = local(stamp, { x: sampleX(t, i), y: sampleY(t, j) }, center, cos, sin, 0);
        if (l.w <= 0) continue;
        const si = clamp(Math.round(((l.x + stamp.width / 2) / stamp.width) * (stamp.columns - 1)), 0, stamp.columns - 1);
        const sj = clamp(Math.round(((l.y + stamp.depth / 2) / stamp.depth) * (stamp.rows - 1)), 0, stamp.rows - 1);
        if (stamp.water.mask[sj * stamp.columns + si]) {
          mask[j * g.columns + i] = 255;
          // Keep the water in its bed: the ground under it stays below the level of this map
          if (g.heights[j * g.columns + i] > level - 0.2) g.heights[j * g.columns + i] = level - 0.2;
        }
      }
    }
    stroke.changed({ water: true, heights: rect });
  }

  if (parts.paint && stamp.materials.length) {
    const slots = stamp.materials.map((m) => stroke.layerOf([m]));
    const res = t.splat.resolution;
    const trect: GridRect = {
      i0: clamp(Math.floor(((b.x0 + t.width / 2) / t.width) * res), 0, res - 1),
      i1: clamp(Math.ceil(((b.x1 + t.width / 2) / t.width) * res), 0, res - 1),
      j0: clamp(Math.floor(((b.y0 + t.depth / 2) / t.depth) * res), 0, res - 1),
      j1: clamp(Math.ceil(((b.y1 + t.depth / 2) / t.depth) * res), 0, res - 1),
    };
    stroke.touchSplat(trect);
    const w8 = new Float32Array(MAX_LAYERS);
    const mats = stamp.materials.length;
    for (let v = trect.j0; v <= trect.j1; v++) {
      for (let u = trect.i0; u <= trect.i1; u++) {
        const l = local(stamp, { x: texelX(t, u), y: texelY(t, v) }, center, cos, sin, feather);
        if (l.w <= 0) continue;
        const su = clamp(Math.floor(((l.x + stamp.width / 2) / stamp.width) * stamp.paintColumns), 0, stamp.paintColumns - 1);
        const sv = clamp(Math.floor(((l.y + stamp.depth / 2) / stamp.depth) * stamp.paintRows), 0, stamp.paintRows - 1);
        const texel = v * res + u;
        readWeights(t, texel, w8);
        for (let k = 0; k < MAX_LAYERS; k++) w8[k] *= 1 - l.w;
        for (let m = 0; m < mats; m++) {
          const slot = slots[m];
          if (slot === null) continue;
          w8[slot] += stamp.paint[(sv * stamp.paintColumns + su) * mats + m] * l.w;
        }
        writeWeights(t, texel, w8);
      }
    }
    stroke.changed({ splat: trect });
  }

  const placed: string[] = [];
  if (parts.objects) {
    // Groups of the piece become groups of their own on the map, a prefab one group: never the groups of where it came from
    const groups = new Map<string, string>();
    let next = Number(/^g(\d+)$/.exec(freeGroup(doc.objects))![1]);
    const groupOf = (source: string): string => {
      let g = groups.get(source);
      if (!g) groups.set(source, (g = `g${next++}`));
      return g;
    };
    const whole = stamp.prefab && stamp.objects.length > 1;
    for (const o of stamp.objects) {
      const p = place(o, center, cos, sin);
      if (Math.abs(p.x) > t.width / 2 - 1 || Math.abs(p.y) > t.depth / 2 - 1) continue;
      const { group, ...plain } = o;
      const object: Omit<MapObject, 'id'> = { ...plain, x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100, rotation: Math.round((o.rotation + options.rotation) * 1000) / 1000 };
      if (whole) object.group = groupOf('');
      else if (group) object.group = groupOf(group);
      placed.push(stroke.addObject(object).id);
    }
  }

  if (parts.roads && stamp.roads.edges.length) {
    stroke.markPaths();
    const paths = doc.paths;
    const ids = new Map<string, string>();
    for (const n of stamp.roads.nodes) {
      const p = place(n, center, cos, sin);
      const id = newId('n', paths.nodes);
      ids.set(n.id, id);
      paths.nodes.push({ id, x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 });
    }
    for (const e of stamp.roads.edges) {
      // A stamp kept before stamps left out the road brush's record: its objects and ground are of another place
      const { dress: _dress, ...plain } = e;
      const edge: MapPathEdge = { ...plain, id: newId('e', paths.edges), a: ids.get(e.a)!, b: ids.get(e.b)! };
      if (e.via) edge.via = e.via.map((v) => place(v, center, cos, sin));
      paths.edges.push(edge);
    }
    stroke.refreshRoads();
  }
  // Life areas, turned with the piece; those with a point off the map and those past the map's limit stay out
  let life = false;
  if (parts.life && stamp.life?.length) {
    const half = { x: t.width / 2, y: t.depth / 2 };
    const areas = [...(doc.life?.areas ?? [])];
    for (const a of stamp.life) {
      if (areas.length >= MAX_LIFE_AREAS) break;
      const points = a.points.map((q) => {
        const p = place(q, center, cos, sin);
        return { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
      });
      if (points.some((p) => Math.abs(p.x) > half.x || Math.abs(p.y) > half.y)) continue;
      if (!life) stroke.markLife();
      life = true;
      areas.push({ ...structuredClone(a), id: newLifeId(areas, a.kind), points });
    }
    if (life) doc.life = { ...doc.life, areas };
  }
  stroke.changed({ objects: placed.length ? placed : undefined, paths: parts.roads && stamp.roads.edges.length ? true : undefined, life: life || undefined });
}

/** Total length of the roads in a stamp, for its description */
export function stampRoadLength(stamp: Stamp): number {
  let n = 0;
  for (const e of stamp.roads.edges) {
    const line = edgePolyline(stamp.roads, e);
    for (let k = 1; k < line.length; k++) n += Math.hypot(line[k].x - line[k - 1].x, line[k].y - line[k - 1].y);
  }
  return n;
}
