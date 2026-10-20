import type { Camera, Scene } from 'three';
import { Vector3 } from 'three';
import { HealthBarInstanceManager } from './instanced-enemy/health-bar-instance.manager';

/** The bars' sides: as wide as a structure's ground, within these, m; a sixth of that high (the shader's 6:1) */
export const STRUCTURE_BAR = { minWidth: 6, maxWidth: 12, widthPerRadius: 1.2 } as const;

/** Width of the bar over a structure of ground `radius`, m */
export function structureBarWidth(radius: number): number {
  return Math.min(STRUCTURE_BAR.maxWidth, Math.max(STRUCTURE_BAR.minWidth, radius * STRUCTURE_BAR.widthPerRadius));
}

/**
 * The health bars over the damaged structures of a destructible world
 * (docs/DESTRUCTION_PLAN.md, E262): the enemies' bars (HealthBarInstanceManager,
 * the same programs, one draw for all), every bar depth tested, since a
 * structure stands still and its bar sits over its roof. The presenter sets
 * a bar when a structure's HP changes (WorldDamagePresenter); nothing runs
 * per structure and frame, the frame only turns the bars to the camera.
 * Switched with the enemies' bars (DebugFacade).
 */
export class StructureHealthBars {
  private readonly bars: HealthBarInstanceManager;
  /** The bars' keys by structure index, made once each */
  private readonly keys: string[] = [];
  private readonly at = new Vector3();

  constructor(scene: Scene) {
    this.bars = new HealthBarInstanceManager(scene, undefined, undefined, false);
  }

  /** Structure `index`'s bar over scene (`x`, `y`, `z`), `width` m wide, filled to `fraction`; none at 0 or full */
  set(index: number, x: number, y: number, z: number, width: number, fraction: number): void {
    const key = (this.keys[index] ??= String(index));
    if (!(fraction > 0 && fraction < 1)) {
      this.bars.remove(key);
      return;
    }
    const height = width / 6;
    this.at.set(x, y, z);
    const slot = this.bars.add(key, this.at, 0, null, width, height);
    this.bars.updateAt(slot, this.at, 0, fraction, width, height);
  }

  /** Bars shown now */
  get count(): number {
    return this.bars.count;
  }

  setVisible(visible: boolean): void {
    this.bars.setVisible(visible);
  }

  clear(): void {
    this.bars.clear();
  }

  /** Once per frame: the bars face the camera, what changed goes up */
  update(camera: Camera): void {
    this.bars.updateBillboard(camera);
  }

  dispose(): void {
    this.bars.dispose();
  }
}
