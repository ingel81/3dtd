import {
  Color,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
  Vector4,
  type DataTexture,
  type Material,
  type Vector3,
} from 'three';
import { MAX_GROUND_LAYERS, type MapBiome, type MapTerrain as MapTerrainDoc, type MapPaths } from '../../map-document';
import type { HeightField } from '../height-field';
import type { MapAssetLibrary, MaterialCompressed, MaterialPixels } from '../map-asset-library';
import { pathMaskResolution, rasterizePathMask } from '../paths/path-mask';
import { addHeightFog } from '../environment/height-fog';
import { ApronProfile, BACKDROP_HEIGHT, buildTerrainApron } from './terrain-apron';
import { APRON_LOOK, ApronMaterial } from './apron-material';
import { APRON_PAINT_BAND, apronPaintTexture, apronPaintWeights } from './apron-paint';
import { TerrainChunks, type GridRect } from './terrain-chunks';
import { TerrainMaterial, TERRAIN_MAX_LAYERS, type TerrainLayerSlots, type TerrainMaterialParams } from './terrain-material';
import type { GrassInputs } from '../grass/grass-field';
import { GrassLayers } from '../grass/grass-layers';
import { GroundOcclusion } from './ground-occlusion';
import { HeightTexture } from './height-texture';
import { setGroundColors } from './ground-color';
import { FarShadow } from './far-shadow';
import { GridNormalTexture, MaterialArrays, SplatTextures, compressedTogether, isCompressed, maskTexture } from './terrain-textures';

/** Materials the path mask paints, by channel */
export const ROAD_MATERIAL = 'cobblestone';
export const PATH_MATERIAL = 'dirt-path';

/**
 * Texture-array layer of every material the terrain shows: the map's splat
 * layers (at most 12), the cliff material and the two path materials, each
 * material once. Layers past TERRAIN_MAX_LAYERS get -1 (not drawn).
 */
export function assignLayerSlots(t: MapTerrainDoc): { ids: string[]; slots: TerrainLayerSlots } {
  const ids: string[] = [];
  const slotOf = (id: string): number => {
    let k = ids.indexOf(id);
    if (k < 0 && ids.length < TERRAIN_MAX_LAYERS) {
      ids.push(id);
      k = ids.length - 1;
    }
    return k;
  };
  const slots: TerrainLayerSlots = {
    count: 0,
    splat: t.layers.slice(0, MAX_GROUND_LAYERS).map((l) => slotOf(l.material)),
    cliff: slotOf(t.cliffMaterial),
    road: slotOf(ROAD_MATERIAL),
    path: slotOf(PATH_MATERIAL),
  };
  slots.count = ids.length;
  return { ids, slots };
}

/**
 * The terrain of a map view: chunk meshes, and once the materials are in,
 * the splat material with its texture arrays, splat maps and path mask.
 * Until then the chunks show a plain green.
 */
export class MapTerrainLayer {
  readonly chunks: TerrainChunks;
  /** Land beyond the border, not part of the map (no LOS, no queries) */
  readonly apron: Mesh;
  /** Height profile of the apron, shared with the water that leaves the map */
  apronProfile: ApronProfile;
  private material: TerrainMaterial | null = null;
  /** The apron's: the terrain's with the backdrop range painted as distant mountains (apron-material.ts) */
  private apronMaterial: ApronMaterial | null = null;
  private materialParams: TerrainMaterialParams | null = null;
  /** Materials of the shader's larger layer counts, by count (layerTwins) */
  private readonly twins = new Map<number, TerrainMaterial>();
  /** Where far ground gets cheaper and steep ground reads its sides (TerrainMaterial.setFarDistances), kept for a material built later */
  private far: [number, number, number] = [150, 400, 150];

  /** Bakes the far cascade of the sun's shadow for the land as it is now (`sunDir` in scene space) */
  bakeFarShadow(sunDir: Vector3): void {
    this.farShadowBake++;
    this.farShadow.bake(this.field, sunDir, this.terrain.width, this.terrain.depth);
  }

  /** The far shadow baked again after an edit, spread over frames (FarShadow.bakeSliced); a newer bake stops it */
  bakeFarShadowSliced(sunDir: Vector3): Promise<boolean> {
    const bake = ++this.farShadowBake;
    return this.farShadow.bakeSliced(this.field, sunDir.clone(), this.terrain.width, this.terrain.depth, () => bake === this.farShadowBake);
  }

