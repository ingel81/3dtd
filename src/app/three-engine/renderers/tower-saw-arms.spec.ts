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
  it('rest docked, go out to their targets within half a second and come home without one', () => {
    const part = turret();
    const arms = new SawArms(TOWER_TYPES.chainsaw, part);
    const saw = part.getObjectByName('saw_down')!;
    const home = saw.position.clone();
    expect(arms.mesh.count).toBeGreaterThan(0);

    const target = new Vector3(0, 0, 3);
    arms.setTargets([target, null, null]);
    for (let i = 0; i < 30; i++) arms.update(1 / 60);
    // At the target, its mount short of it
    expect(saw.position.distanceTo(target)).toBeLessThan(0.6);
    expect(saw.scale.x).toBeCloseTo(1.25, 5);
    expect(part.getObjectByName('saw_up')!.position.distanceTo(home)).toBeLessThan(1);

    arms.setTargets([]);
    for (let i = 0; i < 30; i++) arms.update(1 / 60);
    expect(saw.position.distanceTo(home)).toBeLessThan(1e-6);
    arms.dispose();
    expect(part.getObjectByName('saw_arms')).toBeUndefined();
  });

  it('draws more vertebrae the farther an arm reaches', () => {
    const part = turret();
    const arms = new SawArms(TOWER_TYPES.chainsaw, part);
    const docked = arms.mesh.count;
    arms.setTargets([new Vector3(0, 0, 3.4), new Vector3(1, 0, 3), new Vector3(-1, 0, 3.4)]);
    for (let i = 0; i < 30; i++) arms.update(1 / 60);
    expect(arms.mesh.count).toBeGreaterThan(docked + 40);
    arms.dispose();
  });
});
