import { Box3, Frustum, Matrix4, Vector3, type BufferGeometry, type Camera, type Object3D } from 'three';

/** A body the mirror may serve: who draws it, its level (map metres) and its meshes (the tiles of its water) */
export interface MirrorCandidate<T> {
  owner: T;
  level: number;
  meshes: readonly (Object3D & { geometry: BufferGeometry })[];
}

/** The level the mirror renders this frame, the bodies on it and how strongly they show it */
export interface MirrorPick<T> {
  owners: ReadonlySet<T>;
  level: number;
  /** 0..1: fades in and out (FADE_S), never switches at once */
  weight: number;
}

/** Bodies whose levels differ by less than this share one mirror (they lie in one plane) */
export const SAME_LEVEL_M = 0.05;
/** Seconds the mirror takes to fade in or out */
export const FADE_S = 0.4;
/** Seconds between two picks */
const PICK_S = 0.25;
/** Another level takes the mirror only when it shows this much more of itself than the one that has it */
const SWITCH_MARGIN = 1.3;
/** Nearer than this a tile counts as this near (its share of the screen cannot grow without bound) */
const NEAR_M = 12;

/** A geometry's water area (m2, its triangles over the ground plane) and bounds, worked out once per geometry */
const extents = new WeakMap<BufferGeometry, { area: number; box: Box3 }>();

/**
 * Which water level the mirror (water-reflection.ts, one per frame) serves,
 * and how strongly. Picked by what the camera sees: every body's tiles in
 * the view frustum and within the mirror's reach, each by its water area
 * over the square of its distance (roughly its share of the screen), summed
 * per level; bodies on one level share the mirror, as they lie in one
 * plane. No mask is sampled: a tile's area is read once from its triangles,
 * a pick looks at a few dozen boxes.
 * A level takes over only with clearly more on screen (SWITCH_MARGIN), and
 * the mirror never switches at once: the level that has it fades out
 * (FADE_S), then the next fades in. Before, the body with the most water
 * round the focus took it outright, and none beyond the focus's reach: a
 * river seen from a little farther showed no mirror at all, a little nearer
 * it snapped on.
 */
export class MirrorChoice<T> {
  private age = Infinity;
  private target: { owners: Set<T>; level: number; score: number } | null = null;
  private active: { owners: Set<T>; level: number } | null = null;
  private weight = 0;
  private readonly frustum = new Frustum();
  private readonly viewProjection = new Matrix4();
  private readonly box = new Box3();
  private readonly eye = new Vector3();

  /**
   * Every frame: `bodies` the reflective ones, `reach` how far the mirror
   * draws (m). Null: no mirror this frame.
   */
  update(dt: number, camera: Camera, reach: number, bodies: readonly MirrorCandidate<T>[]): MirrorPick<T> | null {
    this.age += dt;
    if (this.age >= PICK_S) {
      this.age = 0;
      this.pick(camera, reach, bodies);
    }
    const target = this.target;
    if (target && this.active && sameSet(target.owners, this.active.owners)) {
      this.active = { owners: target.owners, level: target.level };
      this.weight = Math.min(1, this.weight + dt / FADE_S);
    } else if (this.active && this.weight > 0) {
      this.weight = Math.max(0, this.weight - dt / FADE_S);
    } else {
      this.active = target ? { owners: target.owners, level: target.level } : null;
      this.weight = 0;
    }
    return this.active ? { owners: this.active.owners, level: this.active.level, weight: this.weight } : null;
  }

  private pick(camera: Camera, reach: number, bodies: readonly MirrorCandidate<T>[]): void {
    camera.updateMatrixWorld();
    this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProjection);
    camera.getWorldPosition(this.eye);
    const levels: { owners: Set<T>; level: number; score: number }[] = [];
    for (const body of bodies) {
      let score = 0;
      for (const mesh of body.meshes) {
        if (!mesh.visible) continue;
        const e = extentOf(mesh.geometry);
        if (e.area <= 0) continue;
        this.box.copy(e.box).applyMatrix4(mesh.matrixWorld);
        const d = this.box.distanceToPoint(this.eye);
        if (d > reach || !this.frustum.intersectsBox(this.box)) continue;
        const near = Math.max(d, NEAR_M);
        score += e.area / (near * near);
      }
      if (score <= 0) continue;
      const group = levels.find((l) => Math.abs(l.level - body.level) < SAME_LEVEL_M);
      if (group) {
        group.owners.add(body.owner);
        group.score += score;
      } else levels.push({ owners: new Set([body.owner]), level: body.level, score });
    }
    let best = levels.reduce<(typeof levels)[number] | null>((a, l) => (!a || l.score > a.score ? l : a), null);
    // The level that has the mirror keeps it unless another shows clearly more
    const held = this.target && levels.find((l) => Math.abs(l.level - this.target!.level) < SAME_LEVEL_M);
    if (best && held && best !== held && best.score < held.score * SWITCH_MARGIN) best = held;
    this.target = best;
  }
}

/** The area of a geometry's triangles over the ground plane (x, z) and its bounds */
function extentOf(geometry: BufferGeometry): { area: number; box: Box3 } {
  let e = extents.get(geometry);
  if (e) return e;
  const pos = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const count = index ? index.count : (pos?.count ?? 0);
  let area = 0;
  for (let t = 0; t + 2 < count; t += 3) {
    const a = index ? index.getX(t) : t;
    const b = index ? index.getX(t + 1) : t + 1;
    const c = index ? index.getX(t + 2) : t + 2;
    const ax = pos.getX(a);
    const az = pos.getZ(a);
    area += Math.abs((pos.getX(b) - ax) * (pos.getZ(c) - az) - (pos.getX(c) - ax) * (pos.getZ(b) - az)) / 2;
  }
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  e = { area, box: geometry.boundingBox!.clone() };
  extents.set(geometry, e);
  return e;
}

function sameSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}
