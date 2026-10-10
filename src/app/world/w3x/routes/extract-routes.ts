/**
 * Picks the route strategy: script patterns (a), then script evaluation (b,
 * JASS only), then the terrain (c). The first that yields a way from a spawn
 * to an end wins; the report names it and keeps what the others said.
 */

import type { W3Region } from '../formats/w3r';
import type { W3xMapFiles } from '../map-files';
import { type Bounds, buildLaneMask } from './lane-mask';
import { type RouteGraph, type RouteStrategy, buildRouteGraph } from './route-graph';
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
  const done = (graph: RouteGraph): RouteExtraction => ({ graph, attempts, regions, warnings: [...warnings, ...graph.warnings] });

  if (map.script && want('script-pattern')) {
    const raw = routesFromPatterns(map.script, regions);
    raw.endHints.forEach((h) => endHints.add(h));
    const g = buildRouteGraph(raw, 'script-pattern');
    attempts.push({ strategy: 'script-pattern', result: g ? `${g.spawns.length} spawns` : `${raw.edges.length} orders, no route` });
    if (g) return done(g);
  }
  if (map.script?.language === 'jass' && want('script-eval')) {
    try {
      const ev = routesFromEvaluation(map.script, regions);
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
  return { graph: null, attempts, regions, warnings };
}
