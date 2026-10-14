/**
 * Effects of the custom map renderer that cost more than the map's base
 * look, each with its own switch (the view's `effects` option, or
 * `CustomMapView.setEffects`). All off by default; the quality levels turn
 * them on (docs/CUSTOM_MAPS_NEXT_PLAN.md, quality table).
 *
 * - refraction: water shows the ground behind it bent by its waves (a copy
 *   of the frame's opaque part, one full-screen blit per frame where water
 *   is in view)
 * - seaWaves: Gerstner swell on seas (vertex displacement, the normal from
 *   it)
 * - lavaGlow: lava pushes its hottest veins over 1 for the bloom pass and
 *   the air above it shimmers (heat haze, shares the refraction's copy)
 * - shadowCascade: a second, coarse cached shadow map for the far land
 */
export interface MapEffects {
  refraction: boolean;
  seaWaves: boolean;
  lavaGlow: boolean;
  shadowCascade: boolean;
}

export const NO_MAP_EFFECTS: Readonly<MapEffects> = {
  refraction: false,
  seaWaves: false,
  lavaGlow: false,
  shadowCascade: false,
};
