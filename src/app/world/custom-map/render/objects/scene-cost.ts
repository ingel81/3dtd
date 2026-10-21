import { QUALITY_TABLE } from '../../../../three-engine/render-quality';
import { objectRadius, pixelDistance, screenDistance, type CatalogObject } from '../asset-catalog';
import { BAND_SCREEN, BAND_TRIANGLES, hasBand } from './line-bands';
import type { MapMass } from '../../map-document';
import { massTriangles } from '../../object-mass';

/**
 * What a map's objects cost the picture, in points: per object about the
 * triangles it puts on screen with the camera somewhere over the map. An
 * object draws its model near the camera, its LOD models farther out, trees
 * and big rocks an impostor beyond that, walls and tracks a band of six
 * triangles (line-bands.ts), and nothing once it is smaller on screen than
 * the pixel limit (object-layer.ts, render-quality.ts `drawPixels`); the
 * pieces of a line draw as far as the line, which on any map is the whole
 * map. Each distance band's triangles count with the share of the map
 * that lies within it (a disc around the camera, at most the whole map): on
 * a Small map a house drawn to 3 km is always in view and costs its 3 800
 * triangles, a grass tuft of 10 triangles that goes at 187 m costs a
 * fraction of one on a Large map, plus what every instance costs on top. The
 * Map panel and the map check hold the sum against SCENE_BUDGET
 * (docs/LEVEL_EDITOR.md, "Szenenkosten").
 */

/**
 * The points a map may spend and stay fluid: 100 % in the Map panel, the
 * map check and the shipped maps' check. Calibrated with
 * e2e/perf/render-bench.ts on nine maps (2026-10-15, RTX 5080, High): the
 * GPU time of the costliest view grows about 0.19 ms per million points on
 * 0.8 ms of terrain, grass and light, and reaches 3 ms at 11.5 M, where the
 * automatic quality would still step up; a GPU a third as fast stays under
 * the 10 ms where it steps down (docs/LEVEL_EDITOR.md, "Szenenkosten").
 * A new benchmark recalibrates it here and nowhere else.
 */
export const SCENE_BUDGET = 12_000_000;

/** Points every object costs whatever it draws: its instance, sorting it into levels, its share of the shadow pass */
const INSTANCE_COST = 2;
/** The two crossed cards of an impostor (impostor.ts) */
const IMPOSTOR_TRIANGLES = 4;
/** A building's far box (far-boxes.ts) */
const FAR_BOX_TRIANGLES = 24;
/** Impostors start no nearer than this at the High quality level (render-quality.ts), m */
const IMPOSTOR_FROM = 380;
/** Objects draw down to this radius on screen at the High quality level, px (render-quality.ts) */
const DRAW_PIXELS = QUALITY_TABLE.high.customMaps.drawPixels;
/** Points per particle a second of an effect: sprites that live a few seconds and overdraw */
const PARTICLE_COST = 20;
/** Triangles of a model the catalogue has not counted */
const UNKNOWN_TRIANGLES = 500;
/** An asset the catalogue does not know: a mid-sized prop */
const UNKNOWN: CostEntry = { category: 'prop', height: 2, file: '?' };

/** The catalogue fields the cost reads */
export type CostEntry = Pick<CatalogObject, 'category' | 'height' | 'file' | 'triangles' | 'lod' | 'effects' | 'box'> & {
  footprint?: number;
  far?: { screen: number };
};

/** Share of a map of `area` m² between two distances from the camera (a ring, at most the whole map) */
function ring(from: number, to: number, area: number): number {
  return (Math.min(area, Math.PI * to * to) - Math.min(area, Math.PI * from * from)) / area;
}

/**
 * The points one object of this catalogue entry costs on a map of `area` m², at the High quality level;
 * `inLine`: it is a piece of a line (MapObject.line), drawn as far as its line
 */
export function objectCost(entry: CostEntry | undefined, area: number, inLine = false): number {
  entry ??= UNKNOWN;
  let cost = INSTANCE_COST;
  for (const e of entry.effects ?? []) cost += (e.rate ?? 1) * PARTICLE_COST;
  if (!entry.file) return cost;
  const levels = [{ from: 0, triangles: entry.triangles ?? UNKNOWN_TRIANGLES }];
  // Where an object of the asset's size takes each LOD model (object-layer.ts levelsFor)
  const radius = objectRadius({ footprint: entry.footprint ?? 0, height: entry.height });
  for (const lod of entry.lod ?? []) levels.push({ from: screenDistance(radius, lod.screen), triangles: lod.triangles ?? entry.triangles ?? UNKNOWN_TRIANGLES });
  // As object-layer.ts levelsFor: trees and big rocks turn into impostors far out
  if (entry.category === 'tree' || (entry.category === 'rock' && entry.height >= 1.5)) {
    const last = levels.length > 1 ? Math.max(...levels.slice(1).map((l) => l.from)) * 1.5 : 0;
    levels.push({ from: Math.max(last, entry.height * 25, IMPOSTOR_FROM), triangles: IMPOSTOR_TRIANGLES });
  }
  // As levelsFor: a building's box where it fills its screen share
  if (entry.far) levels.push({ from: screenDistance(radius, entry.far.screen), triangles: FAR_BOX_TRIANGLES });
  // As levelsFor: a wall's or track's band after its LOD model (line-bands.ts)
  if (hasBand(entry)) levels.push({ from: Math.max(screenDistance(radius, BAND_SCREEN), Math.max(...levels.map((l) => l.from)) * 1.2), triangles: BAND_TRIANGLES });
  levels.sort((a, b) => a.from - b.from);
  // Drawn while its radius on screen stays above the pixel limit; a line's piece as far as its line
  const draw = inLine ? Infinity : pixelDistance(radius, DRAW_PIXELS);
  for (let l = 0; l < levels.length; l++) {
    const to = Math.min(l + 1 < levels.length ? levels[l + 1].from : Infinity, draw);
    cost += levels[l].triangles * ring(levels[l].from, to, area);
  }
  return cost;
}

/**
 * What a list of objects costs together, from the cost of each asset alone
 * and as a piece of a line (objectCost `inLine`); a building raised from its
 * footprint (object-mass.ts) adds its own triangles, drawn as far as any
 * building (the whole map)
 */
export function sceneCost(objects: readonly { asset: string; mass?: MapMass; line?: string }[], costOf: (asset: string, inLine: boolean) => number): number {
  const known = new Map<string, number>();
  let sum = 0;
  for (const o of objects) {
    const key = o.line ? `${o.asset}|l` : o.asset;
    let c = known.get(key);
    if (c === undefined) known.set(key, (c = costOf(o.asset, !!o.line)));
    sum += c + (o.mass ? massTriangles(o.mass) : 0);
  }
  return sum;
}
