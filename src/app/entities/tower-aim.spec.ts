import { describe, it, expect } from 'vitest';
import { TOWER_TYPES, type TowerTypeConfig } from '../configs/tower-types.config';
import {
  aimAt, aimIdle, aimPitch, aimPitchTowards, createTowerAim, headingToLocalRotation, isAimAligned,
  localRotationToHeading, releaseAim, stepTowerAim, towerAimError, TURRET_ALIGN_TOLERANCE, type TowerAim,
} from './tower-aim';

const STEP_MS = 1000 / 60;

/** An aim at rest on heading 0, no sweep; `overrides` on top. */
function aimOf(overrides: Partial<TowerAim> = {}): TowerAim {
  return {
    turret: true,
    current: 0,
    target: 0,
    hasTarget: false,
    scanPhase: 0,
    scanStart: 0,
    scanDelayRemaining: 0,
    pitch: 0,
    pitchTarget: 0,
    pitchMin: -0.4,
    pitchMax: 0.7,
    ...overrides,
  };
}

const run = (aim: TowerAim, ms: number) => {
  for (let t = 0; t < ms; t += STEP_MS) stepTowerAim(aim, STEP_MS);
};

describe('headingToLocalRotation', () => {
  it('turns a geo heading into the rotation under the tower mesh, barrel offset included', () => {
    const config = { turretBarrelOffset: -Math.PI / 2 } as TowerTypeConfig;
    expect(headingToLocalRotation({} as TowerTypeConfig, 0, Math.PI / 2)).toBeCloseTo(-Math.PI / 2, 12);
    expect(headingToLocalRotation(config, 0.4, 0)).toBeCloseTo(Math.PI / 2 - 0.4, 12);
  });

  it('is reversed by localRotationToHeading', () => {
    const config = { turretBarrelOffset: 1.047 } as TowerTypeConfig;
    const local = headingToLocalRotation(config, 0.4, 2.2);
    expect(localRotationToHeading(config, 0.4, local)).toBeCloseTo(2.2, 12);
    expect(localRotationToHeading({} as TowerTypeConfig, 0.4, headingToLocalRotation({} as TowerTypeConfig, 0.4, -1)))
      .toBeCloseTo(-1, 12);
  });
});

describe('createTowerAim', () => {
  it('points where the placement preview showed the turret: the model rest pose under the placed mesh', () => {
    const ice = TOWER_TYPES.ice;
    const aim = createTowerAim(ice, 0.3);
    const meshRotation = (ice.rotationY ?? 0) + 0.3;
    // The turret node as the model file turns it
    expect(headingToLocalRotation(ice, meshRotation, aim.current)).toBeCloseTo(ice.turretRestY!, 12);
    expect(aim.target).toBe(aim.current);
    expect(aim.scanStart).toBe(aim.current);
  });

  it('sweeps after 800 ms with a turret part, not without', () => {
    const cannon = createTowerAim(TOWER_TYPES.cannon, 0);
    expect(cannon.turret).toBe(true);
    expect(cannon.scanPhase).toBe(1);
    expect(cannon.scanDelayRemaining).toBe(800);

    const archer = createTowerAim(TOWER_TYPES.archer, 0);
    expect(archer.turret).toBe(false);
    expect(archer.scanPhase).toBe(0);
    expect(archer.scanDelayRemaining).toBe(0);
  });

  it('gives guns without pitch nodes no tilt range', () => {
    const cannon = createTowerAim(TOWER_TYPES.cannon, 0);
    aimPitch(cannon, 0.5);
    expect(cannon.pitchTarget).toBe(0);
    const gatling = createTowerAim(TOWER_TYPES['dual-gatling'], 0);
    aimPitch(gatling, 5);
    expect(gatling.pitchTarget).toBe(TOWER_TYPES['dual-gatling'].pitchRange!.max);
  });
});

