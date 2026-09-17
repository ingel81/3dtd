import { BufferGeometry, Mesh, MeshStandardMaterial, NoColorSpace, Object3D, Texture } from 'three';

/** The stone frame of the spawn portals, built and baked by tools/blender/spawn_portal.py. */
export const SPAWN_PORTAL_FRAME_URL = 'assets/models/structures/spawn_portal.glb';

/** Anisotropic filtering of the frame's textures: the faces are often seen at a slant. */
const ANISOTROPY = 4;

/**
 * The frame out of its GLB, in portal space at scale 1 (x across the
 * street, y up from the ground, z the way the enemies walk out): stone
 * blocks shaded flat, the horns smooth, tangents for the normal map, and
 * four textures on one UV set. One arch round the portal's plane
 * (PORTAL_DEPTH / 2 ahead of the route start), nothing behind it. The gate shader
 * reads the textures (createPortalGateMaterial); SpawnPortalManager adds
 * the void and draws the frame instanced, the placement preview draws its
 * geometry.
 */
export interface SpawnPortalFrame {
  geometry: BufferGeometry;
  /** Base colour, sRGB */
  baseColor: Texture;
  /** Tangent-space normal map, +Y up (glTF) */
  normal: Texture;
  /** R ambient occlusion, G roughness, B metal */
  orm: Texture;
  /**
   * Data, not a colour: R how much of each carved sigil is left to glow, a
   * smooth mask over its cell (the gate shader draws the glow from the
   * sigil's distance field), G the order its strokes run in (0 to 1 over a
   * sigil), B glowing cracks round the opening
   */
  emissive: Texture;
}

/**
 * The frame from the scene of the loaded GLB. Throws if the asset lacks a
 * part the gate shader needs.
 */
export function frameFromGltf(scene: Object3D): SpawnPortalFrame {
  let mesh: Mesh | undefined;
  scene.traverse((node) => {
    if (!mesh && (node as Mesh).isMesh) mesh = node as Mesh;
  });
  if (!mesh) throw new Error('[SpawnPortal] The frame asset has no mesh');

  const geometry = mesh.geometry;
  for (const name of ['position', 'normal', 'uv', 'tangent']) {
    if (!geometry.getAttribute(name)) throw new Error(`[SpawnPortal] The frame asset has no ${name} attribute`);
  }
  const { map, normalMap, aoMap, emissiveMap } = mesh.material as MeshStandardMaterial;
  if (!map || !normalMap || !aoMap || !emissiveMap) {
    throw new Error('[SpawnPortal] The frame asset lacks one of its four textures');
  }
  // GLTFLoader reads the emissive texture as sRGB colour; it holds data
  emissiveMap.colorSpace = NoColorSpace;
  for (const texture of [map, normalMap, aoMap, emissiveMap]) texture.anisotropy = ANISOTROPY;
  return { geometry, baseColor: map, normal: normalMap, orm: aoMap, emissive: emissiveMap };
}
