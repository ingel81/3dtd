/**
 * The descents into a station's subway (roads.ts underpasses): where a path
 * tunnel under the track field meets a way that is no underpass, the way
 * leads up to the ground, and its stairs or ramp go down at its mouth. The
 * way OSM draws there (the steps, mostly) becomes part of the tunnel, out of
 * the picture and out of the levelling; in its place a model of stairs
 * (`subway-stairs`) or a ramp (`subway-ramp`) runs from the way's end on the
 * ground down to SUBWAY_DEPTH, the head wall with the subway's opening at its
 * foot (`subway-entrance`), steel railings on the walls' copings either side
 * and across the head wall.
 *
 * The ground keeps its height: the height field cannot carry a pit 3 m wide
 * on its 2 m samples, so the stairs and the ramp leave the terrain out over
 * them (catalogue `groundCut`, terrain-cuts.ts) and their walls stand in the
 * ground. It is levelled round each descent to the height at its top
 * (placeDescents), so the copings lie on it.
 *
 * Left out: a way shorter than MIN_WAY (a lift's link, `level=-1;1`, a stub),
 * a way indoors that is no steps (into the station's hall), one ending in a
 * building (the building stands there; a roof over the platforms, a carport
 * stand on posts and do not count), and a ramp's way longer than
 * RAMP_WAY_MAX (the model would hide only its end).
 */
import { heightAt, sampleX, sampleY } from '../../../map-ops/grid';
import type { MapObject, MapPoint, MapTerrain } from '../../custom-map/map-document';
import type { OsmFeatures, OsmWay } from '../osm-parse';
import type { Road } from './underground';
import { SolidIndex } from './square-outlines';
import { round2, round3 } from './geom';

export const STAIRS_ASSET = 'subway-stairs';
export const RAMP_ASSET = 'subway-ramp';
export const ENTRANCE_ASSET = 'subway-entrance';
export const RAILING_ASSET = 'railing-steel';
/** Metres the descents go down (build_modern.py SUBWAY_DEPTH) */
export const SUBWAY_DEPTH = 3;
/** Length of the models along their way, metres: two flights with a landing and a metre at the foot; the ramp */
export const STAIRS_LENGTH = 7.9;
export const RAMP_LENGTH = 20;
/** The head wall's thickness in front of the entrance's origin, metres */
const ENTRANCE_WALL = 0.4;
/** Half the entrance's width, metres (its head wall is wider than the stairs) */
const ENTRANCE_HALF = 2.5;
/** Across the axis, metres: the walls' middle, where the railings stand */
const WALL_AT = 1.625;
/** Height of the walls' coping over the ground at the top, metres: the railings stand on it */
const COPING_TOP = 0.18;
/** Length of one railing at scale 1, metres */
const RAILING_LENGTH = 3;
/** Ways shorter than this lead to no descent, metres (a lift's link, a stub) */
export const MIN_WAY = 2;
/** A way that is no steps gets the ramp from this length on, metres; shorter ones the stairs */
export const RAMP_FROM = 16;
/** Longest way a ramp stands for, metres */
export const RAMP_WAY_MAX = 26;
/** Buildings that stand on posts: a descent may lie under them (the platforms' roofs) */
const OPEN_BUILDINGS = new Set(['roof', 'carport']);
/** Metres the ground fades over from the descent's level round it into the ground as it was */
const LEVEL_FADE = 2;

/** A descent: its top on the ground, its direction down along the way, its model */
export interface SubwayDescent {
  top: MapPoint;
  /** Unit direction from the top towards the subway */
  dir: MapPoint;
  kind: 'stairs' | 'ramp';
}

export interface DescentReport {
  stairs: number;
  ramps: number;
  /** Mouths left without one (see the file's comment) */
  skipped: number;
}

/**
 * The descents at the mouths of the underpasses `under`, the ways of `roads`
 * that lead up from them; marks those ways as tunnels (in place)
 */
export function findDescents(roads: Road[], under: ReadonlySet<OsmWay>, features: OsmFeatures): { descents: SubwayDescent[]; report: DescentReport } {
  const report: DescentReport = { stairs: 0, ramps: 0, skipped: 0 };
  const descents: SubwayDescent[] = [];
  if (!under.size) return { descents, report };
  const ends = new Map<number, Road[]>();
  for (const r of roads) {
    if (under.has(r.way) || r.tags.kind !== 'path') continue;
    for (const id of [r.way.nodes[0], r.way.nodes[r.way.nodes.length - 1]]) ends.set(id, [...(ends.get(id) ?? []), r]);
  }
  // The mouths: the ends of an underpass way where a way that is none begins
  const mouths = new Set<number>();
  for (const w of under) {
    for (const id of [w.nodes[0], w.nodes[w.nodes.length - 1]]) if (ends.has(id)) mouths.add(id);
  }
  if (!mouths.size) return { descents, report };
  const solids = new SolidIndex({ ...features, areas: features.areas.filter((a) => !OPEN_BUILDINGS.has(a.tags['building'] ?? '')) });
  const taken = new Set<Road>();
  for (const id of mouths) {
    const ways = ends.get(id)!.filter((r) => !taken.has(r));
    // The steps first: where a ramp runs beside them both meet the mouth
    ways.sort((a, b) => Number(isSteps(b)) - Number(isSteps(a)));
    const found = ways.map((r) => descentOf(r, id, solids)).find((d) => d !== null);
    if (!found) {
      report.skipped++;
      continue;
    }
    taken.add(found.road);
    found.road.tags = { ...found.road.tags, tunnel: true };
    descents.push(found.descent);
    if (found.descent.kind === 'stairs') report.stairs++;
    else report.ramps++;
  }
  return { descents, report };
}

