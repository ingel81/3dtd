import { Box3, BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshStandardMaterial, SRGBColorSpace, Sphere, Vector3, Vector4, type Texture } from 'three';
import type { MapPaths } from '../../map-document';
import type { RoadCover } from './path-mask';
import type { MapAssetLibrary } from '../map-asset-library';
import { loadMaterialArrays, type MaterialArrays } from '../terrain/terrain-textures';
import { addHeightFog } from '../environment/height-fog';
import type { HeightField } from '../height-field';
import { SHADER_NOISE } from '../shader-noise';
import { TERRAIN_HEIGHT_GLSL, type HeightTexture } from '../terrain/height-texture';
import { RoadNetworkBuilder, ROAD_TILE, type RoadTile } from './road-network';
import { MAX_ROAD_SURFACES } from './road-style';

/**
 * The paved roads drawn as a surface over the ground (road-network.ts): crisp
 * straight edges, the material running along each road, and the look of its
 * class (road-style.ts): lane and edge lines, a dashed centre line, a town
 * street's kerb and gutter of setts, and asphalt that wears down the classes,
 * patched, cracked and sealed along its seams, darker where the wheels run.
 * The surfaces' textures are the ground materials of the catalogue, one
 * array of the few the roads use; markings and wear are drawn by the shader
 * from the road's coordinates.
 *
 * One material for all roads, a mesh per tile (ROAD_TILE): a few draw calls,
 * none per road. The vertices take their height from the terrain's height
 * texture, so a brush moves the road with the ground without a rebuild, and
 * are drawn a little towards the camera (more with distance) instead of
 * lifted: the surface never fights the ground it lies on and does not float
 * over it seen from the side. The ground under a road keeps its paint (an
 * OSM world's: the road's material, a verge beyond), for where coarse far
 * terrain rises over the surface and so no grass grows through it.
 */

/**
 * Metres a road is drawn towards the camera, and per metre of distance past
 * PULL_FROM: up close the terrain is drawn at full detail and the surface
 * lies on it within a centimetre or two (a model standing on the road loses
 * no more than that of its foot); farther out the terrain is coarser, rises
 * over the road by up to metres, and the pull grows with it
 */
const PULL = 0.03;
const PULL_FROM = 200;
const PULL_PER_METRE = 0.004;
/** Metres more per rank, and per metre of distance, where two roads overlap without meeting */
const RANK_PULL = 0.004;
const RANK_PULL_PER_METRE = 0.00004;

export class RoadSurfaceLayer {
  readonly group = new Group();
  readonly material: RoadSurfaceMaterial;
  /** The meshes by tile key */
  private readonly tiles = new Map<string, { mesh: Mesh; tile: RoadTile }>();
  /** The surfaces the roads use, in the order their looks name them (new ones join at the end) */
  private surfaces: string[] = [];
  private assets: { library: MapAssetLibrary; anisotropy: number } | null = null;
  /** The surfaces the textures hold, in layer order, and the arrays */
  private loaded: { ids: string[]; arrays: MaterialArrays } | null = null;
  private generation = 0;
  /** What the last load asked for */
  private requested: { library: MapAssetLibrary; anisotropy: number; ids: string } | null = null;
  /** The network as laid, kept between changes (it lays again only what a change reaches) */
  private network = new RoadNetworkBuilder();

  constructor(
    private readonly field: HeightField,
    heights: HeightTexture,
    gridNormals: Texture,
  ) {
    this.group.name = 'custom-map-roads';
    this.group.userData['losTransparent'] = true;
    this.material = new RoadSurfaceMaterial(heights, gridNormals, field);
  }

  /** Where the surfaces' textures come from; loads those the roads use (nothing when they are in or on the way) */
  setAssets(library: MapAssetLibrary, anisotropy: number): void {
    this.assets = { library, anisotropy };
    void this.loadTextures();
  }

