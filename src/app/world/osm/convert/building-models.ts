/**
 * Catalogue models for a footprint's rectangles (buildings.ts, step 3 and
 * 4): the model of a kind whose wall box fits best, a row of copies along a
 * long side, the door side towards the street, shrunk or dropped where it
 * would stand on a road.
 */
import { BUILDING_MODELS, type BuildingKind, type BuildingModel, KIND_MODELS } from '../building-tags';
import { ACROSS_PENALTY, BLOCK_FIT_ERROR, CORNER_REACH, DOOR_ON_STREET, FRONT_REACH, LONE_MODULE, MAX_COPIES, MAX_FIT_ERROR, MODEL_COVER, RETAINING_ASSET, RETAINING_BOX, SCALE_MAX, SCALE_MIN, SIDE_DOOR, UNTAGGED_FLOORS, VARIETY } from './building-config';
import type { TurnedRect } from '../../custom-map/map-surfaces';
import { SegmentIndex } from './building-indexes';
import type { BuildingCatalogEntry, BuildingReport, Placement } from './building-types';
import type { MapObject, MapPoint } from '../../custom-map/map-document';
import { origin, rightOf } from './building-placement';
import type { CatalogDoor } from '../../custom-map/render/asset-catalog';
import type { ObjectFooting } from '../../custom-map/render/objects/object-seat';

interface Fit {
  model: BuildingModel;
  copies: number;
  rows: number;
  scale: number;
  error: number;
  /** A model with its door on a side (doorSide), laid with that side to the street: its depth along the front */
  turned: boolean;
}

/** The best fit of `kind`'s models to a front `wide` m and `deep` m; null when none is good enough */
export function fitModels(
  kind: BuildingKind,
  wide: number,
  deep: number,
  levels: number | null,
  known: (asset: string) => boolean,
  salt = 0,
  maxError = MAX_FIT_ERROR,
  doorSide: (asset: string) => DoorSide = () => 'front',
): Fit | null {
  let best: Fit | null = null;
  const models = KIND_MODELS[kind].models.filter((m) => known(m) && BUILDING_MODELS[m]);
  models.forEach((asset, rank) => {
    const model = BUILDING_MODELS[asset];
    // High-rises only where the tags say so: a village's winery is no office tower
    if (levels === null && model.floors > UNTAGGED_FLOORS) return;
    // A model with its door on a side: as it stands (the door off the street) and turned to show it to the street
    const side = sideways(doorSide(asset));
    // A module in a kind that does not stand in rows (a terraced house among houses): alone, a narrow house
    const lone = model.module && !KIND_MODELS[kind].rows;
    // Its best fit, the door on the street preferred (SIDE_DOOR) among its own; against the other models by its error
    let own: { fit: Fit; rank: number } | null = null;
    for (const turned of side ? [false, true] : [false]) {
      const [w, d] = turned ? [model.box[1], model.box[0]] : model.box;
      for (let rows = 1; rows <= (lone ? 1 : 2); rows++) {
        const most = lone ? 1 : Math.min(MAX_COPIES, Math.max(1, Math.ceil(wide / (w * SCALE_MIN))));
        for (let copies = 1; copies <= most; copies++) {
          const scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.min(wide / (copies * w), deep / (rows * d))));
          const cu = (copies * w * scale) / wide;
          const cv = (rows * d * scale) / deep;
          // Turned, only where it covers enough to stand as a model (MODEL_COVER): else the model as it stands
          if (turned && Math.min(cu, 1) * Math.min(cv, 1) < MODEL_COVER) continue;
          // A model bigger than the footprint costs twice: it stands in the street or the neighbour
          let error = Math.abs(Math.log(cu)) * (cu > 1 ? 2 : 1) + Math.abs(Math.log(cv)) * (cv > 1 ? 2 : 1);
          const extra = copies * rows - 1;
          // Copies: cheap for modules of a kind that stands in rows, dearer for a house cut in two
          error += extra * (model.module ? (KIND_MODELS[kind].rows ? 0.01 : 0.06) : 0.12) + (rows > 1 ? 0.12 : 0);
          if (levels !== null) error += Math.min(0.6, Math.abs(levels - model.floors) * 0.08);
          if (lone) error += LONE_MODULE;
          // A little order (the first model of the kind) and variety (the footprint's salt) among fits about as good
          error += rank * 0.01 + (((salt * 31 + rank * 17) % 7) / 7) * VARIETY;
          // Its door on a side off the street
          const mine = error + (side && !turned ? SIDE_DOOR : 0);
          if (!own || mine < own.rank) own = { fit: { model, copies, rows, scale, error, turned }, rank: mine };
        }
      }
    }
    if (own && (!best || own.fit.error < best.error)) best = own.fit;
  });
  return best && (best as Fit).error <= maxError ? best : null;
}

