/** Speeds the HUD speed button cycles through and the +/- keys step along. */
export const GAME_SPEEDS: readonly number[] = [1, 2, 4];

/**
 * The next speed up (`step` 1) or down (-1), held at the ends. A speed that
 * is not in the list (a training timescale) steps to the nearest one in that
 * direction.
 */
export function stepGameSpeed(current: number, step: 1 | -1): number {
  if (step > 0) {
    for (const speed of GAME_SPEEDS) {
      if (speed > current) return speed;
    }
    return current;
  }
  for (let i = GAME_SPEEDS.length - 1; i >= 0; i--) {
    if (GAME_SPEEDS[i] < current) return GAME_SPEEDS[i];
  }
  return current;
}