  /**
   * The roads of `paths`: after the first build only the tiles a change
   * reaches are built again (RoadNetworkBuilder): a node dragged in the
   * editor lays the ribbons through it and its junctions, not the map
   */
  set(paths: MapPaths): void {
    const net = this.network.update(paths);
    for (const tile of net.tiles) {
      if (tile.index.length) this.add(tile);
      else this.remove(tile.key);
    }
    this.group.visible = this.tiles.size > 0;
    // The surfaces only ever grow at the end (RoadNetworkBuilder): the layers loaded keep their place, a new one
    // draws its mean colour (layer >= uRoadLayers) until the textures with it are in
    this.surfaces = net.surfaces;
    void this.loadTextures();
  }

  /** Where the surface hides the ground, as laid now (the path mask's covers) */
  covers(): RoadCover[] {
    return this.network.covers();
  }

  /** Heights changed inside a map rectangle (all when omitted): the tiles there fit their bounds again */
  refreshBounds(rect?: { minX: number; minY: number; maxX: number; maxY: number }): void {
    for (const { mesh, tile } of this.tiles.values()) {
      if (rect && (tile.x > rect.maxX || tile.y > rect.maxY || tile.x + ROAD_TILE < rect.minX || tile.y + ROAD_TILE < rect.minY)) continue;
      this.fitBounds(mesh, tile);
    }
  }

  dispose(): void {
    this.generation++;
    this.clear();
    this.loaded?.arrays.dispose();
    this.loaded = null;
    this.requested = null;
    this.material.dispose();
  }

  private add(tile: RoadTile): void {
    this.remove(tile.key);
    const g = new BufferGeometry();
    // Scene space (x = -map x, z = map y); the height comes from the terrain in the shader
    const pos = new Float32Array((tile.position.length / 2) * 3);
    for (let k = 0; k < tile.position.length / 2; k++) {
      pos[k * 3] = -tile.position[k * 2];
      pos[k * 3 + 2] = tile.position[k * 2 + 1];
    }
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('aRoad', new BufferAttribute(tile.road, 4));
    g.setAttribute('aDir', new BufferAttribute(tile.dir, 2));
    g.setAttribute('aArm', new BufferAttribute(tile.arm, 4));
    g.setIndex(new BufferAttribute(tile.index, 1));
    const mesh = new Mesh(g, this.material);
    mesh.name = `custom-map-roads-${tile.key}`;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    this.fitBounds(mesh, tile);
    this.tiles.set(tile.key, { mesh, tile });
    this.group.add(mesh);
  }

  private remove(key: string): void {
    const t = this.tiles.get(key);
    if (!t) return;
    t.mesh.geometry.dispose();
    t.mesh.removeFromParent();
    this.tiles.delete(key);
  }

  /** The textures of the roads' surfaces as one array each (colour, data); until they are in, each look draws its mean colour */
  private async loadTextures(): Promise<void> {
    const assets = this.assets;
    const ids = this.surfaces.slice(0, MAX_ROAD_SURFACES);
    if (!assets || !ids.length) return;
    // The same library and surfaces as the textures in or on the way: nothing to fetch, decode or upload
    const wanted = { library: assets.library, anisotropy: assets.anisotropy, ids: ids.join('|') };
    const r = this.requested;
    if (r && r.library === wanted.library && r.anisotropy === wanted.anisotropy && r.ids === wanted.ids) return;
    this.requested = wanted;
    const generation = ++this.generation;
    const [{ arrays, materials }, catalog] = await Promise.all([loadMaterialArrays(assets.library, ids, assets.anisotropy), assets.library.catalog()]);
    if (generation !== this.generation) {
      arrays.dispose();
      return;
    }
    this.loaded?.arrays.dispose();
    this.loaded = { ids, arrays };
    this.material.setTextures(
      arrays,
      ids.map((id) => catalog.materials.find((m) => m.id === id)?.scale ?? 4),
      materials.map((m) => m.average),
    );
  }