  /** Distances (m) from which far ground samples one layer lookup, then no layer textures, and up to which steep ground reads its sides (quality levels) */
  setFarDistances(single: number, flat: number, steep = single): void {
    this.far = [single, flat, steep];
    this.material?.setFarDistances(single, flat, steep);
  }
  /** The far shadow bake under way (bakeFarShadowSliced): a newer one stops it */
  private farShadowBake = 0;
  private arrays: MaterialArrays | null = null;
  private splat: SplatTextures | null = null;
  private pathMask: DataTexture | null = null;
  private readonly normals: GridNormalTexture;
  readonly occlusion: GroundOcclusion;
  /** The far cascade of the sun's shadow (the shadowCascade effect), shared with the material */
  readonly farShadow = new FarShadow();
  /** Blades on the grass layers, near the camera and in a ring beyond */
  readonly grass: GrassLayers;
  /** The height grid on the GPU (water depth, grass) */
  readonly heightTexture: HeightTexture;
  private grassInputs: Omit<GrassInputs, 'splat' | 'pathMask'> | null = null;
  /** The border's natural ground for the apron, and which map layers count as natural */
  private apronPaint: DataTexture | null = null;
  private natural: boolean[] | null = null;
  private generation = 0;
  private readonly placeholder = new MeshStandardMaterial({ color: 0x5f7a3c, roughness: 0.95 });

  constructor(
    private readonly terrain: MapTerrainDoc,
    private readonly field: HeightField,
    /** The map's look: height (BACKDROP_HEIGHT) and paint (APRON_LOOK) of the mountains beyond the apron */
    private biome: MapBiome = 'temperate',
  ) {
    this.chunks = new TerrainChunks(field, this.placeholder);
    this.apronProfile = new ApronProfile(field, terrain.water, BACKDROP_HEIGHT[biome]);
    this.apron = buildTerrainApron(this.apronProfile, this.placeholder);
    this.normals = new GridNormalTexture(field);
    this.occlusion = new GroundOcclusion(field);
    this.heightTexture = new HeightTexture(field);
    this.grass = new GrassLayers(this.heightTexture);
    for (const m of this.grass.meshes) m.visible = false;
    this.normals.setWater(terrain.water?.mask ?? null);
  }

