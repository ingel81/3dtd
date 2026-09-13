import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  FrontSide,
  MeshBasicMaterial,
  Vector3,
  type Material,
  type Matrix3,
  type Matrix4,
  type Mesh,
  type MeshStandardMaterial,
  type Side,
  type Texture,
} from 'three';
import { growBounds, type VATBounds } from './vat-encoding';

/**
 * Faces the VAT material draws, from the materials of the baked meshes
 * (glTF doubleSided is DoubleSide). A type has one material, so when its
 * meshes disagree it draws both sides: a missing face shows, an extra back
 * face mostly stays behind the front one.
 */
export function vatSide(materials: (Material | Material[])[]): Side {
  const sides = new Set(materials.flat().map((material) => material.side));
  if (sides.size > 1) return DoubleSide;
  return sides.values().next().value ?? FrontSide;
}

/** RGBA bytes of a texture's image, read through a 2D canvas or as the image holds them. */
export interface TexturePixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * The pixels of `tex`, read once per cache. An image that already holds RGBA
 * bytes (DataTexture, the PNGs the model-budget generator decodes in Node) is
 * taken as it is, any other goes through a 2D canvas. Null when the texture
 * has no decoded image or no 2D canvas is available.
 */
export function texturePixels(tex: Texture, cache: Map<Texture, TexturePixels | null>): TexturePixels | null {
  if (cache.has(tex)) return cache.get(tex) ?? null;
  let pixels: TexturePixels | null = null;
  try {
    const img = tex.image as HTMLImageElement | ImageBitmap | HTMLCanvasElement;
    const width = (img as HTMLImageElement).naturalWidth || img.width || 0;
    const height = (img as HTMLImageElement).naturalHeight || img.height || 0;
    const bytes = (img as { data?: unknown }).data;
    if (ArrayBuffer.isView(bytes) && width > 0 && height > 0 && bytes.byteLength === width * height * 4) {
      pixels = { data: new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength), width, height };
    } else if (width > 0 && height > 0) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img as CanvasImageSource, 0, 0);
      pixels = { data: ctx.getImageData(0, 0, width, height).data, width, height };
    }
  } catch {
    pixels = null;
  }
  cache.set(tex, pixels);
  return pixels;
}

/** A baked mesh merged into the VAT geometry: `vertexCount` vertices from `vertexOffset`, into root space by `meshToRoot`. */
export interface BakedMeshPart {
  mesh: Mesh;
  vertexCount: number;
  vertexOffset: number;
  meshToRoot: Matrix4;
  normalMatrix: Matrix3;
}

/** The merged geometry of the baked meshes and what the VAT material takes from their materials. */
export interface MergedBake {
  geometry: BufferGeometry;
  /** Root-space positions as the geometry stores them */
  positions: Float32Array;
  /** Map of the mesh with the most vertices that has one */
  diffuseMap: Texture | null;
  /** Colour of the mesh with the most vertices that has one (fallback when no diffuse map) */
  baseColor: { r: number; g: number; b: number };
  /** Whether a mesh is unlit (MeshBasicMaterial) */
  isUnlit: boolean;
  /** CPU copies of the textures read (own textures of meshes), for the alpha checks */
  pixelCache: Map<Texture, TexturePixels | null>;
}

/**
 * Merge the baked meshes into the geometry of the InstancedMesh: positions
 * and normals in root space (the VAT overrides the positions at runtime),
 * UVs, the indices offset per mesh, aVertexIndex, and per vertex a colour,
 * an alpha and whether the shader samples the diffuse map. A mesh that
 * shares the diffuse map (the same texture, or its source: a glTF atlas)
 * samples it at runtime; one with a texture of its own has it sampled on the
 * CPU into its vertex colours; one without keeps its material colour.
 * `bounds`, when given, grows by every root-space position.
 */
