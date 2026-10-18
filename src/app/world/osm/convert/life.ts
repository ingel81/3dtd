/**
 * Life of an OSM world from its data (docs/OSM_WORLD_ROUND2_PLAN.md, E240), with the life areas and the intro of
 * any custom map (map-life.ts, map-intro.ts), so the editor shows and changes them like hand-made ones: boats on the
 * river (barges where ships go: seamarks, locks), gulls over it, boats in a marina, crows round the church nearest
 * the HQ whose bell rings at each wave (else a ship's horn on a waterway with ships), the look's own ambient sound,
 * and an intro flight from the best landmark to the HQ. Drawn and heard only; the game's rules never read it.
 */
import { heightAt } from '../../../map-ops/grid';
import { resample, simplify } from '../../../map-ops/lines';
import { polylineLength } from '../../../map-ops/path-graph';
import type { CustomMapDocument, MapIntro, MapIntroView, MapLife, MapLifeArea, MapPoint } from '../../custom-map/map-document';
import { LIFE_AREA_DENSITY, MAX_LIFE_POINTS } from '../../custom-map/map-life';
import type { OsmFeatures } from '../osm-parse';
import type { WaterResult } from './water';
import { sampleGrid } from './raster';
import type { Landmark } from './anchors';

export interface LifeReport {
  /** Life areas laid */
  areas: number;
  /** The boats' asset on the river, null without one */
  boats: string | null;
  /** The wave's sound and where it comes from */
  waveSound: string | null;
  /** The landmark the intro flies over (its name, else its kind), null for the game's default tour */
  intro: string | null;
}

/** The look's own ambient sound, a little under the hand-made maps' usual level */
const AMBIENCE_VOLUME = 0.5;
/** A river line shorter than this (m) on the water carries no boats */
const MIN_BOAT_ROUTE_M = 250;
/**
 * Metres of river per unit of the boats' density (a route carries three
 * boats at density 1, map-life): a fleet that fills the river as it is
 * long, between half and the most an area takes
 */
const RIVER_M_PER_DENSITY = 800;
/** Seamarks on the map from which its river counts as a waterway with ships */
const SHIPPING_SEAMARKS = 3;
/** The church whose bell rings stands at most this far (m) from the HQ */
const BELL_REACH_M = 900;
/** The intro flies over a landmark at most this far (m) from the HQ */
const INTRO_REACH_M = 1200;
const INTRO_SECONDS = 16;
/** Marinas with boats at most */
const MAX_MARINAS = 3;

/**
 * Sets `doc.life` (and `doc.intro` with a landmark near the HQ) from the
 * place's data; `landmarks` the best first (anchors.ts findLandmarks)
 */
