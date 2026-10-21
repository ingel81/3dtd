/**
 * The arithmetic of the frame's flat map (E282), apart from MapLibre so a
 * spec can hold it: the square stands still in the middle of the map and
 * keeps its size on the screen, the map is dragged under it and zooms with
 * the square's side. The keys that move the map and size the square.
 */
import { METERS_PER_DEGREE_LAT } from '../../utils/geo-utils';
import { OSM_SIDE_STEP } from '../../world/osm/osm-area';
import type { GeoPoint } from '../../world/osm/osm-frame-core';

/** The earth's circumference at the equator in Web Mercator, metres */
const EARTH_M = 40075016.686;
/** MapLibre's world at zoom 0, pixels */
const WORLD_PX = 512;

/** The zoom at which `sideM` metres at latitude `lat` span `framePx` pixels (the square on the screen) */
export function zoomForSide(sideM: number, lat: number, framePx: number): number {
  return Math.log2((EARTH_M * Math.cos((lat * Math.PI) / 180) * framePx) / (WORLD_PX * sideM));
}

/** `at` moved `east` and `north` metres */
export function movedBy(at: GeoPoint, east: number, north: number): GeoPoint {
  return {
    lat: at.lat + north / METERS_PER_DEGREE_LAT,
    lon: at.lon + east / (METERS_PER_DEGREE_LAT * Math.cos((at.lat * Math.PI) / 180)),
  };
}

/** Metres an arrow key moves the map by; with Shift five times as far */
export const KEY_STEP_M = OSM_SIDE_STEP;
const KEY_STEP_FAR = 5;

/** What a key on the focused map does: the square moves east and north by metres, or its side grows or shrinks a step */
export type FrameKey = { east: number; north: number } | { side: 1 | -1 };

export function frameKey(key: string, shift = false): FrameKey | null {
  const step = KEY_STEP_M * (shift ? KEY_STEP_FAR : 1);
  switch (key) {
    case 'ArrowLeft':
      return { east: -step, north: 0 };
    case 'ArrowRight':
      return { east: step, north: 0 };
    case 'ArrowUp':
      return { east: 0, north: step };
    case 'ArrowDown':
      return { east: 0, north: -step };
    case '+':
    case '=':
      return { side: 1 };
    case '-':
    case '_':
      return { side: -1 };
    default:
      return null;
  }
}
