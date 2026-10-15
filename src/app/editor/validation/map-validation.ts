/**
 * "Check": what keeps a map from playing well, each problem with a place to
 * jump to. Errors stop a test game from making sense (no spawn, a spawn that
 * cannot reach the HQ); warnings are worth a look (very short lanes, roads
 * under water, objects on the road).
 */
import type { CustomMapDocument, MapObject, MapPoint } from '../../world/custom-map/map-document';
import { TOWER_TYPES } from '../../configs/tower-types.config';
import { MAX_SPAWN_PORTALS } from '../../configs/marker-geometry.config';
import { WATER_DEPTH_M } from '../../world/world-provider';
import { dangerLook } from '../../world/custom-map/render/asset-catalog';
import { sceneCost, SCENE_BUDGET } from '../../world/custom-map/render/objects/scene-cost';
import { validateWaveTable, type WaveTable } from '../../director/sources/table/wave-table';
import { heightAt, insideMap, sampleX, sampleY, slopeAt } from '../model/grid';
import { components, EdgeIndex, routeBetween } from '../ops/path-graph';
import { undersideGap } from '../ops/object-ops';
import { seatHeight, type ObjectFooting } from '../../world/custom-map/render/objects/object-seat';
import { waterLevelAt } from '../../world/custom-map/water-level';
import { bridgeDecks, deckHeightAt } from '../../world/custom-map/bridge-decks';
import { HeightField } from '../../world/custom-map/render/height-field';
import { TOWER_SPOT_M2, TYPICAL_TOWER_RANGE, type BuildAreas } from './build-areas';

export type IssueSeverity = 'error' | 'warning';

export interface MapIssue {
  severity: IssueSeverity;
  /** Stable kind for tests and icons */
  code:
    | 'no-paths'
    | 'no-spawns'
    | 'too-many-spawns'
    | 'spawn-off-path'
    | 'spawn-unreachable'
    | 'hq-off-path'
    | 'hq-outside'
    | 'spawn-outside'
    | 'hq-in-water'
    | 'spawn-in-water'
    | 'hq-steep'
    | 'spawn-steep'
    | 'path-outside'
    | 'danger-color'
    | 'paths-split'
    | 'lanes'
    | 'lane-short'
    | 'lane-long'
    | 'lane-little-room'
    | 'spawn-near-hq'
    | 'path-under-water'
    | 'water-buried'
    | 'object-on-path'
    | 'object-floating'
    | 'water-floating'
    | 'path-steep'
    | 'wave-list'
    | 'unknown-tower'
    | 'scene-cost';
  message: string;
  /** Where to look */
  focus?: MapPoint;
  /** What to select */
  target?: { kind: 'spawn' | 'edge' | 'node' | 'object' | 'hq'; id?: string };
}

export interface ValidationRules {
  /** How far a spawn or the HQ may stand off the nearest path, metres */
  snapDistance: number;
  /** Lanes shorter than this give the player no room, metres */
  minLane: number;
  /** Lanes longer than this take ages, metres */
  maxLane: number;
  /** Slope along a path that enemies would climb, degrees */
  maxPathSlope: number;
  /** Slope under a spawn portal or the HQ, degrees */
  maxMarkerSlope: number;
  /** Danger-coloured decoration closer than this to a road is reported, metres */
  dangerColorReach: number;
  /** A rock whose underside hangs further than this over the ground is reported, metres */
  maxFloat: number;
  /** A lane with room for fewer towers than this in reach of its route is reported (build-areas.ts) */
  minTowerSpots: number;
  /** Water whose surface ends further than this over the ground beside it (no bank holds it) is reported, metres */
  maxWaterStep: number;
}

export const DEFAULT_RULES: ValidationRules = {
  snapDistance: 16,
  minLane: 200,
  maxLane: 4000,
  maxPathSlope: 30,
  maxMarkerSlope: 30,
  dangerColorReach: 30,
  maxFloat: 0.25,
  minTowerSpots: 20,
  maxWaterStep: 0.5,
};

