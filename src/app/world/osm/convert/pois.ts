/**
 * The points of interest of an OSM world (docs/OSM_WORLD_ROUND2_PLAN.md,
 * E239): shops, inns, cafés, practices and offices show themselves on the
 * building they are in.
 *
 * 1. Kind: poi-tags.ts reads it from the tags of a point or of a footprint
 *    (a way with `shop` or `amenity`, with or without `building`).
 * 2. Building: the footprint the point lies in (98 % of the points do, the
 *    plan's survey), else the nearest one within NEAR_M (an entrance mapped
 *    on the wall line); only footprints that stand as a catalogue model.
 *    Points in no building get nothing, unless they are one of the few
 *    things standing on their own (a fuel station, a kiosk, an advertising
 *    column, a wayside cross, a bicycle rack, a picnic table, bottle banks,
 *    a letter box, a charging point, a drinking fountain, a street clock, a
 *    fitness station).
 * 3. Front: of the building's models the one nearest the point, of its
 *    fronts (facades.ts) the nearest, the street front by FRONT_BONUS_M
 *    first. Several shops of one front share it in slots, at most one per
 *    SLOT_M of its width; past that the lower kinds (poi-tags.ts `rank`)
 *    show nothing.
 * 4. Look: a facade sign with the kind's word and pictogram (the building's
 *    own sign panel when a single shop has it), a shopfront where the wall
 *    has no shop windows of its own, an awning in the kind's colour, a
 *    wrought-iron hanging sign for an old town's inn, baker or pharmacy,
 *    and tables in front where OSM says `outdoor_seating=yes` and the
 *    pavement has room (off the roads and footprints).
 * 5. Caps: signs at most MAX_POI_SIGNS, the nearest to the HQ first; the
 *    objects within POI_BUDGET_SHARE of the scene budget, signs and fronts
 *    first, then the awnings, then the tables.
 *
 * Every object of a building's front takes the building's group: the
 * editor moves them with it.
 */
import { EdgeIndex } from '../../../map-ops/path-graph';
import { hashCell } from '../../../map-ops/landscape-noise';
import { MASS_ASSET, type CustomMapDocument, type MapObject, type MapPoint, type MapSign } from '../../custom-map/map-document';
import { SCENE_BUDGET } from '../../custom-map/render/objects/scene-cost';
import { BUILDING_MODELS } from '../building-tags';
import type { OsmArea, OsmFeatures } from '../osm-parse';
import { AWNING_COLOURS, BOARD_COLOURS, poiCategory, signLanguage, type PoiCategory, type SignLanguage } from '../poi-tags';
import { pointInRing } from './buildings';
import { facadeDistance, facadesOf, facadeTurn, massFacades, type FacadeAnchor } from './facades';

/** Share of the scene budget the POIs' objects may take */
export const POI_BUDGET_SHARE = 0.06;
/** Signs with writing a map gets at most (docs/OSM_WORLD_ROUND2_PLAN.md, "Grenzen") */
export const MAX_POI_SIGNS = 512;
/** A point this near a footprint (m) belongs to it */
export const NEAR_M = 8;
/** Width of a front each shop needs at least (m) */
export const SLOT_M = 2.8;
/** The street front wins over a side nearer than this (m) */
const FRONT_BONUS_M = 2.5;
/** A raised footprint's edge with a road within this (m) before it is a street front */
const STREET_M = 24;
/** Metres in front of the wall where tables stand */
const SEATING_OUT = 2.3;
/** Metres a table keeps beyond a road's half width */
const ROAD_CLEAR = 1.0;
/** Cell of the footprint index, m */
const CELL = 32;

