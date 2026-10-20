import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Box3,
  Color,
  DirectionalLight,
  DoubleSide,
  HemisphereLight,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix3,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  MeshStandardMaterial,
  NoBlending,
  NoColorSpace,
  OrthographicCamera,
  RGBADepthPacking,
  Scene,
  ShaderChunk,
  ShaderMaterial,
  Sphere,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type Material,
  type Texture,
  type WebGLProgramParametersWithUniforms,
  type WebGLRenderer,
} from 'three';
import type { ObjectModel } from '../map-asset-library';
import { firstUseOf } from '../../../../three-engine/programs-ready';

/**
 * Impostors for far trees and big rocks: the model drawn from many
 * directions over the upper half of a sphere (a hemi-octahedral grid of
 * IMPOSTOR_FRAMES x IMPOSTOR_FRAMES views) into two textures, shown as one
 * card that turns to the camera. The card picks the four views nearest the
 * direction it is seen from and blends them, so a far tree looks right from
 * the side, from above and from anywhere between.
 *
 * The bake keeps what lights the model, not only its colour: the albedo
 * atlas (colour and coverage) and a normal and depth atlas (the surface's
 * normal in the model's frame, as the model's parts light it, and how far
 * in front of the card's plane it lies). The card is lit per pixel with
 * those normals like the model, and shades itself where the shadow map
 * reaches (where the model would cast onto itself): a point of the card
 * lies at its depth, and the view nearest the sun says whether the crown
 * stands between it and the sun. The bake then draws the model and its
 * impostor under the same lights from a few sides and keeps the ratio of
 * their mean colours as the impostor's tone: what is left of the
 * difference (mipmaps, the blend of four views) does not show as a step in
 * colour at the switch.
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

/** Scratch for the drawing buffer's size */
const SCREEN = new Vector2();
/** Drawing buffer height from which a view gets 128 px */
const SHARP_FROM = 1400;

/**
 * Pixels per view for a model of this bounding radius on a drawing buffer
 * `screen` px high. At the High level's 380 m a tree 16 m across covers
 * some 100 px of a 2160 px screen and a cliff twice that: 128 px a view
 * there. Below SHARP_FROM a tree is half that and 64 px hold it, as they
 * do a small far rock anywhere (a quarter of the memory: colour and
 * normals of a tree are 6.7 MB at 128 px)
 */
export function impostorCell(radius: number, screen: number): number {
  return radius >= 3 && screen >= SHARP_FROM ? 128 : 64;
}

/** Texels a view's covered pixels bleed into the empty ones round them, so mipmaps blend towards the model's own colour */
const BLEED = 6;
/** Pixels per side of each probe view of the tone measurement */
const PROBE = 96;
/**
 * Directions the tone measurement looks from: azimuth and elevation, degrees. All round at the game camera's pitch
 * and a little flatter: a card lights as a solid crown and a model's sparse leaves do not (lit leaves behind its gaps
 * against the sun), so the two part with the side the sun stands on; the tone matches them over all sides, as the
 * camera sees a map's woods from every side
 */
const PROBE_VIEWS: readonly [number, number][] = [
  [0, 35], [45, 25], [90, 35], [135, 25], [180, 35], [225, 25], [270, 35], [315, 25],
];
/**
 * The lights of the map an impostor is baked for, as its objects stand
 * under them: the direction towards the sun and the colours (times their
 * intensities, linear) of the sun, the sky and the ground of the
 * hemisphere light, and the ambient. The tone probe draws model and card
 * under these: a low evening sun lights a crown's leaves and its card's
 * baked normals otherwise than a high noon one, and a tone measured under
 * a fixed sun and no environment map left Autumn Keep's far wood darker than its trees
 */
export interface ImpostorLights {
  sunDir: Vector3;
  sun: Color;
  sky: Color;
  ground: Color;
  ambient: Color;
  /** The map's prefiltered environment map and its intensity: most of a far wood's light from the sky comes through it */
  environment?: Texture | null;
  environmentIntensity?: number;
}

/** The probe's lights when the map gives none: a high sun, a sky and a little ambient */
export const DEFAULT_IMPOSTOR_LIGHTS: ImpostorLights = {
  sunDir: new Vector3(0.45, 0.8, 0.35).normalize(),
  sun: new Color(0xfff4e0).multiplyScalar(1.3),
  sky: new Color(0xb8d0f0).multiplyScalar(0.7),
  ground: new Color(0x5a4a32).multiplyScalar(0.7),
  ambient: new Color(0xb8d0f0).multiplyScalar(0.12),
};
/** The probe's sun stands at least this high (a sun at the horizon lights nothing to measure) */
const PROBE_MIN_SUN = 0.12;
/** The probe's lights together bring a white surface to at most this (linear): no channel clips in its 8-bit target */
const PROBE_LIGHT = 1.4;
/** The tone stays within this factor either way: a bake gone wrong is not hidden by it (blue runs widest: autumn leaves hold little of it, and the sky and the sheen add much of what the model shows) */
const TONE_LIMIT = 1.6;
/** How dark the card's self shadow gets (1: the sun's light all gone, like the model in its own shadow) */
const SELF_SHADOW = 0.9;