/** Size class of a footprint for the missing list: its sides rounded to 5 m (2 m under 10 m) */
export function sizeClass(a: number, b: number): string {
  const r = (v: number) => (v < 10 ? Math.max(2, Math.round(v / 2) * 2) : Math.round(v / 5) * 5);
  return `${r(Math.max(a, b))}x${r(Math.min(a, b))}`;
}

/** The models of one rectangle of a footprint, facing the nearest street; null when nothing fits */
export function layPart(
  rect: TurnedRect,
  kind: BuildingKind,
  levels: number | null,
  roads: SegmentIndex,
  known: (asset: string) => boolean,
  salt: number,
  report: BuildingReport,
  entrance: MapPoint | null = null,
  doorSide: (asset: string) => DoorSide = () => 'front',
): { placements: Placement[]; kind: BuildingKind } | null {
  const v = { x: -rect.u.y, y: rect.u.x };
  // The four sides: outward normal, the axis along it, its length and the depth behind it
  const sides = [
    { n: v, along: rect.u, len: rect.a, depth: rect.b },
    { n: { x: -v.x, y: -v.y }, along: rect.u, len: rect.a, depth: rect.b },
    { n: rect.u, along: v, len: rect.b, depth: rect.a },
    { n: { x: -rect.u.x, y: -rect.u.y }, along: v, len: rect.b, depth: rect.a },
  ];
  const dists = sides.map((s) => roads.distance({ x: rect.c.x + (s.n.x * s.depth) / 2, y: rect.c.y + (s.n.y * s.depth) / 2 }, FRONT_REACH));
  let front = 0;
  for (let k = 1; k < 4; k++) if (dists[k] < dists[front]) front = k;
  if (!Number.isFinite(dists[front])) front = rect.a >= rect.b ? 0 : 2;
  // A mapped entrance: the side it is on (the most out along a side's normal, by the depth behind it)
  if (entrance) {
    const out = (k: number) => ((entrance.x - rect.c.x) * sides[k].n.x + (entrance.y - rect.c.y) * sides[k].n.y) / sides[k].depth;
    front = 0;
    for (let k = 1; k < 4; k++) if (out(k) > out(front)) front = k;
  }
  // The other way round: the nearer of the two sides across the front
  const across = front < 2 ? (dists[2] <= dists[3] ? 2 : 3) : dists[0] <= dists[1] ? 0 : 1;

  // The kind's models with the front on the street, else on a side across it; else the next kind's
  let chosen: { fit: Fit; side: number; kind: BuildingKind } | null = null;
  for (let k: BuildingKind | undefined = kind, step = 0; k && step < 3 && !chosen; k = KIND_MODELS[k].fallback, step++) {
    const onFront = fitModels(k, sides[front].len, sides[front].depth, levels, known, salt, MAX_FIT_ERROR, doorSide);
    const onSide = fitModels(k, sides[across].len, sides[across].depth, levels, known, salt, MAX_FIT_ERROR, doorSide);
    // Turning the front away from the street costs; a house keeps its door on the street (its footpath, plots.ts), any
    // building on its mapped entrance
    if (onFront && (((DOOR_ON_STREET.has(k) || entrance) && onFront.error <= MAX_FIT_ERROR) || !onSide || onFront.error <= onSide.error + ACROSS_PENALTY)) chosen = { fit: onFront, side: front, kind: k };
    else if (onSide && onSide.error + ACROSS_PENALTY <= MAX_FIT_ERROR) chosen = { fit: onSide, side: across, kind: k };
    else if (onFront) chosen = { fit: onFront, side: front, kind: k };
  }
  if (!chosen && !KIND_MODELS[kind].own) {
    // The block with a facade: a row of city-block modules (two back to back), as well as they cover
    const block = (levels ?? 4) >= 5 ? 'block-row-6' : 'block-row-4';
    const s = sides[front];
    const fit = fitModels('apartments', s.len, s.depth, levels, (a) => a === block && known(a), salt, BLOCK_FIT_ERROR);
    if (fit) chosen = { fit, side: front, kind: 'apartments' };
  }
  if (!chosen) return null;
  const { fit, side } = chosen;
  const s = sides[side];
  if (fit.copies * fit.rows > 1) report.rows++;
  // The model's door side turned to the street (doorSide): a model with its door on a side stands across
  const door = doorSide(fit.model.asset);
  const turned = fit.turned;
  const mw = fit.model.box[turned ? 1 : 0] * fit.scale;
  const md = fit.model.box[turned ? 0 : 1] * fit.scale;
  const total = fit.copies * mw;
  // Ends of a row of city-block modules where a side street runs: corner houses there
  const corner = fit.model.floors >= 6 ? 'block-corner-6' : 'block-corner-4';
  const cornerAt = (end: number): boolean => {
    if (!fit.model.module || fit.model.floors < 4 || !known(corner)) return false;
    const k = [0, 1, 2, 3].find((q) => q >> 1 !== side >> 1 && (sides[q].n.x * s.along.x + sides[q].n.y * s.along.y) * end > 0.5);
    return k !== undefined && dists[k] <= CORNER_REACH;
  };
  const out: Placement[] = [];
  for (let row = 0; row < fit.rows; row++) {
    const face = row === 0 ? s.n : { x: -s.n.x, y: -s.n.y };
    // Rows against the front and the back: the street front lines up with the footprint's
    const depthOff = (row === 0 ? 1 : -1) * (s.depth / 2 - md / 2);
    for (let k = 0; k < fit.copies; k++) {
      const along = -total / 2 + (k + 0.5) * mw;
      const p = { x: rect.c.x + s.along.x * along + s.n.x * depthOff, y: rect.c.y + s.along.y * along + s.n.y * depthOff };
      // A lone module takes the corner on the side its street is
      const end = fit.copies === 1 ? (cornerAt(-1) ? -1 : 1) : k === 0 ? -1 : k === fit.copies - 1 ? 1 : 0;
      let model = fit.model;
      let front = turned || door === 'back' ? frontFor(door, face) : face;
      if (row === 0 && end !== 0 && cornerAt(end)) {
        model = BUILDING_MODELS[corner];
        // Its second street side is its west (model -x, the front turned right): turned to face the row's end
        const toEnd = { x: s.along.x * end, y: s.along.y * end };
        const west = rightOf(face);
        if (west.x * toEnd.x + west.y * toEnd.y < 0) front = toEnd;
      }
      const scale = model === fit.model ? fit.scale : Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.min(mw / model.box[0], md / model.box[1])));
      out.push({ asset: model.asset, p, front, hw: (model.box[0] * scale) / 2, hd: (model.box[1] * scale) / 2, scale, rotation: Math.atan2(-front.x, front.y), model, ...(front !== face && model === fit.model ? { doorFace: face } : {}) });
    }
  }
  return { placements: out, kind: chosen.kind };
}

