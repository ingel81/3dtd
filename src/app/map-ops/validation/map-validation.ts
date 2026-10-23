/**
 * "Check": what keeps a map from playing well, each problem with a place to
 * jump to. Errors stop a test game from making sense (no spawn, a spawn that
 * cannot reach the HQ); warnings are worth a look (very short lanes, roads
 * under water, objects on the road).
 */
import type { CustomMapDocument, MapObject, MapPathEdge, MapPoint } from '../../world/custom-map/map-document';
import { TOWER_TYPES } from '../../configs/tower-types.config';
import { MAX_SPAWN_PORTALS } from '../../configs/marker-geometry.config';
import { WATER_DEPTH_M } from '../../world/world-provider';
import { dangerLook } from '../../world/custom-map/render/asset-catalog';
import { sceneCost, SCENE_BUDGET } from '../../world/custom-map/render/objects/scene-cost';
import { validateWaveTable, type WaveTable } from '../../director/sources/table/wave-table';
import { heightAt, insideMap, sampleX, sampleY, slopeAt } from '../grid';
import { components, EdgeIndex, nearestOnPolyline, offDoors, routeBetween } from '../path-graph';
import { undersideGap } from '../object-ops';
import { seatHeight, type ObjectFooting } from '../../world/custom-map/render/objects/object-seat';
import { boxDistance, toModel } from '../../world/custom-map/object-ground';
import { massOf, massRadius, massSegmentDistance, objectFooting } from '../../world/custom-map/object-mass';
import { cellarDepth, cellarOf, takesCellar } from '../../world/custom-map/object-cellar';
import { waterLevelAt } from '../../world/custom-map/water-level';
import { bridgeDecks, deckHeight, deckHeightAt, type BridgeDeck } from '../../world/custom-map/bridge-decks';
import { HeightField } from '../../world/custom-map/render/height-field';
import { TOWER_SPOT_M2, TYPICAL_TOWER_RANGE, type BuildAreas } from './build-areas';
import { waveEventProblems } from './wave-event-check';
import { MOVER_CLEARANCE, moverWays } from '../../world/custom-map/map-life';
import { mapProblems, type MapProblem, type MapProblemPart } from '../../world/custom-map/map-file';
import { mapRepairs } from '../../world/custom-map/map-repair';
import type { CheckText, CheckThing } from './check-text';

export type IssueSeverity = 'error' | 'warning';

export interface MapIssue {
  severity: IssueSeverity;
  /** Stable kind for tests and icons */
  code:
    | 'map-file'
    | 'map-values'
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
    | 'object-on-mover-route'
    | 'object-floating'
    | 'water-floating'
    | 'path-steep'
    | 'wave-list'
    | 'unknown-tower'
    | 'wave-events'
    | 'scene-cost';
  /** What it says, as data: the editor and the agents word it (checkText) */
  text: CheckText;
  /** Where to look */
  focus?: MapPoint;
  /** What to select */
  target?: { kind: 'spawn' | 'edge' | 'node' | 'object' | 'hq'; id?: string };
  /** The part of the map to fix it in, when no target says it */
  part?: MapProblemPart;
}

/**
 * What keeps the map file from being written (map-file.ts mapProblems):
 * saving, Ctrl+S and the download all refuse such a map, so each is an
 * error with the thing or the tool to fix it
 */