  /**
   * Loads the layer materials and switches the chunks to the splat material.
   * Called again after the map's layers or cliff material changed.
   */
  async load(assets: MapAssetLibrary, paths: MapPaths, anisotropy: number): Promise<void> {
    const t = this.terrain;
    const generation = ++this.generation;
    const { ids, slots } = assignLayerSlots(t);
    // GPU-compressed layers where every one came so; else the pixels of all (an array is never mixed)
    const [textures, catalog] = await Promise.all([Promise.all(ids.map((id) => assets.materialTextures(id))), assets.catalog()]);
    let pixels: MaterialPixels[] | MaterialCompressed[];
    if (compressedTogether(textures)) {
      pixels = textures;
    } else {
      for (const m of textures.filter(isCompressed)) {
        m.color.dispose();
        m.data.dispose();
      }
      pixels = await Promise.all(ids.map((id) => assets.material(id)));
    }
    const scales = ids.map((id) => {
      const layer = t.layers.find((l) => l.material === id && l.scale);
      return layer?.scale ?? catalog.materials.find((m) => m.id === id)?.scale ?? 4;
    });
    const averages = pixels.map((p) => {
      const [r, g, b] = p.average.map((v) => Math.round(v * 255));
      return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
    });

    const entryOf = (id: string): (typeof catalog.materials)[number] | undefined =>
      catalog.materials.find((m) => m.id === id);
    const emissive = ids.map((id) => entryOf(id)?.emissive ?? 0);
    const flow = ids.map((id) => entryOf(id)?.flow ?? 0);
    const categories = ids.map((id) => entryOf(id)?.category);
    // Ground the apron may carry on from the border: no roads or pavement, no glowing lava
    this.natural = t.layers.map((l) => {
      const entry = entryOf(l.material);
      return entry?.category !== 'road' && !(entry?.emissive ?? 0);
    });

    if (generation !== this.generation) return;
    this.material?.dispose();
    this.apronMaterial?.dispose();
    this.arrays?.dispose();
    this.splat?.dispose();
    this.pathMask?.dispose();
    this.arrays = new MaterialArrays(pixels, anisotropy);
    this.splat = new SplatTextures(t.splat);
    this.pathMask = this.buildPathMask(paths);
    this.refreshApronPaint();
    this.materialParams = {
      colorArray: this.arrays.color,
      dataArray: this.arrays.data,
      splat: this.splat.maps,
      pathMask: this.pathMask,
      apronPaint: this.apronPaint ?? undefined,
      gridNormals: this.normals.texture,
      gridOcclusion: this.occlusion.texture,
      grid: this.field.grid,
      slots,
      scales,
      averages,
      emissive,
      categories,
      flow,
      width: t.width,
      depth: t.depth,
      cliffAngle: t.cliffAngle,
      splatResolution: t.splat.resolution,
    };
    this.material = new TerrainMaterial(this.materialParams);
    this.material.terrainUniforms.uMorphEye = this.chunks.morphEye;
    this.material.terrainUniforms.uMorphFocus = this.chunks.morphFocus;
    this.material.terrainUniforms.uFarShadow = this.farShadow.texture;
    this.material.terrainUniforms.uFarShadowArea = this.farShadow.area;
    addHeightFog(this.material);
    this.material.setFarDistances(this.far[0], this.far[1], this.far[2]);
    this.material.setWaterLevel(t.water?.level ?? null, t.water?.kind);
    this.chunks.setMaterial(this.material);
    this.apronMaterial = new ApronMaterial(this.materialParams, this.material);
    addHeightFog(this.apronMaterial);
    this.setApronRange();
    this.apron.material = this.apronMaterial;

    // Grass blades where the splat paints grass layers, coloured like the ground under them
    // Vector4 defaults to w = 1, which marked the eighth layer as grass on every map
    const mask = t.splat.maps.map(() => new Vector4(0, 0, 0, 0));
    const colors = Array.from({ length: MAX_GROUND_LAYERS }, (_, k) => {
      const px = pixels[slots.splat[k]];
      return px ? new Color().setRGB(px.average[0], px.average[1], px.average[2], SRGBColorSpace) : new Color();
    });
    t.layers.slice(0, MAX_GROUND_LAYERS).forEach((layer, k) => {
      if (entryOf(layer.material)?.category === 'grass') mask[k >> 2]?.setComponent(k & 3, 1);
    });
    this.grassInputs = { mask, colors, width: t.width, depth: t.depth };
    this.updateGrassInputs();
  }

  /**
   * Meshes with the terrain material for each layer count above the map's,
   * on a chunk's geometry, for compiling the shader variant a further
   * material layer switches to (the editor's first stroke with a new biome
   * linked it in the frame, over a second). The materials stay until the
   * layer is disposed: three drops a program no material uses any more, and
   * the map's own material may take it over only later.
   */
  layerTwins(): Mesh[] {
    const params = this.materialParams;
    const chunk = this.chunks.meshes[0];
    if (!this.material || !params || !chunk) return [];
    const out: Mesh[] = [];
    for (let n = this.material.layerCount + 4; n <= TERRAIN_MAX_LAYERS; n += 4) {
      let twin = this.twins.get(n);
      if (!twin) {
        twin = new TerrainMaterial({ ...params, layers: n });
        addHeightFog(twin);
        this.twins.set(n, twin);
      }
      const mesh = new Mesh(chunk.geometry, twin);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      out.push(mesh);
    }
    return out;
  }

  private updateGrassInputs(): void {
    if (!this.grassInputs || !this.splat || !this.pathMask) return;
    this.grass.setInputs({ ...this.grassInputs, splat: this.splat.maps, pathMask: this.pathMask });
    setGroundColors(this.splat.maps, this.grassInputs.colors, this.grassInputs.width, this.grassInputs.depth);
  }

  /** `focus`: the camera's point on the ground (map space), where the terrain keeps its full detail */
  update(cameraPos: Vector3, dt = 0, focus?: Vector3): void {
    this.chunks.update(cameraPos, focus);
    this.material?.tick(dt);
    // Occlusion of edited ground follows a few milliseconds a frame
    this.occlusion.flush(2);
  }

  rebuild(rect?: GridRect): void {
    this.chunks.rebuild(rect);
    this.normals.update(rect);
    if (rect) this.occlusion.queueTerrain(rect);
    else this.occlusion.updateTerrain();
    this.heightTexture.refresh(rect);
    this.refreshApron(rect);
  }

