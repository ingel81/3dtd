/**
 * The label above a spawn portal: the name of the street it stands on.
 *
 * Every way a spawn comes about (random, set by hand, from the URL, a
 * favorite, the location dialog) ends here, so the same place reads the same
 * after a reload as after a location change.
 */

import { UNNAMED_STREET, type Street, type StreetNetwork } from '../interfaces/street-network-provider.interface';
import { nearestStreetSegment } from './street-grid';

/** How far a named street may be when the portal stands on an unnamed one: about a block. */
export const SPAWN_LABEL_RADIUS_M = 150;

/** Label when no named street is near enough. */
export const SPAWN_LABEL_FALLBACK = 'Spawn';

function hasName(street: Street): boolean {
  const name = street.name.trim();
  return name.length > 0 && name !== UNNAMED_STREET;
}

/**
 * The name of the nearest named street within {@link SPAWN_LABEL_RADIUS_M},
 * else {@link SPAWN_LABEL_FALLBACK}.
 */
export function spawnLabel(network: StreetNetwork, lat: number, lon: number): string {
  const nearest = nearestStreetSegment(network, lat, lon, (_node, street) => hasName(street));
  if (!nearest || nearest.distance > SPAWN_LABEL_RADIUS_M) return SPAWN_LABEL_FALLBACK;
  return nearest.street.name.trim();
}