export interface ValidationOptions {
  rules?: ValidationRules;
  /** Whether an object stops building (catalogue default when the object has no flag) */
  blocksBuild?: (asset: string) => boolean;
  /** Whether an asset wears the colours of danger (default: the renderer's danger list, dangerLook) */
  dangerColor?: (asset: string) => boolean;
  /** How the renderer stands an asset on the map (`ObjectFooting`, a catalogue entry is one); without it no object is checked for hanging in the air */
  footingOf?: (asset: string) => ObjectFooting | undefined;
  /** Where towers may stand (computeBuildAreas, judged in a worker); without it the room along the lanes is not checked */
  buildAreas?: BuildAreas | null;
  /** What one object of an asset costs on this map (`assetCosts`); without it the scene cost is not checked */
  costOf?: (asset: string) => number;
}

export function validateMap(doc: CustomMapDocument, options: ValidationOptions = {}): MapIssue[] {
  const rules = options.rules ?? DEFAULT_RULES;
  const issues: MapIssue[] = [];
  const t = doc.terrain;
  const { paths } = doc;
  // Nearest-road lookups through a grid of the edges: an OSM world has ten thousand
  const edges = new EdgeIndex(paths);

  if (!paths.edges.length) {
    issues.push({ severity: 'error', code: 'no-paths', message: 'The map has no roads. Enemies walk only on roads (Roads tool, 6).' });
  }
  if (!doc.spawns.length) {
    issues.push({ severity: 'error', code: 'no-spawns', message: 'The map has no spawn.' });
  }
  if (doc.spawns.length > MAX_SPAWN_PORTALS) {
    const first = doc.spawns[MAX_SPAWN_PORTALS];
    issues.push({
      severity: 'error',
      code: 'too-many-spawns',
      message: `The map has ${doc.spawns.length} spawns; the game uses only the first ${MAX_SPAWN_PORTALS}.`,
      focus: first,
      target: { kind: 'spawn', id: first.id },
    });
  }
  if (!insideMap(t, doc.hq)) {
    issues.push({ severity: 'error', code: 'hq-outside', message: 'The HQ stands outside the map.', focus: doc.hq, target: { kind: 'hq' } });
  } else {
    groundIssues(doc, edges, doc.hq, 'The HQ', rules, issues, { kind: 'hq' });
  }

  if (paths.edges.length) {
    const hqHit = edges.nearest(doc.hq);
    if (!hqHit || hqHit.dist > rules.snapDistance) {
      issues.push({
        severity: 'error',
        code: 'hq-off-path',
        message: `The HQ stands ${hqHit ? Math.round(hqHit.dist) : '?'} m from the nearest road (at most ${rules.snapDistance} m).`,
        focus: doc.hq,
        target: { kind: 'hq' },
      });
    }
    const groups = components(paths, edges).filter((g) => g.length > 1);
    if (groups.length > 1) {
      const smallest = [...groups].sort((a, b) => a.length - b.length)[0];
      const node = paths.nodes.find((n) => n.id === smallest[0]);
      issues.push({
        severity: 'warning',
        code: 'paths-split',
        message: `The roads fall into ${groups.length} parts that do not connect.`,
        focus: node ? { x: node.x, y: node.y } : undefined,
        target: node ? { kind: 'node', id: node.id } : undefined,
      });
    }
  }

  for (const s of doc.spawns) {
    const name = s.name || s.id;
    if (!insideMap(t, s)) {
      issues.push({ severity: 'error', code: 'spawn-outside', message: `Spawn ${name} stands outside the map.`, focus: s, target: { kind: 'spawn', id: s.id } });
      continue;
    }
    groundIssues(doc, edges, s, `Spawn ${name}`, rules, issues, { kind: 'spawn', id: s.id });
    if (!paths.edges.length) continue;
    const hit = edges.nearest(s);
    if (!hit || hit.dist > rules.snapDistance) {
      issues.push({
        severity: 'error',
        code: 'spawn-off-path',
        message: `Spawn ${name} stands ${hit ? Math.round(hit.dist) : '?'} m from the nearest road.`,
        focus: s,
        target: { kind: 'spawn', id: s.id },
      });
      continue;
    }
    const route = routeBetween(paths, s, doc.hq, edges);
    if (!route) {
      issues.push({ severity: 'error', code: 'spawn-unreachable', message: `No road leads from spawn ${name} to the HQ.`, focus: s, target: { kind: 'spawn', id: s.id } });
      continue;
    }
    if (route.length < rules.minLane) {
      issues.push({
        severity: 'warning',
        code: 'lane-short',
        message: `The lane from spawn ${name} is ${Math.round(route.length)} m long, short for towers (from ${rules.minLane} m).`,
        focus: s,
        target: { kind: 'spawn', id: s.id },
      });
    } else if (route.length > rules.maxLane) {
      issues.push({
        severity: 'warning',
        code: 'lane-long',
        message: `The lane from spawn ${name} is ${Math.round(route.length)} m long; waves take long to arrive.`,
        focus: s,
        target: { kind: 'spawn', id: s.id },
      });
    }
    if (Math.hypot(s.x - doc.hq.x, s.y - doc.hq.y) < 60) {
      issues.push({ severity: 'warning', code: 'spawn-near-hq', message: `Spawn ${name} stands right next to the HQ.`, focus: s, target: { kind: 'spawn', id: s.id } });
    }
  }

  // Room for towers in reach of each lane's route, by the game's placement rules
  for (const lane of options.buildAreas?.lanes ?? []) {
    const s = doc.spawns.find((sp) => sp.id === lane.spawnId);
    const spots = Math.floor(lane.area / TOWER_SPOT_M2);
    if (!s || !lane.routed || spots >= rules.minTowerSpots) continue;
    issues.push({
      severity: 'warning',
      code: 'lane-little-room',
      message: `Along the lane from spawn ${s.name || s.id} there is room for about ${spots} towers within ${TYPICAL_TOWER_RANGE} m of the route (at least ${rules.minTowerSpots} give the player a choice). Measure > Build areas shows where.`,
      focus: s,
      target: { kind: 'spawn', id: s.id },
    });
  }

  const water = t.water;
  const KIND_NAME = { road: 'Road', path: 'Path', bridge: 'Bridge' } as const;
  for (const [index, e] of paths.edges.entries()) {
    // Named as the outline counts them, not by the internal id
    const name = `${KIND_NAME[e.kind] ?? 'Road'} ${index + 1}`;
    const line = edges.polyline(e);
    if (line.length < 2) continue;
    const outside = line.find((p) => !insideMap(t, p));
    if (outside) {
      issues.push({ severity: 'error', code: 'path-outside', message: `${name} runs off the map.`, focus: outside, target: { kind: 'edge', id: e.id } });
    }
    let wet: MapPoint | null = null;
    let steep: MapPoint | null = null;
    for (let k = 1; k < line.length; k++) {
      const a = line[k - 1];
      const b = line[k];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const steps = Math.max(1, Math.ceil(len / 4));
      let prevH = heightAt(t, a.x, a.y);
      for (let s = 1; s <= steps; s++) {
        const p = { x: a.x + ((b.x - a.x) * s) / steps, y: a.y + ((b.y - a.y) * s) / steps };
        const h = heightAt(t, p.x, p.y);
        const slope = (Math.atan(Math.abs(h - prevH) / (len / steps)) * 180) / Math.PI;
        // A bridge's deck spans what lies under it: the bed is no climb
        if (!steep && e.kind !== 'bridge' && slope > rules.maxPathSlope) steep = p;
        if (!wet && water && e.kind !== 'bridge' && h < water.level && wetAt(doc, p)) wet = p;
        prevH = h;
      }
    }
    if (wet) {
      issues.push({ severity: 'warning', code: 'path-under-water', message: `${name} runs under water (make it a bridge or raise the ground).`, focus: wet, target: { kind: 'edge', id: e.id } });
    }
    if (steep) {
      issues.push({ severity: 'warning', code: 'path-steep', message: `${name} climbs steeper than ${rules.maxPathSlope} degrees.`, focus: steep, target: { kind: 'edge', id: e.id } });
    }
  }

  const blocks = options.blocksBuild ?? (() => false);
  let blocked = 0;
  let firstBlocked: { id: string; x: number; y: number } | null = null;
  for (const o of doc.objects) {
    if (!(o.blocksBuild ?? blocks(o.asset)) && !o.blocksLos) continue;
    const hit = edges.nearest(o, 30);
    if (!hit) continue;
    if (hit.dist < hit.edge.width / 2) {
      blocked++;
      firstBlocked ??= o;
    }
  }
  if (firstBlocked) {
    issues.push({
      severity: 'warning',
      code: 'object-on-path',
      message: blocked === 1 ? 'An object stands on a road.' : `${blocked} objects stand on roads.`,
      focus: firstBlocked,
      target: { kind: 'object', id: firstBlocked.id },
    });
  }

  if (options.footingOf) floatingObjects(doc, options.footingOf, rules.maxFloat, issues);
  floatingWater(doc, rules.maxWaterStep, issues);
  buriedWater(doc, issues);

  const danger = options.dangerColor ?? ((asset: string) => dangerLook(asset) !== null);
  let alarming = 0;
  let firstAlarming: { id: string; x: number; y: number } | null = null;
  if (paths.edges.length) {
    for (const o of doc.objects) {
      if (!danger(o.asset) || !edges.nearest(o, rules.dangerColorReach)) continue;
      alarming++;
      firstAlarming ??= o;
    }
  }
  if (firstAlarming) {
    issues.push({
      severity: 'warning',
      code: 'danger-color',
      message:
        (alarming === 1 ? 'A red plant stands' : `${alarming} red plants stand`) +
        ' by a road; red reads as danger there. Use another colour or move them away.',
      focus: firstAlarming,
      target: { kind: 'object', id: firstAlarming.id },
    });
  }

  if (options.costOf) {
    const share = sceneCost(doc.objects, options.costOf) / SCENE_BUDGET;
    if (share > 1) {
      issues.push({
        severity: 'warning',
        code: 'scene-cost',
        message: `Scene cost ${Math.round(share * 100)} %: more than a map draws fluidly. Thin out buildings, trees and props first (Map panel, Budget).`,
      });
    }
  }

  const gp = doc.gameplay;
  if (gp?.waves?.kind === 'table') {
    for (const problem of validateWaveTable(gp.waves.table as unknown as WaveTable)) {
      issues.push({ severity: 'error', code: 'wave-list', message: `Wave list: ${problem}` });
    }
  }
  if (gp?.towers) {
    const unknown = gp.towers.filter((t) => !(t in TOWER_TYPES));
    if (unknown.length) issues.push({ severity: 'warning', code: 'unknown-tower', message: `Unknown tower types allowed: ${unknown.join(', ')}` });
    if (!gp.towers.some((t) => t in TOWER_TYPES && t !== 'research-center' && t !== 'missile-silo')) {
      issues.push({ severity: 'error', code: 'unknown-tower', message: 'No tower that shoots is allowed.' });
    }
  }

  const lanes = gp?.lanes;
  if (lanes && doc.spawns.length > 0) {
    const always = doc.spawns.filter((s) => !s.optional).length;
    if (lanes.min !== undefined && lanes.min > doc.spawns.length) {
      issues.push({ severity: 'warning', code: 'lanes', message: `At least ${lanes.min} lanes should be open, but the map has ${doc.spawns.length} spawns.` });
    }
    if (lanes.max !== undefined && lanes.max < always) {
      issues.push({ severity: 'warning', code: 'lanes', message: `At most ${lanes.max} lanes may be open, but ${always} spawns are always open. Mark some as optional.` });
    }
  }

  return issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
}