export interface Impostor {
  geometry: BufferGeometry;
  material: MeshStandardMaterial;
  /** The card turned to the sun, for the shadow pass (InstancedMesh.customDepthMaterial) */
  depthMaterial: MeshDepthMaterial;
  /** Colour and coverage of the views (sRGB) */
  texture: Texture;
  /** Normal in the model's frame (rgb) and depth in front of the card (a), linear */
  normalDepth: Texture;
  /** The factor on the card's colour the bake measured (the model's mean lit colour over the card's) */
  tone: Color;
  /** Pixels per view of the colour atlas (the normal-depth atlas has half) */
  cell: number;
  /** The card's centre and radius, and the crossed cards' half width and height (model frame) */
  frame: { center: Vector3; radius: number; half: number; y0: number; y1: number };
  /** How rough and metallic the model's surface is, as the card draws it */
  roughness: number;
  metalness: number;
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

/** What the probe settles for an impostor: the factor on its colour and the coverage its alpha test keeps */
export interface ImpostorLook {
  tone: Color;
  alphaTest: number;
}

/** The card's alpha test stays within these: a sparse crown is not cut to nothing, a solid one not filled out */
const ALPHA_TEST_RANGE: readonly [number, number] = [0.3, 0.85];

/**
 * The look of an impostor from the probe's pixels (linear RGBA, rows of
 * `views` views of `size` px: the model's first, covered where alpha is
 * set; the card's below with its blended alpha as it is). Four views
 * blended cover more than any one of them, so a sparse crown came out
 * fuller and in the colour of its leaves alone: the alpha test is the one
 * under which the card covers as many pixels as the model (within
 * ALPHA_TEST_RANGE). The tone is the ratio of the mean colours of what
 * each then covers, per channel, within TONE_LIMIT; 1 where either covers
 * nothing
 */
export function measureLook(pixels: Uint8Array, size: number, views: number, out: ImpostorLook = { tone: new Color(1, 1, 1), alphaTest: 0.45 }): ImpostorLook {
  const width = size * views;
  // Readback puts the target's first row (the model's: viewport y 0) first
  let modelCount = 0;
  const histogram = new Uint32Array(256);
  for (let y = 0; y < size * 2; y++) {
    for (let x = 0; x < width; x++) {
      const a = pixels[(y * width + x) * 4 + 3];
      if (y < size) modelCount += a >= 128 ? 1 : 0;
      else histogram[a]++;
    }
  }
  // The highest threshold that keeps at least the model's pixels of the card
  let cut = 255;
  for (let kept = 0; cut > 0; cut--) {
    kept += histogram[cut];
    if (kept >= modelCount) break;
  }
  const lo = Math.ceil(ALPHA_TEST_RANGE[0] * 255);
  const hi = Math.floor(ALPHA_TEST_RANGE[1] * 255);
  cut = modelCount > 0 ? Math.min(hi, Math.max(lo, cut)) : 115;
  out.alphaTest = cut / 255;
  const sums = [0, 0, 0, 0, 0, 0];
  const counts = [0, 0];
  for (let y = 0; y < size * 2; y++) {
    const row = y < size ? 0 : 1;
    const min = row ? Math.max(1, cut) : 128;
    for (let x = 0; x < width; x++) {
      const k = (y * width + x) * 4;
      if (pixels[k + 3] < min) continue;
      sums[row * 3] += pixels[k];
      sums[row * 3 + 1] += pixels[k + 1];
      sums[row * 3 + 2] += pixels[k + 2];
      counts[row]++;
    }
  }
  const ratio = (c: number): number => {
    if (!counts[0] || !counts[1]) return 1;
    const model = sums[c] / counts[0];
    const card = sums[3 + c] / counts[1];
    if (card <= 0 || model <= 0) return 1;
    return Math.min(TONE_LIMIT, Math.max(1 / TONE_LIMIT, model / card));
  };
  out.tone.setRGB(ratio(0), ratio(1), ratio(2));
  return out;
}

/** A foliage card: its normal is authored (bent out of the crown) and holds on both sides, as objectMaterial draws it */
function isCard(m: Material): boolean {
  return m.name.startsWith('foliage-');
}

/**
 * Cards seen edge-on fade out, as objectMaterial fades them (their texture smears into streaks there): the
 * bake and the probe see the crown as the map shows it
 */
const CARD_EDGE_FADE = /* glsl */ `{
  vec3 cardFace = normalize(cross(dFdx(vCardView), dFdy(vCardView)));
  diffuseColor.a *= smoothstep(0.08, 0.3, abs(dot(cardFace, normalize(vCardView))));
}`;

/** The edge-on fade and the authored normal into a built-in material of a card part (bake colour, probe) */
function addCardFade(m: Material, key: string): void {
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCardView;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvCardView = mvPosition.xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCardView;')
      .replace('#include <alphatest_fragment>', `${CARD_EDGE_FADE}\n#include <alphatest_fragment>`)
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n#ifndef FLAT_SHADED\nnormal = normalize(vNormal);\n#endif');
  };
  m.customProgramCacheKey = () => key;
}

/** What a bake draws: the model's parts in three looks, round their bounds */
interface Bake {
  scene: Scene;
  meshes: Mesh[];
  /** Per part: colour unlit, normal and depth, lit as the map lights it (the tone probe) */
  albedo: Material[];
  normal: ShaderMaterial[];
  lit: MeshStandardMaterial[];
  center: Vector3;
  radius: number;
  bounds: Box3;
  cell: number;
  /** The copy into the atlases (bleed included), one for both: its program is built ahead and drawn with */
  copy: CopyQuad;
  /** The impostor's surface: how rough and metallic the model's parts are, by their area on the bake's views */
  roughness: number;
  metalness: number;
  dispose(): void;
}

