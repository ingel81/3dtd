import { PLINTH_CONFIG } from '../configs/placement.config';

/** Where a tower stands on the ground under its footprint. */
export interface TowerFootprint {
  /**
   * Height of the tower's foot (local Y): the highest surface under the
   * footprint, on even ground the surface under the cursor.
   */
  footY: number;
  /** Plinth from the lowest surface under the footprint up to footY (m), 0 = none. */
  plinthHeight: number;
}

/** Largest gap (m) between two probes on a ring. */
const RING_SPACING_M = 2;

const offsetsByRadius = new Map<number, readonly (readonly [number, number])[]>();

/**
 * Horizontal offsets (dx, dz) at which the ground under a footprint of
 * `radius` is probed: the centre, a ring at half the radius and one at the
 * radius, probes at most RING_SPACING_M apart (at least 6 and 12). The inner
 * ring is turned by half a step so the two rings do not line up. Cached per
 * radius, the list is shared.
 */
export function footprintSampleOffsets(radius: number): readonly (readonly [number, number])[] {
  const cached = offsetsByRadius.get(radius);
  if (cached) return cached;

  const offsets: [number, number][] = [[0, 0]];
  const ring = (r: number, count: number, phase: number) => {
    for (let i = 0; i < count; i++) {
      const angle = ((i + phase) / count) * Math.PI * 2;
      offsets.push([Math.cos(angle) * r, Math.sin(angle) * r]);
    }
  };
  ring(radius / 2, Math.max(6, Math.ceil((Math.PI * radius) / RING_SPACING_M)), 0.5);
  ring(radius, Math.max(12, Math.ceil((2 * Math.PI * radius) / RING_SPACING_M)), 0);

  offsetsByRadius.set(radius, offsets);
  return offsets;
}

/**
 * The tower's foot and plinth from the surface under the cursor
 * (`surfaceY`) and the highest surface at each footprint probe (null where
 * a probe hit nothing).
 *
 * On uneven ground the tower stands on the highest point and the plinth
 * reaches down to the lowest, so no part of the tower sinks into the
 * slope. Probes more than PLINTH_CONFIG.MAX_RISE above or MAX_DROP below the
 * cursor surface are left out: a wall or crown beside the tower, the drop
 * past an edge. Below PLINTH_CONFIG.MIN_UNEVENNESS the tower keeps the
 * cursor surface and gets no plinth, as before.
 */
export function resolveTowerFootprint(surfaceY: number, samples: readonly (number | null)[]): TowerFootprint {
  let top = surfaceY;
  let bottom = surfaceY;
  for (const y of samples) {
    if (y === null) continue;
    if (y > surfaceY + PLINTH_CONFIG.MAX_RISE || y < surfaceY - PLINTH_CONFIG.MAX_DROP) continue;
    if (y > top) top = y;
    if (y < bottom) bottom = y;
  }
  if (top - bottom < PLINTH_CONFIG.MIN_UNEVENNESS) {
    return { footY: surfaceY, plinthHeight: 0 };
  }
  return { footY: top, plinthHeight: top - bottom };
}
