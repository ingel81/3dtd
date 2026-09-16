import type { Material, Object3D } from 'three';
import type { TilesRenderer } from '3d-tiles-renderer';

/**
 * Built-in material types three runs the scene lights for. A ShaderMaterial
 * counts when it sets `lights: true`.
 */
const LIT_TYPES = new Set([
  'MeshLambertMaterial',
  'MeshPhongMaterial',
  'MeshStandardMaterial',
  'MeshPhysicalMaterial',
  'MeshToonMaterial',
  'ShadowMaterial',
]);

/** Whether three runs the scene lights in this material's shader. */
export function computesLights(material: Material): boolean {
  return LIT_TYPES.has(material.type) || (material as { lights?: boolean }).lights === true;
}

/**
 * R10 decision aid (docs/archive/PERF_BUG_ANALYSIS_2026-05-28.md): do the tile
 * materials run the scene lights at all? Photoreal tiles come either as a
 * lit material (MeshStandardMaterial) or through KHR_materials_unlit as
 * MeshBasicMaterial, and only the first pays for the lights on every tile
 * pixel.
 *
 * Logs each material type once, when the first loaded tile brings it, with
 * the number of meshes of that type in that tile. Changes nothing.
 */
export function logTileMaterialTypes(tilesRenderer: Pick<TilesRenderer, 'addEventListener'>): void {
  const seen = new Set<string>();
  tilesRenderer.addEventListener('load-model', ({ scene }) => {
    const found = new Map<string, { count: number; lit: boolean }>();
    scene.traverse((object: Object3D) => {
      const material = (object as { material?: Material | Material[] }).material;
      if (!material) return;
      for (const m of Array.isArray(material) ? material : [material]) {
        if (seen.has(m.type)) continue;
        const entry = found.get(m.type);
        if (entry) entry.count++;
        else found.set(m.type, { count: 1, lit: computesLights(m) });
      }
    });
    for (const [type, { count, lit }] of found) {
      seen.add(type);
      console.log(
        `[Tiles] material type: ${type} x${count} in the first tile that has it ` +
        `(${lit ? 'lit, runs the scene lights' : 'unlit, ignores the scene lights'})`
      );
    }
  });
}
