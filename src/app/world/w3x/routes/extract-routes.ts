/**
 * Picks the route strategy: script patterns (a), then script evaluation (b,
 * JASS only), then the terrain's lanes (c), then open walkable ground (d,
 * maze and circuit maps, starting and ending where the script's ways do).
 * The first that yields a way from a spawn to an end wins; the report names
 * it and keeps what the others said.
 */

import type { W3Region } from '../formats/w3r';
import type { W3xMapFiles } from '../map-files';
import { type Bounds, buildLaneMask, buildWalkMask } from './lane-mask';
import { type MazePoint, routesFromMaze } from './maze-routes';
import { type RawRoutes, type RouteGraph, type RouteStrategy, buildRouteGraph } from './route-graph';
import { routesFromEvaluation, routesFromPatterns, scriptRegions } from './script-routes';
import { routesFromTerrain } from './terrain-routes';

export interface RouteExtraction {
  graph: RouteGraph | null;
  /** Every strategy tried, in order, with its outcome */
  attempts: { strategy: RouteStrategy; result: string }[];
  /** Regions of the map plus those only the script defines */
  regions: W3Region[];
  warnings: string[];
}

export interface RouteOptions {
  /** Skip the script strategies (for tests and comparisons) */
  only?: RouteStrategy;
}

export function extractRoutes(map: W3xMapFiles, bounds: Bounds, options: RouteOptions = {}): RouteExtraction {
  const attempts: RouteExtraction['attempts'] = [];
  const warnings: string[] = [];
  const regions = [...map.regions];
  const known = new Set(regions.map((r) => r.variable));
  if (map.script) for (const r of scriptRegions(map.script.text)) if (!known.has(r.variable)) regions.push(r);
  const want = (s: RouteStrategy): boolean => !options.only || options.only === s;
  const endHints = new Set<string>();
  /** What the script strategies saw: where the maze strategy starts and ends when they find no way */
  const scriptRaws: RawRoutes[] = [];
  const done = (graph: RouteGraph): RouteExtraction => ({ graph, attempts, regions, warnings: [...warnings, ...graph.warnings] });

  if (map.script && want('script-pattern')) {
    const raw = routesFromPatterns(map.script, regions);
    scriptRaws.push(raw);
    raw.endHints.forEach((h) => endHints.add(h));
    const g = buildRouteGraph(raw, 'script-pattern');
    attempts.push({ strategy: 'script-pattern', result: g ? `${g.spawns.length} spawns` : `${raw.edges.length} orders, no route` });
    if (g) return done(g);
  }
  if (map.script?.language === 'jass' && want('script-eval')) {
    try {
      const ev = routesFromEvaluation(map.script, regions);
      scriptRaws.push(ev.raw);
      warnings.push(...ev.warnings);
      ev.raw.endHints.forEach((h) => endHints.add(h));
      for (const n of ev.raw.nodes.values()) if (n.region && !regions.includes(n.region)) regions.push(n.region);
      const g = buildRouteGraph(ev.raw, 'script-eval');
      attempts.push({ strategy: 'script-eval', result: g ? `${g.spawns.length} spawns from ${ev.orders} orders` : `${ev.orders} orders, no route` });
      if (g) return done(g);
    } catch (e) {
      attempts.push({ strategy: 'script-eval', result: `failed: ${(e as Error).message}` });
    }
  }
  if (want('terrain')) {
    const mask = buildLaneMask(map.pathing, map.terrain, bounds);
    if (!mask) {
      attempts.push({ strategy: 'terrain', result: 'no lane mask (no pathing map or no lane-like ground)' });
    } else {
      const t = routesFromTerrain({ mask, regions, endHints });
      const g = t ? buildRouteGraph(t.raw, 'terrain') : null;
      attempts.push({ strategy: 'terrain', result: g ? `${g.spawns.length} spawns on ${mask.source} lanes` : `no route on ${mask.source} lanes` });
      if (g) {
        warnings.push(...t!.warnings);
        return done(g);
      }
    }
  }
  if (want('maze')) {
    const mask = buildWalkMask(map.pathing, map.terrain, bounds);
    if (!mask) {
      attempts.push({ strategy: 'maze', result: 'no walkable ground (no pathing map)' });
    } else {
      const { spawns, ends, circling } = scriptPoints(scriptRaws);
      if (circling) warnings.push('routes: the script sends creeps round in circles (a circuit TD), no way of it ends');
      const t = routesFromMaze({
        mask,
        regions,
        spawns,
        ends,
        center: { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 },
      });
      const g = t ? buildRouteGraph(t.raw, 'maze') : null;
      attempts.push({ strategy: 'maze', result: g ? `${g.spawns.length} spawns over open ground` : 'no walkable way from a spawn to an end' });
      if (g) {
        warnings.push('routes: no fixed lanes; the ways are the shortest over walkable ground (maze), check them in the editor');
        warnings.push(...t!.warnings);
        return done(g);
      }
    }
  }
  return { graph: null, attempts, regions, warnings };
}

/**
 * Spawn and end points of the script strategies' raw ways: where units are
 * created and where ways start (no way leads there), and the ends the
 * script marks. `circling`: the ways close into loops with no way out.
 */
function scriptPoints(raws: RawRoutes[]): { spawns: MazePoint[]; ends: MazePoint[]; circling: boolean } {
  const spawns = new Map<string, MazePoint>();
  const ends = new Map<string, MazePoint>();
  let circling = false;
  for (const raw of raws) {
    const into = new Set(raw.edges.map((e) => e.to));
    const from = new Set(raw.edges.map((e) => e.from));
    const point = (id: string): MazePoint => {
      const n = raw.nodes.get(id)!;
      return { id, name: n.name, x: n.x, y: n.y };
    };
    for (const id of raw.creationHints) spawns.set(id, point(id));
    for (const id of from) if (!into.has(id)) spawns.set(id, point(id));
    for (const id of raw.endHints) ends.set(id, point(id));
    if (raw.edges.length > 0 && [...into].every((id) => from.has(id))) circling = true;
  }
  return { spawns: [...spawns.values()], ends: [...ends.values()], circling };
}
