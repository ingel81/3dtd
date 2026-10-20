import { describe, it, expect } from 'vitest';
import { BoxGeometry, Mesh, MeshBasicMaterial, Object3D, Quaternion, Vector3 } from 'three';
import type { TowerTypeConfig } from '../../configs/tower-types.config';
import { headingToLocalRotation, type TowerAim } from '../../entities/tower-aim';
import { TOWER_TYPES } from '../../configs/tower-types.config';
import { towerConfigOf } from '../../configs/tower-paths.config';
import { RELOAD_PHASES, TowerFiring, kickCurve, loadCurve, releaseCurve } from './tower-firing-motion';
import { createTurretPitch, drawTurretAim } from './tower-turret-aim';

describe('kickCurve', () => {
  it('rises to the peak in kickS, comes home a little past and is exactly 0 at the end', () => {
    expect(kickCurve(0, 0.05, 0.5)).toBe(0);
    expect(kickCurve(0.025, 0.05, 0.5)).toBeGreaterThan(0.8);
    expect(kickCurve(0.05, 0.05, 0.5)).toBeCloseTo(1, 12);
    let previous = 0;
    for (let t = 0.001; t < 0.05; t += 0.001) {
      const x = kickCurve(t, 0.05, 0.5);
      expect(x).toBeGreaterThan(previous);
      previous = x;
    }
    const samples = Array.from({ length: 500 }, (_, i) => kickCurve(0.05 + (i / 500) * 0.5, 0.05, 0.5));
    const lowest = Math.min(...samples);
    expect(lowest).toBeLessThan(-0.01);
    expect(lowest).toBeGreaterThan(-0.05);
    expect(kickCurve(0.55, 0.05, 0.5)).toBe(0);
    expect(kickCurve(0.5499, 0.05, 0.5)).toBeCloseTo(0, 3);
  });
});

describe('the reload curves', () => {
  it('slackens the string at once, shivers, hangs and draws it again by drawTo', () => {
    const T = 2;
    expect(releaseCurve(0, T)).toBe(0);
    expect(releaseCurve(0.035, T)).toBeCloseTo(1, 6);
    const shiver = Array.from({ length: 50 }, (_, i) => releaseCurve(0.035 + i * 0.004, T));
    expect(Math.max(...shiver)).toBeGreaterThan(1.05);
    expect(releaseCurve(RELOAD_PHASES.drawFrom * T - 0.001, T)).toBeCloseTo(1, 2);
    expect(releaseCurve(((RELOAD_PHASES.drawFrom + RELOAD_PHASES.drawTo) / 2) * T, T)).toBeCloseTo(0.5, 6);
    expect(releaseCurve(RELOAD_PHASES.drawTo * T, T)).toBe(0);
  });

  it('brings the next shot in after the string is drawn, seating with a knock', () => {
    const T = 2;
    expect(loadCurve(RELOAD_PHASES.loadFrom * T, T)).toBe(0);
    expect(loadCurve(RELOAD_PHASES.loadTo * T, T)).toBe(1);
    const path = Array.from({ length: 100 }, (_, i) => loadCurve((RELOAD_PHASES.loadFrom + (i / 100) * (RELOAD_PHASES.loadTo - RELOAD_PHASES.loadFrom)) * T, T));
    expect(Math.max(...path)).toBeGreaterThan(1);
    expect(Math.max(...path)).toBeLessThan(1.15);
  });
});

/** A turret with a gun on its trunnions, barrel along -X, as the Iron Bastion */
function bastion() {
  const model = new Object3D();
  const turret = new Object3D();
  turret.name = 'turret_top';
  turret.position.set(0, 0.44, 0);
  const gun = new Object3D();
  gun.name = 'gun';
  gun.position.set(-0.09, 0.32, 0);
  model.add(turret);
  turret.add(gun);
  return { model, turret, gun };
}

const bastionConfig = {
  ...TOWER_TYPES.bastion,
  firingMotion: {
    kick: [{ node: 'gun', back: 0.1, tilt: 0.05 }, { node: 'turret_top', back: 0.01, tilt: 0.02 }],
    kickS: 0.05,
    returnS: 0.5,
  },
} as TowerTypeConfig;

/** One render frame as the renderer draws it: the aim, then the firing motion */
function frame(firing: TowerFiring, config: TowerTypeConfig, turret: Object3D, aim: TowerAim, pitch: ReturnType<typeof createTurretPitch>, dt: number): boolean {
  drawTurretAim(config, 0, turret, pitch, aim);
  return firing.update(dt);
}