/** The side of a model its door is in, as the catalogue measured its doors (CatalogDoor) */
export type DoorSide = CatalogDoor[2];

/** Whether a door's side runs along the model's depth (its east or west) */
function sideways(side: DoorSide): boolean {
  return side === 'east' || side === 'west';
}

/**
 * The model's front (local +z) that turns its door side to `face`: its
 * east (+x, the front turned left) to it, its west, its back, or the front
 * itself
 */
function frontFor(side: DoorSide, face: MapPoint): MapPoint {
  if (side === 'east') return rightOf(face);
  if (side === 'west') return { x: -face.y, y: face.x };
  if (side === 'back') return { x: -face.x, y: -face.y };
  return face;
}

/**
 * The ground of a building model as the editor's check and the renderer take
 * it: the catalogue's footprint and ground rectangle, or without a catalogue
 * the model's measured walls (BUILDING_MODELS)
 */
export function buildingFooting(asset: string, entry: BuildingCatalogEntry | undefined): ObjectFooting {
  if (entry) return { category: 'building', footprint: entry.footprint, height: entry.height ?? 6, box: entry.box };
  const model = BUILDING_MODELS[asset];
  const [w, d] = model ? model.box : asset === RETAINING_ASSET ? RETAINING_BOX : [4, 4];
  const [ax, az] = model?.at ?? [0, 0];
  return { category: 'building', footprint: Math.hypot(Math.abs(ax) + w / 2, Math.abs(az) + d / 2), height: 6, box: [ax, az, w / 2, d / 2] };
}

/** Shrinking steps for a model over a road, and the smallest scale it may reach */
const SHRINK_STEPS = [0.9, 0.8, 0.7];
const SHRINK_FLOOR = SCALE_MIN;

/**
 * Whether a placement stays off the roads: 'clear', or 'shrunk' when it had
 * to shrink about the back of its box (the front pulls back from the street,
 * down to SHRINK_FLOOR), false when it stays on one
 */
export function clearOfRoads(pl: Placement, onRoad: (o: Pick<MapObject, 'asset' | 'x' | 'y' | 'rotation' | 'scale'>) => boolean): 'clear' | 'shrunk' | false {
  const touches = (q: Placement) => onRoad({ asset: q.asset, ...origin(q), rotation: q.rotation, scale: q.scale });
  if (!touches(pl)) return 'clear';
  for (const k of SHRINK_STEPS) {
    if (pl.scale * k < SHRINK_FLOOR) break;
    const back = pl.hd * (1 - k);
    const f = pl.front;
    const trial: Placement = { ...pl, p: { x: pl.p.x - f.x * back, y: pl.p.y - f.y * back }, hw: pl.hw * k, hd: pl.hd * k, scale: pl.scale * k };
    if (!touches(trial)) {
      Object.assign(pl, trial);
      return 'shrunk';
    }
  }
  return false;
}
