// Shared fixtures for the particle-based VFX renderer specs (emp-pulse,
// frost-burst, orbital-beam; mushroom-cloud keeps its own sprite-based drawn).
// Not app code: import only from specs.

import { vi } from 'vitest';
import type { Points } from 'three';

/** Math.random with a fixed sequence, so two runs draw the same particles. */
export function seededRandom(seed = 1): void {
  let state = seed;
  vi.spyOn(Math, 'random').mockImplementation(() => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  });
}

export const drawn = (points: Points) => (points.visible ? points.geometry.drawRange.count : 0);

export function positions(points: Points): number[][] {
  const array = points.geometry.getAttribute('position').array;
  const out: number[][] = [];
  for (let i = 0; i < drawn(points); i++) out.push([array[i * 3], array[i * 3 + 1], array[i * 3 + 2]]);
  return out;
}
