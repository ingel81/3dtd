import { Color, Vector2, type Texture } from 'three';

/**
 * The ground's colour at a map point for shaders that see the land from
 * elsewhere (the land in a water reflection, water-material.ts): the
 * splat's layer averages by their weights there, linear. One set for the
 * map on show; MapTerrain fills it whenever its layers or splat change.
 * Two splat lookups, three on a map with more than 8 layers.
 */
export const GROUND_COLOR_UNIFORMS = {
  uGroundSplat0: { value: null as Texture | null },
  uGroundSplat1: { value: null as Texture | null },
  uGroundSplat2: { value: null as Texture | null },
  /** Average colour (linear) of the layer in each splat channel, the maps in order */
  uGroundColors: { value: Array.from({ length: 12 }, () => new Color(0.3, 0.3, 0.25)) },
  /** The map's width and depth, m */
  uGroundSize: { value: new Vector2(1, 1) },
  /** Splat channels in use: 8, or 12 with a third map */
  uGroundLayers: { value: 8 },
};

export function setGroundColors(splat: readonly Texture[], colors: readonly Color[], width: number, depth: number): void {
  const u = GROUND_COLOR_UNIFORMS;
  u.uGroundSplat0.value = splat[0] ?? null;
  u.uGroundSplat1.value = splat[1] ?? null;
  u.uGroundSplat2.value = splat[2] ?? null;
  u.uGroundColors.value.forEach((c, k) => c.copy(colors[k] ?? c));
  u.uGroundSize.value.set(width, depth);
  u.uGroundLayers.value = splat.length * 4;
}

/** GLSL: `groundColorAt(m)`, the ground's colour at map point m (centred map metres, as the water's `m`) */
export const GROUND_COLOR_GLSL = /* glsl */ `
uniform sampler2D uGroundSplat0;
uniform sampler2D uGroundSplat1;
uniform sampler2D uGroundSplat2;
uniform vec3 uGroundColors[12];
uniform vec2 uGroundSize;
uniform float uGroundLayers;
vec3 groundColorAt(vec2 m) {
  vec2 uv = clamp(m / uGroundSize + 0.5, 0.0, 1.0);
  vec4 s0 = texture2D(uGroundSplat0, uv);
  vec4 s1 = texture2D(uGroundSplat1, uv);
  vec3 c = vec3(0.0);
  for (int k = 0; k < 4; k++) c += uGroundColors[k] * s0[k] + uGroundColors[k + 4] * s1[k];
  float total = dot(s0, vec4(1.0)) + dot(s1, vec4(1.0));
  if (uGroundLayers > 8.5) {
    vec4 s2 = texture2D(uGroundSplat2, uv);
    for (int k = 0; k < 4; k++) c += uGroundColors[k + 8] * s2[k];
    total += dot(s2, vec4(1.0));
  }
  return c / max(total, 1e-3);
}
`;
