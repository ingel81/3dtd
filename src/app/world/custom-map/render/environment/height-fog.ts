import { Color, Vector3, Vector4, type Material, type Texture, type WebGLProgramParametersWithUniforms } from 'three';
import { LAMP_LIGHT_FRAGMENT, LAMP_LIGHT_PARS, LAMP_LIGHT_UNIFORMS } from '../effects/lamp-light';

/**
 * Height fog with aerial perspective for the custom map's materials.
 *
 * The scene keeps a FogExp2 (fog colour, density, and the USE_FOG define),
 * but the map's own materials replace its fragment: the fog thins with
 * height above the map's ground (falloff `uFogFalloff` per metre), so
 * valleys and the far plain sink into haze while hill tops and the sky
 * stay clear, and towards the sun the haze takes on the sun's colour.
 * The density integrates along the view ray in closed form, so a camera
 * high above sees the ground through thin air and the far land in thick.
 *
 * Uniforms are shared by every patched material (one environment is
 * active at a time); CustomMapEnvironment sets them.
 */
export const HEIGHT_FOG_UNIFORMS = {
  uFogFalloff: { value: 1 / 70 },
  uFogBase: { value: 0 },
  uFogSunColor: { value: new Color(1, 0.9, 0.75) },
  uFogSunDir: { value: new Vector3(0, 1, 0) },
  /** The map's own fog density (the scene's FogExp2 carries a matched one for other materials) */
  uFogDensity: { value: 0.001 },
  /** Metres of clear air before the haze starts: the game camera (150 to 300 m) looks through none */
  uFogStart: { value: 450 },
  /** The map's extent in the scene (centre x, z and half sizes): land beyond the border fades into the haze */
  uFogMap: { value: new Vector4(0, 0, 1e6, 1e6) },
  /** Colour grade of the map's look, after the fog: contrast, saturation, and a multiply tint */
  uGradeContrast: { value: 1 },
  uGradeSaturation: { value: 1 },
  uGradeTint: { value: new Color(1, 1, 1) },
  /** Split toning of the look: a tint for the shadows and one for the lights */
  uGradeShadow: { value: new Color(1, 1, 1) },
  uGradeLight: { value: new Color(1, 1, 1) },
  /** 0..1 snow on surfaces facing up, and wetness (darker, glossier) */
  uSnowCover: { value: 0 },
  uWetness: { value: 0 },
};

/**
 * Lava's glow on the objects near it (houses, rocks, trees by a lava flow):
 * the ground occlusion texture's lava closeness (channel A,
 * ground-occlusion.ts) read at the fragment's spot on the map, orange from
 * below, without lights. The view sets it where the map has lava; the
 * terrain glows by its own (userData.noLavaGlow).
 */
export const LAVA_GLOW_UNIFORMS = {
  uLavaGlowOn: { value: 0 },
  uLavaGlowTex: { value: null as Texture | null },
  /** Map metres to the texture's uv (as the terrain's uGridUv) */
  uLavaGridUv: { value: new Vector4() },
};

const LAVA_GLOW_PARS = /* glsl */ `
uniform float uLavaGlowOn;
uniform sampler2D uLavaGlowTex;
uniform vec4 uLavaGridUv;
`;

const LAVA_GLOW_FRAGMENT = /* glsl */ `
if (uLavaGlowOn > 0.5) {
  // The map lies at uFogMap.xy in the scene, scene x running against map x
  vec2 lavaAt = vec2(uFogMap.x - vFogWorldPos.x, vFogWorldPos.z - uFogMap.y);
  float lavaNear = texture2D(uLavaGlowTex, lavaAt * uLavaGridUv.xy + uLavaGridUv.zw).a;
  // Lit from below: faces turned down and sideways take the most
  float below = 0.2 + 0.8 * max(-dot(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz)), 0.0);
  totalEmissiveRadiance += vec3(1.0, 0.32, 0.06) * pow(lavaNear, 3.0) * 0.4 * below;
}
`;

export const HEIGHT_FOG_PARS = /* glsl */ `
uniform float uFogFalloff;
uniform float uFogBase;
uniform vec3 uFogSunColor;
uniform vec3 uFogSunDir;
uniform float uFogDensity;
uniform float uFogStart;
uniform vec4 uFogMap;
uniform float uGradeContrast;
uniform float uGradeSaturation;
uniform vec3 uGradeTint;
uniform vec3 uGradeShadow;
uniform vec3 uGradeLight;
uniform float uSnowCover;
uniform float uWetness;

// The map's grade on a colour after colorspace_fragment: saturation, contrast around mid grey, tint.
// Graded in sRGB either way: into the canvas the colour is sRGB already, into the game's
// post-processing target (linear, OutputPass converts later) it is converted there and back, or
// the contrast would crush every dark linear value to black.
vec3 mapGrade(vec3 c) {
  bool linearOut = linearToOutputTexel(vec4(0.5)).r < 0.6;
  if (linearOut) c = pow(max(c, vec3(0.0)), vec3(1.0 / 2.2));
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uGradeSaturation);
  c = max(vec3(0.0), (c - 0.45) * uGradeContrast + 0.45);
  c *= uGradeTint;
  // Split toning: the shadows lean one way (mostly cool), the lights another (mostly warm)
  // (normalised to their luminance: they shift the hue, not the brightness)
  vec3 split = mix(uGradeShadow, uGradeLight, smoothstep(0.08, 0.75, l));
  c *= split / max(dot(split, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
  if (linearOut) c = pow(c, vec3(2.2));
  return c;
}
`;

