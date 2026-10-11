import { ClampToEdgeWrapping, DataTexture, FloatType, NearestFilter, NoColorSpace, RedFormat, Vector2, Vector4 } from 'three';
import type { HeightField } from '../height-field';

/**
 * The height grid as a float texture, for shaders that need the terrain's
 * height under a point (water depth per pixel, grass blades). Read with
 * `terrainHeightAt` (TERRAIN_HEIGHT_GLSL): four texel fetches interpolated
 * on the same two triangles per cell as the mesh and `HeightField`, so a
 * shader sees exactly the drawn surface.
 */
export class HeightTexture {
  readonly texture: DataTexture;
  /** Uniforms to merge into a material that includes TERRAIN_HEIGHT_GLSL */
  readonly uniforms: {
    uTerrainHeights: { value: DataTexture };
    uTerrainGrid: { value: Vector4 };
    uTerrainGridSize: { value: Vector2 };
  };

  constructor(private readonly field: HeightField) {
    this.texture = new DataTexture(field.grid.heights, field.columns, field.rows, RedFormat, FloatType);
    this.texture.colorSpace = NoColorSpace;
    this.texture.magFilter = this.texture.minFilter = NearestFilter;
    this.texture.wrapS = this.texture.wrapT = ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    this.uniforms = {
      uTerrainHeights: { value: this.texture },
      uTerrainGrid: { value: new Vector4(field.originX, field.originY, field.cellSize, 0) },
      uTerrainGridSize: { value: new Vector2(field.columns, field.rows) },
    };
  }

  /** Heights changed: re-upload the grid */
  refresh(): void {
    this.texture.image.data = this.field.grid.heights;
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}

export const TERRAIN_HEIGHT_GLSL = /* glsl */ `
uniform sampler2D uTerrainHeights;
uniform vec4 uTerrainGrid;
uniform vec2 uTerrainGridSize;

// Terrain height at map point m, on the mesh's two triangles per cell; clamped to the grid
float terrainHeightAt(vec2 m) {
  vec2 g = clamp((m - uTerrainGrid.xy) / uTerrainGrid.z, vec2(0.0), uTerrainGridSize - 1.001);
  ivec2 i = ivec2(floor(g));
  vec2 f = g - vec2(i);
  float h00 = texelFetch(uTerrainHeights, i, 0).r;
  float h10 = texelFetch(uTerrainHeights, i + ivec2(1, 0), 0).r;
  float h01 = texelFetch(uTerrainHeights, i + ivec2(0, 1), 0).r;
  float h11 = texelFetch(uTerrainHeights, i + ivec2(1, 1), 0).r;
  return f.x >= f.y ? h00 + f.x * (h10 - h00) + f.y * (h11 - h10) : h00 + f.y * (h01 - h00) + f.x * (h11 - h01);
}
`;