export function fileIssues(doc: CustomMapDocument, problems: readonly MapProblem[] = mapProblems(doc)): MapIssue[] {
  const hard = problems.map((q) => ({ q, severity: 'error' as const, code: 'map-file' as const, text: { key: 'mapFile', v: { problem: q } } as CheckText }));
  // Soft values (map-repair.ts): saved as they are, set right when the map is read next
  const soft = mapRepairs(doc).map((q) => ({ q, severity: 'warning' as const, code: 'map-values' as const, text: { key: 'mapValues', v: { problem: q } } as CheckText }));
  return [...hard, ...soft].map(({ q, severity, code, text }) => {
    const issue: MapIssue = { severity, code, text, part: q.part };
    if (q.at) {
      issue.target = q.at;
      const where = q.at.kind === 'hq' ? doc.hq : q.at.kind === 'object' ? doc.objects.find((o) => o.id === q.at!.id) : q.at.kind === 'spawn' ? doc.spawns.find((sp) => sp.id === q.at!.id) : q.at.kind === 'node' ? doc.paths.nodes.find((n) => n.id === q.at!.id) : undefined;
      if (where && Number.isFinite(where.x) && Number.isFinite(where.y)) issue.focus = { x: where.x, y: where.y };
    }
    return issue;
  });
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
  /** Whether a road may run through an asset (a gatehouse): not reported standing on a road */
  roadThrough?: (asset: string) => boolean;
  /** How the renderer stands an asset on the map (`ObjectFooting`, a catalogue entry is one); without it no object is checked for hanging in the air */
  footingOf?: (asset: string) => ObjectFooting | undefined;
  /** Where towers may stand (computeBuildAreas, judged in a worker); without it the room along the lanes is not checked */
  buildAreas?: BuildAreas | null;
  /** What one object of an asset costs on this map (`assetCosts`); without it the scene cost is not checked */
  costOf?: (asset: string, inLine: boolean) => number;
}

