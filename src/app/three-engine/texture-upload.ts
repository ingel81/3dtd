import type { Material, Mesh, Object3D, Texture, WebGLRenderer } from 'three';

/** The textures of `material`'s own properties (map, normalMap, …) into `out` */
function addMaterialTextures(material: Material, out: Set<Texture>): void {
  for (const value of Object.values(material)) if ((value as Texture | null)?.isTexture) out.add(value as Texture);
}

/** Every texture the materials of the meshes under `root` hold as properties, each once */
export function texturesOf(root: Object3D): Set<Texture> {
  const out = new Set<Texture>();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) addMaterialTextures(m, out);
  });
  return out;
}

/**
 * Every texture a draw of the meshes under `root` binds, hidden ones
 * included: the materials' own, and the uniforms of their compiled programs
 * (what onBeforeCompile hands a shader: the terrain's height and splat
 * textures, the baked lamps, the fog map). Materials not compiled yet give
 * only their own.
 */
export function boundTexturesOf(renderer: WebGLRenderer, root: Object3D): Set<Texture> {
  const out = new Set<Texture>();
  const seen = new Set<Material>();
  const add = (value: unknown): void => {
    if (Array.isArray(value)) for (const v of value) add(v);
    else if ((value as Texture | null)?.isTexture) out.add(value as Texture);
  };
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (seen.has(m)) continue;
      seen.add(m);
      addMaterialTextures(m, out);
      const uniforms = (renderer.properties.get(m) as { uniforms?: Record<string, { value: unknown }> }).uniforms;
      if (uniforms) for (const u of Object.values(uniforms)) add(u?.value);
    }
  });
  return out;
}

/**
 * Uploads `textures` to the GPU now (initTexture), a task for each that
 * took time, instead of all in the first frame that binds them: a map's
 * warm-up frame spent 332 ms in texSubImage2D (demo valley after the editor,
 * browser profile 2026-10-19). Textures already up to date cost nothing.
 * `gone` stops it.
 */
export async function uploadTextures(renderer: WebGLRenderer, textures: Iterable<Texture>, gone: () => boolean = () => false): Promise<void> {
  for (const texture of textures) {
    if (gone()) return;
    // A render target's texture is the target's to set up, as it draws
    if ((texture as Texture & { isRenderTargetTexture?: boolean }).isRenderTargetTexture) continue;
    const t = performance.now();
    renderer.initTexture(texture);
    if (performance.now() - t > 2) await new Promise((resolve) => setTimeout(resolve));
  }
}
