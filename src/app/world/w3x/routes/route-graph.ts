/**
 * The walking routes of a map as a directed graph in Warcraft world units:
 * spawn nodes, waypoint nodes, one end node (where leaks cost lives), and
 * edges in walking direction. Every strategy (script patterns, script
 * evaluation, terrain) produces raw edges between points; `buildRouteGraph`
 * picks the end and the spawns and keeps only what lies on a way from a
 * spawn to the end. Shared waypoints are one node, so routes that merge
 * share their nodes and edges.
 */

import type { W3Region } from '../formats/w3r';

export type RouteStrategy = 'script-pattern' | 'script-eval' | 'terrain' | 'maze';

export interface RouteNode {
  id: string;
  name: string;
  x: number;
  y: number;
  /** The region the node is the centre of */
  region?: W3Region;
}

export interface RouteEdge {
  from: string;
  to: string;
}

export interface RouteGraph {
  strategy: RouteStrategy;
  nodes: RouteNode[];
  edges: RouteEdge[];
  spawns: string[];
  end: string;
  warnings: string[];
}

/** Raw output of a strategy before the end and the spawns are chosen */
export interface RawRoutes {
  nodes: Map<string, RouteNode>;
  edges: RouteEdge[];
  /** Nodes where the script creates units or that are named like spawns */
  spawnHints: Set<string>;
  /**
   * Nodes where the script creates units: spawns even where other lanes
   * walk through them (a spawn square on another lane's way)
   */
  creationHints: Set<string>;
  /** Nodes whose enter trigger costs lives, or named like an end */
  endHints: Set<string>;
}

export const SPAWN_WORDS = /spawn|start|creep|enemy|enter|portal|gate|wave/i;
export const END_WORDS = /throne|\bend\b|end_|finish|castle|leak|goal|\bbase\b|king|queen|exit|core|home/i;

export function emptyRaw(): RawRoutes {
  return { nodes: new Map(), edges: [], spawnHints: new Set(), creationHints: new Set(), endHints: new Set() };
}

function reach(from: string[], adj: Map<string, string[]>): Set<string> {
  const seen = new Set(from);
  const stack = [...from];
  while (stack.length) {
    const n = stack.pop()!;
    for (const m of adj.get(n) ?? []) {
      if (!seen.has(m)) {
        seen.add(m);
        stack.push(m);
      }
    }
  }
  return seen;
}

/** Null when the raw edges hold no way from any start to an end */
export function buildRouteGraph(raw: RawRoutes, strategy: RouteStrategy): RouteGraph | null {
  const edges = dedupe(raw.edges.filter((e) => e.from !== e.to && raw.nodes.has(e.from) && raw.nodes.has(e.to)));
  if (edges.length === 0) return null;
  const out = new Map<string, string[]>();
  const into = new Map<string, string[]>();
  for (const e of edges) {
    (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e.to);
    (into.get(e.to) ?? into.set(e.to, []).get(e.to)!).push(e.from);
  }
  const ids = [...new Set(edges.flatMap((e) => [e.from, e.to]))];
  const sources = ids.filter((n) => !into.has(n));
  const sinks = ids.filter((n) => !out.has(n));
  const warnings: string[] = [];

  // End: a node the most starts reach; hints (lives lost, end-like names) and sinks first
  const starts = sources.length > 0 ? sources : ids.filter((n) => raw.spawnHints.has(n));
  const score = (n: string): number => {
    const reachers = starts.filter((s) => reach([s], out).has(n)).length;
    const hint = raw.endHints.has(n) ? 2 : 0;
    const named = END_WORDS.test(raw.nodes.get(n)!.name) ? 1 : 0;
    const sink = sinks.includes(n) ? 1 : 0;
    return reachers * 10 + hint + named + sink;
  };
  const endCandidates = [...new Set([...sinks, ...ids.filter((n) => raw.endHints.has(n))])];
  if (endCandidates.length === 0) return null;
  endCandidates.sort((a, b) => score(b) - score(a));
  const end = endCandidates[0];
  if (endCandidates.length > 1) {
    const others = endCandidates.slice(1).filter((n) => sinks.includes(n));
    if (others.length) warnings.push(`routes: other dead ends ignored: ${others.map((n) => raw.nodes.get(n)!.name).join(', ')}`);
  }

  // Walking ends at the end node: its own outgoing edges are dropped
  const forward = new Map([...out].filter(([k]) => k !== end));
  const backward = new Map<string, string[]>();
  for (const [from, tos] of forward) {
    for (const to of tos) (backward.get(to) ?? backward.set(to, []).get(to)!).push(from);
  }
  const toEnd = reach([end], backward);
  let spawns = starts.filter((s) => toEnd.has(s) && s !== end);
  // Units created on another lane's way start there too
  for (const n of ids) if (raw.creationHints.has(n) && toEnd.has(n) && n !== end && !spawns.includes(n)) spawns.push(n);
  const hinted = ids.filter((n) => raw.spawnHints.has(n) && toEnd.has(n) && n !== end);
  if (spawns.length === 0) spawns = hinted;
  // In the map's order of regions (spawn 1, 2, ...), points after them
  const order = (n: string): number => raw.nodes.get(n)!.region?.index ?? Number.MAX_SAFE_INTEGER;
  spawns.sort((a, b) => order(a) - order(b) || raw.nodes.get(a)!.name.localeCompare(raw.nodes.get(b)!.name, undefined, { numeric: true }));
  if (spawns.length === 0) return null;
  const lost = starts.filter((s) => !toEnd.has(s));
  if (lost.length) warnings.push(`routes: ${lost.length} start(s) never reach the end and were dropped`);

  const fromSpawns = reach(spawns, forward);
  const kept = edges.filter((e) => e.from !== end && fromSpawns.has(e.from) && toEnd.has(e.to));
  const nodeIds = new Set(kept.flatMap((e) => [e.from, e.to]));
  return {
    strategy,
    nodes: [...nodeIds].map((id) => raw.nodes.get(id)!),
    edges: kept,
    spawns: spawns.filter((s) => nodeIds.has(s)),
    end,
    warnings,
  };
}

