import { ShaderChunk, type Material } from 'three';

/**
 * Looks of one model in a grid atlas (catalogue `variants`): the model's
 * baked textures hold `count` looks of the same mesh side by side (2 x 2
 * for four: Holstein, Fleckvieh, Braunvieh and Angus coats on one cow), its
 * UVs show the first cell, and each instance reads the cell its place
 * picks. A herd of one model shows several breeds without a draw call,
 * a texture or a byte of instance data more; an object keeps its look
 * across rebuilds and on every client because the pick hashes where it
 * stands. Only for objects that do not move (a moving one would change
 * its look on the way).
 *
 * Cell k sits at column k % grid and row floor(k / grid) counted from the
 * bottom of the image as Blender bakes it (blender_kit.bake_surface); glTF
 * flips v, so in the model's UVs the rows go downwards from the first cell.
 */
export function addAtlasVariants(material: Material, count: number): void {
  const grid = Math.ceil(Math.sqrt(count));
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;
  // Every map lookup of the model goes through the shifted UV (a variant model has one UV map)
  const lookups = ShaderChunk.uv_vertex.replace(/vec3\( ([A-Z_]+), 1 \)/g, 'vec3( atlasUv, 1 )');
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader.replace(
      '#include <uv_vertex>',
      /* glsl */ `
      vec2 atlasUv = uv;
      #ifdef USE_INSTANCING
      {
        vec2 atlasAt = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xz;
        float atlasPick = floor(fract(sin(dot(floor(atlasAt * 2.0), vec2(12.9898, 78.233))) * 43758.5453) * ${count.toFixed(1)});
        atlasUv += vec2(mod(atlasPick, ${grid.toFixed(1)}), -floor(atlasPick / ${grid.toFixed(1)})) / ${grid.toFixed(1)};
      }
      #endif
      ${lookups}`,
    );
  };
  material.customProgramCacheKey = () => `${prevKey.call(material)}-atlas${count}`;
}
