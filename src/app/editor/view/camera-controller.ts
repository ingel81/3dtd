/**
 * The editor camera: orbits a target on the ground. Right drag turns, middle
 * drag (or Shift with right drag) pans, the wheel zooms toward the point
 * under the pointer, arrow keys pan, F frames a point, T toggles a straight
 * top-down view. Moves ease toward their goal so the view never jumps.
 */
import { MathUtils, PerspectiveCamera, Vector3 } from 'three';

export interface OrbitState {
  target: Vector3;
  distance: number;
  /** Turn around the up axis, radians; 0 looks north */
  yaw: number;
  /** Angle above the horizon, radians */
  pitch: number;
}

const MIN_PITCH = 0.12;
const MAX_PITCH = Math.PI / 2 - 0.001;
const TOP_DOWN = MAX_PITCH;

export class CameraController {
  readonly goal: OrbitState;
  readonly current: OrbitState;
  private topDown = false;
  private pitchBeforeTopDown = 0.9;
  minDistance = 8;
  maxDistance = 6000;

  constructor(target = new Vector3(), distance = 400) {
    this.goal = { target: target.clone(), distance, yaw: 0.6, pitch: 0.85 };
    this.current = { target: target.clone(), distance, yaw: 0.6, pitch: 0.85 };
  }

  get isTopDown(): boolean {
    return this.topDown;
  }

  rotate(dxPixels: number, dyPixels: number): void {
    this.goal.yaw -= dxPixels * 0.005;
    if (this.topDown) return;
    this.goal.pitch = MathUtils.clamp(this.goal.pitch + dyPixels * 0.004, MIN_PITCH, MAX_PITCH);
  }

  /** Pan by screen pixels; a full viewport height moves about the visible ground height */
  pan(dxPixels: number, dyPixels: number, viewportHeight: number, fovDeg: number): void {
    const visible = 2 * this.goal.distance * Math.tan(MathUtils.degToRad(fovDeg / 2));
    const k = visible / Math.max(1, viewportHeight);
    const right = new Vector3(Math.cos(this.goal.yaw), 0, Math.sin(this.goal.yaw));
    const forward = new Vector3(Math.sin(this.goal.yaw), 0, -Math.cos(this.goal.yaw));
    this.goal.target.addScaledVector(right, -dxPixels * k);
    this.goal.target.addScaledVector(forward, dyPixels * k);
  }

  /** Pan in metres along the view's right and forward (arrow keys) */
  move(rightMetres: number, forwardMetres: number): void {
    const right = new Vector3(Math.cos(this.goal.yaw), 0, Math.sin(this.goal.yaw));
    const forward = new Vector3(Math.sin(this.goal.yaw), 0, -Math.cos(this.goal.yaw));
    this.goal.target.addScaledVector(right, rightMetres).addScaledVector(forward, forwardMetres);
  }

  /** Zoom by wheel steps toward a point (scene space), or the target */
  zoom(steps: number, toward: Vector3 | null): void {
    const factor = Math.pow(1.15, steps);
    const next = MathUtils.clamp(this.goal.distance * factor, this.minDistance, this.maxDistance);
    const share = 1 - next / this.goal.distance;
    if (toward && share > 0) {
      this.goal.target.lerp(new Vector3(toward.x, this.goal.target.y + (toward.y - this.goal.target.y) * 0.5, toward.z), share);
    }
    this.goal.distance = next;
  }

  /** Frame a point with `radius` metres around it in view */
  focus(point: Vector3, radius: number): void {
    this.goal.target.copy(point);
    this.goal.distance = MathUtils.clamp(radius * 2.2, this.minDistance, this.maxDistance);
  }

  setTopDown(on: boolean): void {
    if (on === this.topDown) return;
    this.topDown = on;
    if (on) {
      this.pitchBeforeTopDown = this.goal.pitch;
      this.goal.pitch = TOP_DOWN;
    } else this.goal.pitch = this.pitchBeforeTopDown;
  }

  /** Keep the target on the ground */
  setGroundHeight(h: number): void {
    this.goal.target.y = h;
  }

  /** Ease toward the goal; returns whether the view moved */
  update(dt: number): boolean {
    const k = 1 - Math.exp(-dt * 14);
    const c = this.current;
    const g = this.goal;
    const before = c.target.x + c.target.y + c.target.z + c.distance + c.yaw + c.pitch;
    c.target.lerp(g.target, k);
    c.distance += (g.distance - c.distance) * k;
    c.yaw += (g.yaw - c.yaw) * k;
    c.pitch += (g.pitch - c.pitch) * k;
    const after = c.target.x + c.target.y + c.target.z + c.distance + c.yaw + c.pitch;
    return Math.abs(after - before) > 1e-5;
  }

  /** Jump straight to the goal (opening a map) */
  snap(): void {
    this.current.target.copy(this.goal.target);
    this.current.distance = this.goal.distance;
    this.current.yaw = this.goal.yaw;
    this.current.pitch = this.goal.pitch;
  }

  apply(camera: PerspectiveCamera): void {
    const c = this.current;
    const horizontal = Math.cos(c.pitch) * c.distance;
    camera.position.set(
      c.target.x - Math.sin(c.yaw) * horizontal,
      c.target.y + Math.sin(c.pitch) * c.distance,
      c.target.z + Math.cos(c.yaw) * horizontal,
    );
    // Straight down needs a defined up: north stays at the top of the screen when yaw is 0
    camera.up.set(Math.sin(c.yaw), c.pitch > MAX_PITCH - 0.01 ? 0 : 1, -Math.cos(c.yaw)).normalize();
    if (c.pitch <= MAX_PITCH - 0.01) camera.up.set(0, 1, 0);
    camera.lookAt(c.target);
    camera.near = Math.max(0.5, c.distance / 2000);
    camera.far = Math.max(20000, c.distance * 20);
    camera.updateProjectionMatrix();
  }
}