/** The assets the POIs place, for the catalogue's costs */
export const POI_ASSETS: readonly string[] = [
  'sign-facade', 'sign-bracket', 'shopfront-narrow', 'shopfront-wide', 'awning', 'cafe-set', 'beer-bench-set', 'parasol',
  'fuel-pump', 'kiosk', 'advertising-column', 'wayside-cross', 'shrine', 'bike-rack', 'recycling-containers', 'post-box',
  'charging-station', 'drinking-fountain', 'street-clock', 'picnic-table', 'fitness-station',
];
/** Ground a street thing needs clear of roads and footprints (radius, m), default 1 */
const STREET_ROOM: Readonly<Record<string, number>> = { 'advertising-column': 0.8, 'post-box': 0.4, 'drinking-fountain': 0.5, 'street-clock': 0.5, 'recycling-containers': 2.6, 'fitness-station': 2.0 };

/** Height of the awning model from its valance to the top of its cassette, m at scale 1 */
const AWNING_HEIGHT = 0.94;
/** Width of the awning and the facade sign models, m at scale 1; the sign's height */
const AWNING_WIDTH = 3.2;
const BOARD_WIDTH = 2.6;
const BOARD_HEIGHT = 0.6;
/** Least height of an awning's valance over the pavement, m */
const AWNING_CLEAR = 2.1;
/** The shopfronts: height (its fascia's top) and width */
const SHOPFRONT_HEIGHT = 3.0;

export interface PoiOptions {
  /** Scene cost of one object of an asset on this map */
  costOf: (asset: string) => number;
  /** Points the POIs may cost, default POI_BUDGET_SHARE of SCENE_BUDGET */
  budget?: number;
  /** The signs' language, default the place's (poi-tags.ts signLanguage) */
  language?: SignLanguage;
  /** Signs at most, default MAX_POI_SIGNS */
  maxSigns?: number;
}

export interface PoiReport {
  /** POIs read (points and footprints with a kind the world draws) */
  pois: number;
  /** Matched to a building: inside its footprint, within NEAR_M; standing on their own; with no building */
  inside: number;
  near: number;
  alone: number;
  noBuilding: number;
  /** POIs by kind */
  kinds: Record<string, number>;
  /** Objects placed by asset, signs written (boards, hanging signs, buildings' own panels) */
  placed: Record<string, number>;
  signs: number;
  /** Left out: past the front's slots, past the sign cap, past the budget */
  dropped: { slots: number; signs: number; budget: number };
  language: SignLanguage;
  cost: number;
  budget: number;
}

interface Poi {
  id: number;
  x: number;
  y: number;
  tags: Readonly<Record<string, string>>;
  kind: PoiCategory;
  /** The footprint it is mapped as, when it is a way */
  area: OsmArea | null;
}

/** One object a POI wants, with the step of the budget it belongs to */
interface Wish {
  o: Omit<MapObject, 'id'>;
  /** 0 signs and fronts, 1 awnings, 2 tables and things on their own */
  step: 0 | 1 | 2;
  sign: boolean;
  /** Writes `o.sign` on this building's own panel instead of placing `o` */
  panelOf?: MapObject;
}

/**
 * The POIs of `features` on `doc` (after the buildings, which they hang on;
 * the roads and the HQ are in): objects added to `doc.objects`, a single
 * shop's sign written on its building's own panel
 */
