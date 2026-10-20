import { Color, Vector2, type DataArrayTexture, type Texture } from 'three';

/**
 * The ground's colour at a map point for shaders that stand on the land or
 * see it from elsewhere (grass blades, the land in a water reflection),
 * linear: the terrain's own colour baked from above (ground-albedo.ts) once
 * it is there, until then the splat's layer averages by their weights
 * (two splat lookups, three on a map with more than 8 layers, one array). One set for
 * the map on show; MapTerrain fills it whenever its layers or splat
 * change, the bake when it has drawn.
 */
export const GROUND_COLOR_UNIFORMS = {
  /** The splat maps, a layer each (SplatTextures) */
  uGroundSplats: { value: null as DataArrayTexture | null },
  /** Average colour (linear) of the layer in each splat channel, the maps in order */
  uGroundColors: { value: Array.from({ length: 12 }, () => new Color(0.3, 0.3, 0.25)) },
  /** The map's width and depth, m */
  uGroundSize: { value: new Vector2(1, 1) },
  /** Splat channels in use: 8, or 12 with a third map */
  uGroundLayers: { value: 8 },
  /** The baked colour (GroundAlbedo) over the whole map, and 1 once it holds the map on show */
  uGroundAlbedo: { value: null as Texture | null },
  uGroundAlbedoOn: { value: 0 },
};

export function setGroundColors(splat: DataArrayTexture, colors: readonly Color[], width: number, depth: number): void {
  const u = GROUND_COLOR_UNIFORMS;
  u.uGroundSplats.value = splat;
  u.uGroundColors.value.forEach((c, k) => c.copy(colors[k] ?? c));
  u.uGroundSize.value.set(width, depth);
  u.uGroundLayers.value = splat.image.depth * 4;
}

/** GLSL: `groundColorAt(m)`, the ground's colour at map point m (centred map metres, as the water's `m`) */
export const GROUND_COLOR_GLSL = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray uGroundSplats;
uniform vec3 uGroundColors[12];
uniform vec2 uGroundSize;
uniform float uGroundLayers;
uniform sampler2D uGroundAlbedo;
uniform float uGroundAlbedoOn;
// One return at the end: with an early one D3D's compiler warned of an uninitialised result (X4000)
vec3 groundColorAt(vec2 m) {
  vec2 uv = clamp(m / uGroundSize + 0.5, 0.0, 1.0);
  vec3 c = vec3(0.0);
  if (uGroundAlbedoOn > 0.5) {
    c = textureLod(uGroundAlbedo, uv, 0.0).rgb;
  } else {
    vec4 s0 = texture(uGroundSplats, vec3(uv, 0.0));
    vec4 s1 = texture(uGroundSplats, vec3(uv, 1.0));
    for (int k = 0; k < 4; k++) c += uGroundColors[k] * s0[k] + uGroundColors[k + 4] * s1[k];
    float total = dot(s0, vec4(1.0)) + dot(s1, vec4(1.0));
    if (uGroundLayers > 8.5) {
      vec4 s2 = texture(uGroundSplats, vec3(uv, 2.0));
      for (int k = 0; k < 4; k++) c += uGroundColors[k + 8] * s2[k];
      total += dot(s2, vec4(1.0));
    }
    c /= max(total, 1e-3);
  }
  return c;
}
`;
