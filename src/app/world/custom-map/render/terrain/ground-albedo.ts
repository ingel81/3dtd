import { LinearFilter, Mesh, OrthographicCamera, Scene, SRGBColorSpace, WebGLRenderTarget, type BufferGeometry, type WebGLRenderer } from 'three';
import type { TerrainMaterial } from './terrain-material';
import { GROUND_COLOR_UNIFORMS } from './ground-color';

/** Metres per texel of the bake at least, and texels per side at most */
const TEXEL = 1;
const MAX_SIDE = 1024;
/** After the last change to the ground the bake waits this long, s (a brush stroke bakes once, at its end) */
const SETTLE_S = 0.35;

/** Texels per side of the bake of a map `size` metres across: a metre each, at most MAX_SIDE */
export function groundAlbedoSide(size: number): number {
  return Math.min(MAX_SIDE, Math.max(64, Math.ceil(size / TEXEL)));
}

/**
 * The ground's colour as the terrain shader paints it (the layers with
 * their macro variation, coarse structure and the biome's mood: crests,
 * hollows, patches, trodden rims, shores), baked once from above into a
 * texture over the whole map, as a camera a few dozen metres off sees it
 * (TERRAIN_ALBEDO_BAKE in terrain-material.ts). What stands on the ground
 * or shows it elsewhere takes its colour from here (GROUND_COLOR_GLSL's
 * groundColorAt): grass blades match the ground they grow from, the land
 * in a water reflection the land. One render of the terrain's chunks when
 * the map loads and again once an edit of the ground has settled (heights,
 * paint, paths, water, biome); a metre a texel, 1024 at most (an OSM world
 * of 2.4 km gets 2.3 m), 4 MB.
 */
export class GroundAlbedo {
  readonly target: WebGLRenderTarget;
  private readonly scene = new Scene();
  private readonly camera: OrthographicCamera;
  /** A change waits for its bake; seconds since the last one */
  private dirty = true;
  private since = 0;
  private baking = false;
  private compiled: TerrainMaterial | null = null;
  private disposed = false;

  constructor(width: number, depth: number) {
    const side = groundAlbedoSide(Math.max(width, depth));
    const aspect = width / depth;
    this.target = new WebGLRenderTarget(aspect >= 1 ? side : Math.ceil(side * aspect), aspect >= 1 ? Math.ceil(side / aspect) : side, { depthBuffer: false });
    this.target.texture.colorSpace = SRGBColorSpace;
    this.target.texture.minFilter = this.target.texture.magFilter = LinearFilter;
    this.target.texture.generateMipmaps = false;
    this.target.texture.name = 'ground-albedo';
    // Looking down, its right along map +x (scene -x) and its up along map +y (scene +z): texel u, v is map x, y
    this.camera = new OrthographicCamera(-width / 2, width / 2, depth / 2, -depth / 2, 1, 1e5);
    this.camera.position.set(0, 5e4, 0);
    this.camera.up.set(0, 0, 1);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
  }

  /** The ground changed (heights, paint, paths, water, its look): baked again once it settles */
  invalidate(): void {
    this.dirty = true;
    this.since = 0;
  }

  /**
   * Bakes when a change has settled: `dt` seconds passed, the chunks'
   * geometries and the bake's material (the terrain's, TERRAIN_ALBEDO_BAKE)
   * as they are now. Its program is built off the main thread first.
   */
  update(dt: number, renderer: WebGLRenderer | undefined, geometries: readonly BufferGeometry[], material: TerrainMaterial | null): void {
    if (!this.dirty || this.baking || !renderer || !material || !geometries.length) return;
    this.since += dt;
    if (this.since < SETTLE_S && this.compiled) return;
    void this.bake(renderer, geometries, material);
  }

  /** Bakes now (the map's first bake waits for it) */
  async bake(renderer: WebGLRenderer, geometries: readonly BufferGeometry[], material: TerrainMaterial): Promise<void> {
    if (this.baking || this.disposed) return;
    this.baking = true;
    this.dirty = false;
    try {
      this.setMeshes(geometries, material);
      if (this.compiled !== material) {
        const previous = renderer.getRenderTarget();
        renderer.setRenderTarget(this.target);
        let job: Promise<unknown>;
        try {
          job = renderer.compileAsync(this.scene, this.camera);
        } finally {
          renderer.setRenderTarget(previous);
        }
        await job;
        if (this.disposed) return;
        this.compiled = material;
        // Meshes or material may have changed meanwhile
        this.setMeshes(geometries, material);
      }
      this.draw(renderer);
    } finally {
      this.baking = false;
    }
  }

  dispose(): void {
    this.disposed = true;
    if (GROUND_COLOR_UNIFORMS.uGroundAlbedo.value === this.target.texture) {
      GROUND_COLOR_UNIFORMS.uGroundAlbedo.value = null;
      GROUND_COLOR_UNIFORMS.uGroundAlbedoOn.value = 0;
    }
    this.scene.clear();
    this.target.dispose();
  }

  private setMeshes(geometries: readonly BufferGeometry[], material: TerrainMaterial): void {
    const meshes = this.scene.children as Mesh[];
    for (let k = 0; k < geometries.length; k++) {
      let m = meshes[k];
      if (!m) {
        m = new Mesh(geometries[k], material);
        m.frustumCulled = false;
        m.matrixAutoUpdate = false;
        this.scene.add(m);
      }
      m.geometry = geometries[k];
      m.material = material;
    }
    while (meshes.length > geometries.length) this.scene.remove(meshes[meshes.length - 1]);
  }

  private draw(renderer: WebGLRenderer): void {
    const previous = renderer.getRenderTarget();
    try {
      // The chunks cover the whole target: whatever the clear leaves is drawn over
      renderer.setRenderTarget(this.target);
      renderer.render(this.scene, this.camera);
    } finally {
      renderer.setRenderTarget(previous);
    }
    GROUND_COLOR_UNIFORMS.uGroundAlbedo.value = this.target.texture;
    GROUND_COLOR_UNIFORMS.uGroundAlbedoOn.value = 1;
  }
}

