import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  FloatType,
  Group,
  InstancedMesh,
  MeshDepthMaterial,
  MeshStandardMaterial,
  NearestFilter,
  RGBADepthPacking,
  RGBAFormat,
  Sphere,
  Vector3,
} from 'three';
import type { CatalogObject, StageTone } from '../asset-catalog';
import { linePiece } from '../asset-catalog';
import { addHeightFog } from '../environment/height-fog';
import { addLodFade, fadeGeometry } from './lod-fade';
import { InstanceList, type InstanceSource } from './instance-list';
import type { SharedDraws } from './shared-draws';

/**
 * The far stage of the pieces of walls, fences, hedges and tracks (E304 (d),
 * docs/RENDER_DENSITY_PLAN.md): each piece a box of six triangles, its top
 * and both long sides, every asset's in one instanced draw (one for those
 * that block sight, one for the rest). The pieces of a line overlap a
 * little, so far off their boxes read as one band along the line, a wall's
 * 156 triangles or a track's 116 down to 6. A destroyed piece leaves its
 * gap: the band is its pieces. The box is the catalogue's ground rectangle
 * (`box`) up to the model's height, coloured top and sides apart with what
 * the full model shows from above and from its sides (catalogue `band`,
 * measured at pack time by tools/map-assets/measure_bands.mjs), times the
 * tone of the stage before it where that is a LOD model (matched to the full
 * model in the game's light, flat like the band). A side that covers only a
 * share of its rectangle (a chain-link fence's wire, a rail fence) keeps that
 * share of its pixels in the LOD fade's dither, in the shadow too. All from
 * an asset's row of a small data texture, in the vertex shader of the
 * material and of the sun's shadow alike. The line-of-sight cube draws the
 * pieces' full models (object-layer.ts LosDraw), never these.
 */

/** A piece goes over to its band where its bounding radius is this share of the view's half height: 3 px of 1080 lines */
export const BAND_SCREEN = 3 / 540;
/** Triangles of a piece's band */
export const BAND_TRIANGLES = 6;
/** Texels per asset row: box, heights and cover, top colour, side colour */
const ROW_TEXELS = 4;

/** Whether an asset's pieces end in a band: a wall or structure (linePiece) with a ground rectangle and measured band colours */
export function hasBand(entry: Pick<CatalogObject, 'category' | 'box' | 'band'>): boolean {
  return linePiece(entry.category) && !!entry.box && !!entry.band;
}

/**
 * An asset's band in numbers (line-bands' row, the HLOD tiles' bake): its
 * box (middle x, z, half width, half depth), height and side cover, its top
 * and side colours times `tone`
 */
export function bandParams(entry: Pick<CatalogObject, 'box' | 'band'>, height: number, tone?: StageTone): number[] {
  const [cx, cz, hw, hd] = entry.box!;
  const { top, side, cover = 1 } = entry.band!;
  const t = tone ?? [1, 1, 1];
  return [cx, cz, hw, hd, height, cover, top[0] * t[0], top[1] * t[1], top[2] * t[2], side[0] * t[0], side[1] * t[1], side[2] * t[2]];
}

/** GLSL of the band: where a template vertex lies for its asset's row, and its colour */
const BAND_GLSL = /* glsl */ `
attribute float aBandRow;
attribute float aBandSide;
uniform highp sampler2D uBandParams;
varying float vBandCover;
vec4 bandParam(int k) {
  return texelFetch(uBandParams, ivec2(k, int(aBandRow + 0.5)), 0);
}
// p: across the box (-1 .. 1 along model x), up (0 foot, 1 top), along (-1 .. 1 along model z)
vec3 bandLocal(vec3 p) {
  vec4 box = bandParam(0);
  vec4 h = bandParam(1);
  return vec3(box.x + p.x * box.z, mix(h.x, h.y, p.y), box.y + p.z * box.w);
}
`;

