import { InstancedMesh, Mesh, PlaneGeometry, ShaderMaterial, Vector2, Vector3, Vector4, type IUniform, type Object3D, type Texture } from 'three';
import type { GroundHeights } from '../../../world/world-provider';

/**
 * Soft round shadows under enemies and the hero, on worlds that ask for
 * them (WorldCapabilities.groundShadows: custom maps, whose sun casts real
 * shadows of trees and buildings; on tiles nothing does). Enemies and the
 * hero are not in the cached shadow map: they move every frame.
 *
 * Per enemy type a second instanced mesh shares the type pool's instance
 * matrices and slide offsets (aPrevOffset, uStateLerp), so it costs no
 * per-frame work on the CPU: one small draw per type. Air units get none.
 *
 * The blob lies on the ground, not flat at the foot: where the world gives
 * its height grid (setBlobGround), each vertex of the blob (a 4 x 4 grid)
 * takes the ground's height under it, so on a slope it neither sinks in on
 * the uphill side nor floats on the other. A unit well above the ground
 * there (on a bridge) keeps its blob flat at its feet.
 */

/** The ground's heights the blobs lie on, shared by both materials; off without a world that gives them */
function groundUniforms() {
  return {
    uBlobHeights: { value: null as Texture | null },
    uBlobGrid: { value: new Vector4() },
    uBlobGridSize: { value: new Vector2(1, 1) },
    uBlobOrigin: { value: new Vector3() },
    uBlobOnGround: { value: 0 },
  };
}
/** Made with the first blob material, not at load: specs mock three without the vectors */
let GROUND: ReturnType<typeof groundUniforms> | null = null;
let groundSource: (() => GroundHeights | null) | null = null;

/** Where the blobs read the ground's heights (the world's groundHeights), null: flat at the feet */
export function setBlobGround(source: (() => GroundHeights | null) | null): void {
  groundSource = source;
  followGround();
}

/** The ground's current grid into the blobs' uniforms (the map may have been rebuilt), each frame they draw */
function followGround(): void {
  if (!GROUND) return;
  const g = groundSource?.() ?? null;
  GROUND.uBlobOnGround.value = g ? 1 : 0;
  if (!g) return;
  GROUND.uBlobHeights.value = g.heights;
  GROUND.uBlobGrid.value.copy(g.grid);
  GROUND.uBlobGridSize.value.copy(g.gridSize);
  GROUND.uBlobOrigin.value.copy(g.origin);
}

let blobMaterial: ShaderMaterial | null = null;

function material(stateLerp: IUniform<number>): ShaderMaterial {
  if (blobMaterial) return blobMaterial;
  blobMaterial = new ShaderMaterial({
    uniforms: { uStateLerp: stateLerp, ...(GROUND ??= groundUniforms()) },
    vertexShader: BLOB_VERTEX,
    fragmentShader: BLOB_FRAGMENT,
    transparent: true,
    depthWrite: false,
  });
  blobMaterial.name = 'blob-shadow';
  return blobMaterial;
}

/**
 * A blob under every instance of `pool` (`radius` metres at scale 1),
 * following its count, matrices and slide; returns the blob mesh, added
 * beside the pool
 */
export function attachBlobShadow(pool: InstancedMesh, radius: number, stateLerp: IUniform<number>): InstancedMesh {
  const quad = new PlaneGeometry(radius * 2, radius * 2, 4, 4).rotateX(-Math.PI / 2);
  const blob = new InstancedMesh(quad, material(stateLerp), 1);
  blob.name = `${pool.name || 'enemies'}-blob`;
  blob.frustumCulled = false;
  blob.renderOrder = 1;
  blob.userData['losTransparent'] = true;
  blob.onBeforeRender = () => {
    followGround();
    // The pool grows by replacing its attributes: follow them
    blob.count = pool.visible ? pool.count : 0;
    blob.instanceMatrix = pool.instanceMatrix;
    const slide = pool.geometry.getAttribute('aPrevOffset');
    if (slide && quad.getAttribute('aPrevOffset') !== slide) quad.setAttribute('aPrevOffset', slide);
  };
  blob.count = 0;
  pool.parent?.add(blob);
  return blob;
}

