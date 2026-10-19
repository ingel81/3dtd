import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  DoubleSide,
  FloatType,
  Group,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshDepthMaterial,
  MeshStandardMaterial,
  NearestFilter,
  NoBlending,
  NoColorSpace,
  OrthographicCamera,
  PlaneGeometry,
  RGBADepthPacking,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Sphere,
  SRGBColorSpace,
  Vector3,
  WebGLArrayRenderTarget,
  type Texture,
  type WebGLRenderer,
} from 'three';
import type { LosVertexPatch } from '../../../../three-engine/tower-shadow-mapper';
import { addHeightFog } from '../environment/height-fog';
import { IMPOSTOR_FRAMES, turnToCamera, type Impostor, type ImpostorAccess } from './impostor';
import { InstanceList, type InstanceSource } from './instance-list';
import { addLodFade, fadeGeometry } from './lod-fade';
import type { SharedDraws } from './shared-draws';

/**
 * Every impostor of a map's view in a few draws: the baked views of all
 * trees and big rocks with views of one size (impostor.ts impostorCell)
 * are layers of one texture array, colour and normal-depth, and an
 * instance names its layer. Per layer a row of a small data texture holds
 * what the card needs of its asset (centre, radius, tone, alpha test,
 * surface, the crossed cards' size), so the card's GLSL (impostor.ts)
 * reads it from there instead of an asset's uniforms (IMPOSTOR_ARRAY).
 * One draw per view size and sight flag, where each asset drew its own.
 *
 * ImpostorArrays belongs to the view (shared by its object layers, like the
 * bakes: impostor-cache.ts); each layer draws through its own
 * ImpostorDraws. The layers' atlases are copied in once baked and freed;
 * a full array grows by copying its layers into a bigger one.
 */

/** Texels per row of the parameter texture: centre and radius, tone and alpha test, card size and roughness, metalness */
const PARAM_TEXELS = 4;

/** The card's GLSL reading its asset from a layer of the arrays and its row of the parameters */
export const IMPOSTOR_ARRAY: ImpostorAccess = {
  vertex: /* glsl */ `
attribute float aImpLayer;
uniform highp sampler2D uImpParams;
flat varying float vImpLayer;
flat varying vec3 vImpTone;
flat varying float vImpAlphaTest;
flat varying vec2 vImpSurface;
vec4 impParam(int k) {
  return texelFetch(uImpParams, ivec2(k, int(aImpLayer + 0.5)), 0);
}
#define IMP_CENTER impParam(0).xyz
#define IMP_RADIUS impParam(0).w
#define IMP_PASS vImpLayer = aImpLayer; vImpTone = impParam(1).rgb; vImpAlphaTest = impParam(1).a; vImpSurface = vec2(impParam(2).w, impParam(3).x);
`,
  fragment: (lit) => /* glsl */ `
uniform highp sampler2DArray uImpColor;
${lit ? 'uniform highp sampler2DArray uImpNd;' : ''}
flat varying float vImpLayer;
flat varying vec3 vImpTone;
flat varying float vImpAlphaTest;
flat varying vec2 vImpSurface;
#define IMP_MAP(uv) texture(uImpColor, vec3(uv, vImpLayer))
#define IMP_ND(uv) texture(uImpNd, vec3(uv, vImpLayer))
#define IMP_ND_LOD(uv, l) textureLod(uImpNd, vec3(uv, vImpLayer), l)
#define IMP_TONE vImpTone
`,
};

