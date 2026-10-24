/**
 * Small number and vector helpers the converters share: rounding to the
 * map's precision (centimetres for heights and positions, millimetres for
 * offsets), a unit vector, an angle in 0 to 2π.
 */
import type { MapPoint } from '../../custom-map/map-document';

export const round1 = (v: number): number => Math.round(v * 10) / 10;
export const round2 = (v: number): number => Math.round(v * 100) / 100;
export const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/** `v` scaled to length 1 (as it is when it has none) */
export const unit = (v: MapPoint): MapPoint => {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
};

/** An angle turned into 0 to 2π */
export const wrapAngle = (r: number): number => ((r % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