describe('stepTowerAim', () => {
  it('turns towards the target at π rad/s and snaps onto it', () => {
    const aim = aimOf();
    aimAt(aim, 1);
    stepTowerAim(aim, 100);
    expect(aim.current).toBeCloseTo(Math.PI * 0.1, 12);
    run(aim, 300);
    expect(aim.current).toBe(1);
  });

  it('takes the short way round', () => {
    const aim = aimOf({ current: 3, target: -3 });
    stepTowerAim(aim, 10);
    expect(aim.current).toBeGreaterThan(3);
  });

  it('sweeps to either side after its delay, back to the start, then stops scanning', () => {
    const aim = aimOf({ scanPhase: 1, scanDelayRemaining: 800 });
    run(aim, 790);
    expect(aim.current).toBe(0);
    let min = 0;
    let max = 0;
    let firstMove = 0;
    for (let t = 0; t < 6000 && aim.scanPhase > 0; t += STEP_MS) {
      stepTowerAim(aim, STEP_MS);
      if (firstMove === 0) firstMove = aim.current;
      min = Math.min(min, aim.current);
      max = Math.max(max, aim.current);
    }
    expect(aim.scanPhase).toBe(0);
    // First towards the larger heading, the smaller turret rotation
    expect(firstMove).toBeGreaterThan(0);
    expect(min).toBeCloseTo(-1.309, 9);
    expect(max).toBeCloseTo(1.309, 9);
    expect(aim.current).toBe(0);
  });

  it('breaks off the sweep for a target', () => {
    const aim = aimOf({ scanPhase: 2 });
    aimAt(aim, 0.5);
    run(aim, 1000);
    expect(aim.scanPhase).toBe(0);
    expect(aim.current).toBe(0.5);
  });

  it('turns the aim of a tower without a turret part like any other', () => {
    const bare = aimOf({ turret: false });
    aimIdle(bare, 1);
    run(bare, 500);
    expect(bare.current).toBe(1);
  });

  it('holds the last aim once the target is gone, after finishing the turn it is in', () => {
    const aim = aimOf();
    aimAt(aim, Math.PI / 2);
    run(aim, 250); // halfway
    releaseAim(aim);
    run(aim, 3000);
    expect(aim.hasTarget).toBe(false);
    expect(aim.current).toBe(Math.PI / 2);
  });

  it('tilts at π rad/s towards the pitch target and levels out on the guard heading', () => {
    const aim = aimOf();
    aimPitch(aim, -0.4);
    stepTowerAim(aim, 100);
    expect(aim.pitch).toBeCloseTo(-Math.PI * 0.1, 12);
    expect(aim.current).toBe(0);
    run(aim, 1000);
    expect(aim.pitch).toBe(-0.4);
    aimIdle(aim, 0);
    run(aim, 1000);
    expect(aim.pitch).toBe(0);
  });
});

describe('aimPitchTowards', () => {
  it('clamps the angle to the target to the gun range', () => {
    const aim = aimOf();
    aimPitchTowards(aim, 1, 1);
    expect(aim.pitchTarget).toBe(0.7);
    aimPitchTowards(aim, -10, 1);
    expect(aim.pitchTarget).toBe(-0.4);
    aimPitchTowards(aim, -1, 10);
    expect(aim.pitchTarget).toBeCloseTo(Math.atan2(-1, 10), 12);
  });
});

describe('towerAimError and isAimAligned', () => {
  it('measures the short way round', () => {
    expect(towerAimError(aimOf({ current: 3, target: -3 }))).toBeCloseTo(2 * Math.PI - 6, 12);
  });

  it('holds fire of a turret off its target, never of a tower without one', () => {
    const turret = aimOf({ target: TURRET_ALIGN_TOLERANCE * 2 });
    expect(isAimAligned(turret)).toBe(false);
    expect(isAimAligned(turret, TURRET_ALIGN_TOLERANCE * 3)).toBe(true);
    turret.current = TURRET_ALIGN_TOLERANCE;
    expect(isAimAligned(turret)).toBe(true);
    expect(isAimAligned(aimOf({ turret: false, target: Math.PI }))).toBe(true);
  });
});
