import { Group, type Object3D } from 'three';

/** Objects that draw and rarely hold children: not watched for additions (see StaticGroup) */
function isRenderable(object: Object3D): boolean {
  const o = object as Object3D & { isMesh?: boolean; isPoints?: boolean; isLine?: boolean; isSprite?: boolean };
  return o.isMesh === true || o.isPoints === true || o.isLine === true || o.isSprite === true;
}

/**
 * StaticGroup: a group whose subtree stands still, its world matrices
 * computed when something changed, not every frame.
 *
 * three's `updateMatrixWorld` recomposes the local matrix of every object
 * with `matrixAutoUpdate` each frame, which marks it and forces its whole
 * subtree to multiply again: on an OSM city of 10 000 scene nodes some
 * 11 000 matrix multiplications a frame for a map that does not move. This
 * group skips its subtree in the frame's update and recomputes:
 *
 * - all of it after a move: its own `updateMatrix()` (with
 *   `matrixAutoUpdate` off, as here), `updateMatrixWorld(true)`, a parent
 *   that passes `force` (moved itself), a new parent, or `invalidate()`
 *   after an object inside was moved in place;
 * - an object added anywhere below, with its subtree, in the next update:
 *   the group listens for `childadded` on every object below that is not a
 *   mesh, line, points or sprite (those rarely hold children; one that gets
 *   some after it came in needs `invalidate()`);
 * - every frame, what was added with `addMoving`: parts that move by their
 *   own transform, updated as three updates any object;
 * - a StaticGroup inside goes by its own rules (its subtree is its own).
 *
 * Inside, `matrixAutoUpdate` may stay on: the local matrix is composed
 * whenever the subtree is recomputed. A scene with `matrixAutoUpdate` on
 * forces every child each frame; the scenes holding a StaticGroup have it
 * off (their root stands at the origin).
 */
export class StaticGroup extends Group {
  readonly isStaticGroup = true;
  /** The whole subtree recomputes in the next update */
  private stale = true;
  /** Objects added below since the last update, each recomputed with its subtree */
  private readonly added: Object3D[] = [];
  /** Parts updated every frame (addMoving) */
  private readonly moving: Object3D[] = [];
  /** StaticGroups below: each frame they update by their own rules */
  private readonly inner: StaticGroup[] = [];
  private readonly watched = new WeakSet<Object3D>();
  private readonly onChildAdded = (event: { child: Object3D | null }): void => {
    const child = event.child;
    if (!child) return;
    this.added.push(child);
    this.watch(child);
  };

  constructor() {
    super();
    this.matrixAutoUpdate = false;
    this.watch(this);
    this.addEventListener('added', () => this.invalidate());
  }

  /** An object inside moved in place: the whole subtree recomputes in the next update */
  invalidate(): void {
    this.stale = true;
  }

  /** Adds a part that moves by its own transform: updated every frame, as three updates any object */
  addMoving(object: Object3D): this {
    this.add(object);
    if (!this.moving.includes(object)) this.moving.push(object);
    return this;
  }

  override remove(...objects: Object3D[]): this {
    super.remove(...objects);
    for (const o of objects) {
      const k = this.moving.indexOf(o);
      if (k >= 0) this.moving.splice(k, 1);
    }
    return this;
  }

  override updateMatrixWorld(force?: boolean): void {
    if (force || this.stale || this.matrixWorldNeedsUpdate || this.matrixAutoUpdate) {
      this.stale = false;
      this.added.length = 0;
      super.updateMatrixWorld(true);
      return;
    }
    const added = this.added;
    for (let k = 0; k < added.length; k++) {
      const o = added[k];
      // Taken out again meanwhile: nothing of this group to compute
      if (o.parent && this.holds(o)) o.updateMatrixWorld(true);
    }
    added.length = 0;
    const moving = this.moving;
    for (let k = 0; k < moving.length; k++) moving[k].updateMatrixWorld(false);
    const inner = this.inner;
    for (let k = inner.length - 1; k >= 0; k--) {
      if (this.holds(inner[k])) inner[k].updateMatrixWorld(false);
      else inner.splice(k, 1);
    }
  }

  /** Whether `object` lies in this group's subtree */
  private holds(object: Object3D): boolean {
    let o: Object3D | null = object;
    while (o && o !== this) o = o.parent;
    return o === this;
  }

  /** Listens for additions below `object` (down to the StaticGroups inside, which keep their own) */
  private watch(object: Object3D): void {
    if (object !== this && object instanceof StaticGroup) {
      if (!this.inner.includes(object)) this.inner.push(object);
      return;
    }
    if (!this.watched.has(object) && !(isRenderable(object) && object.children.length === 0)) {
      this.watched.add(object);
      object.addEventListener('childadded', this.onChildAdded);
    }
    for (const child of object.children) this.watch(child);
  }
}
