import type { Object3D } from 'three';

/** Gate per object, so the warm-up finds them in the scene graph. */
const gatesByObject = new WeakMap<Object3D, DrawGate>();

/**
 * Keeps a pool's render objects out of the render list while the pool has
 * nothing to draw (R6, docs/archive/PERF_BUG_ANALYSIS_2026-05-28.md).
 *
 * three puts an InstancedMesh with count 0, a geometry with instanceCount 0
 * or Points with an empty draw range into the render list anyway, and binds
 * program, uniforms and VAO before the draw finds nothing to draw. Between
 * waves that is every enemy type, the projectile, decal and particle pools,
 * the health bars, floating texts and lightning bolts.
 *
 * The owner reports its draw count where it changes. Only the step between
 * empty and non-empty touches `visible`, there is no pass per frame. From
 * then on the gate owns `visible` of its objects: visibility toggles go
 * through setShown(). The objects keep `frustumCulled = false`; the LOS cube
 * render hides and restores scene children around its own render only.
 */
export class DrawGate {
  private shown = true;
  private empty = true;
  private forced = false;

  constructor(private readonly objects: readonly Object3D[]) {
    for (const object of objects) gatesByObject.set(object, this);
    this.apply();
  }

  /** The pool's draw count changed. */
  setCount(count: number): void {
    const empty = count <= 0;
    if (empty === this.empty) return;
    this.empty = empty;
    this.apply();
  }

  /** The owner's visibility toggle (debug switches). */
  setShown(shown: boolean): void {
    if (shown === this.shown) return;
    this.shown = shown;
    this.apply();
  }

  /**
   * Draw even while empty. Only for the load-time warm-up (warmUpScene):
   * three uploads buffers and textures of an object in the first frame that
   * draws it, which for a hidden pool would be the first wave.
   */
  setForced(forced: boolean): void {
    if (forced === this.forced) return;
    this.forced = forced;
    this.apply();
  }

  get visible(): boolean {
    return this.forced || (this.shown && !this.empty);
  }

  private apply(): void {
    const visible = this.visible;
    for (const object of this.objects) object.visible = visible;
  }
}

/** Every gate with an object at or below `root`, each once. */
export function findDrawGates(root: Object3D): DrawGate[] {
  const gates = new Set<DrawGate>();
  root.traverse((object) => {
    const gate = gatesByObject.get(object);
    if (gate) gates.add(gate);
  });
  return [...gates];
}