  private fitBounds(mesh: Mesh, tile: RoadTile): void {
    const box = new Box3();
    const p = tile.position;
    const q = new Vector3();
    for (let k = 0; k < p.length; k += 2) box.expandByPoint(q.set(-p[k], this.field.heightAt(p[k], p[k + 1]), p[k + 1]));
    box.expandByScalar(1);
    mesh.geometry.boundingBox = box;
    mesh.geometry.boundingSphere = box.getBoundingSphere(new Sphere());
  }

  private clear(): void {
    for (const { mesh } of this.tiles.values()) mesh.geometry.dispose();
    this.tiles.clear();
    this.group.clear();
  }
}

export class RoadSurfaceMaterial extends MeshStandardMaterial {
  readonly roadUniforms = {
    uRoadColor: { value: null as Texture | null },
    uRoadData: { value: null as Texture | null },
    uGridNormals: { value: null as Texture | null },
    /** Map metres to the grid normals' uv (as TerrainMaterial's uGridUv) */
    uRoadGridUv: { value: new Vector4() },
    /** Per surface layer: 1 / the metres a texture tile covers, and the mean colour (linear); none until the textures are in */
    uRoadInvScale: { value: new Float32Array(MAX_ROAD_SURFACES).fill(0.25) },
    uRoadAverage: { value: Array.from({ length: MAX_ROAD_SURFACES }, () => new Color(0.09, 0.09, 0.085)) },
    /** Layers the textures hold */
    uRoadLayers: { value: 0 },
  };

  constructor(heights: HeightTexture, gridNormals: Texture, field: HeightField) {
    super({ roughness: 0.9, metalness: 0 });
    this.name = 'custom-map-roads';
    this.roadUniforms.uGridNormals.value = gridNormals;
    const sx = 1 / (field.cellSize * field.columns);
    const sy = 1 / (field.cellSize * field.rows);
    this.roadUniforms.uRoadGridUv.value.set(sx, sy, -field.originX * sx + 0.5 / field.columns, -field.originY * sy + 0.5 / field.rows);
    this.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.roadUniforms, heights.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${ROAD_VERTEX_PARS}`)
        .replace('#include <beginnormal_vertex>', ROAD_BEGIN_NORMAL)
        .replace('#include <begin_vertex>', ROAD_BEGIN_VERTEX)
        .replace('#include <project_vertex>', ROAD_PROJECT_VERTEX);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${ROAD_FRAGMENT_PARS}`)
        .replace('#include <map_fragment>', ROAD_SAMPLE)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roadRough;\n// map-roughness-done')
        .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(roadNormal, 0.0)).xyz);')
        .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= roadAO;\nreflectedLight.directDiffuse *= mix(1.0, roadAO, 0.5);');
    };
    addHeightFog(this);
  }

  /** The surfaces' texture arrays, their tile sizes (metres) and mean colours (sRGB), by layer */
  setTextures(arrays: MaterialArrays, scales: readonly number[], averages: readonly (readonly [number, number, number])[]): void {
    const u = this.roadUniforms;
    u.uRoadColor.value = arrays.color;
    u.uRoadData.value = arrays.data;
    u.uRoadLayers.value = scales.length;
    scales.forEach((s, k) => (u.uRoadInvScale.value[k] = 1 / s));
    averages.forEach((a, k) => u.uRoadAverage.value[k].setRGB(a[0], a[1], a[2], SRGBColorSpace));
  }

  override customProgramCacheKey(): string {
    return 'custom-map-roads-1';
  }
}


const ROAD_VERTEX_PARS = /* glsl */ `
attribute vec4 aRoad;
attribute vec2 aDir;
attribute vec4 aArm;
varying vec4 vRoadArm;
varying vec3 vRoad;
flat varying float vRoadLook;
varying vec2 vRoadDir;
varying vec2 vRoadMap;
varying vec3 vRoadNormal;
uniform sampler2D uGridNormals;
uniform vec4 uRoadGridUv;
${TERRAIN_HEIGHT_GLSL}
`;

