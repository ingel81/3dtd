import type { MapWaterKind } from '../../map-document';

/**
 * Bands of foam that run in from open water to the shore, and the swash they
 * push up the bank. The water material draws the bands, the terrain the
 * wet strip they leave; both take their phase from these numbers and their
 * own clock (water uTime, terrain uTerrainTime: both advance with the
 * view's frames from its start), so the bank darkens as a band arrives.
 *
 * `density`: bands per metre out from the shore (the baked, blurred
 * distance, flow-map.ts); `speed`: bands per second reaching the shore;
 * `reach`: metres out where they gather. None on ice and lava.
 */
export interface ShoreWaves {
  density: number;
  speed: number;
  reach: number;
}

export function shoreWaves(kind: MapWaterKind | undefined): ShoreWaves | null {
  switch (kind ?? 'water') {
    case 'sea':
      return { density: 0.11, speed: 0.11, reach: 22 };
    case 'water':
      return { density: 0.3, speed: 0.15, reach: 5 };
    case 'swamp':
      return { density: 0.3, speed: 0.06, reach: 5 };
    default:
      return null;
  }
}

/** GLSL: the phase of the bands at a distance from the shore, 0 where a band's front is (fract) */
export const SHORE_PHASE_GLSL = /* glsl */ `
float shorePhase(float dist, float density, float speed, float time) {
  return fract(dist * density + time * speed);
}
`;
