import { Color, Vector3, type Material, type WebGLProgramParametersWithUniforms } from 'three';

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
  /** Colour grade of the map's look, after the fog: contrast, saturation, and a multiply tint */
  uGradeContrast: { value: 1 },
  uGradeSaturation: { value: 1 },
  uGradeTint: { value: new Color(1, 1, 1) },
};

export const HEIGHT_FOG_PARS = /* glsl */ `
uniform float uFogFalloff;
uniform float uFogBase;
uniform vec3 uFogSunColor;
uniform vec3 uFogSunDir;
uniform float uFogDensity;
uniform float uGradeContrast;
uniform float uGradeSaturation;
uniform vec3 uGradeTint;

// The map's grade in output (sRGB) space, like three's fog: saturation, contrast around mid grey, tint
vec3 mapGrade(vec3 c) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uGradeSaturation);
  c = max(vec3(0.0), (c - 0.45) * uGradeContrast + 0.45);
  return c * uGradeTint;
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
  float amount = fogBaseDensity * fogDist * (exp(-k * max(camHeight, -50.0)) * along + 0.25);
  float fogFactor = 1.0 - exp(-max(amount, 0.0));
  float sunward = pow(max(dot(fogRay / max(fogDist, 1e-3), uFogSunDir), 0.0), 8.0);
  // Fog is applied in output space (as three does); its colours are linear, so convert them,
  // or the haze ends up darker and greener than the sky it should meet
  vec3 haze = linearToOutputTexel(vec4(mix(fogColor, uFogSunColor, sunward * 0.35), 1.0)).rgb;
  gl_FragColor.rgb = mix(gl_FragColor.rgb, haze, fogFactor);
}
#endif
gl_FragColor.rgb = mapGrade(gl_FragColor.rgb);
`;
}

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
    Object.assign(shader.uniforms, HEIGHT_FOG_UNIFORMS);
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
      .replace('#include <fog_pars_fragment>', `#include <fog_pars_fragment>\nvarying vec3 vFogWorldPos;\n${HEIGHT_FOG_PARS}`)
      .replace('#include <fog_fragment>', heightFogFragment('vFogWorldPos'));
  };
  material.customProgramCacheKey = () => `${prevKey.call(material)}-hfog`;
}
