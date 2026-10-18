/**
 * The places of an OSM world that matter for its level (docs/OSM_WORLD_ROUND2_PLAN.md, E240): where enemies arrive
 * (stations, stops, car parks, a harbour: the spawns prefer them and take their names) and the landmarks (churches,
 * the town hall, a castle or gate, sights): the intro flies over the best one, the frame offers to put the HQ there,
 * and the nearest church rings at each wave. Read from the features alone; no rule of the game changes.
 */
import type { MapPoint } from '../../custom-map/map-document';
import type { OsmArea, OsmFeatures } from '../osm-parse';

/** A place enemies may arrive from, in map metres */
export interface SpawnAnchor {
  x: number;
  y: number;
  /** The spawn's name: "Miltenberg station", "Engelplatz stop", "Car park" */
  name: string;
  /** 0 first: stations, then harbours and large car parks, then stops */
  tier: number;
}

/** What kind of landmark, as the frame names it */
export type LandmarkKind = 'cathedral' | 'church' | 'place of worship' | 'town hall' | 'castle' | 'city gate' | 'tower' | 'monument' | 'museum' | 'sight';

export interface Landmark {
  x: number;
  y: number;
  /** OSM `name`, else empty */
  name: string;
  kind: LandmarkKind;
  /** A Christian church or chapel: it has bells */
  bells: boolean;
  /** Its weight before the distance (kind, renown, size) */
  score: number;
}

/** Surface car parks from this size (m²) are anchors: a lot of a supermarket, a park and ride */
const CAR_PARK_MIN_AREA = 1500;
/** Landmarks closer than this (m) are one: the altar node inside its church, a church and its tower */
const LANDMARK_MERGE_M = 40;
/** Weight of each kind */
const KIND_SCORE: Readonly<Record<LandmarkKind, number>> = {
  cathedral: 6,
  castle: 5,
  church: 4,
  'town hall': 4,
  'city gate': 4,
  tower: 3,
  monument: 2,
  museum: 2,
  sight: 2,
  'place of worship': 1,
};
/** A church or temple with a footprint at least this big (m²) counts as a church, smaller ones as a chapel */
const CHURCH_MIN_AREA = 250;

/** The anchors of a place: stations, harbours, large car parks and stops within the map */
export function spawnAnchors(features: OsmFeatures): SpawnAnchor[] {
  const out: SpawnAnchor[] = [];
  const add = (p: MapPoint, name: string, tier: number) => {
    if (Math.abs(p.x) <= features.half && Math.abs(p.y) <= features.half) out.push({ x: p.x, y: p.y, name, tier });
  };
  for (const pt of features.points) {
    const t = pt.tags;
    const name = shortName(t['name']);
    if (t['railway'] === 'station' || t['railway'] === 'halt' || t['public_transport'] === 'station') {
      add(pt, name ? `${name} station` : 'Station', 0);
    } else if (t['seamark:type'] === 'harbour') {
      add(pt, name ? `${name} harbour` : 'Harbour', 1);
    } else if (t['highway'] === 'bus_stop' || t['railway'] === 'tram_stop') {
      add(pt, name ? `${name} stop` : 'Stop', 2);
    }
  }
  for (const a of features.areas) {
    const t = a.tags;
    const name = shortName(t['name']);
    if (t['amenity'] === 'parking' && (t['parking'] ?? 'surface') === 'surface' && a.area >= CAR_PARK_MIN_AREA) {
      add(areaMiddle(a), name ? `${name} car park` : 'Car park', 1);
    } else if (t['leisure'] === 'marina' || t['landuse'] === 'harbour') {
      add(areaMiddle(a), name ? `${name} harbour` : 'Harbour', 1);
    } else if (t['railway'] === 'station' || t['public_transport'] === 'station') {
      add(areaMiddle(a), name ? `${name} station` : 'Station', 0);
    }
  }
  return out;
}

/**
 * The landmarks of a place within `reachM` of `from`, the best first: kind,
 * renown (`wikidata`, `heritage`) and size, less with the distance
 */
