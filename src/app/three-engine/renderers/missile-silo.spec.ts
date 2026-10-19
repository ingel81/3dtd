import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Group, Quaternion, Vector3, type Object3D } from 'three';
import { createMissileStart, launchSiteLoaded, missileStartAt } from './missile-silo';
import type { TowerRenderData } from './three-tower.renderer';
import { lockedAbilityStatus, type AbilityStatus } from '../../configs/abilities.config';
import { TOWER_TYPES } from '../../configs/tower-types.config';
import { MISSILE_LAUNCH_LOOK } from '../../configs/visual-effects.config';
import { parsePackedGlb } from '../../../test/packed-glb';

const SILO = TOWER_TYPES['missile-silo'];
const UP = new Vector3(0, 1, 0);

/** missile_silo.glb as the game loads it, without its texture */
async function loadSilo(): Promise<Object3D> {
  return (await parsePackedGlb(readFileSync(resolve('public', SILO.modelUrl)))).scene;
}

/** The silo placed as ThreeTowerRenderer.create places a tower: scale, turn and position on the mesh */
function placed(model: Object3D, site: Vector3, customRotation: number): TowerRenderData {
  const mesh = model.clone();
  mesh.scale.setScalar(SILO.scale);
  mesh.rotation.y = (SILO.rotationY ?? 0) + customRotation;
  mesh.position.set(site.x, site.y + SILO.heightOffset, site.z);
  return { mesh, typeConfig: SILO } as unknown as TowerRenderData;
}

function status(charges: number, pending: boolean): AbilityStatus {
  return { ...lockedAbilityStatus('nuclear-strike'), unlocked: true, launchSite: true, charges, pending };
}

describe('launchSiteLoaded', () => {
  it('shows the missile while a charge is ready and no strike is on its way', () => {
    expect(launchSiteLoaded(status(1, false))).toBe(true);
    // Fired: the charge is spent and the strike on its way
    expect(launchSiteLoaded(status(0, true))).toBe(false);
    // Landed, the charge not back yet
    expect(launchSiteLoaded(status(0, false))).toBe(false);
    // Back while one is still on its way (a charge refilled by the cheat)
    expect(launchSiteLoaded(status(1, true))).toBe(false);
    // Before the research
    expect(launchSiteLoaded(lockedAbilityStatus('nuclear-strike'))).toBe(false);
  });
});

describe('missileStartAt', () => {
  const SITE = new Vector3(120, 34, -80);

  it('starts where the missile node stands in the placed silo model, turned with the silo and at its scale', async () => {
    const model = await loadSilo();
    const yaw = 0.9;
    const start = missileStartAt(placed(model, SITE, yaw), 'missile-silo', SITE, createMissileStart());

    const node = model.getObjectByName(MISSILE_LAUNCH_LOOK.missile.node)!;
    const expected = node.position.clone().multiplyScalar(SILO.scale).applyAxisAngle(UP, yaw).add(SITE);
    expect(start.nozzle.distanceTo(expected)).toBeLessThan(1e-4);
    // The asset's numbers: nozzle 2.30 m over the base, the building 10.4 m high
    expect(start.nozzle.y - SITE.y).toBeCloseTo(2.3, 2);
    expect(start.turn.angleTo(new Quaternion().setFromAxisAngle(UP, yaw))).toBeLessThan(1e-6);
    expect(start.scale).toBeCloseTo(SILO.scale, 6);
    expect(start.shaftTop).toBeCloseTo(10.38, 1);
    expect(start.site).toEqual(SITE);
  });

  it('falls back to the look values, which match the model, without the silo or without its missile node', async () => {
    const model = await loadSilo();
    const fromModel = missileStartAt(placed(model, SITE, 0), 'missile-silo', SITE, createMissileStart());

    for (const tower of [undefined, { mesh: new Group(), typeConfig: SILO } as unknown as TowerRenderData]) {
      const start = missileStartAt(tower, 'missile-silo', SITE, createMissileStart());
      expect(start.nozzle).toEqual(new Vector3(SITE.x, SITE.y + MISSILE_LAUNCH_LOOK.missile.baseHeight, SITE.z));
      expect(start.turn.angleTo(new Quaternion().setFromAxisAngle(UP, SILO.rotationY ?? 0))).toBeLessThan(1e-6);
      expect(start.scale).toBe(SILO.scale);
      expect(start.shaftTop).toBe(MISSILE_LAUNCH_LOOK.shaftTop);
      // Within 10 cm of where the model has them (the node stands a few centimetres off the middle)
      expect(start.nozzle.distanceTo(fromModel.nozzle)).toBeLessThan(0.1);
      expect(Math.abs(start.shaftTop - fromModel.shaftTop)).toBeLessThan(0.1);
    }
  });
});