export function growLife(doc: CustomMapDocument, features: OsmFeatures, water: WaterResult, landmarks: readonly Landmark[]): LifeReport {
  const areas: MapLifeArea[] = [];
  const life: MapLife = { ambience: { sound: 'biome', volume: AMBIENCE_VOLUME }, areas };
  const report: LifeReport = { areas: 0, boats: null, waveSound: null, intro: null };
  const id = (kind: string) => `osm-${kind}-${areas.length + 1}`;

  // The river: its line where it runs on the map's water
  const shipping = isShipping(features);
  const river = riverRoute(doc, features, water);
  let riverId: string | null = null;
  if (river) {
    riverId = id('boats');
    report.boats = shipping ? 'fishing-boat' : 'rowboat';
    const density = Math.min(LIFE_AREA_DENSITY.max, Math.max(0.5, polylineLength(river) / RIVER_M_PER_DENSITY)) * (shipping ? 1 : 0.6);
    areas.push({ id: riverId, kind: 'boats', shape: 'route', points: river, asset: report.boats, density: Math.round(density * 10) / 10 });
    areas.push({ id: id('gulls'), kind: 'birds', shape: 'route', points: river, species: 'gulls', height: 30, density: 0.7 });
  }
  const marinas = features.areas
    .filter((a) => a.tags['leisure'] === 'marina' && a.outer.length)
    .sort((a, b) => b.area - a.area)
    .slice(0, MAX_MARINAS);
  for (const m of marinas) {
    const ring = fitPoints(m.outer[0], 2);
    if (ring.length >= 3) areas.push({ id: id('marina'), kind: 'boats', shape: 'area', points: ring, asset: 'rowboat', density: 0.5 });
  }

  // The church nearest the HQ with bells: crows round its tower, its bell at each wave
  const hq = doc.hq;
  const church = landmarks
    .filter((l) => l.bells && Math.hypot(l.x - hq.x, l.y - hq.y) <= BELL_REACH_M)
    .sort((a, b) => Math.hypot(a.x - hq.x, a.y - hq.y) - Math.hypot(b.x - hq.x, b.y - hq.y))[0];
  if (church) {
    const crows = id('crows');
    areas.push({ id: crows, kind: 'birds', shape: 'area', points: circle(church, 35, 10), species: 'crows', height: 35, density: 0.6 });
    life.waveSound = { sound: 'bell', volume: 0.8, area: crows };
    report.waveSound = `bell at ${church.name || church.kind}`;
  } else if (river && shipping) {
    life.waveSound = { sound: 'ship-horn', volume: 0.7, area: riverId! };
    report.waveSound = 'ship horn on the river';
  }
  doc.life = life;
  report.areas = areas.length;

  const landmark = landmarks.find((l) => Math.hypot(l.x - hq.x, l.y - hq.y) <= INTRO_REACH_M);
  if (landmark) {
    doc.intro = landmarkIntro(doc, landmark);
    report.intro = landmark.name || landmark.kind;
  }
  return report;
}

/**
 * The intro flight: in from beyond the landmark, round it, over to the HQ
 * and down to it. Heights over the higher ground of camera and target
 */
export function landmarkIntro(doc: CustomMapDocument, landmark: MapPoint): MapIntro {
  const t = doc.terrain;
  const hq = doc.hq;
  const lim = Math.min(t.width, t.depth) / 2 - 10;
  const clamp = (v: number) => Math.max(-lim, Math.min(lim, v));
  let dx = landmark.x - hq.x;
  let dy = landmark.y - hq.y;
  const len = Math.hypot(dx, dy);
  if (len < 60) [dx, dy] = [1, 0];
  else [dx, dy] = [dx / len, dy / len];
  const sx = -dy;
  const sy = dx;
  const ground = (x: number, y: number) => heightAt(t, clamp(x), clamp(y));
  const gL = ground(landmark.x, landmark.y);
  const gH = ground(hq.x, hq.y);
  const view = (x: number, y: number, over: number, look: MapPoint, lookH: number): MapIntroView => {
    const cx = clamp(x);
    const cy = clamp(y);
    return { x: r1(cx), y: r1(cy), h: r1(Math.max(ground(cx, cy), lookH) + over), lookX: r1(look.x), lookY: r1(look.y), lookH: r1(lookH) };
  };
  const mid = { x: (landmark.x + hq.x) / 2, y: (landmark.y + hq.y) / 2 };
  return {
    kind: 'path',
    seconds: INTRO_SECONDS,
    views: [
      view(landmark.x + dx * 170 + sx * 60, landmark.y + dy * 170 + sy * 60, 70, landmark, gL + 12),
      view(landmark.x - sx * 110 + dx * 40, landmark.y - sy * 110 + dy * 40, 45, landmark, gL + 10),
      view(mid.x - sx * 80, mid.y - sy * 80, 90, hq, gH),
      view(hq.x - dx * 140 + sx * 40, hq.y - dy * 140 + sy * 40, 75, hq, gH),
    ],
  };
}