export function validateMap(doc: CustomMapDocument, options: ValidationOptions = {}): MapIssue[] {
  const rules = options.rules ?? DEFAULT_RULES;
  const issues: MapIssue[] = fileIssues(doc);
  const t = doc.terrain;
  const { paths } = doc;
  // Nearest-road lookups through a grid of the edges: an OSM world has ten thousand
  const edges = new EdgeIndex(paths);

  if (!paths.edges.length) {
    issues.push({ severity: 'error', code: 'no-paths', text: { key: 'noPaths' } });
  }
  if (!doc.spawns.length) {
    issues.push({ severity: 'error', code: 'no-spawns', text: { key: 'noSpawns' } });
  }
  if (doc.spawns.length > MAX_SPAWN_PORTALS) {
    const first = doc.spawns[MAX_SPAWN_PORTALS];
    issues.push({
      severity: 'error',
      code: 'too-many-spawns',
      text: { key: 'tooManySpawns', v: { count: doc.spawns.length, max: MAX_SPAWN_PORTALS } },
      focus: first,
      target: { kind: 'spawn', id: first.id },
    });
  }
  if (!insideMap(t, doc.hq)) {
    issues.push({ severity: 'error', code: 'hq-outside', text: { key: 'hqOutside' }, focus: doc.hq, target: { kind: 'hq' } });
  } else {
    groundIssues(doc, edges, doc.hq, { kind: 'hq' }, rules, issues, { kind: 'hq' });
  }

  if (paths.edges.length) {
    const hqHit = edges.nearest(doc.hq);
    if (!hqHit || hqHit.dist > rules.snapDistance) {
      issues.push({
        severity: 'error',
        code: 'hq-off-path',
        text: { key: 'hqOffPath', v: { dist: hqHit ? Math.round(hqHit.dist) : null, max: rules.snapDistance } },
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
        text: { key: 'pathsSplit', v: { parts: groups.length } },
        focus: node ? { x: node.x, y: node.y } : undefined,
        target: node ? { kind: 'node', id: node.id } : undefined,
      });
    }
  }

  for (const s of doc.spawns) {
    const name = s.name || s.id;
    if (!insideMap(t, s)) {
      issues.push({ severity: 'error', code: 'spawn-outside', text: { key: 'spawnOutside', v: { name } }, focus: s, target: { kind: 'spawn', id: s.id } });
      continue;
    }
    groundIssues(doc, edges, s, { kind: 'spawn', name }, rules, issues, { kind: 'spawn', id: s.id });
    if (!paths.edges.length) continue;
    const hit = edges.nearest(s);
    if (!hit || hit.dist > rules.snapDistance) {
      issues.push({
        severity: 'error',
        code: 'spawn-off-path',
        text: { key: 'spawnOffPath', v: { name, dist: hit ? Math.round(hit.dist) : null } },
        focus: s,
        target: { kind: 'spawn', id: s.id },
      });
      continue;
    }
    const route = routeBetween(paths, s, doc.hq, edges);
    if (!route) {
      issues.push({ severity: 'error', code: 'spawn-unreachable', text: { key: 'spawnUnreachable', v: { name } }, focus: s, target: { kind: 'spawn', id: s.id } });
      continue;
    }
    if (route.length < rules.minLane) {
      issues.push({
        severity: 'warning',
        code: 'lane-short',
        text: { key: 'laneShort', v: { name, length: Math.round(route.length), min: rules.minLane } },
        focus: s,
        target: { kind: 'spawn', id: s.id },
      });
    } else if (route.length > rules.maxLane) {
      issues.push({
        severity: 'warning',
        code: 'lane-long',
        text: { key: 'laneLong', v: { name, length: Math.round(route.length) } },
        focus: s,
        target: { kind: 'spawn', id: s.id },
      });
    }
    if (Math.hypot(s.x - doc.hq.x, s.y - doc.hq.y) < 60) {
      issues.push({ severity: 'warning', code: 'spawn-near-hq', text: { key: 'spawnNearHq', v: { name } }, focus: s, target: { kind: 'spawn', id: s.id } });
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
      text: { key: 'laneLittleRoom', v: { name: s.name || s.id, spots, range: TYPICAL_TOWER_RANGE, min: rules.minTowerSpots } },
      focus: s,
      target: { kind: 'spawn', id: s.id },
    });
  }

  const water = t.water;
  for (const [index, e] of paths.edges.entries()) {
    // Named as the outline counts them, not by the internal id
    const name: CheckThing = { kind: e.kind === 'path' || e.kind === 'bridge' ? e.kind : 'road', n: index + 1 };
    const line = edges.polyline(e);
    if (line.length < 2) continue;
    const outside = line.find((p) => !insideMap(t, p));
    if (outside) {
      issues.push({ severity: 'error', code: 'path-outside', text: { key: 'pathOutside', v: { thing: name } }, focus: outside, target: { kind: 'edge', id: e.id } });
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
      issues.push({ severity: 'warning', code: 'path-under-water', text: { key: 'pathUnderWater', v: { thing: name } }, focus: wet, target: { kind: 'edge', id: e.id } });
    }
    if (steep) {
      issues.push({ severity: 'warning', code: 'path-steep', text: { key: 'pathSteep', v: { thing: name, max: rules.maxPathSlope } }, focus: steep, target: { kind: 'edge', id: e.id } });
    }
  }

  const onPaths = objectsOnPaths(doc, { ...options, byHeight: true }, edges);
  const blocked = onPaths.length;
  const firstBlocked = onPaths[0];
  if (firstBlocked) {
    issues.push({
      severity: 'warning',
      code: 'object-on-path',
      text: { key: 'objectOnPath', v: { count: blocked } },
      focus: firstBlocked,
      target: { kind: 'object', id: firstBlocked.id },
    });
  }

  if (options.footingOf) floatingObjects(doc, options.footingOf, rules.maxFloat, issues);
  if (options.footingOf) {
    const inWay = objectsOnMoverWays(doc, options.footingOf);
    if (inWay.length) {
      issues.push({
        severity: 'warning',
        code: 'object-on-mover-route',
        text: { key: 'objectOnMover', v: { count: inWay.length, assets: [...new Set(inWay.map((o) => o.asset))].join(', ') } },
        focus: inWay[0],
        target: { kind: 'object', id: inWay[0].id },
      });
    }
  }
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
      text: { key: 'dangerColor', v: { count: alarming } },
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
        text: { key: 'sceneCost', v: { percent: Math.round(share * 100) } },
      });
    }
  }

  const gp = doc.gameplay;
  if (gp?.waves?.kind === 'table') {
    for (const problem of validateWaveTable(gp.waves.table as unknown as WaveTable)) {
      issues.push({ severity: 'error', code: 'wave-list', text: { key: 'waveList', v: { problem } } });
    }
  }
  if (gp?.towers) {
    const unknown = gp.towers.filter((t) => !(t in TOWER_TYPES));
    if (unknown.length) issues.push({ severity: 'warning', code: 'unknown-tower', text: { key: 'unknownTowers', v: { list: unknown.join(', ') } } });
    if (!gp.towers.some((t) => t in TOWER_TYPES && t !== 'research-center' && t !== 'missile-silo')) {
      issues.push({ severity: 'error', code: 'unknown-tower', text: { key: 'noShootingTower' } });
    }
  }

  for (const p of waveEventProblems(doc)) {
    issues.push({ severity: p.severity, code: 'wave-events', text: p.text, focus: p.focus, target: p.target });
  }

  const lanes = gp?.lanes;
  if (lanes && doc.spawns.length > 0) {
    const always = doc.spawns.filter((s) => !s.optional).length;
    if (lanes.min !== undefined && lanes.min > doc.spawns.length) {
      issues.push({ severity: 'warning', code: 'lanes', text: { key: 'lanesMin', v: { min: lanes.min, spawns: doc.spawns.length } } });
    }
    if (lanes.max !== undefined && lanes.max < always) {
      issues.push({ severity: 'warning', code: 'lanes', text: { key: 'lanesMax', v: { max: lanes.max, always } } });
    }
  }

  return issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
}

