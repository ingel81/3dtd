import {
  Raycaster,
  Vector2,
  type Intersection,
  type Object3D,
  type PerspectiveCamera,
  type Vector3,
  type WebGLRenderer,
} from 'three';
import { raycastStats } from '../utils/raycast-stats';
import type { TerrainSources } from './terrain-queries';

/** Was der Picker von den Towern braucht: ihre Meshes samt ID. */
export interface PickableTowers {
  getAllMeshes(): { id: string; mesh: Object3D }[];
}

/**
 * ScreenPicker: was unter einem Punkt auf dem Canvas liegt, Boden oder Tower.
 *
 * Vorher inline in `three-tiles-engine.ts` (`raycastTerrain`, `raycastTowers`).
 * Jeder Aufruf nimmt einen frischen Raycaster, siehe ARCHITECTURE.md
 * "Raycaster Corruption Issue". Boden-Picks buchen ihre Strahlen als `screenPick`
 * (`__raycastStats()`); in DevWorld beantwortet der DevTerrainProvider sie.
 *
 * Vom Engine besessen, als `engine.picker` erreichbar. Einziger Aufrufer ist der
 * InputHandlerService (Klick, Build-Vorschau, Debug-Pick).
 */
export class ScreenPicker {
  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly renderer: WebGLRenderer,
    private readonly towers: PickableTowers,
    private readonly sources: TerrainSources,
  ) {}

  /**
   * Raycast against towers at screen coordinates
   * Returns the tower ID if a tower was hit, null otherwise
   */
  raycastTowers(screenX: number, screenY: number): string | null {
    // Convert screen coords to NDC
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new Vector2(
      ((screenX - rect.left) / rect.width) * 2 - 1,
      -((screenY - rect.top) / rect.height) * 2 + 1
    );

    // Create a FRESH raycaster - reusing the LOS raycaster causes issues after LoS checks
    const raycaster = new Raycaster();
    raycaster.setFromCamera(mouse, this.camera);

    // Test each tower mesh
    const towerMeshes = this.towers.getAllMeshes();
    for (const { id, mesh } of towerMeshes) {
      const intersects = raycaster.intersectObject(mesh, true);
      if (intersects.length > 0) {
        return id;
      }
    }

    return null;
  }

  /**
   * Raycast against terrain at screen coordinates
   *
   * IMPORTANT: Uses a fresh Raycaster instance each call.
   * See ARCHITECTURE.md "Raycaster Corruption Issue" for details.
   */
  raycastTerrain(screenX: number, screenY: number): Vector3 | null {
    // DevWorld: delegate to provider
    const devTerrain = this.sources.devTerrain();
    if (devTerrain) {
      return devTerrain.raycastFromScreen(
        screenX, screenY, this.camera, this.renderer
      );
    }

    const tiles = this.sources.tiles();
    if (!tiles) return null;

    // Convert screen coords to NDC
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new Vector2(
      ((screenX - rect.left) / rect.width) * 2 - 1,
      -((screenY - rect.top) / rect.height) * 2 + 1
    );

    // Create a FRESH raycaster - reusing the LOS raycaster causes issues after LoS checks
    // The shared raycaster gets corrupted state from LOS raycasting with custom origins
    const raycaster = new Raycaster();
    raycaster.setFromCamera(mouse, this.camera);

    // Pointer moves in build and placement mode, and clicks
    const scope = raycastStats.enter('screenPick');
    let results: Intersection[];
    try {
      results = raycaster.intersectObject(tiles.group, true);
    } finally {
      raycastStats.exit(scope);
    }

    if (results.length > 0) {
      return results[0].point.clone();
    }

    return null;
  }
}