  /** Rebuilds the apron when heights at the border may have changed */
  refreshApron(rect?: GridRect): void {
    const f = this.field;
    if (!rect || rect.i0 <= 0 || rect.j0 <= 0 || rect.i1 >= f.columns - 1 || rect.j1 >= f.rows - 1) {
      this.apronProfile = new ApronProfile(f, this.terrain.water, BACKDROP_HEIGHT[this.biome]);
      this.apron.geometry.dispose();
      this.apron.geometry = buildTerrainApron(this.apronProfile, this.apron.material as Material).geometry;
      this.setApronRange();
    }
  }

  /** The mountains beyond the apron for a new look of the map (BACKDROP_HEIGHT, APRON_LOOK) */
  setBiome(biome: MapBiome): void {
    if (biome === this.biome) return;
    const height = BACKDROP_HEIGHT[biome] !== BACKDROP_HEIGHT[this.biome];
    this.biome = biome;
    if (height) this.refreshApron();
    else this.setApronRange();
  }

  private setApronRange(): void {
    this.apronMaterial?.setRange(this.apronProfile.base, BACKDROP_HEIGHT[this.biome], APRON_LOOK[this.biome]);
  }

  /** Water changed: wet banks follow the mask and level, river banks the rivers */
  refreshWater(paths?: MapPaths): void {
    if (paths) this.refreshPaths(paths);
    // The apron's sea floor follows the water
    this.refreshApron();
    this.normals.setWater(this.terrain.water?.mask ?? null);
    this.material?.setWaterLevel(this.terrain.water?.level ?? null, this.terrain.water?.kind);
  }

  /** The main water's mask changed in `rect` (samples) only: the wet banks there */
  refreshWaterMask(rect: GridRect): void {
    this.normals.setWater(this.terrain.water?.mask ?? null, rect);
  }

  /** Splat weights changed (painted in place or replaced) */
  refreshSplat(rect?: GridRect): void {
    this.splat?.refresh(this.terrain.splat, rect);
    // The apron carries the border's paint on: again when the paint near the border changed
    const t = this.terrain;
    const band = Math.ceil((APRON_PAINT_BAND / t.width) * t.splat.resolution);
    if (!rect || rect.i0 <= band || rect.j0 <= band || rect.i1 >= t.splat.resolution - 1 - band || rect.j1 >= t.splat.resolution - 1 - band) {
      this.refreshApronPaint();
    }
    if (this.material && this.splat) {
      const u = this.material.terrainUniforms;
      u.uSplat0.value = this.splat.maps[0];
      u.uSplat1.value = this.splat.maps[1];
      u.uSplat2.value = this.splat.maps[2] ?? null;
    }
    this.material?.setCliffAngle(this.terrain.cliffAngle);
    this.updateGrassInputs();
  }

  /** The apron's ground from the border's paint (apron-paint.ts) */
  private refreshApronPaint(): void {
    if (!this.natural) return;
    const natural = this.natural;
    const weights = apronPaintWeights(this.terrain, (k) => natural[k] ?? false);
    this.apronPaint = apronPaintTexture(weights, this.apronPaint ?? undefined);
    if (this.material) this.material.terrainUniforms.uApronPaint.value = this.apronPaint;
  }

  refreshPaths(paths: MapPaths): void {
    if (!this.material) return;
    this.pathMask?.dispose();
    this.pathMask = this.buildPathMask(paths);
    this.material.terrainUniforms.uPathMask.value = this.pathMask;
    this.updateGrassInputs();
  }

  dispose(): void {
    // A sliced far shadow bake under way stops: it would upload into what is gone
    this.farShadowBake++;
    this.chunks.dispose();
    this.apron.geometry.dispose();
    this.apron.removeFromParent();
    this.material?.dispose();
    this.apronMaterial?.dispose();
    for (const twin of this.twins.values()) twin.dispose();
    this.placeholder.dispose();
    this.arrays?.dispose();
    this.splat?.dispose();
    this.pathMask?.dispose();
    this.apronPaint?.dispose();
    this.normals.dispose();
    this.occlusion.dispose();
    this.grass.dispose();
    this.farShadow.dispose();
    this.heightTexture.dispose();
  }

  private buildPathMask(paths: MapPaths): DataTexture {
    const t = this.terrain;
    const res = pathMaskResolution(t.width, t.depth);
    return maskTexture(rasterizePathMask(paths, t.width, t.depth, res, t.rivers ?? []), res);
  }
}
