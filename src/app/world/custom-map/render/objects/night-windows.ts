import type { Material } from 'three';

/**
 * Lit windows at night: the window glass of the buildings (materials named
 * `window-glass…` or `window`) glows warm once it gets dark, about every
 * other window by a hash of its place in the world (cells of 2.5 m across
 * and 3 m up, one storey), so a town reads as lived in, not as a dark mass.
 * No light of its own, no draw call more: a few shader lines on the
 * buildings' materials. Merged parts (merge-parts.ts) carry it per vertex
 * (`nightGlow`), a glass part of its own for all of it.
 */

/** Shared by every map view: how dark it is, 0 day to 1 night (CustomMapEnvironment.darkness) */
export const NIGHT_WINDOW_UNIFORMS = {
  uNightWindows: { value: 0 },
};

/** Whether a source material is window glass */
export function isWindowGlass(name: string): boolean {
  return name.startsWith('window-glass') || name === 'window';
}

/** Share of windows lit at full night */
const LIT_SHARE = 0.55;

/**
 * Patches a material to glow in its window glass at night; `perVertex` reads
 * the share from the vertex attribute `nightGlow` (a merged part), else all
 * of it is glass. Wraps what compiles the material so far.
 */
export function addNightWindows(material: Material, perVertex: boolean): void {
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    Object.assign(shader.uniforms, NIGHT_WINDOW_UNIFORMS);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying vec3 vGlowPos;\nvarying float vNightGlow;\n${perVertex ? 'attribute float nightGlow;' : ''}`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 glowPos = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
        glowPos = instanceMatrix * glowPos;
        #endif
        vGlowPos = (modelMatrix * glowPos).xyz;
        vNightGlow = ${perVertex ? 'nightGlow' : '1.0'};`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGlowPos;\nvarying float vNightGlow;\nuniform float uNightWindows;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        if (vNightGlow > 0.5 && uNightWindows > 0.0) {
          // One storey and window bay per cell: lit or not, a warmer or paler light
          vec3 cell = floor(vGlowPos * vec3(0.4, 0.333, 0.4));
          float h = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          float lit = step(1.0 - ${LIT_SHARE.toFixed(2)}, h);
          vec3 warm = mix(vec3(1.0, 0.62, 0.3), vec3(1.0, 0.85, 0.6), fract(h * 7.0));
          totalEmissiveRadiance += warm * lit * uNightWindows * 0.9;
        }`,
      );
  };
  material.customProgramCacheKey = () => `${prevKey.call(material)}-night-windows${perVertex ? '-v' : ''}`;
}
