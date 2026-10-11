import { Plane, Ray, Vector3, type Camera } from 'three';
import type { WorldMinimap } from '../../world/world-provider';

export type MinimapArea = Omit<WorldMinimap, 'picture'>;

/**
 * The world's area inside a square canvas of `size` pixels: fitted whole,
 * centred, north up. Scene x/z to canvas pixels and back.
 */
export class MinimapFrame {
  /** The area's rectangle in the canvas */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;

  constructor(
    readonly area: MinimapArea,
    readonly size: number,
  ) {
    const aw = Math.abs(area.right - area.left);
    const ah = Math.abs(area.bottom - area.top);
    const k = size / Math.max(aw, ah, 1e-6);
    this.w = aw * k;
    this.h = ah * k;
    this.x = (size - this.w) / 2;
    this.y = (size - this.h) / 2;
  }

  u(sceneX: number): number {
    return this.x + ((sceneX - this.area.left) / (this.area.right - this.area.left)) * this.w;
  }

  v(sceneZ: number): number {
    return this.y + ((sceneZ - this.area.top) / (this.area.bottom - this.area.top)) * this.h;
  }

  /** The scene point under canvas pixel (u, v), kept inside the area */
  toScene(u: number, v: number): { x: number; z: number } {
    const fu = Math.min(1, Math.max(0, (u - this.x) / this.w));
    const fv = Math.min(1, Math.max(0, (v - this.y) / this.h));
    return {
      x: this.area.left + fu * (this.area.right - this.area.left),
      z: this.area.top + fv * (this.area.bottom - this.area.top),
    };
  }

  sameArea(area: MinimapArea): boolean {
    const a = this.area;
    return a.left === area.left && a.right === area.right && a.top === area.top && a.bottom === area.bottom;
  }
}

/** View corners in NDC, around the picture */
const CORNERS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

/**
 * Where the camera's view corners meet the level ground at `groundY`, scene
 * x/z into `out` (four entries). A corner above the horizon reaches out
 * `reach` metres along its direction over the ground instead.
 */
export class ViewFootprint {
  readonly out: { x: number; z: number }[] = CORNERS.map(() => ({ x: 0, z: 0 }));
  private readonly ray = new Ray();
  private readonly plane = new Plane(new Vector3(0, 1, 0), 0);
  private readonly hit = new Vector3();

  update(camera: Camera, groundY: number, reach: number): { x: number; z: number }[] {
    this.plane.constant = -groundY;
    camera.getWorldPosition(this.ray.origin);
    for (let i = 0; i < CORNERS.length; i++) {
      const d = this.ray.direction.set(CORNERS[i][0], CORNERS[i][1], 0.5).unproject(camera).sub(this.ray.origin).normalize();
      const p = this.out[i];
      const distance = this.ray.distanceToPlane(this.plane);
      if (distance !== null && d.y < 0 && Math.hypot(d.x, d.z) * distance <= reach) {
        this.ray.at(distance, this.hit);
        p.x = this.hit.x;
        p.z = this.hit.z;
      } else {
        const flat = Math.hypot(d.x, d.z) || 1;
        p.x = this.ray.origin.x + (d.x / flat) * reach;
        p.z = this.ray.origin.z + (d.z / flat) * reach;
      }
    }
    return this.out;
  }
}