/** Water and steep ground under a spawn portal or the HQ */
function groundIssues(
  doc: CustomMapDocument,
  edges: EdgeIndex,
  p: MapPoint,
  name: string,
  rules: ValidationRules,
  issues: MapIssue[],
  target: { kind: 'spawn' | 'hq'; id?: string },
): void {
  const kind = target.kind;
  // A spawn on a bridge stands over the river, not in it
  const onBridge = edges.nearest(p, rules.snapDistance)?.edge.kind === 'bridge';
  if (!onBridge && underWater(doc, p)) {
    issues.push({ severity: 'warning', code: kind === 'hq' ? 'hq-in-water' : 'spawn-in-water', message: `${name} stands in water.`, focus: p, target });
  }
  const slope = slopeAt(doc.terrain, p.x, p.y);
  if (slope > rules.maxMarkerSlope) {
    issues.push({
      severity: 'warning',
      code: kind === 'hq' ? 'hq-steep' : 'spawn-steep',
      message: `${name} stands on a ${Math.round(slope)} degree slope (at most ${rules.maxMarkerSlope}).`,
      focus: p,
      target,
    });
  }
}

/** In any body of water (the ground below its level where its mask is set) or within a river's banks */
function underWater(doc: CustomMapDocument, p: MapPoint): boolean {
  const t = doc.terrain;
  const g = t.grid;
  const i = Math.round((p.x + t.width / 2) / g.cellSize);
  const j = Math.round((p.y + t.depth / 2) / g.cellSize);
  if (i >= 0 && j >= 0 && i < g.columns && j < g.rows) {
    const ground = heightAt(t, p.x, p.y);
    for (const body of [t.water, ...(t.waterBodies ?? [])]) {
      if (body && body.mask[j * g.columns + i] > 0 && ground < body.level - WATER_DEPTH_M) return true;
    }
  }
  for (const river of t.rivers ?? []) {
    for (let n = 0; n + 1 < river.points.length; n++) {
      const a = river.points[n];
      const b = river.points[n + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const u = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
      const half = (a.width + (b.width - a.width) * u) / 2;
      if (Math.hypot(a.x + dx * u - p.x, a.y + dy * u - p.y) < half) return true;
    }
  }
  return false;
}

/** Fewest marked cells a body needs before `buriedWater` judges it */
const BURIED_MIN_CELLS = 40;
/**
 * Share of a body's marked cells under the ground from which it counts as
 * buried; a mask painted wide over the shore leaves much dry (the demo
 * valley's water 65 %, every other shipped body under 30 %)
 */
const BURIED_SHARE = 0.85;

/**
 * Water whose bed rose over its surface (`water-buried`): most cells its mask
 * marks have ground above its level, so it does not show. A biome brush or a
 * landform stroked over a frozen lake did this and the check said nothing
 * (an AI agent's winter map, 2026-10-15). One pass over each mask.
 */
function buriedWater(doc: CustomMapDocument, issues: MapIssue[]): void {
  const t = doc.terrain;
  const g = t.grid;
  const bodies = [...(t.water ? [{ body: t.water, name: `The ${t.water.kind && t.water.kind !== 'water' ? t.water.kind : 'water'}` }] : []), ...(t.waterBodies ?? []).map((body, index) => ({ body, name: `Water body ${index} (${body.kind ?? 'water'})` }))];
  for (const { body, name } of bodies) {
    let marked = 0;
    let dry = 0;
    let top = -Infinity;
    let sx = 0;
    let sy = 0;
    for (let k = 0; k < body.mask.length; k++) {
      if (body.mask[k] === 0) continue;
      marked++;
      const h = g.heights[k];
      if (h <= body.level) continue;
      dry++;
      top = Math.max(top, h);
      sx += (k % g.columns) * g.cellSize - t.width / 2;
      sy += Math.floor(k / g.columns) * g.cellSize - t.depth / 2;
    }
    if (marked < BURIED_MIN_CELLS || dry / marked < BURIED_SHARE) continue;
    issues.push({
      severity: 'warning',
      code: 'water-buried',
      message: `${name} lies under the ground: ${Math.round((dry / marked) * 100)} % of it has its bed above its surface (up to ${(top - body.level).toFixed(1)} m). Dig it out again or raise its level.`,
      focus: { x: Math.round(sx / dry), y: Math.round(sy / dry) },
    });
  }
}

function wetAt(doc: CustomMapDocument, p: MapPoint): boolean {
  const t = doc.terrain;
  const w = t.water;
  if (!w) return false;
  const g = t.grid;
  const i = Math.round((p.x + t.width / 2) / g.cellSize);
  const j = Math.round((p.y + t.depth / 2) / g.cellSize);
  if (i < 0 || j < 0 || i >= g.columns || j >= g.rows) return false;
  return w.mask[j * g.columns + i] > 0;
}

/** Cell of the grid the supports of an object in the air are looked up in, metres */
const SUPPORT_CELL = 16;

/**
 * Objects hanging in the air (`object-floating`): each object's underside
 * against what it stands on, measured from where the renderer seats it
 * (seatHeight): a rock's plate against the ground under it (undersideGap: a
 * rock level on a slope; a flat set piece without a plate, coastal rocks or
 * a pool, on its footprint less half its thickness), a floating asset's waterline against the water
 * (its z counts from there), anything else its foot against the ground (a
 * house's lowest corner, a tree's trunk 0.15 m deep). More than `tolerance`
 * over it hangs in the air, unless something holds it up: another object
 * whose footprint its foot lies in, between that one's foot and top (a
 * lantern on a quay, a banner on a wall), a road bridge's deck it stands on
 * (to 0.25 m past its rim, at most 0.3 m sunk in), or ice it stands on. Effects (smoke, fog, the
 * waterfall) and what stands in the air by design (catalogue `aloft`:
 * bridges, cable spans, the gondola) are left out. A floating asset deeper
 * under its water than half its height (0.25 to 1.5 m) has sunk; it comes
 * back with a negative gap. One terrain lookup per object (eight for
 * houses, walls and props), supports only for the few in the air, from a
 * grid of SUPPORT_CELL metres.
 */
export function objectsInAir(doc: CustomMapDocument, footingOf: (asset: string) => ObjectFooting | undefined, tolerance = DEFAULT_RULES.maxFloat): { o: MapObject; gap: number }[] {
  const t = doc.terrain;
  const ground = (x: number, y: number) => heightAt(t, x, y);
  const water = (x: number, y: number) => waterLevelAt(t, x, y, ground(x, y));
  interface Solid {
    o: MapObject;
    reach: number;
    foot: number;
    top: number;
  }
  const solids: Solid[] = [];
  const hanging: { solid: Solid; gap: number }[] = [];
  const sunk: { o: MapObject; gap: number }[] = [];
  for (const o of doc.objects) {
    const f = footingOf(o.asset);
    if (!f || f.category === 'fx' || f.aloft) continue;
    const s = o.scale || 1;
    const seat = seatHeight(f, o, ground, water);
    const solid = { o, reach: f.footprint * s, foot: seat + o.z, top: seat + o.z + f.height * s };
    solids.push(solid);
    let gap: number;
    if (f.base && !f.float) gap = undersideGap(t, o, f.base);
    else if (flatSetPiece(o.asset, f)) {
      // A slab without a measured plate (coastal rocks, a pool): its footprint as the plate, its
      // own half thickness may stand over the ground on the low side
      gap = undersideGap(t, o, [f.footprint, f.footprint, 0]) - 0.5 * f.height * s;
    } else {
      // What it stands on: the water under a floating asset, the lowest corner under a house (its seat), else the ground
      const under = f.float ? (water(o.x, o.y) ?? ground(o.x, o.y)) : f.category === 'tree' ? ground(o.x, o.y) : seat;
      gap = solid.foot - under;
    }
    if (gap > tolerance) hanging.push({ solid, gap });
    // A floating asset under the water: deeper than half its height (a quarter metre at least, 1.5 m at most)
    else if (f.float && water(o.x, o.y) !== null && gap < -Math.max(0.25, Math.min(1.5, f.height * s * 0.5))) sunk.push({ o, gap });
  }
  if (!hanging.length) return sunk;
  const cells = new Map<string, Solid[]>();
  let widest = 0;
  for (const solid of solids) {
    const key = `${Math.floor(solid.o.x / SUPPORT_CELL)},${Math.floor(solid.o.y / SUPPORT_CELL)}`;
    let list = cells.get(key);
    if (!list) cells.set(key, (list = []));
    list.push(solid);
    widest = Math.max(widest, solid.reach);
  }
  // A road bridge's deck holds what stands on it (to its rim, a little sunk in), ice what stands on the ice
  const rim = 0.25;
  const decks = bridgeDecks(doc.paths, t, new HeightField(t.grid, t.width, t.depth)).map((d) => ({ ...d, half: d.half + rim, minX: d.minX - rim, minY: d.minY - rim, maxX: d.maxX + rim, maxY: d.maxY + rim }));
  const held = (a: Solid): boolean => {
    const deck = deckHeightAt(decks, a.o.x, a.o.y);
    if (a.foot >= deck - 0.3 && a.foot <= deck + tolerance) return true;
    const ice = waterLevelAt(t, a.o.x, a.o.y, ground(a.o.x, a.o.y), 'ice');
    if (ice !== null && Math.abs(a.foot - ice) <= tolerance) return true;
    const r = Math.ceil((widest + 0.5) / SUPPORT_CELL);
    const ci = Math.floor(a.o.x / SUPPORT_CELL);
    const cj = Math.floor(a.o.y / SUPPORT_CELL);
    for (let j = cj - r; j <= cj + r; j++) {
      for (let i = ci - r; i <= ci + r; i++) {
        for (const b of cells.get(`${i},${j}`) ?? []) {
          if (b === a || Math.hypot(b.o.x - a.o.x, b.o.y - a.o.y) > b.reach + 0.5) continue;
          if (a.foot >= b.foot - tolerance && a.foot <= b.top + tolerance) return true;
        }
      }
    }
    return false;
  };
  return [...hanging.filter(({ solid }) => !held(solid)).map(({ solid, gap }) => ({ o: solid.o, gap })), ...sunk];
}

/** Set pieces that ring a hollow (crater rims): nothing lies under their middle, their pieces follow the rim */
const RING_PIECES = new Set(['crater-rim', 'mars-crater-rim']);

/**
 * A flat rock set piece that rests on no measured plate (catalogue without
 * `base`): a slab or a pool, at most a quarter as high as it is wide; rings
 * left out. Cliff walls are wide too but stand against a slope, their foot
 * at the ground (the Cliff rocks brush sinks them in), not on a plate
 */
function flatSetPiece(asset: string, f: ObjectFooting): boolean {
  return f.category === 'rock' && !f.base && !f.float && f.height < f.footprint * FLAT_SHARE && !RING_PIECES.has(asset);
}

/** A set piece no higher than this share of its footprint lies flat */
const FLAT_SHARE = 0.25;

function floatingObjects(doc: CustomMapDocument, footingOf: (asset: string) => ObjectFooting | undefined, tolerance: number, issues: MapIssue[]): void {
  const found = objectsInAir(doc, footingOf, tolerance);
  if (!found.length) return;
  const worst = found.reduce((a, b) => (Math.abs(b.gap) > Math.abs(a.gap) ? b : a));
  const inAir = found.filter((f) => f.gap > 0).length;
  const under = found.length - inAir;
  const what = [
    inAir === 1 ? 'an object hangs in the air' : inAir ? `${inAir} objects hang in the air` : '',
    under === 1 ? 'a boat or buoy sinks under the water' : under ? `${under} boats or buoys sink under the water` : '',
  ].filter(Boolean);
  issues.push({
    severity: 'warning',
    code: 'object-floating',
    message:
      `${what.join(', ')} (worst: ${worst.o.asset}, ${Math.abs(worst.gap).toFixed(1)} m ${worst.gap > 0 ? 'up' : 'down'})`.replace(/^./, (c) => c.toUpperCase()) +
      '. Select it and press End to set it down on the ground or the water, or Align to slope.',
    focus: worst.o,
    target: { kind: 'object', id: worst.o.id },
  });
}

/** Metres down a river's surface may fall per metre and still count as running water, not a waterfall (river.ts FALL_STEEP) */
const FALL_STEEP = 1;

/**
 * Water standing in the air (`water-floating`): a sheet whose edge no bank
 * holds. A body's wet sample (mask set, ground below its level) next to one
 * outside its mask where both the ground and any other water lie more than
 * `tolerance` below the level, halfway to it where the surface ends: it
 * stops there in mid-air (a lake
 * dug on a slope, a rim a river cut through, a pool of a biome on low
 * ground). A river's ribbon, every 2 m along its points as the renderer
 * runs it, whose two banks (a metre past its edges) both lie that far below
 * its surface, except down a waterfall (falling faster than it runs) and
 * beyond the map's edge. Returns the worst place of each sheet.
 */
export function waterInAir(doc: CustomMapDocument, tolerance = DEFAULT_RULES.maxWaterStep): { what: string; at: MapPoint; height: number }[] {
  const t = doc.terrain;
  const g = t.grid;
  const c = g.columns;
  const h = g.heights;
  const top = (x: number, y: number) => {
    const ground = heightAt(t, x, y);
    return Math.max(ground, waterLevelAt(t, x, y, ground) ?? ground);
  };
  const out: { what: string; at: MapPoint; height: number }[] = [];
  const bodies = [t.water, ...(t.waterBodies ?? [])];
  bodies.forEach((body, n) => {
    if (!body) return;
    let worst: { at: MapPoint; height: number } | null = null;
    for (let k = 0; k < h.length; k++) {
      if (!body.mask[k] || h[k] >= body.level) continue;
      const i = k % c;
      const j = (k - i) / c;
      for (const [a, b] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) {
        if (a < 0 || b < 0 || a >= c || b >= g.rows) continue;
        const q = b * c + a;
        if (body.mask[q] || h[q] >= body.level - tolerance) continue;
        // The surface ends about halfway to the dry sample (the shore cut's soft edge): its height over the ground there
        const at = { x: sampleX(t, a), y: sampleY(t, b) };
        const edge = (h[k] + h[q]) / 2;
        const drop = body.level - Math.max(edge, waterLevelAt(t, at.x, at.y, h[q]) ?? edge);
        if (drop > tolerance && (!worst || drop > worst.height)) worst = { at, height: drop };
      }
    }
    if (worst) out.push({ what: n === 0 ? 'the main water' : `body ${n}`, ...worst });
  });
  (t.rivers ?? []).forEach((river, n) => {
    const pts = river.points;
    let worst: { at: MapPoint; height: number } | null = null;
    for (let s = 0; s + 1 < pts.length; s++) {
      const a = pts[s];
      const b = pts[s + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (!len || Math.abs(a.height - b.height) / len >= FALL_STEEP) continue;
      const nx = -(b.y - a.y) / len;
      const ny = (b.x - a.x) / len;
      for (let d = 0; d < len; d += 2) {
        const f = d / len;
        const p = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
        if (!insideMap(t, p)) continue;
        const level = a.height + (b.height - a.height) * f;
        const off = (a.width + (b.width - a.width) * f) / 2 + 1;
        const bank = Math.max(top(p.x + nx * off, p.y + ny * off), top(p.x - nx * off, p.y - ny * off));
        const drop = level - bank;
        if (drop > tolerance && (!worst || drop > worst.height)) worst = { at: p, height: drop };
      }
    }
    if (worst) out.push({ what: river.kind === 'lava' ? `lava flow ${n + 1}` : `river ${n + 1}`, ...worst });
  });
  return out;
}

function floatingWater(doc: CustomMapDocument, tolerance: number, issues: MapIssue[]): void {
  const found = waterInAir(doc, tolerance);
  if (!found.length) return;
  const worst = found.reduce((a, b) => (b.height > a.height ? b : a));
  issues.push({
    severity: 'warning',
    code: 'water-floating',
    message:
      `Water ends in the air: ${found.map((f) => f.what).join(', ')} (worst: ${worst.what}, ${worst.height.toFixed(1)} m over the ground beside it). ` +
      'Raise the bank there, lower the level, or take the mask off where no bank holds it.',
    focus: worst.at,
  });
}
