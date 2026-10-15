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
 * - shadowCascade: the land's own shadow beyond the cached shadow map's
 *   reach, baked over the whole map (terrain/far-shadow.ts, one lookup)
 * - waterDetail: the water's richer shading of water, sea and swamp
 *   (deep water darker, the body shaded by its waves, light through them,
 *   the land in the reflection in its ground colour, caustics on the
 *   shallow bed with refraction, foam streaks along a river's current);
 *   four height and two or three splat fetches more per water pixel, no
 *   pass
 * - reflection: the scene mirrored in the level of the area body in view
 *   (water-reflection.ts): one more render of the map per frame or every
 *   other, at a fraction of the frame's size
 *   (`CustomMapView.setReflectionScale`)
 */
export interface MapEffects {
  refraction: boolean;
  seaWaves: boolean;
  lavaGlow: boolean;
  shadowCascade: boolean;
  waterDetail: boolean;
  reflection: boolean;
}

export const NO_MAP_EFFECTS: Readonly<MapEffects> = {
  refraction: false,
  seaWaves: false,
  lavaGlow: false,
  shadowCascade: false,
  waterDetail: false,
  reflection: false,
};