export function findLandmarks(features: OsmFeatures, from: MapPoint, reachM: number): Landmark[] {
  const found: (Landmark & { rank: number })[] = [];
  const consider = (p: MapPoint, tags: Record<string, string>, area: number) => {
    const kind = landmarkKind(tags, area);
    if (!kind) return;
    if (Math.abs(p.x) > features.half || Math.abs(p.y) > features.half) return;
    const d = Math.hypot(p.x - from.x, p.y - from.y);
    if (d > reachM) return;
    const score = KIND_SCORE[kind] + (tags['wikidata'] ? 2 : 0) + (tags['heritage'] ? 1 : 0) + Math.min(2, area / 1000);
    found.push({ x: round1(p.x), y: round1(p.y), name: tags['name'] ?? '', kind, bells: hasBells(tags, kind), score: round1(score), rank: score / (1 + d / 600) });
  };
  for (const pt of features.points) consider(pt, pt.tags, 0);
  for (const a of features.areas) consider(areaMiddle(a), a.tags, a.area);
  found.sort((a, b) => b.rank - a.rank);
  const kept: (Landmark & { rank: number })[] = [];
  for (const l of found) {
    if (kept.some((k) => Math.hypot(k.x - l.x, k.y - l.y) < LANDMARK_MERGE_M)) continue;
    kept.push(l);
  }
  return kept.map(({ rank: _rank, ...l }) => l);
}

/** The landmark kind of an element's tags, null for none */
export function landmarkKind(tags: Readonly<Record<string, string>>, area: number): LandmarkKind | null {
  const historic = tags['historic'] ?? '';
  if (historic === 'castle' || tags['building'] === 'castle') return 'castle';
  if (historic === 'city_gate') return 'city gate';
  if (tags['building'] === 'cathedral') return 'cathedral';
  if (tags['amenity'] === 'place_of_worship' || /^(church|chapel)$/.test(tags['building'] ?? '')) {
    // The altar or a chapel inside a house is mapped as a point: only the church itself counts
    if (!area && !tags['wikidata']) return null;
    if (area && area < CHURCH_MIN_AREA && tags['building'] !== 'church') return 'place of worship';
    return tags['religion'] && tags['religion'] !== 'christian' ? 'place of worship' : 'church';
  }
  if (tags['amenity'] === 'townhall' && (area > 0 || tags['wikidata'])) return 'town hall';
  if (historic === 'tower' || (tags['man_made'] === 'tower' && tags['historic'])) return 'tower';
  if (/^(monument|memorial)$/.test(historic) && (tags['wikidata'] || area > 0) && tags['memorial'] !== 'plaque') return 'monument';
  if (tags['tourism'] === 'museum' && area > 0) return 'museum';
  if (tags['tourism'] === 'attraction' && tags['wikidata']) return 'sight';
  return null;
}

function hasBells(tags: Readonly<Record<string, string>>, kind: LandmarkKind): boolean {
  return (kind === 'church' || kind === 'cathedral') && (!tags['religion'] || tags['religion'] === 'christian');
}

/** The middle of an area: the area-weighted centre of its largest outer ring */
export function areaMiddle(a: OsmArea): MapPoint {
  let best: MapPoint[] = a.outer[0] ?? [];
  let bestArea = -1;
  for (const ring of a.outer) {
    const s = Math.abs(signedArea(ring));
    if (s > bestArea) {
      best = ring;
      bestArea = s;
    }
  }
  const s = signedArea(best);
  if (Math.abs(s) < 1e-6) {
    const n = Math.max(1, best.length);
    return { x: best.reduce((v, p) => v + p.x, 0) / n, y: best.reduce((v, p) => v + p.y, 0) / n };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = best.length - 1; i < best.length; j = i++) {
    const f = best[j].x * best[i].y - best[i].x * best[j].y;
    cx += (best[j].x + best[i].x) * f;
    cy += (best[j].y + best[i].y) * f;
  }
  return { x: cx / (6 * s), y: cy / (6 * s) };
}

function signedArea(ring: readonly MapPoint[]): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += ring[j].x * ring[i].y - ring[i].x * ring[j].y;
  return s / 2;
}

/** A stop's name without the town before it ("Miltenberg, Engelplatz" to "Engelplatz"), trimmed to 32 characters */
function shortName(name: string | undefined): string {
  if (!name) return '';
  const parts = name.split(',').map((s) => s.trim()).filter(Boolean);
  const last = parts.length > 1 ? parts[parts.length - 1] : (parts[0] ?? '');
  return last.length > 32 ? `${last.slice(0, 31).trimEnd()}.` : last;
}

const round1 = (v: number): number => Math.round(v * 10) / 10;
