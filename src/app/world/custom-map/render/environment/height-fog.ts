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
};

export const HEIGHT_FOG_PARS = /* glsl */ `
uniform float uFogFalloff;
uniform float uFogBase;
uniform vec3 uFogSunColor;
uniform vec3 uFogSunDir;
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
  #ifdef FOG_EXP2
  float fogBaseDensity = fogDensity * 2.0;
  #else
  float fogBaseDensity = 3.0 / fogFar;
  #endif
  float amount = fogBaseDensity * fogDist * exp(-k * max(camHeight, -50.0)) * along;
  float fogFactor = 1.0 - exp(-max(amount, 0.0));
  float sunward = pow(max(dot(fogRay / max(fogDist, 1e-3), uFogSunDir), 0.0), 8.0);
  vec3 haze = mix(fogColor, uFogSunColor, sunward * 0.45);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, haze, fogFactor);
}
#endif
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
