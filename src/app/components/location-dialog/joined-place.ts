import type { LocationDialogResult } from '../../models/location.types';

/** The place a coop host sends a joining guest (CoopService.hostPlace) */
export interface HostPlace {
  hq: { lat: number; lon: number };
  spawns: { lat: number; lon: number }[];
}

/**
 * The dialog's result after joining from the Coop tab (E30): the host's HQ
 * and every spawn of it. The boot reads only the coordinates
 * (LocationFacadeService.waitForLocationFromDialog); the name comes with the
 * world the host sends, so none is made up here.
 */
export function joinedPlaceResult(place: HostPlace): LocationDialogResult {
  const [first] = place.spawns;
  return {
    confirmed: true,
    hq: { lat: place.hq.lat, lon: place.hq.lon, name: '', displayName: '' },
    spawn: { id: 'spawn-1', lat: first?.lat ?? place.hq.lat, lon: first?.lon ?? place.hq.lon },
    spawns: place.spawns.map(({ lat, lon }) => ({ lat, lon })),
  };
}