/** Drops the share of a band's pixels its side does not cover, in the LOD fade's dither (lod-fade.ts) */
export const BAND_COVER_GLSL = /* glsl */ `
if (vBandCover < 1.0 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) >= vBandCover) discard;
`;

/** The template: the top and the two sides along model x (z = -1 and +1); aBandSide 0 on the top, 1 on the sides */
function bandTemplate(): BufferGeometry {
  // prettier-ignore
  const pos = [
    -1, 1, -1, 1, 1, -1, 1, 1, 1, -1, 1, 1,
    -1, 0, -1, 1, 0, -1, 1, 1, -1, -1, 1, -1,
    -1, 0, 1, 1, 0, 1, 1, 1, 1, -1, 1, 1,
  ];
  const side = [0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1];
  // Faces outward: the top up, the -z side towards -z, the +z side towards +z
  const index = [0, 2, 1, 0, 3, 2, 4, 6, 5, 4, 7, 6, 8, 9, 10, 8, 10, 11];
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aBandSide', new BufferAttribute(new Float32Array(side), 1));
  g.setIndex(index);
  // Instances lie anywhere: the mesh is culled by the bounds of its pieces, never by the template's
  g.boundingSphere = new Sphere(new Vector3(), 1e6);
  return g;
}

/** One draw of bands: its instances and its mesh */
interface BandDraw {
  list: InstanceList;
  mesh: InstancedMesh;
}

/** The keys of the bands' two draws: those that block sight, the rest */
export const BAND_BLOCKING = 'blocking';
export const BAND_OPEN = 'open';

export class LineBands implements SharedDraws {
  private params: DataTexture;
  private readonly rows = new Map<string, number>();
  private readonly template = bandTemplate();
  private readonly material: MeshStandardMaterial;
  private readonly depthMaterial: MeshDepthMaterial;
  private readonly uniforms: { uBandParams: { value: DataTexture } };
  private readonly draws = new Map<string, BandDraw>();
  private readonly boundsOf = new Map<string, Sphere>();

