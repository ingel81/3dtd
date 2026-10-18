import type { Material, Mesh, Object3D, WebGLProgramParametersWithUniforms } from 'three';

/**
 * The shots' light in a material (docs/SHOT_LIGHTS.md, E242): ShotLights
 * writes up to SHOT_LIGHTS_MAX lights a frame into one shared uniform array,
 * and the materials that take it add their light: the custom map's ground
 * and objects (height-fog.ts, where the lamps' light goes in too), the
 * towers, plinths and the hero (addShotLight), the enemies (vat-material.ts).
 * The array keeps its size whatever the quality level allows: a level
 * change switches no program, it only shows fewer lights. No light, no
 * loop: the count is 0 without a shot in view and on Low.
 */

/** Lights a material reads at most (the array's size in the shader; the quality levels give 0 to this), one bit each in a cell */
export const SHOT_LIGHTS_MAX = 32;
/** Cells each way of the grid over the ground the lights cover */
export const SHOT_GRID = 8;

export const SHOT_LIGHT_UNIFORMS = {
  /** Lights in use this frame */
  uShotLightCount: { value: 0 },
  /**
   * Two vec4 per light: its position (scene metres) and 1 / radius², then
   * its colour times its intensity and 1 / core² of its falloff
   */
  uShotLights: { value: new Float32Array(SHOT_LIGHTS_MAX * 8) },
  /** The grid: its corner on the ground (scene x, z) and cells per metre each way (a vec4) */
  uShotGrid: { value: new Float32Array(4) },
  /** Per cell (row by row, four to a uvec4) a bit for each light that reaches it */
  uShotCells: { value: new Uint32Array(SHOT_GRID * SHOT_GRID) },
};

/**
 * shotLightAt(worldPos, worldNormal): the summed light of the shots at a
 * fragment, of the lights its grid cell names (the lowest set bit each
 * round, its index from log2 of it, exact for powers of two). A light
 * falls off as an inverse square beyond its core and ends smoothly at its
 * radius; a face turned to it takes it all, one turned away
 * a little (wrapped), so a flash low over a road lights the road and the
 * wall beside it. Soft limited like the lamps: a dozen blasts light
 * brightly, never to white.
 */
export const SHOT_LIGHT_PARS = /* glsl */ `
#define SHOT_LIGHTS_MAX ${SHOT_LIGHTS_MAX}
#define SHOT_GRID ${SHOT_GRID}
uniform int uShotLightCount;
uniform vec4 uShotLights[SHOT_LIGHTS_MAX * 2];
uniform vec4 uShotGrid;
uniform uvec4 uShotCells[SHOT_GRID * SHOT_GRID / 4];
vec3 shotLightAt(vec3 worldPos, vec3 worldNormal) {
  vec3 shotSum = vec3(0.0);
  vec2 shotCell = floor((worldPos.xz - uShotGrid.xy) * uShotGrid.zw);
  if (any(lessThan(shotCell, vec2(0.0))) || any(greaterThanEqual(shotCell, vec2(float(SHOT_GRID))))) return shotSum;
  int shotIndex = int(shotCell.y) * SHOT_GRID + int(shotCell.x);
  uint shotMask = uShotCells[shotIndex >> 2][shotIndex & 3];
  for (int n = 0; n < SHOT_LIGHTS_MAX; n++) {
    if (shotMask == 0u) break;
    uint shotBit = shotMask & (~shotMask + 1u);
    shotMask ^= shotBit;
    int i = int(log2(float(shotBit)) + 0.5);
    vec4 shotAt = uShotLights[i * 2];
    vec3 shotL = shotAt.xyz - worldPos;
    float shotD2 = dot(shotL, shotL);
    float shotX = shotD2 * shotAt.w;
    if (shotX >= 1.0) continue;
    vec4 shotColor = uShotLights[i * 2 + 1];
    float shotEdge = 1.0 - shotX;
    float shotFacing = clamp(dot(worldNormal, shotL) * inversesqrt(max(shotD2, 1e-4)) * 0.7 + 0.3, 0.0, 1.0);
    shotSum += shotColor.rgb * (shotEdge * shotEdge * shotFacing / (1.0 + shotD2 * shotColor.w));
  }
  return shotSum / (1.0 + max(max(shotSum.r, shotSum.g), shotSum.b) * 0.25);
}
`;

/**
 * For a lit built-in material at <emissivemap_fragment>: the shots' light on
 * its own colour, as the lamps', at the world position in `worldPos` (a
 * varying). `normal` is in view space there; turned back into the world by
 * the view matrix's transpose, its inverse rotation.
 */
export function shotLightFragment(worldPos: string): string {
  return /* glsl */ `
if (uShotLightCount > 0) {
  vec3 shotNormal = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
  totalEmissiveRadiance += diffuseColor.rgb * shotLightAt(${worldPos}, shotNormal);
}
`;
}

/** The world position for shotLightFragment, after <project_vertex> (skinned, morphed, instanced or batched) */
const SHOT_WORLD_VERTEX = /* glsl */ `
{
  vec4 shotWorld = vec4(transformed, 1.0);
  #ifdef USE_BATCHING
  shotWorld = batchingMatrix * shotWorld;
  #endif
  #ifdef USE_INSTANCING
  shotWorld = instanceMatrix * shotWorld;
  #endif
  vShotWorldPos = (modelMatrix * shotWorld).xyz;
}
`;

const patched = new WeakSet<Material>();

/**
 * Makes a lit built-in material (standard, physical, Lambert, Phong) take
 * the shots' light: the towers, their plinths and the hero. Chains an
 * existing onBeforeCompile; an unlit material is left as it is, and
 * patching twice does nothing. The custom map's materials take it through
 * their height fog instead (addHeightFog), which has the world position.
 */
export function addShotLight(material: Material): void {
  if (patched.has(material)) return;
  patched.add(material);
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
    prev.call(material, shader, renderer);
    if (!shader.fragmentShader.includes('#include <emissivemap_fragment>')) return;
    Object.assign(shader.uniforms, SHOT_LIGHT_UNIFORMS);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vShotWorldPos;')
      .replace('#include <project_vertex>', `#include <project_vertex>\n${SHOT_WORLD_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vShotWorldPos;\n${SHOT_LIGHT_PARS}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${shotLightFragment('vShotWorldPos')}`);
  };
  material.customProgramCacheKey = () => `${prevKey.call(material)}-shot1`;
}

/** addShotLight on every material of the meshes under `root` */
export function addShotLightTo(root: Object3D): void {
  root.traverse((o) => {
    const m = (o as Mesh).isMesh ? (o as Mesh).material : null;
    if (!m) return;
    for (const material of Array.isArray(m) ? m : [m]) addShotLight(material);
  });
}
