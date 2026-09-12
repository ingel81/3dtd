/**
 * Places that show off Google Photorealistic 3D Tiles and have a dense street
 * network for the routes. Listed in the location dialog under "Showcase";
 * one click loads the place with a random spawn.
 *
 * Coordinates: checked against OpenStreetMap (Nominatim) on 2026-09-13, each
 * on a pedestrian way, a road or a square, not on a building or water. Not
 * played in the game one by one: whether a spawn and a route come out is up to
 * the street data around each point.
 */
export interface ShowcaseLocation {
  id: string;
  /** City and spot, as the list shows it */
  name: string;
  /** One line on what to expect */
  hint: string;
  lat: number;
  lon: number;
}

export const SHOWCASE_LOCATIONS: readonly ShowcaseLocation[] = [
  { id: 'nyc-times-square', name: 'New York, Times Square', hint: 'Midtown grid, towers on every block', lat: 40.75701, lon: -73.98597 },
  { id: 'sf-union-square', name: 'San Francisco, Union Square', hint: 'Downtown grid below Nob Hill', lat: 37.78794, lon: -122.40752 },
  { id: 'paris-opera', name: 'Paris, Place de l\'Opéra', hint: 'Boulevards meeting at the Palais Garnier', lat: 48.87072, lon: 2.33254 },
  { id: 'london-bank', name: 'London, Bank', hint: 'Narrow City streets around the Bank of England', lat: 51.51339, lon: -0.08900 },
  { id: 'rome-piazza-venezia', name: 'Rome, Piazza Venezia', hint: 'Old centre, the Vittoriano on the south side', lat: 41.89608, lon: 12.48213 },
  { id: 'barcelona-catalunya', name: 'Barcelona, Plaça de Catalunya', hint: 'Eixample grid north, Old Town south', lat: 41.38687, lon: 2.17008 },
  { id: 'madrid-sol', name: 'Madrid, Puerta del Sol', hint: 'Old centre, streets fanning out from the square', lat: 40.41686, lon: -3.70388 },
  { id: 'prague-old-town', name: 'Prague, Old Town Square', hint: 'Medieval lanes around the Old Town Hall', lat: 50.08743, lon: 14.42077 },
  { id: 'amsterdam-dam', name: 'Amsterdam, Dam Square', hint: 'Old centre, the canal ring starts to the west', lat: 52.37312, lon: 4.89235 },
  { id: 'tokyo-shibuya', name: 'Tokyo, Shibuya Crossing', hint: 'Scramble crossing, dense side streets', lat: 35.65950, lon: 139.70050 },
  { id: 'sydney-martin-place', name: 'Sydney, Martin Place', hint: 'Pedestrian mall in the CBD grid', lat: -33.86773, lon: 151.20914 },
  { id: 'dubai-marina', name: 'Dubai, Marina Walk', hint: 'High-rise towers along the marina', lat: 25.07172, lon: 55.13259 },
  { id: 'rio-copacabana', name: 'Rio de Janeiro, Copacabana', hint: 'Beachfront avenue with the grid behind it', lat: -22.96889, lon: -43.18085 },
];