export function mergeBakedMeshes(parts: BakedMeshPart[], totalVertices: number, bounds?: VATBounds): MergedBake {
  // Pick the best diffuse map and colour (prefer the mesh with most vertices)
  let diffuseMap: Texture | null = null;
  let bestMapVertices = 0;
  let isUnlit = false;
  let baseColor = { r: 1.0, g: 1.0, b: 1.0 };
  let bestColorVertices = 0;

  for (const part of parts) {
    const mat = part.mesh.material as MeshStandardMaterial & MeshBasicMaterial;
    if (mat) {
      if (mat.map && part.vertexCount > bestMapVertices) {
        diffuseMap = mat.map;
        bestMapVertices = part.vertexCount;
      }
      if (mat.color && part.vertexCount > bestColorVertices) {
        baseColor = { r: mat.color.r, g: mat.color.g, b: mat.color.b };
        bestColorVertices = part.vertexCount;
      }
      if (part.mesh.material instanceof MeshBasicMaterial) isUnlit = true;
    }
  }

  // Build merged geometry with per-vertex material info
  const mergedPositions = new Float32Array(totalVertices * 3);
  const mergedNormals = new Float32Array(totalVertices * 3);
  const mergedUVs = new Float32Array(totalVertices * 2);
  const mergedColors = new Float32Array(totalVertices * 3);
  const mergedAlpha = new Float32Array(totalVertices).fill(1.0);
  const mergedUseMap = new Float32Array(totalVertices);
  const mergedIndices: number[] = [];
  const tempVec = new Vector3();
  const tempNormal = new Vector3();

  const pixelCache = new Map<Texture, TexturePixels | null>();

  for (const part of parts) {
    const geo = part.mesh.geometry;
    const posAttr = geo.getAttribute('position');
    const normalAttr = geo.getAttribute('normal');
    const uvAttr = geo.getAttribute('uv');

    const mat = part.mesh.material as MeshStandardMaterial & MeshBasicMaterial;
    // Check shared texture via reference OR source (glTF shared atlas)
    const meshSharesTexture = !!(mat && mat.map && diffuseMap &&
      (mat.map === diffuseMap || mat.map.source === diffuseMap.source));
    const meshHasOwnTexture = !meshSharesTexture && !!(mat && mat.map);
    const cr = mat && mat.color ? mat.color.r : 1.0;
    const cg = mat && mat.color ? mat.color.g : 1.0;
    const cb = mat && mat.color ? mat.color.b : 1.0;
    const matOpacity = mat ? mat.opacity ?? 1.0 : 1.0;

    // For meshes with their own unique texture: sample on CPU and bake into vertex colors
    const own = meshHasOwnTexture && uvAttr ? texturePixels(mat.map!, pixelCache) : null;
    const texPixels = own?.data ?? null;
    const texW = own?.width ?? 0;
    const texH = own?.height ?? 0;

    for (let i = 0; i < part.vertexCount; i++) {
      const vi = part.vertexOffset + i;

      // Position → root space
      tempVec.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
      tempVec.applyMatrix4(part.meshToRoot);
      if (bounds) growBounds(bounds, tempVec);
      mergedPositions[vi * 3] = tempVec.x;
      mergedPositions[vi * 3 + 1] = tempVec.y;
      mergedPositions[vi * 3 + 2] = tempVec.z;

      // Normal → root space
      if (normalAttr) {
        tempNormal.set(normalAttr.getX(i), normalAttr.getY(i), normalAttr.getZ(i));
        tempNormal.applyMatrix3(part.normalMatrix).normalize();
        mergedNormals[vi * 3] = tempNormal.x;
        mergedNormals[vi * 3 + 1] = tempNormal.y;
        mergedNormals[vi * 3 + 2] = tempNormal.z;
      } else {
        mergedNormals[vi * 3 + 1] = 1.0; // default up normal
      }

      // UV
      if (uvAttr) {
        mergedUVs[vi * 2] = uvAttr.getX(i);
        mergedUVs[vi * 2 + 1] = uvAttr.getY(i);
      }

      // Per-vertex color, alpha and texture flag
      if (meshSharesTexture) {
        // Shares the main diffuse map → shader samples color + alpha at runtime
        mergedColors[vi * 3] = 1.0;
        mergedColors[vi * 3 + 1] = 1.0;
        mergedColors[vi * 3 + 2] = 1.0;
        mergedAlpha[vi] = matOpacity;
        mergedUseMap[vi] = 1.0;
      } else if (texPixels && uvAttr) {
        // Own texture → bake sampled color + alpha into vertex attributes
        let u = uvAttr.getX(i);
        let v = uvAttr.getY(i);
        u = u - Math.floor(u); // wrap to [0,1]
        v = v - Math.floor(v);
        const px = Math.min(Math.floor(u * texW), texW - 1);
        const py = Math.min(Math.floor((1 - v) * texH), texH - 1); // flip V
        const idx = (py * texW + px) * 4;
        mergedColors[vi * 3] = texPixels[idx] / 255;
        mergedColors[vi * 3 + 1] = texPixels[idx + 1] / 255;
        mergedColors[vi * 3 + 2] = texPixels[idx + 2] / 255;
        mergedAlpha[vi] = (texPixels[idx + 3] / 255) * matOpacity;
        mergedUseMap[vi] = 0.0;
      } else {
        // No texture → material color + opacity
        mergedColors[vi * 3] = cr;
        mergedColors[vi * 3 + 1] = cg;
        mergedColors[vi * 3 + 2] = cb;
        mergedAlpha[vi] = matOpacity;
        mergedUseMap[vi] = 0.0;
      }
    }

    // Indices (offset by vertexOffset)
    if (geo.index) {
      for (let i = 0; i < geo.index.count; i++) {
        mergedIndices.push(geo.index.getX(i) + part.vertexOffset);
      }
    } else {
      for (let i = 0; i < part.vertexCount; i++) {
        mergedIndices.push(part.vertexOffset + i);
      }
    }
  }

  // Create merged BufferGeometry
  const mergedGeometry = new BufferGeometry();
  mergedGeometry.setAttribute('position', new BufferAttribute(mergedPositions, 3));
  mergedGeometry.setAttribute('normal', new BufferAttribute(mergedNormals, 3));
  mergedGeometry.setAttribute('uv', new BufferAttribute(mergedUVs, 2));
  mergedGeometry.setIndex(mergedIndices);

  // Add vertex index, vertex color, alpha and texture flag attributes
  const vertexIndices = new Float32Array(totalVertices);
  for (let i = 0; i < totalVertices; i++) vertexIndices[i] = i;
  mergedGeometry.setAttribute('aVertexIndex', new BufferAttribute(vertexIndices, 1));
  mergedGeometry.setAttribute('aVertexColor', new BufferAttribute(mergedColors, 3));
  mergedGeometry.setAttribute('aVertexAlpha', new BufferAttribute(mergedAlpha, 1));
  mergedGeometry.setAttribute('aUseMap', new BufferAttribute(mergedUseMap, 1));

  return { geometry: mergedGeometry, positions: mergedPositions, diffuseMap, baseColor, isUnlit, pixelCache };
}