/** Fog for a fragment at world position `worldPos`, applied to gl_FragColor (needs fogColor, fogDensity) */
export function heightFogFragment(worldPos: string): string {
  return /* glsl */ `
#ifdef USE_FOG
{
  vec3 fogRay = ${worldPos} - cameraPosition;
  float fogDist = length(fogRay);
  float k = uFogFalloff;
  float kdy = k * fogRay.y;
  float camHeight = cameraPosition.y - uFogBase;
  // Integral of density * exp(-k * height) along the ray, closed form
  float along = abs(kdy) > 1e-4 ? (1.0 - exp(-kdy)) / kdy : 1.0;
  float fogBaseDensity = uFogDensity * 2.0;
  // Height fog, plus thin air everywhere: far land turns hazy blue even seen from high above
  // Clear air up to uFogStart, then height fog plus a little haze everywhere
  float fogPath = max(fogDist - uFogStart, 0.0);
  // Aerial perspective: past a kilometre and a half the land fades into the haze at any height
  float farPath = max(fogDist - uFogStart * 3.0, 0.0);
  float amount = fogBaseDensity * (fogPath * (exp(-k * max(camHeight, -50.0)) * along + 0.1) + farPath * 0.9);
  float fogFactor = 1.0 - exp(-max(amount, 0.0));
  // Land beyond the map's border is backdrop: it sinks into the haze within 160 m, so the map stands out as the place
  vec2 beyond = abs(${worldPos}.xz - uFogMap.xy) - uFogMap.zw;
  fogFactor = max(fogFactor, smoothstep(-20.0, 160.0, max(beyond.x, beyond.y)) * 0.97);
  float sunward = pow(max(dot(fogRay / max(fogDist, 1e-3), uFogSunDir), 0.0), 8.0);
  // Fog is applied in output space (as three does). three hands fogColor over in that space already
  // (getUnlitUniformColorSpace: sRGB into the canvas, linear into a post target); only the sun's
  // colour is ours and linear. Converting fogColor again lifted every haze into a pale band
  vec3 haze = mix(fogColor, linearToOutputTexel(vec4(uFogSunColor, 1.0)).rgb, sunward * 0.2);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, haze, fogFactor);
}
#endif
gl_FragColor.rgb = mapGrade(gl_FragColor.rgb);
`;
}

/**
 * Snow and wetness on the map's materials (before lighting): snow settles on
 * whatever faces up, broken up by a little noise; wet surfaces are darker
 * and glossier.
 */
const SURFACE_WEATHER_COLOR = /* glsl */ `
float surfaceUp = 1.0;
#ifndef FLAT_SHADED
surfaceUp = dot(normalize(vNormal), normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz));
#endif
if (uSnowCover > 0.0) {
  vec2 sp = vFogWorldPos.xz * 0.7;
  float grain = fract(sin(dot(floor(sp), vec2(12.9898, 78.233))) * 43758.5453) * 0.15 + sin(sp.x * 0.37 + sp.y * 0.21) * 0.08;
  float snow = smoothstep(0.75 - uSnowCover * 0.55, 0.95 - uSnowCover * 0.45, surfaceUp + grain) * min(1.0, uSnowCover * 1.6);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.95), snow);
}
diffuseColor.rgb *= 1.0 - uWetness * 0.3;
`;

const SURFACE_WEATHER_ROUGHNESS = /* glsl */ `
roughnessFactor = mix(roughnessFactor, min(roughnessFactor, 0.35), uWetness * smoothstep(0.2, 0.8, surfaceUp));
`;

const patched = new WeakSet<Material>();

/**
 * Makes a standard (or any built-in) material use the height fog. Chains
 * an existing onBeforeCompile; patching twice does nothing.
 */
export function addHeightFog(material: Material): void {
  if (patched.has(material)) return;
  patched.add(material);
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
    prev.call(material, shader, renderer);
    Object.assign(shader.uniforms, HEIGHT_FOG_UNIFORMS, LAVA_GLOW_UNIFORMS, LAMP_LIGHT_UNIFORMS);
    const lit = shader.fragmentShader.includes('#include <emissivemap_fragment>');
    const lavaGlow = !material.userData['noLavaGlow'] && lit;
    // Lamps, torches and fires light every lit surface near them (effects/lamp-light.ts), the terrain too
    const glow = `${lavaGlow ? LAVA_GLOW_FRAGMENT : ''}\n${lit ? LAMP_LIGHT_FRAGMENT : ''}`;
    shader.vertexShader = shader.vertexShader
      .replace('#include <fog_pars_vertex>', '#include <fog_pars_vertex>\nvarying vec3 vFogWorldPos;')
      .replace(
        '#include <fog_vertex>',
        /* glsl */ `#include <fog_vertex>
        #ifdef USE_INSTANCING
        vFogWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
        vFogWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <fog_pars_fragment>', `#include <fog_pars_fragment>\nvarying vec3 vFogWorldPos;\n${HEIGHT_FOG_PARS}\n${LAVA_GLOW_PARS}\n${LAMP_LIGHT_PARS}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${glow}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${SURFACE_WEATHER_COLOR}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${SURFACE_WEATHER_ROUGHNESS}`)
      // The terrain replaces the roughness chunk and leaves this marker
      .replace('// map-roughness-done', SURFACE_WEATHER_ROUGHNESS)
      .replace('#include <fog_fragment>', heightFogFragment('vFogWorldPos'));
  };
  material.customProgramCacheKey = () => `${prevKey.call(material)}-hfog3`;
}