  constructor(private readonly groups: { blocking: Group; open: Group }) {
    this.params = new DataTexture(new Float32Array(ROW_TEXELS * 4 * 16), ROW_TEXELS, 16, RGBAFormat, FloatType);
    this.params.magFilter = this.params.minFilter = NearestFilter;
    this.params.needsUpdate = true;
    this.uniforms = { uBandParams: { value: this.params } };

    const m = new MeshStandardMaterial({ flatShading: true, roughness: 0.9, metalness: 0 });
    m.name = 'line-band';
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${BAND_GLSL}\nvarying vec3 vBandColour;`)
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `vec3 transformed = bandLocal(position);
          vBandColour = aBandSide < 0.5 ? bandParam(2).rgb : bandParam(3).rgb;
          vBandCover = bandParam(1).z;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vBandColour;\nvarying float vBandCover;')
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${BAND_COVER_GLSL}`)
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vBandColour;');
    };
    m.customProgramCacheKey = () => 'custom-map-line-band';
    addLodFade(m);
    addHeightFog(m);
    this.material = m;

    const d = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
    d.name = 'line-band-depth';
    d.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${BAND_GLSL}`)
        .replace('#include <begin_vertex>', 'vec3 transformed = bandLocal(position);\nvBandCover = bandParam(1).z;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vBandCover;')
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${BAND_COVER_GLSL}`);
    };
    d.customProgramCacheKey = () => 'custom-map-line-band-depth';
    this.depthMaterial = d;
  }

  bounds(key: string): Sphere {
    let b = this.boundsOf.get(key);
    if (!b) this.boundsOf.set(key, (b = new Sphere()));
    return b;
  }

  /** The asset's row (its box, heights, cover and colours written on first use, times `tone`); null for one hasBand does not take */
  row(entry: CatalogObject, height: number, tone?: StageTone): number | null {
    const known = this.rows.get(entry.id);
    if (known !== undefined) return known;
    if (!hasBand(entry)) return null;
    const r = this.rows.size;
    this.rows.set(entry.id, r);
    if (r >= this.params.image.height) {
      const grown = new DataTexture(new Float32Array(ROW_TEXELS * 4 * this.params.image.height * 2), ROW_TEXELS, this.params.image.height * 2, RGBAFormat, FloatType);
      (grown.image.data as Float32Array).set(this.params.image.data as Float32Array);
      grown.magFilter = grown.minFilter = NearestFilter;
      this.params.dispose();
      this.params = grown;
      this.uniforms.uBandParams.value = grown;
    }
    const [cx, cz, hw, hd, h, cover, tr, tg, tb, sr, sg, sb] = bandParams(entry, height, tone);
    (this.params.image.data as Float32Array).set([cx, cz, hw, hd, 0, h, cover, 0, tr, tg, tb, 0, sr, sg, sb, 0], r * ROW_TEXELS * 4);
    this.params.needsUpdate = true;
    return r;
  }

  /** The list of the bands that block sight or not, with room for at least `capacity`; a new one when it had less */
  list(key: string, capacity: number): { list: InstanceList; renewed: boolean } {
    const blocks = key === BAND_BLOCKING;
    const old = this.draws.get(key);
    if (old && old.list.capacity >= capacity) return { list: old.list, renewed: false };
    if (old) this.disposeDraw(old);
    const list = new InstanceList(Math.max(capacity, old ? old.list.capacity * 2 : 256), true, [1]);
    const geometry = fadeGeometry(this.template, list.fades);
    geometry.setAttribute('aBandRow', list.extras[0]);
    const mesh = new InstancedMesh(geometry, this.material, 0);
    mesh.instanceMatrix = list.matrices;
    mesh.instanceColor = list.colors;
    mesh.customDepthMaterial = this.depthMaterial;
    mesh.boundingSphere = this.bounds(key);
    mesh.name = blocks ? 'line-bands' : 'line-bands-decor';
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = true;
    mesh.visible = false;
    mesh.userData['objectsKind'] = 'line-band';
    // A far stand-in the camera chose: the LOS cube draws the pieces' full models (object-layer.ts LosDraw)
    mesh.userData['losTransparent'] = true;
    let drawn = 0;
    mesh.onBeforeShadow = () => {
      drawn = mesh.count;
      mesh.count = Math.min(drawn, list.casters);
    };
    mesh.onAfterShadow = () => {
      mesh.count = drawn;
    };
    (blocks ? this.groups.blocking : this.groups.open).add(mesh);
    this.draws.set(key, { list, mesh });
    return { list, renewed: true };
  }

  /** Uploads what the lists changed and draws what they hold (or, `warmUp`, one band each for a render that compiles them) */
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

  /** While `on` the bands near the focus alone (MapObjectLayer.nearOnly) */
  nearOnly(on: boolean): void {
    for (const d of this.draws.values()) d.mesh.count = on ? Math.min(d.list.count, d.list.casters) : d.list.count;
  }

  /** The meshes of the bands that block no sight (a water reflection leaves them out) */
  openMeshes(): InstancedMesh[] {
    const open = this.draws.get(BAND_OPEN);
    return open ? [open.mesh] : [];
  }

  dispose(): void {
    for (const d of this.draws.values()) this.disposeDraw(d);
    this.draws.clear();
    this.template.dispose();
    this.material.dispose();
    this.depthMaterial.dispose();
    this.params.dispose();
  }

  private disposeDraw(d: BandDraw): void {
    d.mesh.removeFromParent();
    d.mesh.dispose();
    // The template's buffers stay for the next list; the fades and rows of this one go with it
    const g = d.mesh.geometry;
    g.deleteAttribute('position');
    g.deleteAttribute('aBandSide');
    g.setIndex(null);
    g.dispose();
  }
}

/** What a warm-up render draws of an empty list: a band of row 0 at the origin */
const PLACEHOLDER: InstanceSource = {
  matrices: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
  colors: null,
  extras: [[0]],
};