const ROAD_BEGIN_NORMAL = /* glsl */ `
vec2 roadMap = vec2(-position.x, position.z);
vec3 objectNormal = normalize(texture2D(uGridNormals, roadMap * uRoadGridUv.xy + uRoadGridUv.zw).xyz);
vRoadNormal = objectNormal;
vRoad = aRoad.xyz;
vRoadLook = aRoad.w;
vRoadArm = aArm;
vRoadDir = aDir;
vRoadMap = roadMap;
`;

const ROAD_BEGIN_VERTEX = /* glsl */ `
vec3 transformed = vec3(position.x, terrainHeightAt(roadMap), position.z);
`;

// Drawn towards the camera along the view ray: where it lands on screen stays, its depth comes before the ground's;
// a higher road a little more than a lower one where two overlap without meeting (RoadStyle.rank, the code's top bits)
const ROAD_PROJECT_VERTEX = /* glsl */ `
vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
float roadDist = length(mvPosition.xyz);
float roadRank = floor((aRoad.w + 0.5) / 131072.0);
float roadPull = ${PULL.toFixed(4)} + max(0.0, roadDist - ${PULL_FROM.toFixed(1)}) * ${PULL_PER_METRE.toFixed(5)} + roadRank * (${RANK_PULL.toFixed(4)} + roadDist * ${RANK_PULL_PER_METRE.toFixed(6)});
mvPosition.xyz *= 1.0 - min(0.5, roadPull / max(roadDist, 1e-3));
gl_Position = projectionMatrix * mvPosition;
`;

const ROAD_FRAGMENT_PARS = /* glsl */ `
precision highp sampler2DArray;
varying vec3 vRoad;
flat varying float vRoadLook;
varying vec4 vRoadArm;
varying vec2 vRoadDir;
varying vec2 vRoadMap;
varying vec3 vRoadNormal;
uniform sampler2DArray uRoadColor;
uniform sampler2DArray uRoadData;
uniform float uRoadInvScale[${MAX_ROAD_SURFACES}];
uniform vec3 uRoadAverage[${MAX_ROAD_SURFACES}];
uniform float uRoadLayers;
${SHADER_NOISE}

// A dash pattern along: 1 on the paint, soft over a pixel
float roadDash(float along, float paint, float gap, float aa) {
  float p = mod(along, paint + gap);
  return smoothstep(-aa, aa, p) * (1.0 - smoothstep(paint - aa, paint + aa, p));
}

// The surface's texture at (across, along): up close two lookups shifted by a slow noise so the tile never repeats
void roadLookup(float across, float along, float layer, float invScale, float near, out vec4 rc, out vec4 rd) {
  vec2 ruv = vec2(across, along) * invScale;
  vec2 rdx = dFdx(ruv);
  vec2 rdy = dFdy(ruv);
  float l = valueNoise(vec2(along * 0.035, across * 0.05 + layer * 7.0)) * 6.0;
  float ia = floor(l);
  vec2 oa = sin(vec2(3.0, 7.0) * ia);
  rc = textureGrad(uRoadColor, vec3(ruv + oa, layer), rdx, rdy);
  rd = textureGrad(uRoadData, vec3(ruv + oa, layer), rdx, rdy);
  float b = smoothstep(0.3, 0.7, fract(l)) * step(0.001, near);
  if (b > 0.0) {
    vec2 ob = sin(vec2(3.0, 7.0) * (ia + 1.0));
    rc = mix(rc, textureGrad(uRoadColor, vec3(ruv + ob, layer), rdx, rdy), b);
    rd = mix(rd, textureGrad(uRoadData, vec3(ruv + ob, layer), rdx, rdy), b);
  }
}

// A line across at offset c with width w: 1 on it, soft over a pixel
float roadLine(float across, float c, float w, float aa) {
  return 1.0 - smoothstep(w * 0.5 - aa, w * 0.5 + aa, abs(across - c));
}
`;