describe('TowerFiring', () => {
  it('is null without a firing motion or without any of its nodes in the model', () => {
    const { model, turret } = bastion();
    const aim = { current: 0, pitch: 0 } as TowerAim;
    expect(TowerFiring.create({ ...bastionConfig, firingMotion: undefined }, model, turret, undefined, aim)).toBeNull();
    expect(TowerFiring.create({ ...bastionConfig, firingMotion: { kick: [{ node: 'nope', back: 1 }] } }, model, turret, undefined, aim)).toBeNull();
  });

  it('slides the gun back along its pitched barrel and climbs on top of the aim pitch, then back to rest', () => {
    const { model, turret, gun } = bastion();
    const aim = { current: 0.7, pitch: 0.3 } as TowerAim;
    const pitch = createTurretPitch(bastionConfig, turret);
    const firing = TowerFiring.create(bastionConfig, model, turret, pitch, aim)!;
    const rest = gun.position.clone();
    frame(firing, bastionConfig, turret, aim, pitch, 0);
    const yaw = turret.rotation.y;
    firing.fire(0.75);
    expect(frame(firing, bastionConfig, turret, aim, pitch, 0.05)).toBe(true);
    // Back along the barrel: -X turned up by the pitch, so back is +X and down
    const moved = gun.position.clone().sub(rest);
    expect(moved.length()).toBeCloseTo(0.1, 6);
    expect(moved.x).toBeCloseTo(0.1 * Math.cos(0.3), 6);
    expect(moved.y).toBeCloseTo(-0.1 * Math.sin(0.3), 6);
    const muzzle = new Vector3(-1, 0, 0).applyQuaternion(gun.quaternion);
    expect(Math.asin(muzzle.y)).toBeCloseTo(0.35, 6);
    // The turret rocks on its yaw: it still faces the aim
    const facing = new Vector3(-1, 0, 0).applyQuaternion(turret.quaternion);
    expect(facing.x).toBeCloseTo(-Math.cos(yaw) * Math.cos(0.02), 6);
    expect(facing.z).toBeCloseTo(Math.sin(yaw) * Math.cos(0.02), 6);
    expect(facing.y).toBeCloseTo(Math.sin(0.02), 6);

    // Home again, aim and all
    let moving = true;
    for (let i = 0; i < 100 && moving; i++) moving = frame(firing, bastionConfig, turret, aim, pitch, 0.016);
    expect(moving).toBe(false);
    frame(firing, bastionConfig, turret, aim, pitch, 0.016);
    expect(gun.position.distanceTo(rest)).toBeLessThan(1e-12);
    expect(Math.asin(new Vector3(-1, 0, 0).applyQuaternion(gun.quaternion).y)).toBeCloseTo(0.3, 9);
    expect(turret.rotation.x).toBeCloseTo(0, 12);
    expect(turret.rotation.z).toBeCloseTo(0, 12);
    expect(turret.rotation.y).toBeCloseTo(yaw, 12);
  });

  it('leaves a turret turned past a quarter turn where its aim points, during the kick and once it is home', () => {
    // Heading -0.7 turns the turret 2.27 rad in its mesh: its quaternion reads back as Euler (π, π - yaw, π)
    const { model, turret } = bastion();
    const aim = { current: -0.7, pitch: 0 } as TowerAim;
    const pitch = createTurretPitch(bastionConfig, turret);
    const firing = TowerFiring.create(bastionConfig, model, turret, pitch, aim)!;
    const yawOff = (): number => {
      const want = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), headingToLocalRotation(bastionConfig, 0, aim.current));
      return turret.quaternion.angleTo(want);
    };
    frame(firing, bastionConfig, turret, aim, pitch, 0);
    firing.fire(0.75);
    for (let i = 0; i < 10; i++) {
      aim.current -= 0.02;
      frame(firing, bastionConfig, turret, aim, pitch, 0.016);
      // Off by no more than the rock on its yaw
      expect(yawOff()).toBeLessThan(0.021);
    }
    while (frame(firing, bastionConfig, turret, aim, pitch, 0.016));
    // Home: the aim turns on, the turret with it (it turned to the mirrored heading, off by up to 180°)
    for (const heading of [-0.7, -0.9, -1.2, -1.7]) {
      aim.current = heading;
      frame(firing, bastionConfig, turret, aim, pitch, 0.016);
      expect(yawOff()).toBeLessThan(1e-6);
    }
  });

  it('shortens the return to fit between two shots', () => {
    const { model, turret, gun } = bastion();
    const aim = { current: 0, pitch: 0 } as TowerAim;
    const pitch = createTurretPitch(bastionConfig, turret);
    const firing = TowerFiring.create(bastionConfig, model, turret, pitch, aim)!;
    firing.fire(4); // 0.25 s between shots: home by 0.85 of it
    let t = 0;
    while (frame(firing, bastionConfig, turret, aim, pitch, 0.01)) t += 0.01;
    expect(t).toBeLessThan(0.22);
    expect(gun.position.x).toBeCloseTo(-0.09, 12);
  });

  it('kicks one part per shot in turn when they alternate', () => {
    const top = new Object3D();
    const left = new Object3D();
    left.name = 'gun_left';
    const right = new Object3D();
    right.name = 'gun_right';
    top.add(left, right);
    const config = {
      ...TOWER_TYPES['dual-gatling'],
      firingMotion: { kick: [{ node: 'gun_left', back: 0.1 }, { node: 'gun_right', back: 0.1 }], alternate: true, kickS: 0.02, returnS: 0.1 },
    } as TowerTypeConfig;
    const aim = { current: 0, pitch: 0 } as TowerAim;
    const pitch = createTurretPitch(config, top);
    const firing = TowerFiring.create(config, top, top, pitch, aim)!;
    firing.fire(5);
    frame(firing, config, top, aim, pitch, 0.02);
    expect(left.position.length()).toBeCloseTo(0.1, 6);
    expect(right.position.length()).toBe(0);
    firing.fire(5);
    frame(firing, config, top, aim, pitch, 0.02);
    expect(right.position.length()).toBeCloseTo(0.1, 6);
  });

  it('takes the shot off the model, slackens and draws the string, turns the winch and loads the next shot', () => {
    const model = new Object3D();
    const turret = new Object3D();
    turret.name = 'turret_top';
    const weapon = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    weapon.name = 'weapon';
    weapon.morphTargetDictionary = { relaxed: 0 };
    weapon.morphTargetInfluences = [0];
    const bolt = new Object3D();
    bolt.name = 'bolt';
    bolt.position.set(-0.3, 0, 0);
    const winch = new Object3D();
    winch.name = 'winch';
    model.add(turret);
    turret.add(weapon);
    weapon.add(bolt, winch);
    const config = {
      ...towerConfigOf('archer', 'sniper'),
      firingMotion: {
        reload: {
          seconds: 2, ammoNode: 'bolt', ammoFrom: [0, 0.2, 0] as const,
          release: { node: 'weapon', target: 'relaxed' },
          winch: { node: 'winch', axis: [0, 0, 1] as const, turns: 0.5 },
        },
      },
    } as TowerTypeConfig;
    const aim = { current: 0, pitch: 0 } as TowerAim;
    const firing = TowerFiring.create(config, model, turret, undefined, aim)!;
    firing.fire(0.25); // 4 s between shots: the reload takes its 2 s
    expect(bolt.visible).toBe(false);
    firing.update(0.1);
    expect(weapon.morphTargetInfluences[0]).toBeGreaterThan(0.85);
    expect(bolt.visible).toBe(false);
    firing.update(RELOAD_PHASES.drawTo * 2 - 0.1);
    expect(weapon.morphTargetInfluences[0]).toBe(0);
    expect(winch.quaternion.angleTo(new Object3D().quaternion)).toBeCloseTo(Math.PI, 6);
    firing.update((RELOAD_PHASES.loadFrom + 0.01) * 2 - RELOAD_PHASES.drawTo * 2);
    expect(bolt.visible).toBe(true);
    expect(bolt.position.y).toBeGreaterThan(0.15);
    let moving = true;
    while (moving) moving = firing.update(0.016);
    expect(bolt.position.distanceTo(new Vector3(-0.3, 0, 0))).toBeLessThan(1e-12);
    expect(bolt.visible).toBe(true);

    // A shot while the string is drawn keeps the winch's turn: it does not run back
    firing.fire(0.25);
    firing.update(((RELOAD_PHASES.drawFrom + RELOAD_PHASES.drawTo) / 2) * 2);
    const half = winch.quaternion.clone();
    firing.fire(0.25);
    firing.update(0.001);
    expect(winch.quaternion.angleTo(half)).toBeLessThan(1e-3);
  });

  it('reloads faster when the tower fires faster', () => {
    const model = new Object3D();
    const bolt = new Object3D();
    bolt.name = 'bolt';
    model.add(bolt);
    const config = { ...TOWER_TYPES.archer, firingMotion: { reload: { seconds: 2.4, ammoNode: 'bolt', ammoFrom: [0, 0.1, 0] as const } } } as TowerTypeConfig;
    const firing = TowerFiring.create(config, model, null, undefined, { current: 0, pitch: 0 } as TowerAim)!;
    firing.fire(1); // 1 s between shots: loaded by 0.9 s
    let t = 0;
    while (firing.update(0.01)) t += 0.01;
    expect(t).toBeCloseTo(0.9, 1);
  });
});
