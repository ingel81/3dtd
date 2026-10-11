import { MeshStandardMaterial, type DataTexture, type Material, type Mesh, type Vector3 } from 'three';
import type { MapTerrain as MapTerrainDoc, MapPaths } from '../../map-document';
import type { HeightField } from '../height-field';
import type { MapAssetLibrary } from '../map-asset-library';
import { pathMaskResolution, rasterizePathMask } from '../paths/path-mask';
import { addHeightFog } from '../environment/height-fog';
import { ApronProfile, buildTerrainApron } from './terrain-apron';
import { TerrainChunks, type GridRect } from './terrain-chunks';
import { TerrainMaterial, TERRAIN_MAX_LAYERS, type TerrainLayerSlots } from './terrain-material';
import { GridNormalTexture, MaterialArrays, SplatTextures, maskTexture } from './terrain-textures';

/** Materials the path mask paints, by channel */
export const ROAD_MATERIAL = 'cobblestone';
export const PATH_MATERIAL = 'dirt-path';

/**
 * Texture-array layer of every material the terrain shows: the map's splat
 * layers (at most 8), the cliff material and the two path materials, each
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
    splat: t.layers.slice(0, 8).map((l) => slotOf(l.material)),
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
  private arrays: MaterialArrays | null = null;
  private splat: SplatTextures | null = null;
  private pathMask: DataTexture | null = null;
  private readonly normals: GridNormalTexture;
  private generation = 0;
  private readonly placeholder = new MeshStandardMaterial({ color: 0x5f7a3c, roughness: 0.95 });

  constructor(
    private readonly terrain: MapTerrainDoc,
    private readonly field: HeightField,
  ) {
    this.chunks = new TerrainChunks(field, this.placeholder);
    this.apronProfile = new ApronProfile(field);
    this.apron = buildTerrainApron(this.apronProfile, this.placeholder);
    this.normals = new GridNormalTexture(field);
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
    const [pixels, catalog] = await Promise.all([Promise.all(ids.map((id) => assets.material(id))), assets.catalog()]);
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

    if (generation !== this.generation) return;
    this.material?.dispose();
    this.arrays?.dispose();
    this.splat?.dispose();
    this.pathMask?.dispose();
    this.arrays = new MaterialArrays(pixels, anisotropy);
    this.splat = new SplatTextures(t.splat);
    this.pathMask = this.buildPathMask(paths);
    this.material = new TerrainMaterial({
      colorArray: this.arrays.color,
      dataArray: this.arrays.data,
      splat: this.splat.maps,
      pathMask: this.pathMask,
      gridNormals: this.normals.texture,
      grid: this.field.grid,
      slots,
      scales,
      averages,
      emissive,
      flow,
      width: t.width,
      depth: t.depth,
      cliffAngle: t.cliffAngle,
    });
    addHeightFog(this.material);
    this.material.setWaterLevel(t.water?.level ?? null);
    this.chunks.setMaterial(this.material);
    this.apron.material = this.material;
  }

  update(cameraPos: Vector3, dt = 0): void {
    this.chunks.update(cameraPos);
    this.material?.tick(dt);
  }

  rebuild(rect?: GridRect): void {
    this.chunks.rebuild(rect);
    this.normals.update(rect);
    this.refreshApron(rect);
  }

  /** Rebuilds the apron when heights at the border may have changed */
  refreshApron(rect?: GridRect): void {
    const f = this.field;
    if (!rect || rect.i0 <= 0 || rect.j0 <= 0 || rect.i1 >= f.columns - 1 || rect.j1 >= f.rows - 1) {
      this.apronProfile = new ApronProfile(f);
      this.apron.geometry.dispose();
      this.apron.geometry = buildTerrainApron(this.apronProfile, this.apron.material as Material).geometry;
    }
  }

  /** Water changed: wet banks follow the mask and level */
  refreshWater(): void {
    this.normals.setWater(this.terrain.water?.mask ?? null);
    this.material?.setWaterLevel(this.terrain.water?.level ?? null);
  }

  /** Splat weights changed (painted in place or replaced) */
  refreshSplat(): void {
    this.splat?.refresh(this.terrain.splat);
    if (this.material && this.splat) {
      const u = this.material.terrainUniforms;
      u.uSplat0.value = this.splat.maps[0];
      u.uSplat1.value = this.splat.maps[1];
    }
    this.material?.setCliffAngle(this.terrain.cliffAngle);
  }

  refreshPaths(paths: MapPaths): void {
    if (!this.material) return;
    this.pathMask?.dispose();
    this.pathMask = this.buildPathMask(paths);
    this.material.terrainUniforms.uPathMask.value = this.pathMask;
  }

  dispose(): void {
    this.chunks.dispose();
    this.apron.geometry.dispose();
    this.apron.removeFromParent();
    this.material?.dispose();
    this.placeholder.dispose();
    this.arrays?.dispose();
    this.splat?.dispose();
    this.pathMask?.dispose();
    this.normals.dispose();
  }

  private buildPathMask(paths: MapPaths): DataTexture {
    const t = this.terrain;
    const res = pathMaskResolution(t.width, t.depth);
    return maskTexture(rasterizePathMask(paths, t.width, t.depth, res), res);
  }
}
