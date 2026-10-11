import {
  Raycaster,
  Vector2,
  type Object3D,
  type PerspectiveCamera,
  type Vector3,
  type WebGLRenderer,
} from 'three';
import type { WorldSurface } from '../world/world-provider';

/** Was der Picker von den Towern braucht: ihre Meshes samt ID. */
export interface PickableTowers {
  getAllMeshes(): { id: string; mesh: Object3D }[];
}

/**
 * ScreenPicker: was unter einem Punkt auf dem Canvas liegt, Boden oder Tower.
 *
 * Vorher inline in `three-tiles-engine.ts` (`raycastTerrain`, `raycastTowers`).
 * Jeder Aufruf nimmt einen frischen Raycaster, siehe ARCHITECTURE.md
 * "Raycaster Corruption Issue". Den Boden trifft die Oberfläche der Welt
 * (`WorldSurface.pickRay`); auf den Tiles bucht sie ihre Strahlen als `screenPick`
 * (`__raycastStats()`).
 *
 * Vom Engine besessen, als `engine.picker` erreichbar. Einziger Aufrufer ist der
 * InputHandlerService (Klick, Build-Vorschau, Debug-Pick).
 */
export class ScreenPicker {
  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly renderer: WebGLRenderer,
    private readonly towers: PickableTowers,
    private readonly ground: Pick<WorldSurface, 'pickRay'>,
  ) {}

  /**
   * Raycast against towers at screen coordinates.
   * Returns the ID of the frontmost tower hit, null when none is; of two
   * hits at the same distance the first in the list wins. After a hit the
   * ray ends there, so a tower behind it drops out at its bounding sphere
   * instead of being tested triangle by triangle.
   */
  raycastTowers(screenX: number, screenY: number): string | null {
    const raycaster = this.rayAt(screenX, screenY);

    let hitId: string | null = null;
    for (const { id, mesh } of this.towers.getAllMeshes()) {
      // Sorted by distance, the first is this tower's nearest
      const hit = raycaster.intersectObject(mesh, true)[0];
      if (hit && hit.distance < raycaster.far) {
        hitId = id;
        raycaster.far = hit.distance;
      }
    }

    return hitId;
  }

  /** Whether `object` or one of its children lies under the screen point; false for null. The hero's pick. */
  hits(screenX: number, screenY: number, object: Object3D | null): boolean {
    if (!object) return false;
    return this.rayAt(screenX, screenY).intersectObject(object, true).length > 0;
  }

  /**
   * A FRESH raycaster through the screen point: reusing the LOS raycaster
   * causes issues after LoS checks.
   */
  private rayAt(screenX: number, screenY: number): Raycaster {
    // Convert screen coords to NDC
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new Vector2(
      ((screenX - rect.left) / rect.width) * 2 - 1,
      -((screenY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new Raycaster();
    raycaster.setFromCamera(mouse, this.camera);
    return raycaster;
  }

  /**
   * Raycast against the ground at screen coordinates: the world's surface
   * (WorldSurface.pickRay) on a fresh ray through the point.
   *
   * IMPORTANT: Uses a fresh Raycaster instance each call.
   * See ARCHITECTURE.md "Raycaster Corruption Issue" for details.
   */
  raycastTerrain(screenX: number, screenY: number): Vector3 | null {
    return this.ground.pickRay(this.rayAt(screenX, screenY));
  }
}