/** The crossed upright cards in unit form (x, z across, y from bottom 0 to top 1), as impostor.ts lays them out per asset */
function cardTemplate(): BufferGeometry {
  const pos = [
    [-1, 0, 0], [1, 0, 0], [1, 1, 0], [-1, 1, 0],
    [0, 0, 1], [0, 0, -1], [0, 1, -1], [0, 1, 1],
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
  // Instances lie anywhere: a mesh is culled by the bounds of its objects, never by the template's
  g.boundingSphere = new Sphere(new Vector3(), 1e6);
  return g;
}

/** What the LOS cube draws of a card: the crossed cards of its asset's size (as impostor.ts's geometry has them) */
const LOS_CARDS = /* glsl */ `
attribute float aImpLayer;
uniform highp sampler2D uImpParams;
vec4 impParam(int k) {
  return texelFetch(uImpParams, ivec2(k, int(aImpLayer + 0.5)), 0);
}
`;

/** One size of views: its arrays, parameters, materials */
export interface ImpostorSet {
  cell: number;
  color: WebGLArrayRenderTarget;
  normalDepth: WebGLArrayRenderTarget;
  params: DataTexture;
  layers: number;
  material: MeshStandardMaterial;
  depthMaterial: MeshDepthMaterial;
  losVertex: LosVertexPatch;
  uniforms: { uImpColor: { value: Texture }; uImpNd: { value: Texture }; uImpParams: { value: DataTexture } };
}

/** An asset's place in the arrays */
export interface ImpostorSlot {
  set: ImpostorSet;
  layer: number;
}

export class ImpostorArrays {
  private readonly sets = new Map<number, ImpostorSet>();
  private readonly copy2d: ShaderMaterial;
  private readonly copyArray: ShaderMaterial;
  private readonly quad: Mesh;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor(private readonly renderer: WebGLRenderer) {
    const vertexShader = /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }`;
    this.copy2d = new ShaderMaterial({
      uniforms: { uSource: { value: null as Texture | null } },
      vertexShader,
      fragmentShader: /* glsl */ `
        uniform sampler2D uSource;
        varying vec2 vUv;
        void main() {
          gl_FragColor = texture2D(uSource, vUv);
        }`,
      blending: NoBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.copyArray = new ShaderMaterial({
      uniforms: { uSource: { value: null as Texture | null }, uLayer: { value: 0 } },
      vertexShader,
      fragmentShader: /* glsl */ `
        precision highp sampler2DArray;
        uniform sampler2DArray uSource;
        uniform int uLayer;
        varying vec2 vUv;
        void main() {
          gl_FragColor = texture(uSource, vec3(vUv, float(uLayer)));
        }`,
      blending: NoBlending,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.copy2d);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /** A fresh impostor into a layer of the arrays of its view size; its own atlases are no longer needed */
  add(imp: Impostor): ImpostorSlot {
    let set = this.sets.get(imp.cell);
    if (!set) this.sets.set(imp.cell, (set = this.createSet(imp.cell, 8)));
    if (set.layers >= set.color.depth) this.grow(set, set.color.depth * 2);
    const layer = set.layers++;
    this.copyInto(imp.texture, set.color, layer);
    this.copyInto(imp.normalDepth, set.normalDepth, layer);
    const data = set.params.image.data as Float32Array;
    const f = imp.frame;
    data.set(
      [f.center.x, f.center.y, f.center.z, f.radius, imp.tone.r, imp.tone.g, imp.tone.b, imp.material.alphaTest, f.half, f.y0, f.y1, imp.roughness, imp.metalness, 0, 0, 0],
      layer * PARAM_TEXELS * 4,
    );
    set.params.needsUpdate = true;
    return { set, layer };
  }

  dispose(): void {
    for (const set of this.sets.values()) {
      set.color.dispose();
      set.normalDepth.dispose();
      set.params.dispose();
      set.material.dispose();
      set.depthMaterial.dispose();
    }
    this.sets.clear();
    this.copy2d.dispose();
    this.copyArray.dispose();
    this.quad.geometry.dispose();
  }

  private createSet(cell: number, layers: number): ImpostorSet {
    const color = arrayTarget(cell * IMPOSTOR_FRAMES, layers, SRGBColorSpace);
    const normalDepth = arrayTarget((cell / 2) * IMPOSTOR_FRAMES, layers, NoColorSpace);
    const params = paramTexture(layers);
    const uniforms = { uImpColor: { value: color.texture as Texture }, uImpNd: { value: normalDepth.texture as Texture }, uImpParams: { value: params } };
    const material = new MeshStandardMaterial({ alphaTest: 0.45, alphaToCoverage: true, side: DoubleSide });
    material.name = 'impostor-array';
    material.onBeforeCompile = (shader) => {
      turnToCamera(shader, uniforms, true, IMPOSTOR_ARRAY);
      shader.fragmentShader = perInstanceSurface(shader.fragmentShader);
    };
    material.customProgramCacheKey = () => 'impostor-array';
    addLodFade(material);
    addHeightFog(material);
    const depthMaterial = new MeshDepthMaterial({ depthPacking: RGBADepthPacking, alphaTest: 0.45, side: DoubleSide });
    depthMaterial.name = 'impostor-array-depth';
    depthMaterial.onBeforeCompile = (shader) => {
      turnToCamera(shader, uniforms, false, IMPOSTOR_ARRAY);
      shader.fragmentShader = perInstanceAlphaTest(shader.fragmentShader);
    };
    depthMaterial.customProgramCacheKey = () => 'impostor-array-depth';
    const losVertex: LosVertexPatch = {
      key: 'custom-map-impostor-array',
      pars: LOS_CARDS,
      vertex: 'localPos.xyz = vec3(impParam(0).x + localPos.x * impParam(2).x, mix(impParam(2).y, impParam(2).z, localPos.y), impParam(0).z + localPos.z * impParam(2).x);',
      uniforms: { uImpParams: uniforms.uImpParams },
    };
    return { cell, color, normalDepth, params, layers: 0, material, depthMaterial, losVertex, uniforms };
  }

  /** The arrays with room for `layers`, the layers so far copied over */
  private grow(set: ImpostorSet, layers: number): void {
    const color = arrayTarget(set.color.width, layers, SRGBColorSpace);
    const normalDepth = arrayTarget(set.normalDepth.width, layers, NoColorSpace);
    for (let l = 0; l < set.layers; l++) {
      this.copyLayer(set.color, color, l);
      this.copyLayer(set.normalDepth, normalDepth, l);
    }
    const params = paramTexture(layers);
    (params.image.data as Float32Array).set(set.params.image.data as Float32Array);
    params.needsUpdate = true;
    set.color.dispose();
    set.normalDepth.dispose();
    set.params.dispose();
    set.color = color;
    set.normalDepth = normalDepth;
    set.params = params;
    set.uniforms.uImpColor.value = color.texture;
    set.uniforms.uImpNd.value = normalDepth.texture;
    set.uniforms.uImpParams.value = params;
  }

  private copyInto(source: Texture, target: WebGLArrayRenderTarget, layer: number): void {
    this.copy2d.uniforms['uSource'].value = source;
    this.quad.material = this.copy2d;
    this.draw(target, layer);
    this.copy2d.uniforms['uSource'].value = null;
  }

  private copyLayer(source: WebGLArrayRenderTarget, target: WebGLArrayRenderTarget, layer: number): void {
    this.copyArray.uniforms['uSource'].value = source.texture;
    this.copyArray.uniforms['uLayer'].value = layer;
    this.quad.material = this.copyArray;
    this.draw(target, layer);
    this.copyArray.uniforms['uSource'].value = null;
  }

  private draw(target: WebGLArrayRenderTarget, layer: number): void {
    const r = this.renderer;
    const previous = r.getRenderTarget();
    const autoClear = r.autoClear;
    r.autoClear = false;
    try {
      r.setRenderTarget(target, layer);
      r.render(this.scene, this.camera);
    } finally {
      r.setRenderTarget(previous);
      r.autoClear = autoClear;
    }
  }
}

function arrayTarget(size: number, layers: number, colorSpace: string): WebGLArrayRenderTarget {
  const t = new WebGLArrayRenderTarget(size, size, layers, { depthBuffer: false, generateMipmaps: true, minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter });
  t.texture.colorSpace = colorSpace;
  return t;
}

function paramTexture(layers: number): DataTexture {
  const t = new DataTexture(new Float32Array(PARAM_TEXELS * 4 * layers), PARAM_TEXELS, layers, RGBAFormat, FloatType);
  t.magFilter = t.minFilter = NearestFilter;
  t.needsUpdate = true;
  return t;
}

/** The card's alpha test of its own asset (the bake measures one per asset) in place of the material's */
function perInstanceAlphaTest(fragment: string): string {
  return fragment.replace('#include <alphatest_fragment>', '#define alphaTest vImpAlphaTest\n#include <alphatest_fragment>');
}

/** The alpha test, roughness and metalness of the card's own asset */
function perInstanceSurface(fragment: string): string {
  return perInstanceAlphaTest(fragment)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vImpSurface.x;')
    .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vImpSurface.y;');
}

/** One view size's draw for one sight flag: its instances and its mesh */
interface CardDraw {
  list: InstanceList;
  mesh: InstancedMesh;
  set: ImpostorSet;
}

/**
 * An object layer's draws of the impostors: per view size and sight flag
 * (key `<cell>|blocking` or `<cell>|open`) one list and one mesh through
 * the view's arrays
 */
export class ImpostorDraws implements SharedDraws {
  private readonly draws = new Map<string, CardDraw>();
  private readonly boundsOf = new Map<string, Sphere>();
  private readonly template = cardTemplate();
  private readonly sets = new Map<string, ImpostorSet>();

  constructor(private readonly groups: { blocking: Group; open: Group }) {}

  /** The key of an asset's draw */
  static key(slot: ImpostorSlot, blocks: boolean): string {
    return `${slot.set.cell}|${blocks ? 'blocking' : 'open'}`;
  }

  /** The set of a key, made known before its first list (the layer registers each asset's slot) */
  register(key: string, set: ImpostorSet): void {
    this.sets.set(key, set);
  }

  list(key: string, capacity: number): { list: InstanceList; renewed: boolean } {
    const old = this.draws.get(key);
    if (old && old.list.capacity >= capacity) return { list: old.list, renewed: false };
    const set = this.sets.get(key)!;
    if (old) this.disposeDraw(old);
    const blocks = key.endsWith('|blocking');
    // Vegetation has instance colours; the layer's index per card
    const list = new InstanceList(Math.max(capacity, old ? old.list.capacity * 2 : 256), true, [1]);
    const geometry = fadeGeometry(this.template, list.fades);
    geometry.setAttribute('aImpLayer', list.extras[0]);
    const mesh = new InstancedMesh(geometry, set.material, 0);
    mesh.instanceMatrix = list.matrices;
    mesh.instanceColor = list.colors;
    mesh.customDepthMaterial = set.depthMaterial;
    mesh.boundingSphere = this.bounds(key);
    mesh.name = `impostors-${key.replace('|', '-')}`;
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = true;
    mesh.visible = false;
    mesh.userData['losVertex'] = set.losVertex;
    mesh.userData['objectsKind'] = 'impostor';
    if (!blocks) mesh.userData['losTransparent'] = true;
    let drawn = 0;
    mesh.onBeforeShadow = () => {
      drawn = mesh.count;
      mesh.count = Math.min(drawn, list.casters);
    };
    mesh.onAfterShadow = () => {
      mesh.count = drawn;
    };
    (blocks ? this.groups.blocking : this.groups.open).add(mesh);
    this.draws.set(key, { list, mesh, set });
    return { list, renewed: true };
  }

  bounds(key: string): Sphere {
    let b = this.boundsOf.get(key);
    if (!b) this.boundsOf.set(key, (b = new Sphere()));
    return b;
  }

  sync(warmUp = false): void {
    for (const d of this.draws.values()) {
      if (warmUp && d.list.count === 0) d.list.placeholder(PLACEHOLDER, 0);
      d.list.flush();
      d.mesh.count = warmUp ? Math.max(1, d.list.count) : d.list.count;
      d.mesh.visible = d.mesh.count > 0;
      d.mesh.castShadow = warmUp || d.list.casters > 0;
      d.mesh.frustumCulled = !warmUp;
    }
  }

  nearOnly(on: boolean): void {
    for (const d of this.draws.values()) d.mesh.count = on ? Math.min(d.list.count, d.list.casters) : d.list.count;
  }

  openMeshes(): InstancedMesh[] {
    return [...this.draws.entries()].filter(([k]) => k.endsWith('|open')).map(([, d]) => d.mesh);
  }

  dispose(): void {
    for (const d of this.draws.values()) this.disposeDraw(d);
    this.draws.clear();
    this.template.dispose();
  }

  private disposeDraw(d: CardDraw): void {
    d.mesh.removeFromParent();
    d.mesh.dispose();
    // The template's buffers stay for the next list; the fades and layers of this one go with it
    const g = d.mesh.geometry;
    for (const name of ['position', 'impCorner', 'uv', 'normal']) g.deleteAttribute(name);
    g.setIndex(null);
    g.dispose();
  }
}

/** What a warm-up render draws of an empty list: a card of layer 0 at the origin */
const PLACEHOLDER: InstanceSource = {
  matrices: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
  colors: null,
  extras: [[0]],
};
