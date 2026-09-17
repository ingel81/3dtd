import { SavedSpawn } from '../models/location.types';

/**
 * Places that show off Google Photorealistic 3D Tiles and have a dense street
 * network for the routes. Listed in the location dialog under "Showcase";
 * one click loads the place, with its fixed spawn if it has one, otherwise a
 * random spawn like the Random mode.
 *
 * Coordinates: checked against OpenStreetMap (Nominatim) on 2026-09-13, each
 * on a pedestrian way, a road or a square, not on a building or water. The
 * fixed spawns come from the user's played URLs (2026-09-17); the hints name
 * where the spawn stands as Nominatim reverse geocodes it. A place without a
 * fixed spawn is not played one by one: whether a spawn and a route come out
 * is up to the street data around it.
 */
export interface ShowcaseLocation {
  id: string;
  /** City and spot, as the list shows it */
  name: string;
  /** One line on what to expect */
  hint: string;
  lat: number;
  lon: number;
  /** A spawn the player picked, loaded the same way as a URL or favorite spawn. Without one the spawn is random. */
  spawn?: SavedSpawn;
}

export const SHOWCASE_LOCATIONS: readonly ShowcaseLocation[] = [
  { id: 'nyc-times-square', name: 'New York, Times Square', hint: 'From Columbus Circle down to Times Square', lat: 40.75701, lon: -73.98597, spawn: { lat: 40.76693, lon: -73.97898 } },
  { id: 'sf-union-square', name: 'San Francisco, Union Square', hint: 'From Mission Street in SoMa across Market Street', lat: 37.78794, lon: -122.40752, spawn: { lat: 37.78902, lon: -122.39853 } },
  { id: 'paris-iena', name: 'Paris, Pont d\'Iéna', hint: 'From the Trocadéro to the Eiffel Tower bridge', lat: 48.85889, lon: 2.29320, spawn: { lat: 48.86239, lon: 2.29190 } },
  { id: 'london-bank', name: 'London, Bank', hint: 'From Eastcheap through narrow City streets', lat: 51.51339, lon: -0.08900, spawn: { lat: 51.51068, lon: -0.08398 } },
  { id: 'rome-colosseum', name: 'Rome, Colosseum', hint: 'From Via dei Cerchi up to the Colosseum', lat: 41.89024, lon: 12.49234, spawn: { lat: 41.88571, lon: 12.48684 } },
  { id: 'barcelona-catalunya', name: 'Barcelona, Plaça de Catalunya', hint: 'From the Arc de Triomf promenade to the square', lat: 41.38687, lon: 2.17008, spawn: { lat: 41.39107, lon: 2.18067 } },
  { id: 'madrid-sol', name: 'Madrid, Puerta del Sol', hint: 'From Calle de Toledo up into the old centre', lat: 40.41686, lon: -3.70388, spawn: { lat: 40.41312, lon: -3.70754 } },
  { id: 'prague-old-town', name: 'Prague, Old Town Square', hint: 'From Klárov in the Lesser Town over the Vltava', lat: 50.08743, lon: 14.42077, spawn: { lat: 50.09230, lon: 14.40944 } },
  { id: 'amsterdam-dam', name: 'Amsterdam, Dam Square', hint: 'From Muntplein north through the old centre', lat: 52.37312, lon: 4.89235, spawn: { lat: 52.36729, lon: 4.89365 } },
  // HQ and spawn from the user's URL (2026-09-15): the old HQ at 35.65950, 139.70050
  // got a random route that looped round a block
  {
    id: 'tokyo-shibuya', name: 'Tokyo, Shibuya Crossing', hint: 'From Hachiyamacho through dense side streets',
    lat: 35.65924, lon: 139.70049, spawn: { lat: 35.65208, lon: 139.69853 },
  },
  { id: 'sydney-martin-place', name: 'Sydney, Martin Place', hint: 'From Woolloomooloo up into the CBD grid', lat: -33.86773, lon: 151.20914, spawn: { lat: -33.87133, lon: 151.21665 } },
  {
    id: 'rio-copacabana', name: 'Rio de Janeiro, Copacabana', hint: 'Beachfront avenue with the grid behind it',
    lat: -22.96889, lon: -43.18085, spawn: { lat: -22.96421, lon: -43.17463 },
  },
];
