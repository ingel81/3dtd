import type { SavedSpawn } from '../../models/location.types';
import type { NominatimAddress } from './geocoding.service';

/** A spawn picked by address; null in a choice draws a random street spawn 500 to 1000 m from the HQ */
export interface SpawnPick {
  lat: number;
  lon: number;
  name?: string;
  portalBearing?: number;
}

/**
 * What the place picker of the menu's New game page hands on
 * (LocationChangeCoordinatorService.choosePlace):
 * - `place`: a searched, recent, showcase or world-map place, or the place
 *   loaded with a new spawn; `spawn` null draws a random one
 * - `stored`: a place with every spawn it was kept with: a favourite, a
 *   pasted link, the place of a coop host or of a save
 * - `dice`: a random city from the world dice
 */
export type PlaceChoice =
  | { kind: 'place'; hq: { lat: number; lon: number; name: string; address?: NominatimAddress }; spawn: SpawnPick | null }
  | { kind: 'stored'; hq: { lat: number; lon: number }; spawns: SavedSpawn[] }
  | { kind: 'dice' };

/** A choice with a place in it, everything but the dice */
export type PlacedChoice = Exclude<PlaceChoice, { kind: 'dice' }>;

/** A place with every spawn it was kept with; without one the game draws a random spawn */
export function storedPlace(hq: { lat: number; lon: number }, spawns: readonly SavedSpawn[]): Extract<PlaceChoice, { kind: 'stored' }> {
  return {
    kind: 'stored',
    hq: { lat: hq.lat, lon: hq.lon },
    spawns: spawns.map(({ lat, lon, portalBearing }) => (portalBearing === undefined ? { lat, lon } : { lat, lon, portalBearing })),
  };
}

/**
 * The spawns a start without a place loads a choice with
 * (LocationManagementService.setLocation): none draws a random one at boot
 */
export function startSpawns(choice: PlacedChoice): SavedSpawn[] {
  if (choice.kind === 'stored') return choice.spawns;
  const spawn = choice.spawn;
  if (!spawn) return [];
  return [spawn.portalBearing === undefined ? { lat: spawn.lat, lon: spawn.lon } : { lat: spawn.lat, lon: spawn.lon, portalBearing: spawn.portalBearing }];
}

function isValidLatLon(lat: number, lon: number): boolean {
  return !isNaN(lat) && !isNaN(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

function dmsToDecimal(degrees: number, minutes: number, seconds: number): number {
  return degrees + minutes / 60 + seconds / 3600;
}

/**
 * Coordinates pasted in one of the usual ways: "49.5432, 9.1234",
 * "49.5432°N, 9.1234°E", "N 49.5432, E 9.1234", degrees, minutes and
 * seconds, or a Google Maps URL with "@lat,lon". Null for anything else.
 */
export function parseCoordinates(text: string): { lat: number; lon: number } | null {
  const normalized = text.trim().replace(/\s+/g, ' ');

  const decimal = normalized.match(/^(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)$/);
  if (decimal) {
    const lat = parseFloat(decimal[1]);
    const lon = parseFloat(decimal[2]);
    if (isValidLatLon(lat, lon)) return { lat, lon };
  }

  const cardinal = normalized.match(/^(-?\d+\.?\d*)\s*°?\s*([NSns])[,\s]+(-?\d+\.?\d*)\s*°?\s*([EWew])$/);
  if (cardinal) {
    let lat = parseFloat(cardinal[1]);
    let lon = parseFloat(cardinal[3]);
    if (cardinal[2].toUpperCase() === 'S') lat = -lat;
    if (cardinal[4].toUpperCase() === 'W') lon = -lon;
    if (isValidLatLon(lat, lon)) return { lat, lon };
  }

  const prefixed = normalized.match(/^([NSns])\s*(-?\d+\.?\d*)[,\s]+([EWew])\s*(-?\d+\.?\d*)$/);
  if (prefixed) {
    let lat = parseFloat(prefixed[2]);
    let lon = parseFloat(prefixed[4]);
    if (prefixed[1].toUpperCase() === 'S') lat = -lat;
    if (prefixed[3].toUpperCase() === 'W') lon = -lon;
    if (isValidLatLon(lat, lon)) return { lat, lon };
  }

  const dms = normalized.match(
    /^(\d+)\s*°\s*(\d+)\s*['′]\s*(\d+\.?\d*)\s*["″]?\s*([NSns])[,\s]+(\d+)\s*°\s*(\d+)\s*['′]\s*(\d+\.?\d*)\s*["″]?\s*([EWew])$/,
  );
  if (dms) {
    let lat = dmsToDecimal(parseFloat(dms[1]), parseFloat(dms[2]), parseFloat(dms[3]));
    let lon = dmsToDecimal(parseFloat(dms[5]), parseFloat(dms[6]), parseFloat(dms[7]));
    if (dms[4].toUpperCase() === 'S') lat = -lat;
    if (dms[8].toUpperCase() === 'W') lon = -lon;
    if (isValidLatLon(lat, lon)) return { lat, lon };
  }

  const googleMaps = text.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (googleMaps) {
    const lat = parseFloat(googleMaps[1]);
    const lon = parseFloat(googleMaps[2]);
    if (isValidLatLon(lat, lon)) return { lat, lon };
  }

  return null;
}