function prepareBake(model: ObjectModel, renderer: WebGLRenderer): Bake | null {
  const parts = model.parts;
  if (!parts.length) return null;
  const scene = new Scene();
  const bounds = new Box3();
  const meshes: Mesh[] = [];
  const albedo: Material[] = [];
  const normal: ShaderMaterial[] = [];
  const lit: MeshStandardMaterial[] = [];
  for (const part of parts) {
    part.geometry.computeBoundingBox();
    bounds.union(part.geometry.boundingBox!);
  }
  const size = bounds.getSize(new Vector3());
  if (!(Math.max(size.x, size.z) > 0 && size.y > 0)) return null;
  // The card covers the model's bounding sphere from every direction
  const center = bounds.getCenter(new Vector3());
  const radius = size.length() / 2;
  const copy = copyQuad();
  let rough = 0;
  let metal = 0;
  let weight = 0;
  for (const part of parts) {
    const src = part.material as MeshStandardMaterial;
    const alphaTest = src.alphaTest > 0 ? src.alphaTest : 0;
    const flat = new MeshBasicMaterial({ map: src.map ?? null, color: src.color ?? new Color(1, 1, 1), vertexColors: !!src.vertexColors, alphaTest, transparent: false, side: DoubleSide });
    if (isCard(src)) addCardFade(flat, 'impostor-bake-card');
    albedo.push(flat);
    normal.push(normalDepthMaterial(src, center, radius));
    const l = (src.clone?.() ?? new MeshStandardMaterial()) as MeshStandardMaterial;
    l.side = DoubleSide;
    l.transparent = false;
    // A hard test, as the bake cuts: the probe has no samples to cover, and the sharpened alpha read as a sparse crown
    l.alphaToCoverage = false;
    // As objectMaterial draws the cards: their authored normal on both sides, faded edge-on
    if (isCard(src)) addCardFade(l, 'impostor-probe-card');
    lit.push(l);
    const mesh = new Mesh(part.geometry, albedo[albedo.length - 1]);
    meshes.push(mesh);
    scene.add(mesh);
    // Leaves and bark count by how much of the model they make (their triangles' share is near enough)
    const tris = (part.geometry.index?.count ?? part.geometry.getAttribute('position').count) / 3;
    rough += (src.roughness ?? 0.9) * tris;
    // A metalness map scales its factor (glTF writes the factor 1 beside a bark's ORM texture, whose metal is 0): the
    // factor alone made the far wood half metal, its light from the sky halved
    metal += (src.metalnessMap ? 0 : (src.metalness ?? 0)) * tris;
    weight += tris;
  }
  return {
    scene,
    meshes,
    albedo,
    normal,
    lit,
    center,
    radius,
    bounds,
    cell: impostorCell(radius, renderer.getDrawingBufferSize(SCREEN).y),
    roughness: weight > 0 ? Math.min(1, Math.max(0.4, rough / weight)) : 0.9,
    metalness: weight > 0 ? Math.min(0.5, metal / weight) : 0,
    copy,
    dispose: () => {
      for (const m of [...albedo, ...normal, ...lit]) m.dispose();
      copy.dispose();
    },
  };
}