export function placePois(doc: CustomMapDocument, features: OsmFeatures, options: PoiOptions): PoiReport {
  const language = options.language ?? signLanguage(features.frame, [...features.areas, ...features.points]);
  const report: PoiReport = {
    pois: 0, inside: 0, near: 0, alone: 0, noBuilding: 0, kinds: {}, placed: {}, signs: 0,
    dropped: { slots: 0, signs: 0, budget: 0 }, language, cost: 0, budget: 0,
  };
  const seed = Math.round(features.frame.lat * 1e4) ^ Math.round(features.frame.lon * 1e4);
  const half = doc.terrain.width / 2;
  const roads = new EdgeIndex({ nodes: doc.paths.nodes, edges: doc.paths.edges.filter((e) => !e.tunnel) });

  // The buildings that stand, by footprint
  const byArea = new Map<number, MapObject[]>();
  const objectsById = new Map<string, MapObject>();
  for (const o of doc.objects) {
    const m = o.group && /^osm-b(\d+)$/.exec(o.group);
    if (!m || !(BUILDING_MODELS[o.asset] || (o.asset === MASS_ASSET && o.mass))) continue;
    const id = Number(m[1]);
    byArea.set(id, [...(byArea.get(id) ?? []), o]);
    objectsById.set(o.id, o);
  }
  const areasById = new Map(features.areas.map((a) => [a.id, a]));
  const index = new FootprintIndex(features.areas.filter((a) => a.tags['building'] && byArea.has(a.id)));
  const built = new FootprintIndex(features.areas.filter((a) => a.tags['building']));

  // The POIs: points and footprints with a kind
  const pois: Poi[] = [];
  for (const p of features.points) {
    const kind = poiCategory(p.tags);
    if (kind) pois.push({ id: p.id, x: p.x, y: p.y, tags: p.tags, kind, area: null });
  }
  for (const a of features.areas) {
    const kind = poiCategory(a.tags);
    if (!kind || !a.outer.length) continue;
    const c = ringCentre(a.outer[0]);
    pois.push({ id: a.id, x: c.x, y: c.y, tags: a.tags, kind, area: a });
  }
  report.pois = pois.length;

  // Each POI to a front of its building, or on its own
  const wishes = new Map<Poi, Wish[]>();
  const onFront = new Map<string, { f: FacadeAnchor; pois: Poi[] }>();
  for (const poi of pois) {
    report.kinds[poi.kind.id] = (report.kinds[poi.kind.id] ?? 0) + 1;
    const area = poi.area?.tags['building'] && byArea.has(poi.area.id) ? poi.area : index.at(poi, NEAR_M);
    if (!area) {
      const own = standAlone(poi, doc, roads, built, half, seed);
      if (own.length) {
        report.alone++;
        wishes.set(poi, own);
      } else {
        report.noBuilding++;
      }
      continue;
    }
    if (poi.area === area || area.outer.some((r) => pointInRing(poi, r))) report.inside++;
    else report.near++;
    if (poi.kind.id === 'fuel') {
      wishes.set(poi, fuelPumps(poi, doc, roads));
      continue;
    }
    const f = nearestFront(poi, byArea.get(area.id) ?? [], roads);
    if (!f) continue;
    const key = `${f.object}:${f.side}`;
    const slot = onFront.get(key) ?? { f, pois: [] };
    slot.pois.push(poi);
    onFront.set(key, slot);
  }

  // Fronts into slots, then what each shop shows in its slot
  for (const { f, pois: here } of onFront.values()) {
    const room = Math.max(1, Math.floor(f.width / SLOT_M));
    const kept = [...here].sort((p, q) => p.kind.rank - q.kind.rank || p.id - q.id).slice(0, room);
    report.dropped.slots += here.length - kept.length;
    // Left to right along the wall as they lie
    const tx = -f.ny;
    const ty = f.nx;
    kept.sort((p, q) => (p.x - f.x) * tx + (p.y - f.y) * ty - ((q.x - f.x) * tx + (q.y - f.y) * ty));
    const slotW = f.width / kept.length;
    const building = objectsById.get(f.object)!;
    const area = areasById.get(Number(/^osm-b(\d+)$/.exec(building.group ?? '')?.[1]));
    kept.forEach((poi, k) => {
      const along = -f.width / 2 + slotW * (k + 0.5);
      const at = { x: f.x + tx * along, y: f.y + ty * along };
      wishes.set(poi, frontWishes(poi, f, at, slotW, kept.length === 1, building, oldTown(area?.tags ?? {}), language, seed, roads, built, half));
    });
  }

  // Signs by kind and nearness to the HQ under their cap; the objects under the budget in three steps
  const order = [...wishes.keys()].sort(
    (p, q) => p.kind.rank - q.kind.rank || Math.hypot(p.x - doc.hq.x, p.y - doc.hq.y) - Math.hypot(q.x - doc.hq.x, q.y - doc.hq.y),
  );
  const budget = options.budget ?? POI_BUDGET_SHARE * SCENE_BUDGET;
  let cost = 0;
  let n = 0;
  const groupOf = (poi: Poi, o: Omit<MapObject, 'id'>) => o.group ?? `osm-p${poi.id}`;
  for (const step of [0, 1, 2] as const) {
    for (const poi of order) {
      for (const w of wishes.get(poi)!) {
        if (w.step !== step) continue;
        if (w.sign && report.signs >= (options.maxSigns ?? MAX_POI_SIGNS)) {
          report.dropped.signs++;
          continue;
        }
        if (w.panelOf) {
          w.panelOf.sign = w.o.sign;
          report.signs++;
          continue;
        }
        const add = options.costOf(w.o.asset);
        if (cost + add > budget) {
          report.dropped.budget++;
          continue;
        }
        cost += add;
        doc.objects.push({ id: `osm-p${++n}`, ...w.o, group: groupOf(poi, w.o) });
        report.placed[w.o.asset] = (report.placed[w.o.asset] ?? 0) + 1;
        if (w.sign) report.signs++;
      }
    }
  }
  // Things of the street a point names, with what the budget has left
  let m = 0;
  for (const p of features.points) {
    const asset = streetAsset(p.tags);
    if (!asset || !roomFor(p, STREET_ROOM[asset] ?? 1.0, roads, built, half)) continue;
    const add = options.costOf(asset);
    if (cost + add > budget) {
      report.dropped.budget++;
      continue;
    }
    cost += add;
    const hit = roads.nearest(p, 30);
    const rotation = hit && hit.dist > 0.3 ? facing(p, hit.point) : round3(hashCell(p.id % 1e6, 9, seed) * Math.PI * 2);
    doc.objects.push({ id: `osm-s${++m}`, asset, x: round2(p.x), y: round2(p.y), z: 0, rotation, scale: 1, group: `osm-n${p.id}` });
    report.placed[asset] = (report.placed[asset] ?? 0) + 1;
  }
  report.cost = Math.round(cost);
  report.budget = Math.round(budget);
  return report;
}

