/**
 * The ground's shape of the editor's view worked out in the editor's worker
 * (EditorCore) from its mirror of the map: occlusion, curvature and drainage
 * (ground-shape.ts), the closeness to lava, the far shadow, and the height
 * lines of the overlay. The view hands its requests over (it is the view's
 * GroundBaker) and takes the results back as patches; each answers null
 * when a newer request of its kind took its place or no map is open.
 */
import type { FarShadowTexels, GroundBaker, SampleRect, ShapePatch } from '../../world/custom-map/render/terrain/ground-shape';
import type { Contours } from '../ops/contours';
import type { CoreJobKind } from '../workers/editor-core-protocol';
import type { CoreResult, EditorCore } from './editor-core';

export class EditorGround implements GroundBaker {
  constructor(private readonly core: EditorCore) {}

  shape(rect: SampleRect | null): Promise<ShapePatch | null> {
    return this.value('groundShape', () => this.core.run('groundShape', { rect }));
  }

  lava(): Promise<{ closeness: Uint8Array; any: boolean } | null> {
    return this.value('lava', () => this.core.run('lava', {}));
  }

  farShadow(sunDir: { x: number; y: number; z: number }): Promise<FarShadowTexels | null> {
    return this.value('farShadow', () => this.core.run('farShadow', { sunDir: { x: sunDir.x, y: sunDir.y, z: sunDir.z } }));
  }

  /** Height lines every `step` metres */
  contours(step: number): Promise<Contours | null> {
    return this.value('contours', () => this.core.run('contours', { step }));
  }

  private async value<K extends CoreJobKind>(kind: K, run: () => Promise<CoreResult<K> | null>): Promise<CoreResult<K>['value'] | null> {
    if (!this.core.versions) return null;
    try {
      return (await run())?.value ?? null;
    } catch (e) {
      console.warn(`[Editor] ${kind} not worked out:`, e);
      return null;
    }
  }
}