/** A waterway with ships: seamarks, lock gates, or a river tagged for ships */
function isShipping(features: OsmFeatures): boolean {
  let seamarks = 0;
  for (const p of features.points) {
    if (p.tags['waterway'] === 'lock_gate') return true;
    if (p.tags['seamark:type']) seamarks++;
  }
  for (const w of features.ways) {
    const t = w.tags;
    if (t['seamark:type']) seamarks++;
    if ((t['waterway'] === 'river' || t['waterway'] === 'canal') && (t['CEMT'] || t['ship'] === 'yes' || t['motorboat'] === 'yes')) return true;
  }
  return seamarks >= SHIPPING_SEAMARKS;
}

/** The longest stretch of a river or canal line that runs on the map's water, null for none long enough */
function riverRoute(doc: CustomMapDocument, features: OsmFeatures, water: WaterResult): MapPoint[] | null {
  const t = doc.terrain;
  const grid = sampleGrid(t.width, t.grid.cellSize);
  const wet = (p: MapPoint) => {
    const i = Math.round((p.x - grid.origin) / grid.step);
    const j = Math.round((p.y - grid.origin) / grid.step);
    return i >= 0 && j >= 0 && i < grid.n && j < grid.n && water.wet[j * grid.n + i] === 1;
  };
  let best: MapPoint[] = [];
  let bestLength = 0;
  for (const points of riverChains(features)) {
    if (points.length < 2) continue;
    let run: MapPoint[] = [];
    const close = () => {
      const length = run.length * 10;
      if (length > bestLength) {
        best = run;
        bestLength = length;
      }
      run = [];
    };
    for (const p of resample(points, 10)) {
      if (wet(p)) run.push(p);
      else close();
    }
    close();
  }
  return bestLength >= MIN_BOAT_ROUTE_M ? fitPoints(best, 3) : null;
}

/**
 * The river and canal lines joined where one way ends at the next's start
 * (OSM cuts a river at every bridge), each as its points without the gaps
 */
function riverChains(features: OsmFeatures): MapPoint[][] {
  const ways = features.ways.filter((w) => (w.tags['waterway'] === 'river' || w.tags['waterway'] === 'canal') && w.nodes.length >= 2);
  const byStart = new Map<number, (typeof ways)[number]>();
  const hasBefore = new Set<number>();
  for (const w of ways) byStart.set(w.nodes[0], w);
  for (const w of ways) if (byStart.has(w.nodes[w.nodes.length - 1])) hasBefore.add(byStart.get(w.nodes[w.nodes.length - 1])!.id);
  const used = new Set<number>();
  const chains: MapPoint[][] = [];
  const follow = (first: (typeof ways)[number]) => {
    const chain: MapPoint[] = [];
    for (let w: (typeof ways)[number] | undefined = first; w && !used.has(w.id); w = byStart.get(w.nodes[w.nodes.length - 1])) {
      used.add(w.id);
      for (const p of w.points) if (p) chain.push(p);
    }
    chains.push(chain);
  };
  // From the ways nothing flows into, then what is left (rings)
  for (const w of ways) if (!hasBefore.has(w.id)) follow(w);
  for (const w of ways) if (!used.has(w.id)) follow(w);
  return chains;
}

/** A line thinned to the life areas' most points, rounded to 10 cm */
function fitPoints(line: readonly MapPoint[], tolerance: number): MapPoint[] {
  let out = simplify(line, tolerance);
  for (let tol = tolerance * 2; out.length > MAX_LIFE_POINTS; tol *= 2) out = simplify(line, tol);
  return out.map((p) => ({ x: r1(p.x), y: r1(p.y) }));
}

function circle(c: MapPoint, radius: number, points: number): MapPoint[] {
  return Array.from({ length: points }, (_, k) => {
    const a = (k / points) * Math.PI * 2;
    return { x: r1(c.x + Math.cos(a) * radius), y: r1(c.y + Math.sin(a) * radius) };
  });
}

const r1 = (v: number): number => Math.round(v * 10) / 10;
