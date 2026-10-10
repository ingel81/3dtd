/**
 * "Check": what keeps a map from playing well, each problem with a place to
 * jump to. Errors stop a test game from making sense (no spawn, a spawn that
 * cannot reach the HQ); warnings are worth a look (very short lanes, roads
 * under water, objects on the road).
 */
import type { CustomMapDocument, MapPoint } from '../../world/custom-map/map-document';
import { heightAt, insideMap } from '../model/grid';
import { components, edgePolyline, nearestOnEdges, nearestOnPolyline, routeBetween } from '../ops/path-graph';

export type IssueSeverity = 'error' | 'warning';

export interface MapIssue {
  severity: IssueSeverity;
  /** Stable kind for tests and icons */
  code:
    | 'no-paths'
    | 'no-spawns'
    | 'spawn-off-path'
    | 'spawn-unreachable'
    | 'hq-off-path'
    | 'hq-outside'
    | 'spawn-outside'
    | 'paths-split'
    | 'lane-short'
    | 'lane-long'
    | 'spawn-near-hq'
    | 'path-under-water'
    | 'object-on-path'
    | 'path-steep';
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
}

export const DEFAULT_RULES: ValidationRules = { snapDistance: 16, minLane: 200, maxLane: 4000, maxPathSlope: 30 };

export interface ValidationOptions {
  rules?: ValidationRules;
  /** Whether an object stops building (catalogue default when the object has no flag) */
  blocksBuild?: (asset: string) => boolean;
}

export function validateMap(doc: CustomMapDocument, options: ValidationOptions = {}): MapIssue[] {
  const rules = options.rules ?? DEFAULT_RULES;
  const issues: MapIssue[] = [];
  const t = doc.terrain;
  const { paths } = doc;

  if (!paths.edges.length) {
    issues.push({ severity: 'error', code: 'no-paths', message: 'The map has no paths. Enemies walk only on paths.' });
  }
  if (!doc.spawns.length) {
    issues.push({ severity: 'error', code: 'no-spawns', message: 'The map has no spawn.' });
  }
  if (!insideMap(t, doc.hq)) {
    issues.push({ severity: 'error', code: 'hq-outside', message: 'The HQ stands outside the map.', focus: doc.hq, target: { kind: 'hq' } });
  }

  if (paths.edges.length) {
    const hqHit = nearestOnEdges(paths, doc.hq);
    if (!hqHit || hqHit.dist > rules.snapDistance) {
      issues.push({
        severity: 'error',
        code: 'hq-off-path',
        message: `The HQ stands ${hqHit ? Math.round(hqHit.dist) : '?'} m from the nearest path (at most ${rules.snapDistance} m).`,
        focus: doc.hq,
        target: { kind: 'hq' },
      });
    }
    const groups = components(paths).filter((g) => g.length > 1);
    if (groups.length > 1) {
      const smallest = [...groups].sort((a, b) => a.length - b.length)[0];
      const node = paths.nodes.find((n) => n.id === smallest[0]);
      issues.push({
        severity: 'warning',
        code: 'paths-split',
        message: `The paths fall into ${groups.length} parts that do not connect.`,
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
    if (!paths.edges.length) continue;
    const hit = nearestOnEdges(paths, s);
    if (!hit || hit.dist > rules.snapDistance) {
      issues.push({
        severity: 'error',
        code: 'spawn-off-path',
        message: `Spawn ${name} stands ${hit ? Math.round(hit.dist) : '?'} m from the nearest path.`,
        focus: s,
        target: { kind: 'spawn', id: s.id },
      });
      continue;
    }
    const route = routeBetween(paths, s, doc.hq);
    if (!route) {
      issues.push({ severity: 'error', code: 'spawn-unreachable', message: `No path leads from spawn ${name} to the HQ.`, focus: s, target: { kind: 'spawn', id: s.id } });
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

  const water = t.water;
  for (const e of paths.edges) {
    const line = edgePolyline(paths, e);
    if (line.length < 2) continue;
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
        if (!steep && slope > rules.maxPathSlope) steep = p;
        if (!wet && water && e.kind !== 'bridge' && h < water.level && wetAt(doc, p)) wet = p;
        prevH = h;
      }
    }
    if (wet) {
      issues.push({ severity: 'warning', code: 'path-under-water', message: `Path ${e.id} runs under water (make it a bridge or raise the ground).`, focus: wet, target: { kind: 'edge', id: e.id } });
    }
    if (steep) {
      issues.push({ severity: 'warning', code: 'path-steep', message: `Path ${e.id} climbs steeper than ${rules.maxPathSlope} degrees.`, focus: steep, target: { kind: 'edge', id: e.id } });
    }
  }

  const blocks = options.blocksBuild ?? (() => false);
  let blocked = 0;
  let firstBlocked: { id: string; x: number; y: number } | null = null;
  for (const o of doc.objects) {
    if (!(o.blocksBuild ?? blocks(o.asset)) && !o.blocksLos) continue;
    const hit = nearestOnEdges(paths, o, 30);
    if (!hit) continue;
    const half = hit.edge.width / 2;
    if (nearestOnPolyline(edgePolyline(paths, hit.edge), o)!.dist < half) {
      blocked++;
      firstBlocked ??= o;
    }
  }
  if (firstBlocked) {
    issues.push({
      severity: 'warning',
      code: 'object-on-path',
      message: blocked === 1 ? 'An object stands on a path.' : `${blocked} objects stand on paths.`,
      focus: firstBlocked,
      target: { kind: 'object', id: firstBlocked.id },
    });
  }

  return issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
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
