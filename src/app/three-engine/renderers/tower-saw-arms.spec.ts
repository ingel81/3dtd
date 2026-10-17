import { describe, it, expect } from 'vitest';
import { Group, Object3D, Vector3 } from 'three';
import { TOWER_TYPES } from '../../configs/tower-types.config';
import { SawArms } from './tower-saw-arms';

/** The Chainsaw's turret part with its three saws where the model docks them */
function turret(): Object3D {
  const part = new Group();
  part.name = 'turret_top';
  for (const arm of TOWER_TYPES.chainsaw.sawArms!) {
    const saw = new Object3D();
    saw.name = arm.node;
    saw.position.set(arm.socket[0], arm.socket[1] - 0.1, arm.socket[2] + 0.1);
    part.add(saw);
  }
  part.updateMatrixWorld(true);
  return part;
}

describe('SawArms', () => {
  it('rest docked, go out to their targets within 0.8 s and come home without one', () => {
    const part = turret();
    const arms = new SawArms(TOWER_TYPES.chainsaw, part);
    const saw = part.getObjectByName('saw_down')!;
    const home = saw.position.clone();
    expect(arms.mesh.count).toBeGreaterThan(0);

    const target = new Vector3(0, 0, 3);
    arms.setTargets([target, null, null]);
    for (let i = 0; i < 48; i++) arms.update(1 / 60);
    // At the target, its mount short of it
    expect(saw.position.distanceTo(target)).toBeLessThan(0.6);
    expect(saw.scale.x).toBeCloseTo(1.25, 5);
    expect(part.getObjectByName('saw_up')!.position.distanceTo(home)).toBeLessThan(1);

    arms.setTargets([]);
    for (let i = 0; i < 48; i++) arms.update(1 / 60);
    expect(saw.position.distanceTo(home)).toBeLessThan(1e-6);
    arms.dispose();
    expect(part.getObjectByName('saw_arms')).toBeUndefined();
  });

  it('unfold first, then reach; at work a saw swings over to a new enemy, never jumps (E221)', () => {
    const part = turret();
    const arms = new SawArms(TOWER_TYPES.chainsaw, part);
    const saw = part.getObjectByName('saw_down')!;
    const spec = TOWER_TYPES.chainsaw.sawArms![0];
    const socket = new Vector3(...spec.socket);
    arms.setTargets([new Vector3(0, 0, 3), null, null]);
    // A quarter of a second out: still unfolding near its socket, not yet across the road
    for (let i = 0; i < 15; i++) arms.update(1 / 60);
    expect(saw.position.distanceTo(socket)).toBeLessThan(1.4);
    expect(saw.position.z).toBeLessThan(1.6);
    for (let i = 0; i < 40; i++) arms.update(1 / 60);
    // The enemy dies, the next stands 2 units to the side: the saw goes over in steps, not at once
    arms.setTargets([new Vector3(1.6, 0, 2.6), null, null]);
    let largest = 0;
    let last = saw.position.clone();
    for (let i = 0; i < 60; i++) {
      arms.update(1 / 60);
      largest = Math.max(largest, saw.position.distanceTo(last));
      last = saw.position.clone();
    }
    expect(largest).toBeLessThan(0.15);
    expect(saw.position.distanceTo(new Vector3(1.6, 0, 2.6))).toBeLessThan(0.6);
  });

  it('keep each arm on its enemy and its side, and two saws apart (E221)', () => {
    const part = turret();
    const arms = new SawArms(TOWER_TYPES.chainsaw, part);
    const near = new Vector3(0, 0, 2.2);
    const right = new Vector3(2.4, 0, 0.6);
    const far = new Vector3(-0.4, 0, 3.6);
    arms.setTargets([near, right, far]);
    for (let i = 0; i < 60; i++) arms.update(1 / 60);
    // The side arm (out to +x) takes the enemy on the right
    expect(part.getObjectByName('saw_side')!.position.distanceTo(right)).toBeLessThan(0.6);
    const before = ['saw_down', 'saw_side', 'saw_up'].map((n) => part.getObjectByName(n)!.position.clone());
    // The simulation lists them in another order next frame: no arm trades its enemy
    arms.setTargets([far, near, right]);
    arms.update(1 / 60);
    ['saw_down', 'saw_side', 'saw_up'].forEach((n, i) => expect(part.getObjectByName(n)!.position.distanceTo(before[i])).toBeLessThan(0.05));
    // Two enemies on one spot: the saws keep apart
    arms.setTargets([near, near.clone(), null]);
    for (let i = 0; i < 90; i++) arms.update(1 / 60);
    const out = ['saw_down', 'saw_side', 'saw_up'].map((n) => part.getObjectByName(n)!.position).filter((p) => p.distanceTo(near) < 1);
    expect(out).toHaveLength(2);
    expect(out[0].distanceTo(out[1])).toBeGreaterThan(0.5);
    arms.dispose();
  });

  it('draws more vertebrae the farther an arm reaches', () => {
    const part = turret();
    const arms = new SawArms(TOWER_TYPES.chainsaw, part);
    const docked = arms.mesh.count;
    arms.setTargets([new Vector3(0, 0, 3.4), new Vector3(1, 0, 3), new Vector3(-1, 0, 3.4)]);
    for (let i = 0; i < 48; i++) arms.update(1 / 60);
    expect(arms.mesh.count).toBeGreaterThan(docked + 40);
    arms.dispose();
  });
});