/** One blob under a single object (the hero), its own mesh; follows `target` each frame */
export function singleBlobShadow(target: Object3D, radius: number): Mesh {
  const blob = new Mesh(new PlaneGeometry(radius * 2, radius * 2, 4, 4).rotateX(-Math.PI / 2), SINGLE_MATERIAL());
  blob.onBeforeRender = followGround;
  blob.name = 'hero-blob';
  blob.position.y = 0.06;
  blob.renderOrder = 1;
  blob.userData['losTransparent'] = true;
  target.add(blob);
  return blob;
}

let single: ShaderMaterial | null = null;
function SINGLE_MATERIAL(): ShaderMaterial {
  if (single) return single;
  single = new ShaderMaterial({ uniforms: { ...(GROUND ??= groundUniforms()) }, vertexShader: SINGLE_VERTEX, fragmentShader: BLOB_FRAGMENT, transparent: true, depthWrite: false });
  single.name = 'blob-shadow-single';
  return single;
}

/**
 * GLSL: a world point put on the ground under it, 8 cm up; one well above
 * the ground there (more than 0.6 m, a bridge) stays at its own height
 */
const ON_GROUND = /* glsl */ `
uniform sampler2D uBlobHeights;
uniform vec4 uBlobGrid;
uniform vec2 uBlobGridSize;
uniform vec3 uBlobOrigin;
uniform float uBlobOnGround;
float blobGroundAt(vec3 world) {
  vec2 m = vec2(uBlobOrigin.x - world.x, world.z - uBlobOrigin.z);
  vec2 g = clamp((m - uBlobGrid.xy) / uBlobGrid.z, vec2(0.0), uBlobGridSize - 1.001);
  ivec2 i = ivec2(floor(g));
  vec2 f = g - vec2(i);
  float h00 = texelFetch(uBlobHeights, i, 0).r;
  float h10 = texelFetch(uBlobHeights, i + ivec2(1, 0), 0).r;
  float h01 = texelFetch(uBlobHeights, i + ivec2(0, 1), 0).r;
  float h11 = texelFetch(uBlobHeights, i + ivec2(1, 1), 0).r;
  return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y) + uBlobOrigin.y;
}
vec3 blobOnGround(vec3 world, vec3 foot) {
  if (uBlobOnGround < 0.5 || foot.y - blobGroundAt(foot) > 0.6) return world;
  return vec3(world.x, blobGroundAt(world) + 0.08, world.z);
}
`;

const BLOB_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${ON_GROUND}
attribute vec3 aPrevOffset;
uniform float uStateLerp;
varying vec2 vBlob;
void main() {
  // The enemy's foot: its instance position (and its slide), the quad flat under it at its scale
  float s = length(instanceMatrix[0].xyz);
  vec3 foot = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz + aPrevOffset * (1.0 - uStateLerp);
  vec4 world = vec4(blobOnGround(foot + vec3(position.x * s, 0.06, position.z * s), foot), 1.0);
  vBlob = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>
}
`;

const SINGLE_VERTEX = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
${ON_GROUND}
varying vec2 vBlob;
void main() {
  vBlob = uv * 2.0 - 1.0;
  vec3 foot = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec4 world = vec4(blobOnGround((modelMatrix * vec4(position, 1.0)).xyz, foot), 1.0);
  gl_Position = projectionMatrix * viewMatrix * world;
  #include <logdepthbuf_vertex>
}
`;

const BLOB_FRAGMENT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
varying vec2 vBlob;
void main() {
  #include <logdepthbuf_fragment>
  // Dark under the feet, fading out to the quad's rim
  float r = length(vBlob);
  float a = (1.0 - smoothstep(0.3, 1.0, r)) * 0.45;
  if (a <= 0.003) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}
`;