/** The fronts of a building object: a catalogue model's, a raised footprint's */
function frontsOf(o: MapObject): FacadeAnchor[] {
  if (o.asset === MASS_ASSET) return o.mass ? massFacades(o, o.mass) : [];
  return facadesOf(o, BUILDING_MODELS[o.asset]);
}

/**
 * The front of `objects` (one building's) nearest to point `p`, a street
 * front first: a model's front (its street side), a raised footprint's edge
 * that has a road within STREET_M before it
 */
function nearestFront(p: MapPoint, objects: readonly MapObject[], roads: EdgeIndex): FacadeAnchor | null {
  let best: FacadeAnchor | null = null;
  let bestD = Infinity;
  for (const o of objects) {
    const mass = o.asset === MASS_ASSET;
    for (const f of frontsOf(o)) {
      const street = mass ? !!roads.nearest({ x: f.x + f.nx * STREET_M * 0.5, y: f.y + f.ny * STREET_M * 0.5 }, STREET_M * 0.5) : f.side === 0;
      const d = facadeDistance(f, p) - (street ? FRONT_BONUS_M : 0);
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
  }
  return best;
}

/** An old town's building: listed, old, or with a pitched roof of few storeys (as OSM says; no guess where it says nothing) */
function oldTown(tags: Readonly<Record<string, string>>): boolean {
  if (tags['heritage'] || tags['historic'] || tags['building:architecture']) return true;
  const year = Number.parseInt(tags['start_date'] ?? '', 10);
  if (Number.isFinite(year) && year < 1900) return true;
  const levels = Number.parseInt(tags['building:levels'] ?? '', 10);
  return /^(gabled|hipped|half-hipped|gambrel|mansard|saltbox)$/.test(tags['roof:shape'] ?? '') && !(levels > 5);
}

/** What one shop shows on its slot of front `f`: centre `at`, width `slotW` */
function frontWishes(
  poi: Poi,
  f: FacadeAnchor,
  at: MapPoint,
  slotW: number,
  alone: boolean,
  building: MapObject,
  old: boolean,
  language: SignLanguage,
  seed: number,
  roads: EdgeIndex,
  built: FootprintIndex,
  half: number,
): Wish[] {
  const out: Wish[] = [];
  const kind = poi.kind;
  const rotation = round3(facadeTurn(f));
  const group = building.group;
  const sign: MapSign = { text: kind.words[language], icon: kind.icon };
  const pick = (list: readonly string[], salt: number) => list[Math.floor(hashCell(poi.id % 1e6, salt, seed) * list.length) % list.length];
  const put = (asset: string, x: number, y: number, z: number, extra: Partial<MapObject> = {}): Omit<MapObject, 'id'> => ({
    asset, x: round2(x), y: round2(y), z: round2(z), rotation, scale: 1, group, ...extra,
  });
  const tx = -f.ny;
  const ty = f.nx;

  // The building's own panel takes a single shop's sign
  if (f.panel && alone) {
    out.push({ o: { asset: building.asset, x: 0, y: 0, z: 0, rotation: 0, scale: 1, sign }, step: 0, sign: true, panelOf: building });
  } else {
    // A shopfront where the wall has no shop windows of its own, as high as the ground floor lets it
    const fs = Math.min(1, (f.ground - 0.15) / SHOPFRONT_HEIGHT);
    const front = kind.front && !f.shopFloor && slotW >= 3.0 * fs && fs >= 0.8;
    if (front) out.push({ o: put(slotW >= 6.3 * fs ? 'shopfront-wide' : 'shopfront-narrow', at.x, at.y, 0, { scale: round3(fs) }), step: 0, sign: false });
    // The board where the front has room for it, out by its fascia
    const scale = round3(Math.min(f.boardH / BOARD_HEIGHT, (slotW * 0.8) / BOARD_WIDTH));
    const bx = at.x + f.nx * f.proud;
    const by = at.y + f.ny * f.proud;
    if (scale >= 0.45) {
      out.push({ o: put('sign-facade', bx, by, f.boardZ, { scale, tint: kind.board ?? pick(BOARD_COLOURS, 11), sign }), step: 0, sign: true });
    }
    // An awning under the board, its valance clear over the pavement
    if (kind.awning && slotW >= 2.8) {
      const fit = Math.min(1.25, (slotW - 0.4) / AWNING_WIDTH);
      const s = Math.min(fit, (f.boardZ - 0.05 - AWNING_CLEAR) / AWNING_HEIGHT);
      if (s >= 0.75) {
        const tint = kind.awning === 'any' ? pick(AWNING_COLOURS, 13) : kind.awning;
        out.push({ o: put('awning', bx, by, round2(f.boardZ - 0.05 - AWNING_HEIGHT * s), { scale: round3(s), tint }), step: 1, sign: false });
      }
    }
  }
  // An old town's hanging sign at the slot's edge, the pictogram on both faces
  if (kind.bracket && old) {
    const edge = slotW / 2 - 0.35;
    out.push({
      o: put('sign-bracket', at.x + tx * edge + f.nx * f.proud, at.y + ty * edge + f.ny * f.proud, round2(Math.max(2.2, f.boardZ - 1.15)), {
        tint: '#2a2421',
        sign: { icon: kind.icon },
      }),
      step: 0,
      sign: true,
    });
  }
  // Tables in front where OSM says so and the pavement has room
  if (kind.seating && poi.tags['outdoor_seating'] === 'yes') {
    const sets = slotW >= 5 ? 2 : 1;
    const asset = kind.seating === 'beer' ? 'beer-bench-set' : 'cafe-set';
    for (let k = 0; k < sets; k++) {
      const along = sets === 1 ? 0 : (k - 0.5) * Math.min(2.6, slotW / 2);
      const p = { x: at.x + f.nx * SEATING_OUT + tx * along, y: at.y + f.ny * SEATING_OUT + ty * along };
      if (!roomFor(p, 1.2, roads, built, half)) continue;
      out.push({ o: put(asset, p.x, p.y, 0, { rotation: round3(facadeTurn(f) + (k % 2 ? 0.12 : -0.08)) }), step: 2, sign: false });
    }
    if (kind.seating === 'cafe' && sets === 2) {
      const p = { x: at.x + f.nx * SEATING_OUT, y: at.y + f.ny * SEATING_OUT };
      if (roomFor(p, 1.6, roads, built, half)) {
        const tint = kind.awning && kind.awning !== 'any' ? kind.awning : pick(AWNING_COLOURS, 13);
        out.push({ o: put('parasol', p.x, p.y, 0, { tint }), step: 2, sign: false });
      }
    }
  }
  return out;
}

/** Whether a thing of radius `r` stands at `p` clear of the roads, the footprints and the map's edge */
function roomFor(p: MapPoint, r: number, roads: EdgeIndex, built: FootprintIndex, half: number): boolean {
  if (Math.abs(p.x) > half - r || Math.abs(p.y) > half - r) return false;
  const hit = roads.nearest(p, 20);
  if (hit && hit.dist < hit.edge.width / 2 + ROAD_CLEAR + r * 0.5) return false;
  return !built.at(p, r * 0.5);
}

/** The turn that faces a thing at `p` towards `toward` (its front, model +z) */
function facing(p: MapPoint, toward: MapPoint): number {
  const r = Math.atan2(-(toward.x - p.x), toward.y - p.y);
  return round3(r < 0 ? r + Math.PI * 2 : r);
}

/** The pumps of a fuel station: under its canopy (a station-canopy within 30 m), else two islands beside the point */
function fuelPumps(poi: Poi, doc: CustomMapDocument, roads: EdgeIndex): Wish[] {
  const canopy = doc.objects.find((o) => o.asset === 'station-canopy' && Math.hypot(o.x - poi.x, o.y - poi.y) < 30);
  const out: Wish[] = [];
  if (canopy) {
    const cos = Math.cos(canopy.rotation);
    const sin = Math.sin(canopy.rotation);
    for (const lx of [-6, 0, 6]) {
      const x = canopy.x - lx * cos * canopy.scale;
      const y = canopy.y - lx * sin * canopy.scale;
      out.push({ o: { asset: 'fuel-pump', x: round2(x), y: round2(y), z: 0, rotation: round3(canopy.rotation), scale: 1, group: canopy.group }, step: 0, sign: false });
    }
    return out;
  }
  const hit = roads.nearest(poi, 40);
  const rotation = hit && hit.dist > 0.5 ? facing(poi, hit.point) : 0;
  const ax = Math.cos(rotation);
  const ay = Math.sin(rotation);
  for (const d of [-2.5, 2.5]) out.push({ o: { asset: 'fuel-pump', x: round2(poi.x + ax * d), y: round2(poi.y + ay * d), z: 0, rotation, scale: 1 }, step: 0, sign: false });
  return out;
}

/** Things that stand on their own at their point: a kiosk, an advertising column, a wayside cross, a bicycle rack, a picnic table */
function standAlone(poi: Poi, doc: CustomMapDocument, roads: EdgeIndex, built: FootprintIndex, half: number, seed: number): Wish[] {
  if (poi.kind.id === 'fuel') return fuelPumps(poi, doc, roads);
  if (poi.area || poi.kind.id !== 'kiosk' || !roomFor(poi, 2.6, roads, built, half)) return [];
  const hit = roads.nearest(poi, 40);
  const rotation = hit ? facing(poi, hit.point) : round3(hashCell(poi.id % 1e6, 5, seed) * Math.PI * 2);
  return [{ o: { asset: 'kiosk', x: round2(poi.x), y: round2(poi.y), z: 0, rotation, scale: 1 }, step: 2, sign: false }];
}

/** The model of a street thing's point, null for none */
export function streetAsset(tags: Readonly<Record<string, string>>): string | null {
  if (tags['advertising'] === 'column') return 'advertising-column';
  if (tags['historic'] === 'wayside_cross') return 'wayside-cross';
  if (tags['historic'] === 'wayside_shrine') return 'shrine';
  if (tags['amenity'] === 'bicycle_parking') return 'bike-rack';
  if (tags['amenity'] === 'recycling' && tags['recycling_type'] !== 'centre') return 'recycling-containers';
  if (tags['amenity'] === 'post_box') return 'post-box';
  if (tags['amenity'] === 'charging_station') return 'charging-station';
  if (tags['amenity'] === 'drinking_water') return 'drinking-fountain';
  // A clock on a wall or a tower stands in its building; one on its own pole is the street's
  if (tags['amenity'] === 'clock' && !/wall|building|tower/.test(tags['support'] ?? '')) return 'street-clock';
  if (tags['leisure'] === 'picnic_table') return 'picnic-table';
  if (tags['leisure'] === 'fitness_station') return 'fitness-station';
  return null;
}

/** The middle of a ring (the mean of its corners) */
function ringCentre(ring: readonly MapPoint[]): MapPoint {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p.x;
    y += p.y;
  }
  return { x: x / ring.length, y: y / ring.length };
}

