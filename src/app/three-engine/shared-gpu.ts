import { Sprite, type Material, type Mesh, type Object3D, type Texture, type WebGLRenderer } from 'three';

/** A material, texture or geometry three can drop the GPU side of and upload again */
interface GpuResource {
  dispose(): void;
}

const shared = new Set<GpuResource>();
/** three's DFG LUT, once a renderer showed it (findThreeLut) */
let threeLut: Texture | null = null;

/**
 * Marks `resource` as made once for the page and drawn by every renderer that
 * comes (a material, texture or geometry on module level, or a class's static
 * one); returns it. Every renderer that draws it hangs a dispose listener on
 * it, and that listener holds the renderer, its context and canvas, and
 * through them the whole game or editor of that renderer; left standing, a
 * page kept every world opened before (E195). `releaseSharedGpu` drops them.
 */
export function shareGpu<T extends GpuResource>(resource: T): T {
  shared.add(resource);
  return resource;
}

/** `resource` is no longer the page's (its owner went and freed it) */
export function unshareGpu(resource: GpuResource): void {
  shared.delete(resource);
}

/**
 * A renderer goes (ThreeTilesEngine.dispose, EditorViewport.dispose), before
 * its scene is emptied: every shared resource drops its GPU side and with it
 * the listeners of every renderer that drew it. The object itself stays, with
 * its CPU data (a baked noise is not baked again); the next draw, by a
 * renderer still standing or the next one, uploads or links it anew.
 *
 * three keeps two such objects of its own for the page: the sprites' geometry
 * and the DFG LUT of its physical materials, which it does not export; the
 * LUT is read off a material `renderer` drew (a shared one, or one in
 * `scene`).
 */
export function releaseSharedGpu(renderer: WebGLRenderer, scene?: Object3D): void {
  threeLut ??= findThreeLut(renderer, scene);
  for (const resource of shared) resource.dispose();
  threeLut?.dispose();
  new Sprite().geometry.dispose();
}

/** The LUT three hands every physical material it draws, from the uniforms `renderer` made for one in `root` */
function findThreeLut(renderer: WebGLRenderer, root: Object3D | undefined): Texture | null {
  let found: Texture | null = null;
  const look = (material: Material): void => {
    if (found) return;
    const uniforms = (renderer.properties.get(material) as { uniforms?: Record<string, { value: unknown }> }).uniforms;
    const value = uniforms?.['dfgLUT']?.value as Texture | null | undefined;
    if (value?.isTexture) found = value;
  };
  for (const resource of shared) if ((resource as Material).isMaterial) look(resource as Material);
  root?.traverse((obj) => {
    const material = (obj as Mesh).material;
    if (!material || found) return;
    if (Array.isArray(material)) material.forEach(look);
    else look(material);
  });
  return found;
}