const ROAD_SAMPLE = /* glsl */ `
// The look (road-style.ts encodeRoadStyle): layer, markings, lanes, gutter, sealed, junction, wear
float code = floor(vRoadLook + 0.5);
float layer = mod(code, 16.0);
code = floor(code / 16.0);
float markings = mod(code, 4.0);
code = floor(code / 4.0);
float lanes = mod(code, 8.0);
code = floor(code / 8.0);
bool gutterOn = mod(code, 2.0) > 0.5;
code = floor(code / 2.0);
bool sealed = mod(code, 2.0) > 0.5;
code = floor(code / 2.0);
// Lanes, patches and cracks follow a ribbon's lanes; a junction has none of its own
bool ribbon = mod(code, 2.0) < 0.5;
code = floor(code / 2.0);
float wear = mod(code, 32.0) / 31.0;
// In a junction, the road this point runs into: its texture takes over towards its end
float armWeight = fract(vRoadArm.w) / 0.99;
wear = mix(wear, floor(vRoadArm.w) / 31.0, armWeight);
int li = min(int(layer), ${MAX_ROAD_SURFACES - 1});
float across = vRoad.x;
float along = vRoad.y;
float edgeDist = vRoad.z;
// Pixel size in metres for the soft edges of paint, seams and setts; the fine detail fades out once a pixel
// covers more than a few centimetres (far roads pay for one texture lookup and their markings)
float aa = max(length(vec2(dFdx(along), dFdy(along))), length(vec2(dFdx(across), dFdy(across)))) * 0.75 + 1e-4;
float near = 1.0 - smoothstep(0.04, 0.12, aa);

// The material along the road: u across, v along
vec4 rc;
vec4 rd;
if (layer < uRoadLayers) {
  roadLookup(across, along, layer, uRoadInvScale[li], near, rc, rd);
  if (armWeight > 0.001) {
    // The road's own frame, its normal turned into the junction's
    vec4 ac;
    vec4 ad;
    roadLookup(vRoadArm.x, vRoadArm.y, layer, uRoadInvScale[li], near, ac, ad);
    float c = cos(vRoadArm.z);
    float s = sin(vRoadArm.z);
    vec2 an = ad.xy * 2.0 - 1.0;
    ad.xy = vec2(an.x * c - an.y * s, an.x * s + an.y * c) * 0.5 + 0.5;
    rc = mix(rc, ac, armWeight);
    rd = mix(rd, ad, armWeight);
  }
} else {
  rc = vec4(uRoadAverage[li], 0.5);
  rd = vec4(0.5, 0.5, 0.8, 1.0);
}
vec3 roadAlbedo = rc.rgb;
float roadRough = rd.b;
float roadAO = mix(1.0, rd.a, 0.8);
vec2 roadNxy = (rd.xy * 2.0 - 1.0) * vec2(1.2, -1.2);

// Broad tone: wear pales and greys the surface, slow blots of older and newer patches of it
float blot = valueNoise(vRoadMap * 0.045 + layer) * 0.6 + valueNoise(vRoadMap * 0.17) * 0.4;
roadAlbedo *= mix(0.9, 1.1, blot);
// Asphalt carries the warm grey of its stone, not the texture's blue
if (sealed) roadAlbedo *= vec3(1.04, 1.0, 0.93);
float grey = dot(roadAlbedo, vec3(0.299, 0.587, 0.114));
roadAlbedo = mix(roadAlbedo, vec3(grey) * 1.08, wear * 0.35);

float halfW = abs(across) + edgeDist;
// Lane width: a motorway's by its lanes, else a half of the road
float lane = markings > 2.5 ? (2.0 * halfW) / max(lanes, 1.0) : halfW;
if (sealed) {
  if (ribbon && near > 0.0) {
    // Wheel tracks: darker, smoother bands where the tyres run, two per lane
    float inLane = mod(across + halfW, lane) / lane;
    float tracks = exp(-pow((inLane - 0.27) / 0.07, 2.0)) + exp(-pow((inLane - 0.73) / 0.07, 2.0));
    tracks *= (0.6 + 0.4 * valueNoise(vec2(along * 0.08, across))) * near;
    roadAlbedo *= 1.0 - tracks * mix(0.1, 0.18, wear);
    roadRough -= tracks * 0.12;
    // Repair patches: rectangles over a lane, newer and darker asphalt with a sealed seam round them
    float cell = floor(along / 11.0);
    float laneIndex = floor((across + halfW) / max(lane, 1.0));
    float pick = hash12(vec2(cell, laneIndex + 0.37));
    if (pick < (wear - 0.25) * 0.5) {
      float a0 = cell * 11.0 + hash12(vec2(cell, 3.1)) * 5.0;
      float len = 2.0 + hash12(vec2(cell, 7.7)) * 6.0;
      float laneStart = laneIndex * lane - halfW;
      float inside = smoothstep(a0 - aa, a0 + aa, along) * (1.0 - smoothstep(a0 + len - aa, a0 + len + aa, along))
        * smoothstep(laneStart + 0.15 - aa, laneStart + 0.15 + aa, across) * (1.0 - smoothstep(laneStart + lane - 0.15 - aa, laneStart + lane - 0.15 + aa, across));
      float rim = inside * (1.0 - smoothstep(0.0, 0.06 + aa, min(min(along - a0, a0 + len - along), min(across - laneStart - 0.15, laneStart + lane - 0.15 - across))));
      // Newer asphalt: darker and a touch bluer, a grain of its own
      float own = valueNoise(vec2(along, across) * 0.7 + pick * 40.0);
      roadAlbedo = mix(roadAlbedo, roadAlbedo * vec3(0.8, 0.81, 0.84) * mix(0.92, 1.05, own), inside * 0.8 * near);
      roadAlbedo = mix(roadAlbedo, vec3(0.03), rim * 0.65 * near);
      roadRough = mix(roadRough, 0.45, rim * near);
    }
    // Cracks: across the road every few metres where it is worn, a hair wide
    float crackAt = along / 7.0 + valueNoise(vec2(across * 0.6, along * 0.2)) * 0.9;
    float crackCell = floor(crackAt + 0.5);
    float crackDist = (0.5 - abs(fract(crackAt) - 0.5)) * 7.0;
    float crack = (1.0 - smoothstep(0.008, 0.008 + aa, crackDist)) * step(hash12(vec2(crackCell, 5.3)), wear * 0.8);
    crack *= smoothstep(0.35, 0.75, valueNoise(vec2(across * 1.3, crackCell * 3.7))) * near;
    // A sealed seam along the middle of a marked road, where its two halves were laid
    float seam = markings > 0.5 ? roadLine(across + (valueNoise(vec2(along * 0.15, 1.0)) - 0.5) * 0.12, 0.0, 0.05, aa) * smoothstep(0.2, 0.6, wear + 0.2) * near : 0.0;
    roadAlbedo = mix(roadAlbedo, vec3(0.025), max(crack * 0.75, seam * 0.6));
    roadRough = mix(roadRough, 0.4, seam);
  }
  // The edge: the asphalt breaks off ragged and pale on a country road (a kerb in town, below)
  if (!gutterOn) {
    float ragged = (valueNoise(vec2(along * 0.9, 2.0)) - 0.5) * 0.12 * near;
    roadAlbedo *= mix(1.0, 0.82, 1.0 - smoothstep(0.0, 0.08 + aa, edgeDist + ragged));
    roadAlbedo = mix(roadAlbedo, roadAlbedo * 1.08 + 0.015, (1.0 - smoothstep(0.1, 0.5, edgeDist)) * 0.5 * wear);
  }

  // Markings: paint a little worn by traffic, more so on worn roads
  if (markings > 0.5 && ribbon) {
    float paint = roadLine(across, 0.0, 0.12, aa) * roadDash(along, 3.0, 6.0, aa) * step(markings, 2.5);
    if (markings > 1.5) {
      float off = markings > 2.5 ? 0.3 : 0.15;
      paint = max(paint, roadLine(edgeDist, 0.25 + off * 0.5, off, aa));
    }
    if (markings > 2.5) {
      for (int k = 1; k < 6; k++) {
        if (float(k) >= lanes) break;
        paint = max(paint, roadLine(across, -halfW + lane * float(k), 0.15, aa) * roadDash(along, 6.0, 12.0, aa));
      }
    }
    float worn = valueNoise(vec2(along * 1.7, across * 2.3)) * 0.7 + 0.15;
    if (near > 0.0) worn += (valueNoise(vRoadMap * 9.0) - 0.5) * 0.3 * near;
    paint *= smoothstep(0.25, 0.75, worn + 0.3 - wear * 0.6);
    roadAlbedo = mix(roadAlbedo, vec3(0.78, 0.77, 0.72), paint * 0.92);
    roadRough = mix(roadRough, 0.55, paint);
    roadNxy *= 1.0 - paint * 0.7;
  }
} else {
  // Setts and slabs: joints darker along the edge, worn paler in the middle
  roadAlbedo *= mix(0.85, 1.0, smoothstep(0.0, 0.25 + aa, edgeDist));
  roadAlbedo = mix(roadAlbedo, roadAlbedo * 1.06, exp(-pow(across / max(halfW, 0.5) / 0.5, 2.0)) * wear * 0.6);
}

// A town street's kerb stone and its gutter of setts along both edges
if (gutterOn) {
  float kerb = 1.0 - smoothstep(0.15 - aa, 0.15 + aa, edgeDist);
  float gutter = (1.0 - smoothstep(0.55 - aa, 0.55 + aa, edgeDist)) * (1.0 - kerb);
  vec3 settColour = vec3(0.34, 0.33, 0.31);
  if (gutter > 0.0 && near > 0.0) {
    vec2 sett = vec2((edgeDist - 0.15) / 0.2, along / 0.16 + floor((edgeDist - 0.15) / 0.2) * 0.5);
    vec2 sf = abs(fract(sett) - 0.5);
    float joint = smoothstep(0.38, 0.47, max(sf.x, sf.y)) * near;
    settColour = mix(vec3(0.36, 0.35, 0.33) * mix(0.8, 1.15, hash12(floor(sett) + 3.0)), vec3(0.08), joint * 0.8);
    roadNxy = mix(roadNxy, vec2(sf.x > sf.y ? sign(fract(sett.x) - 0.5) : 0.0, sf.y >= sf.x ? sign(fract(sett.y) - 0.5) : 0.0) * joint * 0.6, gutter);
  }
  roadAlbedo = mix(roadAlbedo, settColour, gutter);
  roadAlbedo = mix(roadAlbedo, vec3(0.55, 0.54, 0.5) * mix(0.9, 1.05, valueNoise(vec2(along * 0.9, 4.0))), kerb);
  roadAlbedo *= 1.0 - (1.0 - smoothstep(0.15, 0.2 + aa, edgeDist)) * (1.0 - kerb) * 0.45;
  roadRough = mix(roadRough, 0.8, max(kerb, gutter));
}

diffuseColor.rgb *= roadAlbedo;
// The road's frame: along and across in the scene (x = -map x), the normal from the terrain's grid
vec3 roadUp = normalize(vRoadNormal);
vec3 roadT = normalize(vec3(-vRoadDir.x, 0.0, vRoadDir.y));
vec3 roadB = normalize(cross(roadUp, roadT));
roadT = cross(roadB, roadUp);
vec3 roadNormal = normalize(roadUp + roadB * roadNxy.x + roadT * roadNxy.y);
roadRough = clamp(roadRough, 0.2, 1.0);
`;