/** Footprints by CELL m cells of their bounds: the one a point lies in or nearest within a reach */
class FootprintIndex {
  private readonly cells = new Map<number, OsmArea[]>();

  constructor(areas: readonly OsmArea[]) {
    for (const a of areas) {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const r of a.outer) {
        for (const p of r) {
          x0 = Math.min(x0, p.x);
          y0 = Math.min(y0, p.y);
          x1 = Math.max(x1, p.x);
          y1 = Math.max(y1, p.y);
        }
      }
      for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) {
        for (let j = Math.floor(y0 / CELL); j <= Math.floor(y1 / CELL); j++) {
          const k = key(i, j);
          const list = this.cells.get(k);
          if (list) list.push(a);
          else this.cells.set(k, [a]);
        }
      }
    }
  }

  /** The footprint `p` lies in, else the nearest within `reach` m; null for none */
  at(p: MapPoint, reach = 0): OsmArea | null {
    const ci = Math.floor(p.x / CELL);
    const cj = Math.floor(p.y / CELL);
    for (const a of this.cells.get(key(ci, cj)) ?? []) if (a.outer.some((r) => pointInRing(p, r))) return a;
    if (reach <= 0) return null;
    let best: OsmArea | null = null;
    let bestD = reach;
    const span = Math.ceil(reach / CELL);
    const seen = new Set<OsmArea>();
    for (let i = ci - span; i <= ci + span; i++) {
      for (let j = cj - span; j <= cj + span; j++) {
        for (const a of this.cells.get(key(i, j)) ?? []) {
          if (seen.has(a)) continue;
          seen.add(a);
          for (const r of a.outer) {
            const d = ringDistance(p, r);
            if (d < bestD) {
              bestD = d;
              best = a;
            }
          }
        }
      }
    }
    return best;
  }
}

const key = (i: number, j: number): number => (i + 4096) * 8192 + (j + 4096);

/** Distance from `p` to a ring's edges */
function ringDistance(p: MapPoint, ring: readonly MapPoint[]): number {
  let best = Infinity;
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k];
    const b = ring[(k + 1) % ring.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)));
  }
  return best;
}

const round2 = (v: number): number => Math.round(v * 100) / 100;
const round3 = (v: number): number => Math.round(v * 1000) / 1000;