function dedupe(edges: RouteEdge[]): RouteEdge[] {
  const seen = new Set<string>();
  return edges.filter((e) => {
    const k = `${e.from}\u0000${e.to}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Total length of every spawn's first path to the end, in world units, for reports and checks */
export function routeLengths(g: RouteGraph): Map<string, number> {
  const pos = new Map(g.nodes.map((n) => [n.id, n]));
  const out = new Map<string, string[]>();
  for (const e of g.edges) (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e.to);
  const result = new Map<string, number>();
  for (const s of g.spawns) {
    let n = s;
    let len = 0;
    const seen = new Set([s]);
    while (n !== g.end) {
      const next = (out.get(n) ?? []).find((m) => !seen.has(m));
      if (!next) break;
      const a = pos.get(n)!;
      const b = pos.get(next)!;
      len += Math.hypot(b.x - a.x, b.y - a.y);
      seen.add(next);
      n = next;
    }
    result.set(s, len);
  }
  return result;
}

/** The region a point belongs to: the smallest containing it */
export function regionAt(regions: W3Region[], x: number, y: number): W3Region | null {
  let best: W3Region | null = null;
  let bestArea = Infinity;
  for (const r of regions) {
    if (x < r.left - 1 || x > r.right + 1 || y < r.bottom - 1 || y > r.top + 1) continue;
    const area = (r.right - r.left) * (r.top - r.bottom);
    if (area < bestArea) {
      best = r;
      bestArea = area;
    }
  }
  return best;
}

/** Node for a region (keyed by its script variable) */
export function regionNode(raw: RawRoutes, r: W3Region): string {
  const id = r.variable;
  if (!raw.nodes.has(id)) {
    raw.nodes.set(id, { id, name: r.name, x: (r.left + r.right) / 2, y: (r.bottom + r.top) / 2, region: r });
    if (SPAWN_WORDS.test(r.name) && !/left|right|down|up|walk|wlk|to /i.test(r.name)) raw.spawnHints.add(id);
    if (END_WORDS.test(r.name)) raw.endHints.add(id);
  }
  return id;
}

/** Node for a free point, or the region it lies in */
export function pointNode(raw: RawRoutes, regions: W3Region[], x: number, y: number): string {
  const r = regionAt(regions, x, y);
  if (r) return regionNode(raw, r);
  const id = `p_${Math.round(x)}_${Math.round(y)}`;
  if (!raw.nodes.has(id)) raw.nodes.set(id, { id, name: `Point ${Math.round(x)} ${Math.round(y)}`, x, y });
  return id;
}

/** Bodies of the script's functions by name (JASS `function X takes` .. or Lua `function X(`) */
export function functionBodies(script: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /^[ \t]*(?:constant\s+)?function\s+(\w+)/gm;
  const starts: { name: string; at: number }[] = [];
  for (let m = re.exec(script); m; m = re.exec(script)) starts.push({ name: m[1], at: m.index });
  starts.forEach((s, i) => out.set(s.name, script.slice(s.at, starts[i + 1]?.at ?? script.length)));
  return out;
}

/** Text that suggests an enter trigger removes leaking units or costs lives */
export const LEAK_ACTION = /lives?\b|leak|RemoveUnit|KillUnit|ExplodeUnit|Defeat|GameOver|CustomDefeat/i;
