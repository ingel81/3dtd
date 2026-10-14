import { Vector2 } from 'three';
import type { MapBiome, MapEnvironment, MapWind } from '../../map-document';

/**
 * One wind for the whole map: trees, plants, grass, clouds, smoke, leaves,
 * rain, snow and the biome's ash and dust all move with the same direction
 * and strength. Gusts run as fronts over the world along the wind, so a
 * squall is seen crossing a meadow and then a wood.
 *
 * The uniforms are shared by every material that moves in the wind (one
 * environment is active at a time, like HEIGHT_FOG_UNIFORMS);
 * CustomMapEnvironment sets them from the map's `environment.wind`, or the
 * biome's default when a map has none.
 */
export const WIND_UNIFORMS = {
  /** Seconds, advanced by the environment every frame */
  uWindTime: { value: 0 },
  /** Where the wind blows to, a unit vector in the scene's x, z */
  uWindDir: { value: new Vector2(1, 0) },
  /** 0 calm .. 1 a strong wind */
  uWindStrength: { value: 0.35 },
  /** 0 steady .. 1 strong gust fronts */
  uWindGust: { value: 0.5 },
  /**
   * Share of the sway grass, trees and plants take from the wind (the
   * player's plant motion, render-quality.ts): 0 still, 1 as the map's wind
   * moves them. Clouds, smoke and weather keep the full wind
   */
  uPlantSway: { value: 1 },
};

/** The wind of maps without their own, per biome; the moon has no air */
const BIOME_WIND: Record<MapBiome, MapWind> = {
  temperate: { strength: 0.35, direction: 240, gusts: 0.5 },
  mountain: { strength: 0.55, direction: 270, gusts: 0.6 },
  swamp: { strength: 0.15, direction: 200, gusts: 0.25 },
  desert: { strength: 0.45, direction: 60, gusts: 0.5 },
  arctic: { strength: 0.5, direction: 330, gusts: 0.6 },
  city: { strength: 0.3, direction: 240, gusts: 0.4 },
  apocalypse: { strength: 0.45, direction: 250, gusts: 0.6 },
  hell: { strength: 0.3, direction: 180, gusts: 0.4 },
  moon: { strength: 0, direction: 0, gusts: 0 },
  mars: { strength: 0.4, direction: 120, gusts: 0.5 },
};

/** The wind a map blows with: its own, or its biome's default */
export function windOf(env: Pick<MapEnvironment, 'wind' | 'biome'>): MapWind {
  return env.wind ?? BIOME_WIND[env.biome ?? 'temperate'] ?? BIOME_WIND.temperate;
}

/**
 * Where the wind blows to in the scene (x, z), for a wind from `direction`
 * (degrees from north, clockwise, as a weather report gives it). Map east
 * is scene -x, map north scene +z.
 */
export function windSceneDirection(direction: number, target: Vector2): Vector2 {
  const a = (direction * Math.PI) / 180;
  // Towards the opposite side: map (-sin, -cos), scene x = -map x
  return target.set(Math.sin(a), -Math.cos(a));
}

/** Installs a wind in the shared uniforms; values are clamped to 0..1 */
export function setWind(wind: MapWind): void {
  const clamp = (v: number): number => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
  WIND_UNIFORMS.uWindStrength.value = clamp(wind.strength);
  WIND_UNIFORMS.uWindGust.value = clamp(wind.gusts);
  windSceneDirection(Number.isFinite(wind.direction) ? wind.direction : 0, WIND_UNIFORMS.uWindDir.value);
}

/** How far plants sway in the wind, 0 still .. 1 as the wind takes them (the player's plant motion) */
export function setPlantSway(share: number): void {
  WIND_UNIFORMS.uPlantSway.value = Math.min(1, Math.max(0, Number.isFinite(share) ? share : 1));
}

/**
 * How far (model metres) the top of a plant of `height` metres and
 * catalogue sway `sway` (0 rigid .. 1 slender) moves in a strong wind
 * (push 1). A slender 18 m tree moves about a metre; small plants move more
 * for their size than tall ones. The shaders scale it by the wind's push at
 * the plant (strength, swell and gust front).
 */
export function windSwayAtTop(sway: number, height: number): number {
  return Math.max(0, sway) * (0.04 * Math.max(0, height) + 0.15);
}

/**
 * GLSL for the shared wind: the uniforms, `windGust(p)` (0..1 at a scene
 * x, z: gust fronts about 70 m apart that run along the wind at 7 m/s,
 * bent across it) and `windPush(p)` (0 in calm air, the strength in steady
 * wind, up to about 2.6 times it in the strongest gust). Plants scale their
 * sway by `uPlantSway`.
 */
export const WIND_GLSL = /* glsl */ `
uniform float uWindTime;
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform float uWindGust;
uniform float uPlantSway;
float windGust(vec2 p) {
  float along = dot(p, uWindDir);
  float across = dot(p, vec2(-uWindDir.y, uWindDir.x));
  float w = along * 0.09 - uWindTime * 0.63 + sin(across * 0.021 + 1.7) * 1.6 + sin(across * 0.057 - uWindTime * 0.05) * 0.7;
  float g = 0.5 + 0.5 * sin(w);
  return g * g * g * uWindGust;
}
float windPush(vec2 p) {
  return uWindStrength * (0.8 + 0.2 * sin(uWindTime * 0.31 + dot(p, vec2(0.013, 0.017))) + 1.6 * windGust(p));
}
`;
