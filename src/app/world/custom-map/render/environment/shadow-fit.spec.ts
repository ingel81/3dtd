import { Group, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { fitShadowBox, SHADOW_BOX_MAX } from './shadow-fit';

function camera(at: Vector3, look: Vector3): PerspectiveCamera {
  const c = new PerspectiveCamera(60, 16 / 9, 1, 20000);
  c.position.copy(at);
  c.lookAt(look);
  c.updateMatrixWorld();
  return c;
}

/** Where a screen point (NDC) meets the ground plane y = 0 */
function ground(c: PerspectiveCamera, x: number, y: number): Vector3 {
  const p = new Vector3(x, y, 0.5).unproject(c);
  const d = p.sub(c.position).normalize();
  return c.position.clone().addScaledVector(d, -c.position.y / d.y);
}

describe('fitShadowBox', () => {
  const frame = new Group();
  frame.updateMatrixWorld();

  it('covers the corners of a view straight down, centred under it', () => {
    const c = camera(new Vector3(0, 100, 0.01), new Vector3());
    const center = new Vector3();
    const r = fitShadowBox(c, frame, new Vector3(), center);
    const corner = ground(c, 1, 1);
    expect(Math.hypot(center.x, center.z)).toBeLessThan(1);
    expect(r).toBeGreaterThan(Math.hypot(corner.x, corner.z));
    expect(r).toBeLessThan(Math.hypot(corner.x, corner.z) * 1.2);
  });

  it('reaches the far corners of an oblique view, which the old box of 0.9 x the distance missed', () => {
    // The editor's start pitch, 0.85 rad, from 120 m
    const focus = new Vector3();
    const at = new Vector3(0, Math.sin(0.85) * 120, -Math.cos(0.85) * 120);
    const c = camera(at, focus);
    const center = new Vector3();
    const r = fitShadowBox(c, frame, focus, center);
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = ground(c, x, y);
      expect(Math.hypot(p.x - center.x, p.z - center.z)).toBeLessThanOrEqual(r);
    }
    const far = ground(c, 1, 1);
    expect(Math.hypot(far.x, far.z)).toBeGreaterThan(120 * 0.9);
  });

  it('reaches 2.5 times the camera distance over the horizon, no further than its largest box, the focus inside', () => {
    const focus = new Vector3();
    const center = new Vector3();
    const near = camera(new Vector3(0, 20, -60), new Vector3(0, 15, 100));
    const distance = near.position.length();
    const r = fitShadowBox(near, frame, focus, center);
    expect(r).toBeGreaterThan(distance * 2.5 * 0.5);
    expect(r).toBeLessThanOrEqual(distance * 2.5 * 1.1);
    expect(Math.hypot(center.x, center.z)).toBeLessThan(r);
    const far = camera(new Vector3(0, 120, -300), new Vector3(0, 100, 100));
    expect(fitShadowBox(far, frame, focus, center)).toBeGreaterThan(SHADOW_BOX_MAX * 0.9);
    expect(Math.hypot(center.x, center.z)).toBeLessThanOrEqual(SHADOW_BOX_MAX * 0.6 + 1e-6);
  });
});
