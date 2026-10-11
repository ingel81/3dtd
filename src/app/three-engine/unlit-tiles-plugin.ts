import { MeshBasicMaterial, type Material, type MeshStandardMaterial, type Object3D } from 'three';
import { computesLights } from './tile-material-log';

/**
 * The unlit counterpart of a tile material: its texture, colour, vertex
 * colours, side and transparency, nothing that reacts to light. A material
 * that ignores the lights already comes back as it is.
 */
export function toUnlitTileMaterial(material: Material): Material {
  if (!computesLights(material)) return material;
  const lit = material as MeshStandardMaterial;
  const unlit = new MeshBasicMaterial({
    map: lit.map ?? null,
    vertexColors: lit.vertexColors,
    side: lit.side,
    transparent: lit.transparent,
    opacity: lit.opacity,
    alphaTest: lit.alphaTest,
  });
  if (lit.color) unlit.color.copy(lit.color);
  unlit.name = lit.name;
  material.dispose();
  return unlit;
}

/**
 * TilesRenderer plugin for an own tileset: a photo mesh exported with a lit
 * glTF material (no KHR_materials_unlit) is drawn unlit, as the light is in
 * its texture. Runs in processTileModel, before the fade plugin wraps the
 * materials on load-model and before the renderer collects them for disposal.
 */
export class UnlitTilesPlugin {
  readonly name = 'UNLIT_TILES_PLUGIN';

  processTileModel(scene: Object3D): void {
    scene.traverse((object) => {
      const holder = object as { material?: Material | Material[] };
      if (!holder.material) return;
      holder.material = Array.isArray(holder.material)
        ? holder.material.map(toUnlitTileMaterial)
        : toUnlitTileMaterial(holder.material);
    });
  }
}
