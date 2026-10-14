import type { MapWaterKind } from '../../map-document';

/**
 * Bands of foam that run in from the deep to the shore, and the swash they
 * push up the bank. The water material draws the bands, the terrain the
 * wet strip they leave; both take their phase from these numbers and their
 * own clock (water uTime, terrain uTerrainTime: both advance with the
 * view's frames from its start), so the bank darkens as a band arrives.
 *
 * `density`: bands per metre of depth; `speed`: bands per second reaching
 * the shore. None on ice and lava.
 */
export interface ShoreWaves {
  density: number;
  speed: number;
}

export function shoreWaves(kind: MapWaterKind | undefined): ShoreWaves | null {
  switch (kind ?? 'water') {
    case 'sea':
      return { density: 0.8, speed: 0.11 };
    case 'water':
      return { density: 2.0, speed: 0.15 };
    case 'swamp':
      return { density: 2.0, speed: 0.06 };
    default:
      return null;
  }
}

/** GLSL: the phase of the bands at a depth, 0 where a band's front is (fract) */
export const SHORE_PHASE_GLSL = /* glsl */ `
float shorePhase(float depth, float density, float speed, float time) {
  return fract(depth * density + time * speed);
}
`;
