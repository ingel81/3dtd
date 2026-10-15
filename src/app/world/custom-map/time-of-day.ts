import type { MapEnvironment } from './map-document';

/** Lowest sun (degrees) timeOfDay calls day; under it the land takes dusk light and the map's lights come on */
export const DAY_SUN = 15;

/**
 * A time of day as sun and sky, a summer day: the sun rises in the east at
 * 6, stands in the south at 13 60 degrees high, sets in the west at 20;
 * low sun is dusk, an hour past sunset is night. An overcast sky stays
 * overcast.
 */
export function timeOfDay(hour: number, sky: MapEnvironment['sky']): Partial<MapEnvironment> {
  const f = (hour - 6) / 14;
  const elevation = 60 * Math.sin(Math.PI * f);
  const azimuth = ((90 + 180 * f) % 360 + 360) % 360;
  const nextSky: MapEnvironment['sky'] = sky === 'overcast' ? 'overcast' : elevation < -6 ? 'night' : elevation < DAY_SUN ? 'dusk' : 'day';
  return { sunAzimuth: Math.round(azimuth), sunElevation: Math.round(Math.max(2, elevation)), sky: nextSky };
}