function isSteps(r: Road): boolean {
  return r.way.tags['highway'] === 'steps';
}

/** The descent along `road` from its other end down to the mouth `at`, null where it leads to none */
function descentOf(road: Road, at: number, solids: SolidIndex): { road: Road; descent: SubwayDescent } | null {
  const pts = road.way.points.filter((p): p is MapPoint => p !== null);
  if (pts.length < 2 || pts.length !== road.way.points.length) return null;
  const line = road.way.nodes[0] === at ? [...pts].reverse() : pts;
  const top = line[0];
  const mouth = line[line.length - 1];
  let length = 0;
  for (let k = 1; k < line.length; k++) length += Math.hypot(line[k].x - line[k - 1].x, line[k].y - line[k - 1].y);
  const span = Math.hypot(mouth.x - top.x, mouth.y - top.y);
  if (length < MIN_WAY || span < MIN_WAY) return null;
  const steps = isSteps(road);
  if (!steps && road.way.tags['indoor'] === 'yes') return null;
  const kind = steps || length < RAMP_FROM ? 'stairs' : 'ramp';
  if (kind === 'ramp' && length > RAMP_WAY_MAX) return null;
  const dir = { x: (mouth.x - top.x) / span, y: (mouth.y - top.y) / span };
  const reach = (kind === 'stairs' ? STAIRS_LENGTH : RAMP_LENGTH) / 2;
  if (solids.inside(top) || solids.inside({ x: top.x + dir.x * reach, y: top.y + dir.y * reach })) return null;
  return { road, descent: { top, dir, kind } };
}

/**
 * The descents' models, the ground levelled round each to the height at its
 * top (after the roads, the rails and the portals are levelled)
 */
export function placeDescents(terrain: MapTerrain, descents: readonly SubwayDescent[]): MapObject[] {
  const out: MapObject[] = [];
  const h = terrain.grid.heights;
  descents.forEach((d, n) => {
    const length = d.kind === 'stairs' ? STAIRS_LENGTH : RAMP_LENGTH;
    const foot = length + ENTRANCE_WALL;
    const level = heightAt(terrain, d.top.x, d.top.y);
    const side = { x: -d.dir.y, y: d.dir.x };
    // The plateau: the stairs, the head wall and the entrance's ceiling under the ground behind it
    const far = foot + 4;
    const at = (along: number, across = 0): MapPoint => ({ x: d.top.x + d.dir.x * along + side.x * across, y: d.top.y + d.dir.y * along + side.y * across });
    forSamples(terrain, [at(-LEVEL_FADE - 1), at(far + LEVEL_FADE)], ENTRANCE_HALF + LEVEL_FADE + 1, (k, q) => {
      const ox = q.x - d.top.x;
      const oy = q.y - d.top.y;
      const along = ox * d.dir.x + oy * d.dir.y;
      const across = Math.abs(ox * side.x + oy * side.y);
      const beyond = Math.max(-1 - along, along - far, across - ENTRANCE_HALF - 0.5, 0);
      if (beyond >= LEVEL_FADE) return;
      const w = 1 - smooth(beyond / LEVEL_FADE);
      h[k] += (level - h[k]) * w;
    });
    // Model -z runs down the descent: map (sin r, -cos r) is `dir`
    const rotation = round3(Math.atan2(d.dir.x, -d.dir.y));
    const id = `subway-${n + 1}`;
    out.push({ id, asset: d.kind === 'stairs' ? STAIRS_ASSET : RAMP_ASSET, x: round2(d.top.x), y: round2(d.top.y), z: 0, rotation, scale: 1 });
    const e = at(foot);
    out.push({ id: `${id}-entrance`, asset: ENTRANCE_ASSET, x: round2(e.x), y: round2(e.y), z: -SUBWAY_DEPTH, rotation, scale: 1 });
    // Railings on both copings, as many as cover the length, scaled to it; one across the head wall
    const count = Math.ceil(length / RAILING_LENGTH);
    const scale = round3(length / (count * RAILING_LENGTH));
    const lengthwise = round3(Math.atan2(d.dir.y, d.dir.x));
    for (const s of [-1, 1]) {
      for (let k = 0; k < count; k++) {
        const p = at(((k + 0.5) * length) / count, s * WALL_AT);
        out.push({ id: `${id}-rail-${s < 0 ? 'l' : 'r'}${k + 1}`, asset: RAILING_ASSET, x: round2(p.x), y: round2(p.y), z: COPING_TOP, rotation: lengthwise, scale });
      }
    }
    const c = at(length + ENTRANCE_WALL / 2);
    out.push({ id: `${id}-rail-foot`, asset: RAILING_ASSET, x: round2(c.x), y: round2(c.y), z: COPING_TOP, rotation: round3(Math.atan2(side.y, side.x)), scale: round3((2 * WALL_AT) / RAILING_LENGTH) });
  });
  return out;
}

/** Smoothstep over 0..1, clamped */
const smooth = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

function forSamples(terrain: MapTerrain, points: readonly MapPoint[], pad: number, f: (k: number, q: MapPoint) => void): void {
  const g = terrain.grid;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const i0 = Math.max(0, Math.floor((Math.min(...xs) - pad + terrain.width / 2) / g.cellSize));
  const i1 = Math.min(g.columns - 1, Math.ceil((Math.max(...xs) + pad + terrain.width / 2) / g.cellSize));
  const j0 = Math.max(0, Math.floor((Math.min(...ys) - pad + terrain.depth / 2) / g.cellSize));
  const j1 = Math.min(g.rows - 1, Math.ceil((Math.max(...ys) + pad + terrain.depth / 2) / g.cellSize));
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) f(j * g.columns + i, { x: sampleX(terrain, i), y: sampleY(terrain, j) });
  }
}