/** The normal (model frame) and the depth along the view of a part, cut where its colour map is clear like its albedo */
export function normalDepthMaterial(src: MeshStandardMaterial, center: Vector3, radius: number): ShaderMaterial {
  const map = src.map ?? null;
  map?.updateMatrix();
  return new ShaderMaterial({
    name: 'impostor-bake-normal',
    side: DoubleSide,
    uniforms: {
      uMap: { value: map },
      // A mat3 uniform must hold a matrix even unused: three reads its elements on every draw
      uMapTransform: { value: map ? map.matrix.clone() : new Matrix3() },
      uHasMap: { value: map ? 1 : 0 },
      uAlphaTest: { value: src.alphaTest > 0 ? src.alphaTest : 0 },
      uCard: { value: isCard(src) ? 1 : 0 },
      uCenter: { value: center },
      uRadius: { value: radius },
      uViewDir: { value: new Vector3(0, 1, 0) },
    },
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      uniform mat3 uMapTransform;
      uniform float uHasMap;
      uniform vec3 uCenter;
      uniform float uRadius;
      uniform vec3 uViewDir;
      varying vec2 vBakeUv;
      varying vec3 vBakeNormal;
      varying float vBakeDepth;
      varying vec3 vCardView;
      void main() {
        vBakeUv = uHasMap > 0.5 ? (uMapTransform * vec3(uv, 1.0)).xy : uv;
        vBakeNormal = normal;
        vBakeDepth = dot(position - uCenter, uViewDir) / uRadius;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vCardView = mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform sampler2D uMap;
      uniform float uHasMap;
      uniform float uAlphaTest;
      uniform float uCard;
      varying vec2 vBakeUv;
      varying vec3 vBakeNormal;
      varying float vBakeDepth;
      varying vec3 vCardView;
      void main() {
        #include <logdepthbuf_fragment>
        vec4 diffuseColor = vec4(1.0, 1.0, 1.0, uHasMap > 0.5 ? texture2D(uMap, vBakeUv).a : 1.0);
        if (uCard > 0.5) ${CARD_EDGE_FADE}
        if (diffuseColor.a < uAlphaTest) discard;
        vec3 n = normalize(vBakeNormal);
        // Solid parts face the viewer as three lights a double-sided surface; cards keep their authored normal
        if (uCard < 0.5 && !gl_FrontFacing) n = -n;
        gl_FragColor = vec4(n * 0.5 + 0.5, clamp(vBakeDepth * 0.5 + 0.5, 0.0, 1.0));
      }`,
  });
}

export function bakeImpostor(renderer: WebGLRenderer, model: ObjectModel, lights: ImpostorLights = DEFAULT_IMPOSTOR_LIGHTS): Impostor | null {
  const bake = prepareBake(model, renderer);
  if (!bake) return null;
  const imp = drawImpostor(renderer, bake);
  const probe = toneProbe(bake, imp, lights);
  probe.draw(renderer);
  renderer.readRenderTargetPixels(probe.target, 0, 0, probe.target.width, probe.target.height, probe.pixels);
  settleLook(imp, probe.pixels);
  probe.dispose();
  bake.dispose();
  return imp;
}

/**
 * The same bake with its programs built first, off the main thread where
 * the driver allows (the model's bake materials, the copy and the tone
 * probe's lit materials), their first-use work each in a task of its own,
 * and the probe read back without a stall. What is compiled here is what
 * draws: a material made anew would free the compiled program with the
 * old one and link again in the bake
 */
export async function bakeImpostorAsync(renderer: WebGLRenderer, model: ObjectModel, lights: ImpostorLights = DEFAULT_IMPOSTOR_LIGHTS): Promise<Impostor | null> {
  const bake = prepareBake(model, renderer);
  if (!bake) return null;
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 10);
  const msaa = new WebGLRenderTarget(1, 1, { samples: 4 });
  msaa.texture.colorSpace = SRGBColorSpace;
  const target = new WebGLRenderTarget(1, 1, { depthBuffer: false });
  target.texture.colorSpace = SRGBColorSpace;
  const jobs: Promise<unknown>[] = [];
  bake.copy.material.uniforms['uSource'].value = msaa.texture;
  try {
    // compileAsync builds the programs before it returns its promise: the targets only around the calls
    jobs.push(compileInto(renderer, msaa, bake.scene, camera));
    bake.meshes.forEach((m, k) => (m.material = bake.normal[k]));
    jobs.push(compileInto(renderer, msaa, bake.scene, camera));
    bake.meshes.forEach((m, k) => (m.material = bake.albedo[k]));
    jobs.push(compileInto(renderer, target, bake.copy.scene, bake.copy.camera));
    await Promise.all(jobs);
    await firstUseOf(renderer, [...bake.albedo, ...bake.normal, bake.copy.material]);
  } catch (error) {
    bake.dispose();
    throw error;
  } finally {
    msaa.dispose();
    target.dispose();
  }
  const imp = drawImpostor(renderer, bake);
  const probe = toneProbe(bake, imp, lights);
  try {
    // The probe's programs (both sides under its lights) built off the main thread as well
    await Promise.all([compileInto(renderer, probe.target, probe.model, probe.camera), compileInto(renderer, probe.target, probe.card, probe.camera)]);
    await firstUseOf(renderer, [...bake.lit, probe.raw]);
    probe.draw(renderer);
    await renderer.readRenderTargetPixelsAsync(probe.target, 0, 0, probe.target.width, probe.target.height, probe.pixels);
    settleLook(imp, probe.pixels);
  } finally {
    probe.dispose();
    bake.dispose();
  }
  return imp;
}

/** The probe's measure into the impostor: its tone, and the alpha test of the card and its shadow */
function settleLook(imp: Impostor, pixels: Uint8Array): void {
  const look = measureLook(pixels, PROBE, PROBE_VIEWS.length, { tone: imp.tone, alphaTest: 0.45 });
  imp.material.alphaTest = look.alphaTest;
  imp.depthMaterial.alphaTest = look.alphaTest;
}

/** The renderer's target, clear colour and auto clear, put back after a bake */
function saveState(renderer: WebGLRenderer): () => void {
  const target = renderer.getRenderTarget();
  const clear = new Color();
  renderer.getClearColor(clear);
  const alpha = renderer.getClearAlpha();
  const autoClear = renderer.autoClear;
  return () => {
    renderer.setRenderTarget(target);
    renderer.setClearColor(clear, alpha);
    renderer.autoClear = autoClear;
  };
}

/** Starts building the programs `scene` needs drawn into `target`; the renderer's own target stays */
function compileInto(renderer: WebGLRenderer, target: WebGLRenderTarget, scene: Scene, camera: OrthographicCamera): Promise<unknown> {
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  try {
    return renderer.compileAsync(scene, camera);
  } finally {
    renderer.setRenderTarget(previous);
  }
}

/** The views of `bake` with each part in `materials` into an atlas, its empty pixels bled into, mipmapped */
function drawAtlas(renderer: WebGLRenderer, bake: Bake, materials: Material[], cell: number, colorSpace: string, clear: number, bleed: boolean): WebGLRenderTarget {
  const { scene, meshes, center, radius } = bake;
  const side = cell * IMPOSTOR_FRAMES;
  meshes.forEach((m, k) => (m.material = materials[k]));
  // Drawn with 4x MSAA, then copied into a plain target: kept, the MSAA buffer held three times the texture
  const msaa = new WebGLRenderTarget(side, side, { samples: 4 });
  msaa.texture.colorSpace = colorSpace;
  const target = new WebGLRenderTarget(side, side, { depthBuffer: false });
  target.texture.colorSpace = colorSpace;
  target.texture.generateMipmaps = true;
  target.texture.minFilter = LinearMipmapLinearFilter;
  target.texture.magFilter = LinearFilter;
  renderer.setRenderTarget(msaa);
  renderer.setClearColor(clear, 0);
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
      for (const m of materials) if (m instanceof ShaderMaterial) (m.uniforms['uViewDir'].value as Vector3).copy(dir);
      msaa.viewport.set(i * cell, j * cell, cell, cell);
      msaa.scissor.set(i * cell, j * cell, cell, cell);
      renderer.setRenderTarget(msaa);
      renderer.render(scene, camera);
    }
  }
  const copy = bake.copy;
  copy.material.uniforms['uSource'].value = msaa.texture;
  copy.material.uniforms['uCell'].value = cell;
  copy.material.uniforms['uBleed'].value = bleed ? 1 : 0;
  renderer.setRenderTarget(target);
  renderer.render(copy.scene, copy.camera);
  copy.material.uniforms['uSource'].value = null;
  msaa.dispose();
  return target;
}

function drawImpostor(renderer: WebGLRenderer, bake: Bake): Impostor {
  const restore = saveState(renderer);
  // A leaf-dark clear colour with no alpha under the bleed: what it does not reach blends towards it, not towards black
  const albedo = drawAtlas(renderer, bake, bake.albedo, bake.cell, SRGBColorSpace, 0x2c3a22, true);
  // Empty pixels: facing up and as far behind the card as the bake reaches (nothing there shades anything). At half
  // the colour's size: light and the self shadow change slower over a crown than its leaves' colour, and at the
  // distance impostors stand the colour itself is read a mip level down. Copied without the bleed: its alpha is the
  // depth, not the coverage, and a bleed by it gave the crown's far half (lit leaves seen through its gaps against the
  // sun) the near half's normals: the card went dark where the model still showed light
  const normalDepth = drawAtlas(renderer, bake, bake.normal, bake.cell / 2, NoColorSpace, 0x80ff80, false);
  bake.meshes.forEach((m, k) => (m.material = bake.albedo[k]));
  restore();

  const { center, radius, bounds } = bake;
  const geometry = impostorGeometry(center, radius, bounds);
  const tone = new Color(1, 1, 1);
  const uniforms = {
    uImpCenter: { value: center.clone() },
    uImpRadius: { value: radius },
    uImpNormalDepth: { value: normalDepth.texture as Texture },
    uImpTone: { value: tone },
  };
  const material = new MeshStandardMaterial({
    map: albedo.texture,
    alphaTest: 0.45,
    alphaToCoverage: true,
    side: DoubleSide,
    roughness: bake.roughness,
    metalness: bake.metalness,
  });
  material.name = 'impostor';
  material.onBeforeCompile = (shader) => turnToCamera(shader, uniforms, true);
  material.customProgramCacheKey = () => 'impostor-octa-2';
  // Packed for the shadow map as the terrain's depth material packs it, turned to the sun
  const depthMaterial = new MeshDepthMaterial({ depthPacking: RGBADepthPacking, map: albedo.texture, alphaTest: 0.45, side: DoubleSide });
  depthMaterial.name = 'impostor-depth';
  depthMaterial.onBeforeCompile = (shader) => turnToCamera(shader, uniforms, false);
  depthMaterial.customProgramCacheKey = () => 'impostor-octa-depth-2';
  return {
    geometry,
    material,
    depthMaterial,
    texture: albedo.texture,
    normalDepth: normalDepth.texture,
    tone,
    cell: bake.cell,
    frame: {
      center: center.clone(),
      radius,
      half: Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) / 2,
      y0: bounds.min.y,
      y1: bounds.max.y,
    },
    roughness: bake.roughness,
    metalness: bake.metalness,
    dispose: () => {
      geometry.dispose();
      material.dispose();
      depthMaterial.dispose();
      albedo.dispose();
      normalDepth.dispose();
    },
  };
}

/**
 * The probe's sun towards which it lights: the map's, raised to PROBE_MIN_SUN when it stands lower (a night map's moon,
 * an evening sun at the horizon)
 */
export function probeSun(lights: ImpostorLights, out = new Vector3()): Vector3 {
  out.copy(lights.sunDir);
  out.y = Math.max(out.y, PROBE_MIN_SUN);
  return out.normalize();
}

/** The factor on all the probe's lights, the environment map's too: a white surface stays below PROBE_LIGHT */
export function probeScale(lights: ImpostorLights): number {
  const peak = (c: Color) => Math.max(c.r, c.g, c.b);
  const env = lights.environment ? (lights.environmentIntensity ?? 1) : 0;
  return PROBE_LIGHT / Math.max(peak(lights.sun) + Math.max(peak(lights.sky), peak(lights.ground)) + peak(lights.ambient) + env, 1e-3);
}

/**
 * The lights both sides of the tone probe stand under: the map's sun, sky and ambient (ImpostorLights), scaled
 * together so a white surface stays below PROBE_LIGHT (the tone is a ratio: the scale cancels, clipping would not)
 */
export function probeRig(center: Vector3, radius: number, lights: ImpostorLights): [DirectionalLight, HemisphereLight, AmbientLight] {
  const k = probeScale(lights);
  const sun = new DirectionalLight(lights.sun.clone().multiplyScalar(k), 1);
  // No shadow: impostors stand beyond the shadow map (380 m and more from the camera), where neither the model nor the
  // card shades itself. Measured with the model in its own shadow, the tone darkened every far card for a self shadow
  // it never gets there (Autumn Keep's far wood 6 % under its trees); where the map does cast, the card's own self
  // shadow (impSelfShade) stands in for the model's
  sun.position.copy(center).addScaledVector(probeSun(lights), radius * 2);
  sun.target.position.copy(center);
  return [sun, new HemisphereLight(lights.sky.clone().multiplyScalar(k), lights.ground.clone().multiplyScalar(k), 1), new AmbientLight(lights.ambient.clone().multiplyScalar(k), 1)];
}

/**
 * The model (lit as the map lights it) in the probe's first row and the
 * impostor card under the same lights in the second, from PROBE_VIEWS:
 * what measureLook compares
 */
interface ToneProbe {
  target: WebGLRenderTarget;
  /** The card's material as the probe draws it */
  raw: MeshStandardMaterial;
  model: Scene;
  card: Scene;
  camera: OrthographicCamera;
  pixels: Uint8Array;
  draw(renderer: WebGLRenderer): void;
  dispose(): void;
}

function toneProbe(bake: Bake, imp: Impostor, lights: ImpostorLights): ToneProbe {
  const views = PROBE_VIEWS.length;
  const target = new WebGLRenderTarget(PROBE * views, PROBE * 2);
  target.texture.colorSpace = NoColorSpace;
  target.scissorTest = true;
  const model = new Scene();
  const modelSun = probeRig(bake.center, bake.radius, lights);
  model.add(...modelSun, modelSun[0].target);
  for (let k = 0; k < bake.meshes.length; k++) {
    model.add(new Mesh(bake.meshes[k].geometry, bake.lit[k]));
  }
  const card = new Scene();
  const cardSun = probeRig(bake.center, bake.radius, lights);
  // Both under the map's environment map, scaled as the lights are
  for (const scene of [model, card]) {
    scene.environment = lights.environment ?? null;
    scene.environmentIntensity = (lights.environmentIntensity ?? 1) * probeScale(lights);
  }
  card.add(...cardSun, cardSun[0].target);
  // The card's blended alpha as it is (no coverage, no test, no blending): measureLook picks the test
  const raw = imp.material.clone();
  raw.onBeforeCompile = imp.material.onBeforeCompile;
  raw.customProgramCacheKey = imp.material.customProgramCacheKey;
  raw.alphaToCoverage = false;
  raw.transparent = true;
  raw.blending = NoBlending;
  raw.alphaTest = 0.004;
  card.add(new Mesh(imp.geometry, raw));
  const { center, radius } = bake;
  const camera = new OrthographicCamera(-radius, radius, radius, -radius, 0.01, radius * 4);
  camera.position.copy(center).add(new Vector3(0, 0, radius * 2));
  camera.lookAt(center);
  const draw = (renderer: WebGLRenderer): void => {
    const restore = saveState(renderer);
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = false;
    renderer.clear();
    const dir = new Vector3();
    PROBE_VIEWS.forEach(([az, el], v) => {
      const a = (az * Math.PI) / 180;
      const e = (el * Math.PI) / 180;
      dir.set(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a));
      camera.position.copy(center).addScaledVector(dir, radius * 2);
      camera.up.set(0, 1, 0);
      camera.lookAt(center);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      for (const [row, scene] of [[0, model], [1, card]] as const) {
        target.viewport.set(v * PROBE, row * PROBE, PROBE, PROBE);
        target.scissor.set(v * PROBE, row * PROBE, PROBE, PROBE);
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
      }
    });
    restore();
  };
  return { target, raw, model, card, camera, pixels: new Uint8Array(PROBE * views * PROBE * 2 * 4), draw, dispose: () => {
    target.dispose();
    raw.dispose();
  } };
}

interface CopyQuad {
  scene: Scene;
  camera: OrthographicCamera;
  material: ShaderMaterial;
  dispose(): void;
}

/**
 * A triangle over clip space copying its `uSource` as it is (no blending),
 * and the identity camera it draws with. Pixels the model does not cover
 * take the mean colour of the covered ones within BLEED texels of the same
 * view (`uCell` px), keeping their zero alpha: mipmaps of the atlas then
 * blend a crown's rim towards its own colour, not towards the clear colour
 */
function copyQuad(): CopyQuad {
  const material = new ShaderMaterial({
    name: 'impostor-bake-copy',
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    uniforms: { uSource: { value: null as Texture | null }, uCell: { value: 64 }, uBleed: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec2 vCopyUv;
      void main() {
        vCopyUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uSource;
      uniform float uCell;
      uniform float uBleed;
      varying vec2 vCopyUv;
      void main() {
        ivec2 size = textureSize(uSource, 0);
        ivec2 p = ivec2(vCopyUv * vec2(size));
        vec4 c = texelFetch(uSource, p, 0);
        if (uBleed > 0.5 && c.a < 0.5) {
          // The view's own cell only: a neighbour view's crown never bleeds in
          ivec2 lo = (p / int(uCell)) * int(uCell);
          ivec2 hi = lo + int(uCell) - 1;
          vec3 sum = vec3(0.0);
          float n = 0.0;
          for (int y = -${BLEED}; y <= ${BLEED}; y++) {
            for (int x = -${BLEED}; x <= ${BLEED}; x++) {
              vec4 q = texelFetch(uSource, clamp(p + ivec2(x, y), lo, hi), 0);
              float w = step(0.5, q.a);
              sum += q.rgb * w;
              n += w;
            }
          }
          if (n > 0.0) c.rgb = sum / n;
        }
        gl_FragColor = c;
      }`,
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  const quad = new Mesh(geometry, material);
  quad.frustumCulled = false;
  const scene = new Scene();
  scene.add(quad);
  // Clip space as it comes: an identity camera
  const camera = new OrthographicCamera(-1, 1, 1, -1, -1, 1);
  return {
    scene,
    camera,
    material,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

/**
 * How the card's GLSL reads its asset: its centre and radius (IMP_CENTER, IMP_RADIUS) in the vertex shader,
 * what it passes on (IMP_PASS, run with the card's setup), and in the fragment shader its views' colour and
 * normal-depth (IMP_MAP, IMP_ND, IMP_ND_LOD) and its tone (IMP_TONE). One asset reads them from uniforms
 * (SINGLE_IMPOSTOR); the map's draw of all impostors reads them from a layer of shared arrays
 * (impostor-array.ts)
 */
export interface ImpostorAccess {
  vertex: string;
  fragment(lit: boolean): string;
}

/** One asset's impostor: its uniforms and its own atlases */
export const SINGLE_IMPOSTOR: ImpostorAccess = {
  vertex: /* glsl */ `
uniform vec3 uImpCenter;
uniform float uImpRadius;
#define IMP_CENTER uImpCenter
#define IMP_RADIUS uImpRadius
#define IMP_PASS
`,
  fragment: (lit) => /* glsl */ `
${lit ? 'uniform sampler2D uImpNormalDepth;\nuniform vec3 uImpTone;' : ''}
#define IMP_MAP(uv) texture2D(map, uv)
#define IMP_ND(uv) texture2D(uImpNormalDepth, uv)
#define IMP_ND_LOD(uv, l) textureLod(uImpNormalDepth, uv, l)
#define IMP_TONE uImpTone
`,
};

/** The card's turn to the camera and the blend of its four nearest views, into a standard or a depth material */
export function turnToCamera(
  shader: WebGLProgramParametersWithUniforms,
  uniforms: Record<string, { value: unknown }>,
  lit: boolean,
  access: ImpostorAccess = SINGLE_IMPOSTOR,
): void {
  Object.assign(shader.uniforms, uniforms, IMPOSTOR_SUN);
  shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${access.vertex}\n${IMPOSTOR_VERTEX_PARS}`);
  shader.vertexShader = lit
    ? shader.vertexShader
        // The vertex normal follows the card (the fragment takes the baked one): towards the camera and up
        .replace('#include <beginnormal_vertex>', `${IMPOSTOR_SETUP}\n${IMPOSTOR_AXES}\nvec3 objectNormal = normalize(impDir + vec3(0.0, 0.6, 0.0));`)
        .replace('#include <begin_vertex>', IMPOSTOR_BEGIN)
        .replace('#include <shadowmap_vertex>', IMPOSTOR_SHADOW_LOOKUP)
    : shader.vertexShader.replace('#include <begin_vertex>', `${IMPOSTOR_SETUP}\n${IMPOSTOR_BEGIN}`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${access.fragment(lit)}\n${IMPOSTOR_FRAGMENT_PARS}${lit ? IMPOSTOR_LIT_PARS : ''}`)
    .replace('#include <map_fragment>', lit ? `${IMPOSTOR_MAP}\n${IMPOSTOR_SURFACE}` : IMPOSTOR_MAP);
  if (lit) {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>\n${IMPOSTOR_NORMAL}`)
      .replace('#include <lights_fragment_begin>', IMPOSTOR_LIGHTS);
  }
}

const IMPOSTOR_VERTEX_PARS = /* glsl */ `
#define IMPOSTOR_FRAMES ${IMPOSTOR_FRAMES}.0
attribute vec3 impCorner;
uniform vec3 uImpSun;
flat varying vec2 vImpFrame;
flat varying vec2 vImpBlend;
varying vec2 vImpUv;
flat varying vec3 vImpDir;
flat varying vec3 vImpAxisX;
flat varying vec3 vImpAxisY;
`;

// The direction to the camera in the model's own space (from below: the horizon's views), the card's axes
// as the views were baked (right = up x direction), and the four views around that direction
const IMPOSTOR_SETUP = /* glsl */ `
#ifdef USE_INSTANCING
mat4 impToWorld = modelMatrix * instanceMatrix;
#else
mat4 impToWorld = modelMatrix;
#endif
IMP_PASS
vec3 impDir = (inverse(impToWorld) * vec4(cameraPosition, 1.0)).xyz - IMP_CENTER;
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

// What the lit card's fragments need of the instance: the view direction in the model's frame and the
// model's x and y axes in view space (z is their cross product), for the baked normals and the self shadow
const IMPOSTOR_AXES = /* glsl */ `
vImpDir = impDir;
mat3 impToView = mat3(viewMatrix) * mat3(impToWorld);
vImpAxisX = normalize(impToView[0]);
vImpAxisY = normalize(impToView[1]);
`;

// The second card's corners (impCorner.z 0) all fall on the centre: one turned card is drawn. The include stays
// for what other hooks add after it (the detail band's fade)
const IMPOSTOR_BEGIN = /* glsl */ `
#include <begin_vertex>
transformed = IMP_CENTER + (impRight * impCorner.x + impUp * impCorner.y) * IMP_RADIUS * impCorner.z;
`;

// The card looks up its shadow a radius closer to the sun: the card the camera sees runs through the model's
// centre, and so does the one turned to the sun that casts, so half the seen card lay behind its own caster
// and showed as a dark box in the crown. Other casters' shadows still fall on it; its own come from the bake
const IMPOSTOR_SHADOW_LOOKUP = /* glsl */ `
#ifdef USE_SHADOWMAP
vec4 impWorldPosition = worldPosition;
worldPosition.xyz += uImpSun * IMP_RADIUS * length(impToWorld[0].xyz);
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

const IMPOSTOR_LIT_PARS = /* glsl */ `
// Snow settles by the baked normal (height-fog.ts), not by the card's
#define SURFACE_VIEW_NORMAL impViewNormal
uniform vec3 uImpSun;
flat varying vec3 vImpDir;
flat varying vec3 vImpAxisX;
flat varying vec3 vImpAxisY;

// A direction's view axes as the bake's lookAt had them: right = up x direction, up = direction x right
void impAxes(vec3 d, out vec3 r, out vec3 u) {
  r = cross(vec3(0.0, 1.0, 0.0), d);
  r = dot(r, r) < 1e-8 ? vec3(1.0, 0.0, 0.0) : normalize(r);
  u = cross(d, r);
}

// The model in its own shadow: the view nearest the sun holds the surface nearest the sun at each spot. Where that
// lies a little nearer the sun than this point (in radii), the crown stands between them. Only inside the shadow
// map (shadowCoord within it), where the model itself would cast onto itself
float impSelfShade(vec4 shadowCoord, vec3 p, vec3 sunInModel) {
  vec3 sc = shadowCoord.xyz / shadowCoord.w;
  if (any(lessThan(sc, vec3(0.0))) || any(greaterThan(sc, vec3(1.0)))) return 1.0;
  vec3 s = normalize(vec3(sunInModel.x, max(sunInModel.y, 0.0), sunInModel.z) + vec3(0.0, 1e-5, 0.0));
  vec2 sp = s.xz / (abs(s.x) + abs(s.y) + abs(s.z));
  vec2 frame = floor((vec2(sp.x + sp.y, sp.x - sp.y) * 0.5 + 0.5) * (IMPOSTOR_FRAMES - 1.0) + 0.5);
  // That view's own direction and axes (it was baked from there, not from the sun)
  vec2 e = frame / (IMPOSTOR_FRAMES - 1.0) * 2.0 - 1.0;
  vec2 fp = vec2(e.x + e.y, e.x - e.y) * 0.5;
  vec3 fd = normalize(vec3(fp.x, 1.0 - abs(fp.x) - abs(fp.y), fp.y));
  vec3 fr;
  vec3 fu;
  impAxes(fd, fr, fu);
  vec2 at = vec2(dot(p, fr), dot(p, fu)) * 0.5 + 0.5;
  if (any(lessThan(at, vec2(0.0))) || any(greaterThan(at, vec2(1.0)))) return 1.0;
  float front = IMP_ND_LOD((frame + clamp(at, 0.002, 0.998)) / IMPOSTOR_FRAMES, 1.0).a * 2.0 - 1.0;
  return 1.0 - smoothstep(0.04, 0.22, front - dot(p, fd)) * ${SELF_SHADOW.toFixed(2)};
}
`;

// The four views at the card's point, each weighted by how near its direction is
const IMPOSTOR_MAP = /* glsl */ `
vec2 impUv = clamp(vImpUv, 0.002, 0.998);
vec2 impTa = (vImpFrame + impUv) / IMPOSTOR_FRAMES;
vec2 impTb = (vImpFrame + vec2(1.0, 0.0) + impUv) / IMPOSTOR_FRAMES;
vec2 impTc = (vImpFrame + vec2(0.0, 1.0) + impUv) / IMPOSTOR_FRAMES;
vec2 impTd = (vImpFrame + vec2(1.0, 1.0) + impUv) / IMPOSTOR_FRAMES;
vec4 impA = IMP_MAP(impTa);
vec4 impB = IMP_MAP(impTb);
vec4 impC = IMP_MAP(impTc);
vec4 impD = IMP_MAP(impTd);
diffuseColor *= mix(mix(impA, impB, vImpBlend.x), mix(impC, impD, vImpBlend.x), vImpBlend.y);
`;

// The lit card's surface from the normal and depth atlas, blended as the colours are; the tone the bake measured
const IMPOSTOR_SURFACE = /* glsl */ `
diffuseColor.rgb *= IMP_TONE;
vec4 impNd = mix(
  mix(IMP_ND(impTa), IMP_ND(impTb), vImpBlend.x),
  mix(IMP_ND(impTc), IMP_ND(impTd), vImpBlend.x),
  vImpBlend.y
);
vec3 impObjNormal = normalize(impNd.rgb * 2.0 - 1.0 + vec3(0.0, 1e-4, 0.0));
mat3 impToView = mat3(vImpAxisX, vImpAxisY, cross(vImpAxisX, vImpAxisY));
vec3 impViewNormal = normalize(impToView * impObjNormal);
// The point of the model this fragment shows, in radii from its centre (model frame)
vec3 impCardRight;
vec3 impCardUp;
impAxes(vImpDir, impCardRight, impCardUp);
vec3 impPoint = impCardRight * (vImpUv.x * 2.0 - 1.0) + impCardUp * (vImpUv.y * 2.0 - 1.0) + vImpDir * (impNd.a * 2.0 - 1.0);
vec3 impSunInModel = transpose(impToView) * (mat3(viewMatrix) * uImpSun);
`;

// The baked normal, turned with the instance into view space
const IMPOSTOR_NORMAL = /* glsl */ `
normal = impViewNormal;
`;

// three's light loop with the self shadow applied to the sun's shadowed light, after its shadow map
const IMPOSTOR_LIGHTS = ShaderChunk.lights_fragment_begin.replace(
  /(vDirectionalShadowCoord\[ i \] \) : 1\.0;)/,
  '$1\n\t\tdirectLight.color *= impSelfShade( vDirectionalShadowCoord[ i ], impPoint, impSunInModel );',
);

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
