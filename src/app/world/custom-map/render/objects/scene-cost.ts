import type { CatalogObject } from '../asset-catalog';

/**
 * What a map's objects cost the picture, in points: per object about the
 * triangles it puts on screen with the camera somewhere over the map. An
 * object draws its model near the camera, its LOD models farther out, trees
 * and big rocks an impostor beyond that, and nothing past its draw distance
 * (object-layer.ts). Each band's triangles count with the share of the map
 * that lies within it (a disc around the camera, at most the whole map): on
 * a Small map a house drawn to 3 km is always in view and costs its 3 800
 * triangles, a grass tuft of 10 triangles that fades at 140 m costs a
 * fraction of one on a Large map, plus what every instance costs on top. The
 * Map panel and the map check hold the sum against SCENE_BUDGET
 * (docs/LEVEL_EDITOR.md, "Szenenkosten").
 */

/**
 * The points a map may spend and stay fluid: 100 % in the Map panel, the
 * map check and the shipped maps' check. Six times the Demo Valley (2.0 M
 * points, 1.2 ms GPU in the game view on the development machine), so
 * about 7 ms if GPU time grows with the points, room left under the 10 ms
 * of 100 fps for draw calls and the game itself (docs/LEVEL_EDITOR.md,
 * "Szenenkosten"). A GPU benchmark (e2e/perf/render-bench.ts) recalibrates
 * it here and nowhere else.
 */
export const SCENE_BUDGET = 12_000_000;

/** Points every object costs whatever it draws: its instance, sorting it into levels, its share of the shadow pass */
const INSTANCE_COST = 2;
/** The two crossed cards of an impostor (impostor.ts) */
const IMPOSTOR_TRIANGLES = 4;
/** Impostors start no nearer than this at the High quality level (render-quality.ts), m */
const IMPOSTOR_FROM = 380;
/** Points per particle a second of an effect: sprites that live a few seconds and overdraw */
const PARTICLE_COST = 20;
/** Triangles of a model the catalogue has not counted */
const UNKNOWN_TRIANGLES = 500;
/** An asset the catalogue does not know: a mid-sized prop */
const UNKNOWN: CostEntry = { category: 'prop', height: 2, drawDistance: 500, file: '?' };

/** The catalogue fields the cost reads */
export type CostEntry = Pick<CatalogObject, 'category' | 'height' | 'drawDistance' | 'file' | 'triangles' | 'lod' | 'effects'>;

/** Share of a map of `area` m² between two distances from the camera (a ring, at most the whole map) */
function ring(from: number, to: number, area: number): number {
  return (Math.min(area, Math.PI * to * to) - Math.min(area, Math.PI * from * from)) / area;
}

/** The points one object of this catalogue entry costs on a map of `area` m², at the High quality level */
export function objectCost(entry: CostEntry | undefined, area: number): number {
  entry ??= UNKNOWN;
  let cost = INSTANCE_COST;
  for (const e of entry.effects ?? []) cost += (e.rate ?? 1) * PARTICLE_COST;
  if (!entry.file) return cost;
  const levels = [{ from: 0, triangles: entry.triangles ?? UNKNOWN_TRIANGLES }];
  for (const lod of entry.lod ?? []) levels.push({ from: lod.distance, triangles: lod.triangles ?? entry.triangles ?? UNKNOWN_TRIANGLES });
  // As object-layer.ts levelsFor: trees and big rocks turn into impostors far out
  if (entry.category === 'tree' || (entry.category === 'rock' && entry.height >= 1.5)) {
    const last = entry.lod?.length ? entry.lod[entry.lod.length - 1].distance * 1.5 : 0;
    levels.push({ from: Math.max(last, entry.height * 25, IMPOSTOR_FROM), triangles: IMPOSTOR_TRIANGLES });
  }
  levels.sort((a, b) => a.from - b.from);
  for (let l = 0; l < levels.length; l++) {
    const to = Math.min(l + 1 < levels.length ? levels[l + 1].from : Infinity, entry.drawDistance);
    cost += levels[l].triangles * ring(levels[l].from, to, area);
  }
  return cost;
}

/** What a list of objects costs together, from the cost of each asset */
export function sceneCost(objects: readonly { asset: string }[], costOf: (asset: string) => number): number {
  const known = new Map<string, number>();
  let sum = 0;
  for (const o of objects) {
    let c = known.get(o.asset);
    if (c === undefined) known.set(o.asset, (c = costOf(o.asset)));
    sum += c;
  }
  return sum;
}