/**
 * How the VAT shader treats alpha: 'opaque' ignores it and draws in the
 * opaque pass, 'mask' discards below the cutoff, 'blend' is transparent.
 */
export type VATAlphaMode = 'opaque' | 'mask' | 'blend';

export interface VATAlpha {
  mode: VATAlphaMode;
  /** Alpha below which 'mask' discards a fragment (0 for the other modes). */
  cutoff: number;
}

/**
 * The alpha mode of a type from the materials of its baked meshes, the way
 * three.js draws them: a transparent material blends (glTF BLEND), one with
 * alphaTest cuts out below it (glTF MASK), any other ignores alpha. A
 * transparent material without alpha below 1 (opacity 1, no translucent
 * texel in its map) draws opaque. A type has one material, so one blending
 * mesh makes all of it blend; among masks the lowest cutoff wins.
 * `pixels` reads a map; a map it cannot read counts as translucent.
 */
export function vatAlpha(
  materials: (Material | Material[])[],
  pixels: (map: Texture) => TexturePixels | null,
): VATAlpha {
  let cutoff = Infinity;
  for (const material of materials.flat()) {
    if (material.transparent) {
      const map = (material as MeshStandardMaterial).map;
      if (material.opacity < 1 || (map && !isOpaque(pixels(map)))) return { mode: 'blend', cutoff: 0 };
    } else if (material.alphaTest > 0) {
      cutoff = Math.min(cutoff, material.alphaTest);
    }
  }
  return cutoff < Infinity ? { mode: 'mask', cutoff } : { mode: 'opaque', cutoff: 0 };
}

/** Every texel fully opaque; unknown pixels count as translucent. */
function isOpaque(pixels: TexturePixels | null): boolean {
  if (!pixels) return false;
  const { data } = pixels;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return false;
  }
  return true;
}