/** Water and steep ground under a spawn portal or the HQ */
/**
 * The objects that stand on a road (`object-on-path`): ones that block
 * building or sight and are no gate a road runs through, whose ground
 * reaches onto a road (groundOnPath). With `byHeight` (the editor's check)
 * a road in a tunnel runs under them, and with footings an object whose
 * top stays under a bridge's deck stands under it (a track under a road
 * bridge), not on it; without, every road counts on the ground (the level
 * scripts and the OSM buildings keep off them so)
 */
export function objectsOnPaths(
  doc: CustomMapDocument,
  options: Pick<ValidationOptions, 'blocksBuild' | 'roadThrough' | 'footingOf'> & { byHeight?: boolean },
  edges = new EdgeIndex(doc.paths),
): MapObject[] {
  const blocks = options.blocksBuild ?? (() => false);
  const t = doc.terrain;
  let decks: Map<MapPathEdge, BridgeDeck> | undefined;
  const ground = (x: number, y: number) => heightAt(t, x, y);
  const water = (x: number, y: number) => waterLevelAt(t, x, y, ground(x, y));
  const clear = (o: MapObject, footing: ObjectFooting | undefined, edge: MapPathEdge): boolean => {
    // A passage runs through the building over it; a square's outline is walked, not laid (the OSM import pulls it
    // off the walls, square-outlines.ts)
    if (edge.covered || edge.area) return true;
    if (!options.byHeight) return false;
    if (edge.tunnel) return true;
    if (edge.kind !== 'bridge' || !footing) return false;
    decks ??= decksOf(edges, t);
    const deck = decks.get(edge);
    if (!deck) return false;
    const top = seatHeight(footing, o, ground, water) + o.z + footing.height * (o.scale || 1);
    const near = nearestOnPolyline(deck.line, o);
    return !!near && top < deckHeight(deck, near.along / deck.total) - UNDER_DECK;
  };
  return doc.objects.filter((o) => {
    if (!((o.blocksBuild ?? blocks(o.asset)) || o.blocksLos) || options.roadThrough?.(o.asset)) return false;
    const footing = options.footingOf?.(o.asset);
    return groundOnPath(o, footing, edges, (edge) => clear(o, footing, edge));
  });
}

/** Metres an object's top keeps under a bridge's deck to stand under it */
const UNDER_DECK = 0.5;

/** The bridge decks of an index's paths on a terrain, kept per index (the OSM buildings ask once per footprint) */
const deckCache = new WeakMap<EdgeIndex, { heights: Float32Array; decks: Map<MapPathEdge, BridgeDeck> }>();
function decksOf(edges: EdgeIndex, t: CustomMapDocument['terrain']): Map<MapPathEdge, BridgeDeck> {
  const kept = deckCache.get(edges);
  if (kept && kept.heights === t.grid.heights) return kept.decks;
  const decks = new Map(bridgeDecks(edges.paths, t, new HeightField(t.grid, t.width, t.depth)).map((d) => [d.edge, d]));
  deckCache.set(edges, { heights: t.grid.heights, decks });
  return decks;
}

/**
 * Share of a footpath's width (kind `path`) that counts against an object's
 * ground: a wall may stand at the pavement, a house's front line along it
 * (roads and bridges count in full)
 */
export const PATH_WALL_SHARE = 0.5;

