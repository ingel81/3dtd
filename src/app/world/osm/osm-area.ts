/**
 * The square an OSM world is made of (E209): its centre and side, as the
 * player moves and sizes the frame's square on the flat map. The HQ stays on
 * the place the player searched for; the square may move off it as long as
 * the place keeps room to the edge, and its side goes from OSM_MIN_SIDE to
 * OSM_WORLD_SIDE (the size the format, the scene budget and the renderer are
 * measured for, docs/OSM_WORLD_PLAN.md). The data of a place is loaded for a
 * square at least as big as the default one, so sizing it down and moving it
 * a little fetch nothing (areaWithin).
 */
import { OSM_WORLD_SIDE } from './import-osm';
import { OsmFrame } from './osm-parse';

/** A square on the earth: its centre and its side in metres */
export interface OsmArea {
  lat: number;
  lon: number;
  sideM: number;
}

/** The smallest square: spawns 500 m out still fit beside an HQ in the middle */
export const OSM_MIN_SIDE = 1200;
/** The side goes in steps of this many metres (a multiple of the 2 m cell) */
export const OSM_SIDE_STEP = 100;
/** The HQ's place keeps at least this far from the square's edge, as the map's margin round the play (Größe der Karte) */
export const OSM_HQ_EDGE_M = 200;

/**
 * `area` as it may be: the side within its limits and steps, the centre
 * moved as little as needed for `place` to keep OSM_HQ_EDGE_M to the edge
 */
export function fitArea(area: OsmArea, place: { lat: number; lon: number }, maxSide = OSM_WORLD_SIDE): OsmArea {
  const top = Math.max(OSM_MIN_SIDE, maxSide);
  const sideM = Math.min(top, Math.max(OSM_MIN_SIDE, Math.round(area.sideM / OSM_SIDE_STEP) * OSM_SIDE_STEP));
  const frame = new OsmFrame(place.lat, place.lon);
  const reach = sideM / 2 - OSM_HQ_EDGE_M;
  const at = frame.point(area);
  const centre = frame.geo({ x: Math.max(-reach, Math.min(reach, at.x)), y: Math.max(-reach, Math.min(reach, at.y)) });
  return { lat: centre.lat, lon: centre.lon, sideM };
}

/** `inner` lies within `outer` (a crop of its data), to half a metre */
export function areaWithin(inner: OsmArea, outer: OsmArea): boolean {
  const at = new OsmFrame(outer.lat, outer.lon).point(inner);
  const room = (outer.sideM - inner.sideM) / 2 + 0.5;
  return Math.abs(at.x) <= room && Math.abs(at.y) <= room;
}

/** Two squares are the same, to half a metre */
export function sameArea(a: OsmArea, b: OsmArea): boolean {
  return a.sideM === b.sideM && areaWithin(a, b);
}
