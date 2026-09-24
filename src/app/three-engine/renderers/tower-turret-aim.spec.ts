import { describe, it, expect } from 'vitest';
import { Object3D, Vector3 } from 'three';
import type { TowerTypeConfig } from '../../configs/tower-types.config';
import { createTurretPitch, drawTurretAim } from './tower-turret-aim';
import type { TowerAim } from '../../entities/tower-aim';

const config = {
  turretBarrelOffset: -Math.PI / 2,
  pitchNodes: ['gun_left', 'gun_right'],
  pitchRange: { min: -0.4, max: 0.7 },
} as TowerTypeConfig;

function gatling() {
  const top = new Object3D();
  for (const name of ['gun_left', 'gun_right', 'saddle']) {
    const node = new Object3D();
    node.name = name;
    top.add(node);
  }
  return top;
}

const aimOf = (current: number, pitch: number) => ({ current, pitch }) as TowerAim;

describe('createTurretPitch', () => {
  it('finds only the configured nodes under the turret', () => {
    const pitch = createTurretPitch(config, gatling())!;
    expect(pitch.nodes.map((n) => n.name)).toEqual(['gun_left', 'gun_right']);
    expect(createTurretPitch({ ...config, pitchNodes: ['missing'] }, gatling())).toBeUndefined();
  });
});

describe('drawTurretAim', () => {
  it('turns the turret part to the aim heading under the mesh', () => {
    const top = gatling();
    drawTurretAim(config, 0.4, top, undefined, aimOf(1.2, 0));
    // headingToLocalRotation: -heading - barrel offset - mesh rotation
    expect(top.rotation.y).toBeCloseTo(-1.2 + Math.PI / 2 - 0.4, 12);
  });

  it('raises the muzzle for a positive pitch, barrels along -X, and leaves the tilt alone while it holds', () => {
    const top = gatling();
    const pitch = createTurretPitch(config, top)!;
    drawTurretAim(config, 0, top, pitch, aimOf(0, 0.5));
    const muzzle = new Vector3(-1, 0, 0).applyQuaternion(pitch.nodes[0].quaternion);
    expect(muzzle.y).toBeCloseTo(Math.sin(0.5), 12);
    expect(muzzle.x).toBeCloseTo(-Math.cos(0.5), 12);
    expect(pitch.nodes[1].quaternion.equals(pitch.nodes[0].quaternion)).toBe(true);

    // Same pitch: the nodes are not written again
    pitch.nodes[0].quaternion.set(0, 0, 0, 1);
    drawTurretAim(config, 0, top, pitch, aimOf(0, 0.5));
    expect(pitch.nodes[0].quaternion.w).toBe(1);
  });

  it('draws nothing without a turret part', () => {
    expect(() => drawTurretAim(config, 0, null, undefined, aimOf(1, 0))).not.toThrow();
  });
});