/** Half width of the widest road the check looks out for round an object, metres */
const WIDEST_PATH = 40;

/**
 * Whether an object's ground (object-ground.ts: its footprint disc, for
 * buildings and walls within it the turned ground rectangle, for rocks their
 * underside) reaches onto a
 * road: some point of a road's centre line nearer to that ground than the
 * road's half width (a footpath's times PATH_WALL_SHARE). Without a footing
 * only the object's middle counts. A stilt hut beside a boardwalk stood with
 * its middle off the deck and half its floor on it
 */
function groundOnPath(o: MapObject, footing: ObjectFooting | undefined, edges: EdgeIndex, under: (edge: MapPathEdge) => boolean = () => false): boolean {
  const s = o.scale || 1;
  // A raised building stands on its own outline (object-mass.ts)
  const mass = massOf(o);
  const r = (mass ? massRadius(mass) : (footing?.footprint ?? 0)) * s;
  // A rock stands on its underside (its measured plate), not on the disc of its widest overhang
  const box = footing?.box ?? (footing?.base ? ([0, 0, footing.base[0], footing.base[1]] as const) : undefined);
  const cos = Math.cos(o.rotation);
  const sin = Math.sin(o.rotation);
  for (const near of edges.segmentsNear(o, r + Math.min(widestHalf(edges), WIDEST_PATH))) {
    const edge = near.edge;
    if (under(edge)) continue;
    const half = (edge.width / 2) * (edge.kind === 'path' ? PATH_WALL_SHARE : 1);
    // A way that runs into a passage through a building touches its wall with its end: that holds nothing off
    const piece = offDoors(near.a, near.b, near.doorA, near.doorB, half);
    if (!piece) continue;
    const [a, b] = piece;
    if (mass) {
      // The centre line against the building's walls, in its own axes
      const p = toModel(a.x - o.x, a.y - o.y, cos, sin);
      const q = toModel(b.x - o.x, b.y - o.y, cos, sin);
      if (massSegmentDistance(mass, p.x / s, p.z / s, q.x / s, q.z / s) * s < half) return true;
      continue;
    }
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    // The part of the segment within reach of the disc, walked in steps of a quarter metre
    const along = ((o.x - a.x) * dx + (o.y - a.y) * dy) / len;
    const off = Math.abs(((o.x - a.x) * dy - (o.y - a.y) * dx) / len);
    const reach = r + half;
    if (off >= reach) continue;
    const chord = Math.sqrt(reach * reach - off * off);
    const t0 = Math.max(0, along - chord);
    const t1 = Math.min(len, along + chord);
    for (let t = t0; t <= t1 + 1e-9; t += 0.25) {
      const px = a.x + (dx / len) * t - o.x;
      const py = a.y + (dy / len) * t - o.y;
      const disc = Math.max(0, Math.hypot(px, py) - r);
      const rect = box ? boxDistance(box, s, px, py, cos, sin) : 0;
      if (Math.max(disc, rect) < half) return true;
    }
  }
  return false;
}

/** Half the widest road of the map (the reach segmentsNear needs) */
const widest = new WeakMap<EdgeIndex, number>();
function widestHalf(edges: EdgeIndex): number {
  let w = widest.get(edges);
  if (w === undefined) {
    w = Math.max(0, ...edges.paths.edges.map((e) => e.width / 2));
    widest.set(edges, w);
  }
  return w;
}

