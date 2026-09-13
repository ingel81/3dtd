import { describe, it, expect } from 'vitest';
import { Object3D } from 'three';
import type { TowerTypeConfig } from '../../configs/tower-types.config';
import type { TowerRenderData } from './three-tower.renderer';
import { headingToLocalRotation, stepTurretAim, turretAimError } from './tower-turret-aim';

const STEP_MS = 1000 / 60;

/** The fields of a tower the turret aim reads and writes. */
function turret(overrides: Partial<TowerRenderData> = {}): TowerRenderData {
  return {
    turretPart: new Object3D(),
    typeConfig: { id: 'archer' } as TowerTypeConfig,
    currentLocalRotation: 0,
    targetLocalRotation: 0,
    hasTarget: false,
    scanPhase: 0,
    scanStartRotation: 0,
    scanDelayRemaining: 0,
    ...overrides,
  } as TowerRenderData;
}

const run = (data: TowerRenderData, ms: number) => {
  for (let t = 0; t < ms; t += STEP_MS) stepTurretAim(data, STEP_MS);
};

describe('headingToLocalRotation', () => {
  it('turns a geo heading into the rotation under the tower mesh, barrel offset included', () => {
    const config = { turretBarrelOffset: -Math.PI / 2 } as TowerTypeConfig;
    expect(headingToLocalRotation({} as TowerTypeConfig, 0, Math.PI / 2)).toBeCloseTo(-Math.PI / 2, 12);
    expect(headingToLocalRotation(config, 0.4, 0)).toBeCloseTo(Math.PI / 2 - 0.4, 12);
  });
});

describe('stepTurretAim', () => {
  it('turns towards the target at π rad/s and snaps onto it', () => {
    const data = turret({ targetLocalRotation: 1, hasTarget: true });
    stepTurretAim(data, 100);
    expect(data.currentLocalRotation).toBeCloseTo(Math.PI * 0.1, 12);
    expect(data.turretPart!.rotation.y).toBe(data.currentLocalRotation);
    run(data, 300);
    expect(data.currentLocalRotation).toBe(1);
  });

  it('takes the short way round', () => {
    const data = turret({ currentLocalRotation: 3, targetLocalRotation: -3 });
    stepTurretAim(data, 10);
    expect(data.currentLocalRotation).toBeGreaterThan(3);
  });

  it('sweeps left, right and back after its delay, then stops scanning', () => {
    const data = turret({ scanPhase: 1, scanDelayRemaining: 800 });
    run(data, 790);
    expect(data.currentLocalRotation).toBe(0);
    let min = 0;
    let max = 0;
    for (let t = 0; t < 6000 && data.scanPhase > 0; t += STEP_MS) {
      stepTurretAim(data, STEP_MS);
      min = Math.min(min, data.currentLocalRotation);
      max = Math.max(max, data.currentLocalRotation);
    }
    expect(data.scanPhase).toBe(0);
    expect(min).toBeCloseTo(-1.309, 9);
    expect(max).toBeCloseTo(1.309, 9);
    expect(data.currentLocalRotation).toBe(0);
  });

  it('breaks off the sweep for a target', () => {
    const data = turret({ scanPhase: 2, targetLocalRotation: 0.5, hasTarget: true });
    run(data, 1000);
    expect(data.scanPhase).toBe(0);
    expect(data.currentLocalRotation).toBe(0.5);
  });

  it('turns an idle magic turret to its guard heading like any other', () => {
    const magic = turret({ typeConfig: { id: 'magic' } as TowerTypeConfig, targetLocalRotation: 1 });
    run(magic, 500);
    expect(magic.currentLocalRotation).toBe(1);
  });

  it('leaves a tower without a turret part alone', () => {
    const bare = turret({ turretPart: null, targetLocalRotation: 1 });
    run(bare, 500);
    expect(bare.currentLocalRotation).toBe(0);
  });
});

describe('turretAimError', () => {
  it('measures the short way round', () => {
    expect(turretAimError(turret({ currentLocalRotation: 3, targetLocalRotation: -3 }))).toBeCloseTo(2 * Math.PI - 6, 12);
  });
});
