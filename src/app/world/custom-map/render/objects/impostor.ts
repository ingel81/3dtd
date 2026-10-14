import {
  BufferAttribute,
  BufferGeometry,
  Box3,
  Color,
  DoubleSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  MeshStandardMaterial,
  NoBlending,
  OrthographicCamera,
  RGBADepthPacking,
  Scene,
  Sphere,
  SRGBColorSpace,
  Vector3,
  WebGLRenderTarget,
  type Material,
  type Texture,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from 'three';
import type { ObjectModel } from '../map-asset-library';

/**
 * Impostors for far trees and big rocks: the model drawn from many
 * directions over the upper half of a sphere (a hemi-octahedral grid of
 * IMPOSTOR_FRAMES x IMPOSTOR_FRAMES views, albedo only, unlit) into one
 * texture, shown as one card that turns to the camera. The card picks the
 * four views nearest the direction it is seen from and blends them, so a
 * far tree looks right from the side, from above and from anywhere
 * between, not only along two crossed cards and one from above. The scene
 * lights it like any standard material, its normal bent towards the camera
 * and up.
 *
 * In the shadow pass the card turns to the sun (`depthMaterial`, the
 * mesh's customDepthMaterial) and casts the outline seen from there. The
 * geometry itself still holds two crossed upright cards the size of the
 * model: what draws the mesh with a material of its own (the towers' line
 * of sight swaps in a distance material) sees those cards, as before.
 */

/** The direction towards the sun (scene space), for the cards' shadow lookup; the map's view sets it each frame */
export const IMPOSTOR_SUN = { uImpSun: { value: new Vector3(0, 1, 0) } };

/** Views per side of the grid */
export const IMPOSTOR_FRAMES = 8;
/** Pixels per view */
const CELL = 64;

export interface Impostor {
  geometry: BufferGeometry;
  material: MeshStandardMaterial;
  /** The card turned to the sun, for the shadow pass (InstancedMesh.customDepthMaterial) */
  depthMaterial: MeshDepthMaterial;
  texture: Texture;
  dispose(): void;
}

/** The direction (y up) a point of the hemi-octahedral grid stands for, `ex` and `ey` 0..1 */
export function hemiOctDirection(ex: number, ey: number, out = new Vector3()): Vector3 {
  const x = ex * 2 - 1;
  const y = ey * 2 - 1;
  const px = (x + y) / 2;
  const pz = (x - y) / 2;
  return out.set(px, 1 - Math.abs(px) - Math.abs(pz), pz).normalize();
}

/** The grid point (0..1 on both axes) of a direction with y >= 0, as the shader finds it */
export function hemiOctPoint(d: Vector3): [number, number] {
  const s = Math.abs(d.x) + Math.abs(d.y) + Math.abs(d.z);
  const px = d.x / s;
  const pz = d.z / s;
  return [(px + pz) / 2 + 0.5, (px - pz) / 2 + 0.5];
}

export function bakeImpostor(renderer: WebGLRenderer, model: ObjectModel): Impostor | null {
  const parts = model.parts;
  if (!parts.length) return null;
  const scene = new Scene();
  const bounds = new Box3();
  const unlit: Material[] = [];
  for (const part of parts) {
    part.geometry.computeBoundingBox();
    bounds.union(part.geometry.boundingBox!);
    const src = part.material as MeshStandardMaterial;
    const m = new MeshBasicMaterial({
      map: src.map ?? null,
      color: src.color ?? new Color(1, 1, 1),
      alphaTest: src.alphaTest > 0 ? src.alphaTest : 0,
      transparent: false,
      side: DoubleSide,
    });
    unlit.push(m);
    scene.add(new Mesh(part.geometry, m));
  }
  const size = bounds.getSize(new Vector3());
  if (!(Math.max(size.x, size.z) > 0 && size.y > 0)) return null;
  const center = bounds.getCenter(new Vector3());
  // The card covers the model's bounding sphere from every direction
  const radius = size.length() / 2;

  const side = CELL * IMPOSTOR_FRAMES;
  // Drawn with 4x MSAA, then copied into a plain target: kept, the MSAA buffer held three times the texture
  const msaa = new WebGLRenderTarget(side, side, { samples: 4 });
  msaa.texture.colorSpace = SRGBColorSpace;
  const target = new WebGLRenderTarget(side, side, { depthBuffer: false });
  target.texture.colorSpace = SRGBColorSpace;
  target.texture.generateMipmaps = true;
  target.texture.minFilter = LinearMipmapLinearFilter;
  target.texture.magFilter = LinearFilter;
  const prevTarget = renderer.getRenderTarget();
  const prevClear = new Color();
  renderer.getClearColor(prevClear);
  const prevAlpha = renderer.getClearAlpha();
  const prevAutoClear = renderer.autoClear;
  renderer.setRenderTarget(msaa);
  // A leaf-dark clear colour with no alpha: mipmaps blend towards it, not towards black
  renderer.setClearColor(0x2c3a22, 0);
  renderer.autoClear = false;
  renderer.clear();
  // A bound render target draws to its own viewport and scissor, not the canvas's
  msaa.scissorTest = true;
  // Each view looks at the centre from its direction, its right is up x direction (three's lookAt), as the card's
  const camera = new OrthographicCamera(-radius, radius, radius, -radius, 0.01, radius * 4);
  const dir = new Vector3();
  for (let j = 0; j < IMPOSTOR_FRAMES; j++) {
    for (let i = 0; i < IMPOSTOR_FRAMES; i++) {
      hemiOctDirection(i / (IMPOSTOR_FRAMES - 1), j / (IMPOSTOR_FRAMES - 1), dir);
      camera.position.copy(center).addScaledVector(dir, radius * 2);
      camera.up.set(0, 1, 0);
      camera.lookAt(center);
      camera.updateProjectionMatrix();
      msaa.viewport.set(i * CELL, j * CELL, CELL, CELL);
      msaa.scissor.set(i * CELL, j * CELL, CELL, CELL);
      renderer.setRenderTarget(msaa);
      renderer.render(scene, camera);
    }
  }
  copyTexture(renderer, msaa.texture, target);
  msaa.dispose();
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
  renderer.autoClear = prevAutoClear;
  for (const m of unlit) m.dispose();

  const geometry = impostorGeometry(center, radius, bounds);
  const uniforms = {
    uImpCenter: { value: center.clone() },
    uImpRadius: { value: radius },
  };
  const material = new MeshStandardMaterial({
    map: target.texture,
    alphaTest: 0.45,
    alphaToCoverage: true,
    side: DoubleSide,
    roughness: 0.9,
    metalness: 0,
  });
  material.name = 'impostor';
  material.onBeforeCompile = (shader) => turnToCamera(shader, uniforms, true);
  material.customProgramCacheKey = () => 'impostor-octa-1';
  // Packed for the shadow map as the terrain's depth material packs it, turned to the sun
  const depthMaterial = new MeshDepthMaterial({ depthPacking: RGBADepthPacking, map: target.texture, alphaTest: 0.45, side: DoubleSide });
  depthMaterial.name = 'impostor-depth';
  depthMaterial.onBeforeCompile = (shader) => turnToCamera(shader, uniforms, false);
  depthMaterial.customProgramCacheKey = () => 'impostor-octa-depth-1';
  return {
    geometry,
    material,
    depthMaterial,
    texture: target.texture,
    dispose: () => {
      geometry.dispose();
      material.dispose();
      depthMaterial.dispose();
      target.dispose();
    },
  };
}

/** `source` into `target` as it is, alpha too (a triangle over the target, no blending), its mipmaps made after */
function copyTexture(renderer: WebGLRenderer, source: Texture, target: WebGLRenderTarget): void {
  const material = new MeshBasicMaterial({ map: source, blending: NoBlending, toneMapped: false, depthTest: false, depthWrite: false });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  const quad = new Mesh(geometry, material);
  quad.frustumCulled = false;
  const scene = new Scene();
  scene.add(quad);
  // Clip space as it comes: an identity camera
  const camera = new OrthographicCamera(-1, 1, 1, -1, -1, 1);
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  geometry.dispose();
  material.dispose();
}

/** The card's turn to the camera and the blend of its four nearest views, into a standard or a depth material */
export function turnToCamera(shader: WebGLProgramParametersWithUniforms, uniforms: Record<string, { value: unknown }>, lit: boolean): void {
  Object.assign(shader.uniforms, uniforms, IMPOSTOR_SUN);
  shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${IMPOSTOR_VERTEX_PARS}`);
  shader.vertexShader = lit
    ? shader.vertexShader
        // The normal follows the card: towards the camera and up, like a crown's
        .replace('#include <beginnormal_vertex>', `${IMPOSTOR_SETUP}\nvec3 objectNormal = normalize(impDir + vec3(0.0, 0.6, 0.0));`)
        .replace('#include <begin_vertex>', IMPOSTOR_BEGIN)
        .replace('#include <shadowmap_vertex>', IMPOSTOR_SHADOW_LOOKUP)
    : shader.vertexShader.replace('#include <begin_vertex>', `${IMPOSTOR_SETUP}\n${IMPOSTOR_BEGIN}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${IMPOSTOR_FRAGMENT_PARS}`)
    .replace('#include <map_fragment>', IMPOSTOR_MAP);
}

const IMPOSTOR_VERTEX_PARS = /* glsl */ `
#define IMPOSTOR_FRAMES ${IMPOSTOR_FRAMES}.0
attribute vec3 impCorner;
uniform vec3 uImpCenter;
uniform float uImpRadius;
uniform vec3 uImpSun;
flat varying vec2 vImpFrame;
flat varying vec2 vImpBlend;
varying vec2 vImpUv;
`;

// The direction to the camera in the model's own space (from below: the horizon's views), the card's axes
// as the views were baked (right = up x direction), and the four views around that direction
const IMPOSTOR_SETUP = /* glsl */ `
#ifdef USE_INSTANCING
mat4 impToWorld = modelMatrix * instanceMatrix;
#else
mat4 impToWorld = modelMatrix;
#endif
vec3 impDir = (inverse(impToWorld) * vec4(cameraPosition, 1.0)).xyz - uImpCenter;
impDir.y = max(impDir.y, 0.0);
impDir = normalize(impDir + vec3(0.0, 1e-5, 0.0));
vec3 impRight = cross(vec3(0.0, 1.0, 0.0), impDir);
impRight = dot(impRight, impRight) < 1e-8 ? vec3(1.0, 0.0, 0.0) : normalize(impRight);
vec3 impUp = cross(impDir, impRight);
vec2 impP = impDir.xz / (abs(impDir.x) + abs(impDir.y) + abs(impDir.z));
vec2 impGrid = (vec2(impP.x + impP.y, impP.x - impP.y) * 0.5 + 0.5) * (IMPOSTOR_FRAMES - 1.0);
vImpFrame = min(floor(impGrid), vec2(IMPOSTOR_FRAMES - 2.0));
vImpBlend = impGrid - vImpFrame;
vImpUv = impCorner.xy * 0.5 + 0.5;
`;

// The second card's corners (impCorner.z 0) all fall on the centre: one turned card is drawn
const IMPOSTOR_BEGIN = /* glsl */ `
vec3 transformed = uImpCenter + (impRight * impCorner.x + impUp * impCorner.y) * uImpRadius * impCorner.z;
`;

// The card looks up its shadow a radius closer to the sun: the card the camera sees runs through the model's
// centre, and so does the one turned to the sun that casts, so half the seen card lay behind its own caster
// and showed as a dark box in the crown. Other casters' shadows still fall on it
const IMPOSTOR_SHADOW_LOOKUP = /* glsl */ `
#ifdef USE_SHADOWMAP
vec4 impWorldPosition = worldPosition;
worldPosition.xyz += uImpSun * uImpRadius * length(impToWorld[0].xyz);
#endif
#include <shadowmap_vertex>
#ifdef USE_SHADOWMAP
worldPosition = impWorldPosition;
#endif
`;

const IMPOSTOR_FRAGMENT_PARS = /* glsl */ `
#define IMPOSTOR_FRAMES ${IMPOSTOR_FRAMES}.0
flat varying vec2 vImpFrame;
flat varying vec2 vImpBlend;
varying vec2 vImpUv;
`;

// The four views at the card's point, each weighted by how near its direction is
const IMPOSTOR_MAP = /* glsl */ `
vec2 impUv = clamp(vImpUv, 0.002, 0.998);
vec4 impA = texture2D(map, (vImpFrame + impUv) / IMPOSTOR_FRAMES);
vec4 impB = texture2D(map, (vImpFrame + vec2(1.0, 0.0) + impUv) / IMPOSTOR_FRAMES);
vec4 impC = texture2D(map, (vImpFrame + vec2(0.0, 1.0) + impUv) / IMPOSTOR_FRAMES);
vec4 impD = texture2D(map, (vImpFrame + vec2(1.0, 1.0) + impUv) / IMPOSTOR_FRAMES);
diffuseColor *= mix(mix(impA, impB, vImpBlend.x), mix(impC, impD, vImpBlend.x), vImpBlend.y);
`;

/**
 * Two crossed upright cards the size of the model (what a material of its
 * own draws, as before) carrying the corners of the card the shaders turn
 * to the camera: the first card's corners (impCorner z 1), the second's
 * all on the centre (z 0)
 */
function impostorGeometry(center: Vector3, radius: number, bounds: Box3): BufferGeometry {
  const half = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) / 2;
  const y0 = bounds.min.y;
  const y1 = bounds.max.y;
  const { x: cx, z: cz } = center;
  const pos = [
    [cx - half, y0, cz], [cx + half, y0, cz], [cx + half, y1, cz], [cx - half, y1, cz],
    [cx, y0, cz + half], [cx, y0, cz - half], [cx, y1, cz - half], [cx, y1, cz + half],
  ];
  const corner = [
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
    [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0],
  ];
  const uv = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0], [1, 0], [1, 1], [0, 1]];
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos.flat()), 3));
  g.setAttribute('impCorner', new BufferAttribute(new Float32Array(corner.flat()), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv.flat()), 2));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(Array.from({ length: 8 }, () => [0, 1, 0]).flat()), 3));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  // The turned card stays within the model's bounding sphere
  g.boundingSphere = new Sphere(center.clone(), radius);
  g.boundingBox = new Box3(center.clone().subScalar(radius), center.clone().addScalar(radius));
  return g;
}