function groundIssues(
  doc: CustomMapDocument,
  edges: EdgeIndex,
  p: MapPoint,
  name: CheckThing,
  rules: ValidationRules,
  issues: MapIssue[],
  target: { kind: 'spawn' | 'hq'; id?: string },
): void {
  const kind = target.kind;
  // A spawn on a bridge stands over the river, not in it
  const onBridge = edges.nearest(p, rules.snapDistance)?.edge.kind === 'bridge';
  if (!onBridge && underWater(doc, p)) {
    issues.push({ severity: 'warning', code: kind === 'hq' ? 'hq-in-water' : 'spawn-in-water', text: { key: 'inWater', v: { thing: name } }, focus: p, target });
  }
  const slope = slopeAt(doc.terrain, p.x, p.y);
  if (slope > rules.maxMarkerSlope) {
    issues.push({
      severity: 'warning',
      code: kind === 'hq' ? 'hq-steep' : 'spawn-steep',
      text: { key: 'steep', v: { thing: name, slope: Math.round(slope), max: rules.maxMarkerSlope } },
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
  const bodies = [
    ...(t.water ? [{ body: t.water, name: { kind: 'main-water', water: t.water.kind ?? 'water' } as CheckThing }] : []),
    ...(t.waterBodies ?? []).map((body, index) => ({ body, name: { kind: 'water-body', n: index, water: body.kind ?? 'water' } as CheckThing })),
  ];
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
      text: { key: 'waterBuried', v: { thing: name, percent: Math.round((dry / marked) * 100), up: top - body.level } },
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
    const f = objectFooting(o, footingOf(o.asset));
    if (!f || f.category === 'fx' || f.aloft) continue;
    const s = o.scale || 1;
    const seat = seatHeight(f, o, ground, water);
    // A building's cellar (MapObject.cellar) reaches down from its floor: its walls stand on the ground under it
    const cellar = cellarDepth(cellarOf(o, takesCellar(f)));
    const solid = { o, reach: f.footprint * s, foot: seat + o.z - cellar, top: seat + o.z + f.height * s };
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

/** What a mover cannot drive through: rocks, trees, buildings, walls, props (not plants, structures one drives over, effects) */
const IN_THE_WAY: ReadonlySet<string> = new Set(['rock', 'tree', 'building', 'wall', 'prop']);

/**
 * Objects standing on the way of a ground route's movers (`object-on-mover-route`,
 * map-life.ts moverWays): their footprint reaches within MOVER_CLEARANCE of
 * the loop the movers drive, so a rover would go through them. `categories`
 * narrows what counts (default: all that stand in the way)
 */
export function objectsOnMoverWays(
  doc: CustomMapDocument,
  footingOf: (asset: string) => ObjectFooting | undefined,
  categories: ReadonlySet<string> = IN_THE_WAY,
): MapObject[] {
  const ways = moverWays(doc.life);
  if (!ways.length) return [];
  return doc.objects.filter((o) => {
    const f = objectFooting(o, footingOf(o.asset));
    if (!f || !categories.has(f.category)) return false;
    const reach = MOVER_CLEARANCE + f.footprint * (o.scale || 1);
    return ways.some((loop) => (nearestOnPolyline([...loop, loop[0]], o)?.dist ?? Infinity) < reach);
  });
}

function floatingObjects(doc: CustomMapDocument, footingOf: (asset: string) => ObjectFooting | undefined, tolerance: number, issues: MapIssue[]): void {
  const found = objectsInAir(doc, footingOf, tolerance);
  if (!found.length) return;
  const worst = found.reduce((a, b) => (Math.abs(b.gap) > Math.abs(a.gap) ? b : a));
  const inAir = found.filter((f) => f.gap > 0).length;
  const under = found.length - inAir;
  issues.push({
    severity: 'warning',
    code: 'object-floating',
    text: { key: 'objectsFloating', v: { inAir, under, asset: worst.o.asset, gap: Math.abs(worst.gap), up: worst.gap > 0 } },
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
export function waterInAir(doc: CustomMapDocument, tolerance = DEFAULT_RULES.maxWaterStep): { what: CheckThing; at: MapPoint; height: number }[] {
  const t = doc.terrain;
  const g = t.grid;
  const c = g.columns;
  const h = g.heights;
  const top = (x: number, y: number) => {
    const ground = heightAt(t, x, y);
    return Math.max(ground, waterLevelAt(t, x, y, ground) ?? ground);
  };
  const out: { what: CheckThing; at: MapPoint; height: number }[] = [];
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
    if (worst) out.push({ what: n === 0 ? { kind: 'main-water-short' } : { kind: 'body', n }, ...worst });
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
    if (worst) out.push({ what: { kind: river.kind === 'lava' ? 'lava-flow' : 'river', n: n + 1 }, ...worst });
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
    text: { key: 'waterFloating', v: { list: found.map((f) => f.what), worst: worst.what, height: worst.height } },
    focus: worst.at,
  });
}
