import type { Messages } from '../../i18n/messages/en';
import { haversineDistance } from '../../utils/geo-utils';
import type { GeocodingResult } from './geocoding.service';
import { placeLabel } from './place-label';

/** The kinds of place a search line names (Nominatim's addresstype); others go without a kind */
export const PLACE_KINDS = [
  'city', 'town', 'village', 'hamlet', 'municipality', 'suburb', 'quarter', 'neighbourhood', 'city_district', 'borough',
  'county', 'state', 'region', 'country', 'road', 'building', 'house',
] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

/**
 * How far apart two hits of the same name in the same county may lie and still be one place, m: a municipality's
 * area (its centre) and its town's point, a town and its part of that name
 */
const SAME_PLACE_M = 5000;

/** A hit's kind, when it is one the dictionary names */
export function placeKind(result: GeocodingResult): PlaceKind | null {
  const kind = result.addressType ?? result.type;
  return (PLACE_KINDS as readonly string[]).includes(kind) ? (kind as PlaceKind) : null;
}

/** Where a hit lies, as far as its address says: county, state, country */
function regionOf(result: GeocodingResult): string {
  const a = result.address;
  return [a?.county, a?.state, a?.country].map((p) => p ?? '').join('|');
}

/** Two hits for one place: the same OSM object, or the same name in the same county close together (area and point) */
function samePlace(a: GeocodingResult, b: GeocodingResult): boolean {
  if (a.osm && b.osm && a.osm.type === b.osm.type && a.osm.id === b.osm.id) return true;
  return (
    placeLabel(a.displayName, a.address).toLowerCase() === placeLabel(b.displayName, b.address).toLowerCase() &&
    regionOf(a) === regionOf(b) &&
    haversineDistance(a.lat, a.lon, b.lat, b.lon) < SAME_PLACE_M
  );
}

/**
 * The hits with doubles of one place folded into the first (Nominatim lists
 * the more important first): the same OSM object twice, or a municipality's
 * boundary and its town's point, a town and its part of that name. Where
 * the first is of a kind no line names (a cadastral area) and the double
 * is (a suburb), the double stands in its place.
 */
export function mergeSamePlaces(results: readonly GeocodingResult[]): GeocodingResult[] {
  const kept: GeocodingResult[] = [];
  for (const result of results) {
    const at = kept.findIndex((k) => samePlace(k, result));
    if (at < 0) kept.push(result);
    else if (!placeKind(kept[at]) && placeKind(result)) kept[at] = result;
  }
  return kept;
}

/** "Municipality | Bavaria, Germany": the kind in the player's language, where it lies as Nominatim named it */
function contextLine(t: Messages, result: GeocodingResult, withCounty: boolean): string {
  const a = result.address ?? {};
  const name = placeLabel(result.displayName, result.address);
  const kind = placeKind(result);
  const where = [withCounty || !a.state ? a.county : undefined, a.state, a.country]
    // The place itself is no part of where it lies (a state, a country found as such)
    .filter((part): part is string => !!part && part !== name);
  const words = [kind ? t.addressSearch.kinds[kind] : '', [...new Set(where)].join(', ')].filter((w) => w !== '');
  return words.join(' | ');
}

/**
 * The second line of each hit, which tells hits of one name apart: kind,
 * state, country; the county too where two hits would read alike without it
 */
export function contextLines(t: Messages, results: readonly GeocodingResult[]): string[] {
  const lines = results.map((r) => contextLine(t, r, false));
  const keys = results.map((r, i) => `${placeLabel(r.displayName, r.address)}\n${lines[i]}`);
  return lines.map((line, i) => (keys.indexOf(keys[i]) !== keys.lastIndexOf(keys[i]) ? contextLine(t, results[i], true) : line));
}
