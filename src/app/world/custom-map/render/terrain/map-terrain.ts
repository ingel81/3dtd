import {
  Color,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
  Vector4,
  type DataTexture,
  type Vector3,
} from 'three';
import { MAX_GROUND_LAYERS, type MapBiome, type MapTerrain as MapTerrainDoc, type MapPaths } from '../../map-document';
import type { HeightField } from '../height-field';
import type { MapAssetLibrary } from '../map-asset-library';
import { pathMaskResolution, rasterizePathMask } from '../paths/path-mask';
import { addHeightFog } from '../environment/height-fog';
import { ApronProfile, BACKDROP_HEIGHT, buildTerrainApron, writeApronGeometry } from './terrain-apron';
import { APRON_LOOK, ApronMaterial } from './apron-material';
import { APRON_PAINT_BAND, apronPaintTexture, apronPaintWeights } from './apron-paint';
import { TerrainChunks, patchTerrainVertex, type GridRect } from './terrain-chunks';
import { TerrainMaterial, TERRAIN_MAX_LAYERS, type TerrainLayerSlots, type TerrainMaterialParams } from './terrain-material';
import type { GrassInputs } from '../grass/grass-field';
import { GrassLayers } from '../grass/grass-layers';
import { GroundOcclusion } from './ground-occlusion';
import { HeightTexture } from './height-texture';
import { setGroundColors } from './ground-color';
import { FarShadow } from './far-shadow';
import { TerrainCuts } from './terrain-cuts';
import { RoadSurfaceLayer } from '../paths/road-surface';
import { SurfaceLayer } from '../surfaces/surface-layer';
import { GridNormalTexture, MaterialArrays, SplatTextures, loadMaterialArrays, maskTexture } from './terrain-textures';
import { uploadRect, type TexelRect } from './texture-ranges';
import type { GroundBaker } from './ground-shape';

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
  /** Materials of the shader's larger layer counts, by count, the ground's and the apron's (layerTwins) */
  private readonly twins = new Map<number, [TerrainMaterial, ApronMaterial]>();
  /**
   * Builds the programs of new ground materials before they draw (the editor: off the main thread, for each
   * picture it draws); without it a change of the layer count links them in the next frame
   */
  prepare: ((meshes: Mesh[]) => Promise<unknown>) | null = null;
  /** Where far ground gets cheaper and steep ground reads its sides (TerrainMaterial.setFarDistances), kept for a material built later */
  private far: [number, number, number] = [150, 400, 150];

  /**
   * Bakes the far cascade of the sun's shadow for the land as it is now (`sunDir` in scene space): by the baker
   * where there is one, else here at once; resolves once it is in
   */
  bakeFarShadow(sunDir: Vector3): Promise<unknown> {
    if (this.occlusion.baker) return this.bakeFarShadowSliced(sunDir);
    this.farShadowBake++;
    this.farShadow.bake(this.field, sunDir, this.terrain.width, this.terrain.depth);
    return Promise.resolve();
  }

  /**
   * The far shadow baked again after an edit: by the baker (the editor's worker), else spread over frames
   * (FarShadow.bakeSliced); a newer bake stops it
   */
  async bakeFarShadowSliced(sunDir: Vector3): Promise<boolean> {
    const bake = ++this.farShadowBake;
    const baker = this.occlusion.baker;
    if (!baker) return this.farShadow.bakeSliced(this.field, sunDir.clone(), this.terrain.width, this.terrain.depth, () => bake === this.farShadowBake);
    const texels = await baker.farShadow({ x: sunDir.x, y: sunDir.y, z: sunDir.z });
    if (!texels || bake !== this.farShadowBake) return false;
    this.farShadow.set(texels);
    return true;
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
  /**
   * The roads, river banks and road covers painted into the ground (path-mask.ts), painted once with the
   * map; the editor's worker paints what changes and hands the texels over (setPathMask)
   */
  private pathMask: DataTexture | null = null;
  /** Hears when the path mask was painted from the map as it is now (the editor's worker takes over from there) */
  pathMaskBuilt: (() => void) | null = null;
  private readonly normals: GridNormalTexture;
  readonly occlusion: GroundOcclusion;
  /** The far cascade of the sun's shadow (the shadowCascade effect), shared with the material */
  readonly farShadow = new FarShadow();
  /** Blades on the grass layers, near the camera and in a ring beyond */
  readonly grass: GrassLayers;
  /** The height grid on the GPU (water depth, grass) */
  readonly heightTexture: HeightTexture;
  /** The ground cut away inside the openings of models set into it (tunnel portals), shared with the material */
  readonly cuts: TerrainCuts;
  /** The paved roads as a surface over the ground, on the terrain's textures and heights (road-surface.ts) */
  readonly roads: RoadSurfaceLayer;
  /** The surfaces of squares, pitches and car parks over the ground, the same way (surfaces/surface-layer.ts) */
  readonly surfaces: SurfaceLayer;
  private grassInputs: Omit<GrassInputs, 'splat' | 'pathMask'> | null = null;
  /** The border's natural ground for the apron, and which map layers count as natural */
  private apronPaint: DataTexture | null = null;
  private natural: boolean[] | null = null;
  private generation = 0;
  private readonly placeholder = new MeshStandardMaterial({ color: 0x5f7a3c, roughness: 0.95 });
  /** The apron's until the layers load: its heights are its geometry's */
  private readonly apronPlaceholder = new MeshStandardMaterial({ color: 0x5f7a3c, roughness: 0.95 });

  constructor(
    private readonly terrain: MapTerrainDoc,
    private readonly field: HeightField,
    /** The map's look: height (BACKDROP_HEIGHT) and paint (APRON_LOOK) of the mountains beyond the apron */
    private biome: MapBiome = 'temperate',
    /** Works the ground's shape out off the page's thread from the start (GroundOcclusion.baker) */
    baker: GroundBaker | null = null,
  ) {
    this.heightTexture = new HeightTexture(field);
    this.chunks = new TerrainChunks(field, this.heightTexture, this.placeholder);
    // The plain ground draws the chunks' heights too (TerrainChunks: they live on the GPU)
    this.placeholder.onBeforeCompile = (shader) => patchTerrainVertex(shader, this.chunks.uniforms);
    this.placeholder.customProgramCacheKey = () => 'custom-map-terrain-placeholder';
    this.apronProfile = new ApronProfile(field, terrain.water, BACKDROP_HEIGHT[biome]);
    this.apron = buildTerrainApron(this.apronProfile, this.apronPlaceholder);
    this.normals = new GridNormalTexture(field, terrain.water?.mask ?? null);
    this.occlusion = new GroundOcclusion(field, baker);
    this.cuts = new TerrainCuts(terrain.width, terrain.depth);
    this.roads = new RoadSurfaceLayer(field, this.heightTexture, this.normals.texture);
    this.surfaces = new SurfaceLayer(field, this.heightTexture, this.normals.texture);
    this.grass = new GrassLayers(this.heightTexture);
    for (const m of this.grass.meshes) m.visible = false;
  }

  /**
   * Loads the layer materials and switches the chunks to the splat material.
   * Called again after the map's layers or cliff material changed.
   */
  async load(assets: MapAssetLibrary, paths: MapPaths, anisotropy: number): Promise<void> {
    const t = this.terrain;
    const generation = ++this.generation;
    const { ids, slots } = assignLayerSlots(t);
    const [{ arrays, materials: pixels }, catalog] = await Promise.all([loadMaterialArrays(assets, ids, anisotropy), assets.catalog()]);
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
    const paved = ids.map((id) => (entryOf(id)?.paved ? 1 : 0));
    // Ground the apron may carry on from the border: no roads or pavement, no glowing lava
    this.natural = t.layers.map((l) => {
      const entry = entryOf(l.material);
      return entry?.category !== 'road' && !(entry?.emissive ?? 0);
    });

    if (generation !== this.generation) {
      arrays.dispose();
      return;
    }
    const splat = new SplatTextures(t.splat);
    // The roads first: the mask leaves the ground under their surface to them. New layers keep the mask
    this.roads.set(paths);
    if (!this.pathMask) {
      this.pathMask = this.buildPathMask(paths);
      this.pathMaskBuilt?.();
    }
    this.refreshApronPaint();
    const params: TerrainMaterialParams = {
      colorArray: arrays.color,
      dataArray: arrays.data,
      splat: splat.maps,
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
      paved,
      flow,
      width: t.width,
      depth: t.depth,
      cliffAngle: t.cliffAngle,
      splatResolution: t.splat.resolution,
    };
    const material = new TerrainMaterial(params);
    Object.assign(material.terrainUniforms, this.chunks.uniforms);
    material.terrainUniforms.uFarShadow = this.farShadow.texture;
    material.terrainUniforms.uFarShadowArea = this.farShadow.area;
    Object.assign(material.terrainUniforms, this.cuts.uniforms);
    addHeightFog(material);
    material.setGroundMood(this.biome);
    material.setFarDistances(this.far[0], this.far[1], this.far[2]);
    material.setWaterLevel(t.water?.level ?? null, t.water?.kind);
    const apronMaterial = new ApronMaterial(params, material);
    addHeightFog(apronMaterial);
    // A layer count of another program (a stroke's first new material): the old ground stays until the new
    // programs are built off the main thread, as linked in the frame they held it seconds (4 programs of 3 s
    // each on Direct3D for a first forest stroke). The paint of those frames goes to the old maps; the new
    // ones are first uploaded when they first draw, with the document as it is then
    const chunk = this.chunks.meshes[0];
    if (this.prepare && this.material && chunk && material.customProgramCacheKey() !== this.material.customProgramCacheKey()) {
      const ground = new Mesh(chunk.geometry, material);
      ground.castShadow = ground.receiveShadow = true;
      const apron = new Mesh(this.apron.geometry, apronMaterial);
      apron.receiveShadow = true;
      for (const m of [ground, apron]) m.frustumCulled = false;
      await this.prepare([ground, apron]);
      if (generation !== this.generation) {
        material.dispose();
        apronMaterial.dispose();
        arrays.dispose();
        splat.dispose();
        return;
      }
      // A cliff angle or water level set meanwhile
      material.setCliffAngle(t.cliffAngle);
      material.setWaterLevel(t.water?.level ?? null, t.water?.kind);
    }
    this.material?.dispose();
    this.apronMaterial?.dispose();
    this.arrays?.dispose();
    this.splat?.dispose();
    this.arrays = arrays;
    this.splat = splat;
    this.materialParams = params;
    this.material = material;
    this.chunks.setMaterial(material);
    this.roads.setAssets(assets, anisotropy);
    this.surfaces.setAssets(assets, anisotropy);
    this.apronMaterial = apronMaterial;
    this.setApronRange();
    this.apron.material = apronMaterial;

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
   * Meshes with the terrain and apron materials for each layer count above
   * the map's, on a chunk's and the apron's geometry, for compiling the
   * shader variants a further material layer switches to (the editor's first
   * stroke with a new biome linked them in the frame, seconds each). Past 8
   * layers with the third splat map, as the map then has it. The materials
   * stay until the layer is disposed: three drops a program no material uses
   * any more, and the map's own material may take it over only later.
   */
  layerTwins(): Mesh[] {
    const params = this.materialParams;
    const chunk = this.chunks.meshes[0];
    if (!this.material || !params || !chunk) return [];
    const out: Mesh[] = [];
    for (let n = this.material.layerCount + 4; n <= TERRAIN_MAX_LAYERS; n += 4) {
      let twin = this.twins.get(n);
      if (!twin) {
        const splat = n > 8 ? [params.splat[0], params.splat[1], params.splat[2] ?? params.splat[0]] : params.splat.slice(0, 2);
        const ground = new TerrainMaterial({ ...params, splat, layers: n });
        Object.assign(ground.terrainUniforms, this.chunks.uniforms);
        Object.assign(ground.terrainUniforms, this.cuts.uniforms);
        addHeightFog(ground);
        ground.setGroundMood(this.biome);
        const apron = new ApronMaterial({ ...params, splat, layers: n }, ground);
        addHeightFog(apron);
        twin = [ground, apron];
        this.twins.set(n, twin);
      }
      const ground = new Mesh(chunk.geometry, twin[0]);
      ground.castShadow = ground.receiveShadow = true;
      const apron = new Mesh(this.apron.geometry, twin[1]);
      apron.receiveShadow = true;
      for (const m of [ground, apron]) {
        m.frustumCulled = false;
        out.push(m);
      }
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

  /** Heights changed in `rect` (all when omitted); whether the apron changed with them (the border's heights) */
  rebuild(rect?: GridRect): boolean {
    this.chunks.rebuild(rect);
    const f = this.field;
    const bounds = rect && { minX: f.originX + rect.i0 * f.cellSize, minY: f.originY + rect.j0 * f.cellSize, maxX: f.originX + rect.i1 * f.cellSize, maxY: f.originY + rect.j1 * f.cellSize };
    this.roads.refreshBounds(bounds);
    this.surfaces.refreshBounds(bounds);
    this.normals.update(rect);
    if (rect) this.occlusion.queueTerrain(rect);
    else this.occlusion.updateTerrain();
    this.heightTexture.refresh(rect);
    return this.refreshApron(rect);
  }

  /** Rebuilds the apron when heights at the border may have changed; whether it did */
  refreshApron(rect?: GridRect): boolean {
    const f = this.field;
    if (rect && rect.i0 > 0 && rect.j0 > 0 && rect.i1 < f.columns - 1 && rect.j1 < f.rows - 1) return false;
    this.apronProfile = new ApronProfile(f, this.terrain.water, BACKDROP_HEIGHT[this.biome]);
    writeApronGeometry(this.apron.geometry, this.apronProfile);
    this.setApronRange();
    return true;
  }

  /** The mountains beyond the apron and the ground's mood for a new look of the map (BACKDROP_HEIGHT, APRON_LOOK, ground-mood.ts) */
  setBiome(biome: MapBiome): void {
    if (biome === this.biome) return;
    const height = BACKDROP_HEIGHT[biome] !== BACKDROP_HEIGHT[this.biome];
    this.biome = biome;
    // The ground's mood (ground-mood.ts); the apron shares the material's uniforms
    this.material?.setGroundMood(biome);
    for (const [ground] of this.twins.values()) ground.setGroundMood(biome);
    if (height) this.refreshApron();
    else this.setApronRange();
  }

  private setApronRange(): void {
    this.apronMaterial?.setRange(this.apronProfile.base, BACKDROP_HEIGHT[this.biome], APRON_LOOK[this.biome]);
  }

  /** Water changed: wet banks follow the mask and level (the rivers' banks are the path mask's, setPathMask) */
  refreshWater(): void {
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

  /** The paths changed: the roads lay what changed (the mask follows from the editor's worker, setPathMask) */
  refreshPaths(paths: MapPaths): void {
    this.roads.set(paths);
  }

  /**
   * Texels of the path mask painted elsewhere (the editor's worker, path-mask-job.ts): `data` holds the RGBA rows
   * of `rect` of a mask of `resolution`² over `width` x `depth` metres. False when this mask is not that one
   */
  setPathMask(width: number, depth: number, resolution: number, rect: TexelRect, data: Uint8Array): boolean {
    const mask = this.pathMask;
    const t = this.terrain;
    if (!mask || t.width !== width || t.depth !== depth || mask.image.width !== resolution) return false;
    const texels = mask.image.data as Uint8Array;
    const row = (rect.i1 - rect.i0 + 1) * 4;
    for (let j = rect.j0; j <= rect.j1; j++) texels.set(data.subarray((j - rect.j0) * row, (j - rect.j0 + 1) * row), (j * resolution + rect.i0) * 4);
    uploadRect(mask, rect);
    return true;
  }

  dispose(): void {
    // A sliced far shadow bake under way stops: it would upload into what is gone
    this.farShadowBake++;
    this.chunks.dispose();
    this.apron.geometry.dispose();
    this.apron.removeFromParent();
    this.material?.dispose();
    this.apronMaterial?.dispose();
    for (const pair of this.twins.values()) for (const twin of pair) twin.dispose();
    this.placeholder.dispose();
    this.apronPlaceholder.dispose();
    this.arrays?.dispose();
    this.splat?.dispose();
    this.pathMask?.dispose();
    this.pathMask = null;
    this.apronPaint?.dispose();
    this.normals.dispose();
    this.occlusion.dispose();
    this.grass.dispose();
    this.farShadow.dispose();
    this.heightTexture.dispose();
    this.cuts.dispose();
    this.roads.dispose();
    this.surfaces.dispose();
  }

  private buildPathMask(paths: MapPaths): DataTexture {
    const t = this.terrain;
    const resolution = pathMaskResolution(t.width, t.depth);
    const texture = maskTexture(rasterizePathMask(paths, t.width, t.depth, resolution, t.rivers ?? [], this.roads.covers(), this.surfaces.surfaces), resolution);
    uploadRect(texture, undefined);
    return texture;
  }
}
