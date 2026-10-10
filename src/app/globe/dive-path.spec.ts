import { describe, expect, it } from 'vitest';
import { Matrix4, Quaternion, Vector3 } from 'three';
import {
  HANDOVER_ALTITUDE,
  altitudeAt,
  diveDurations,
  divePoseAt,
  easeIn,
  easeOut,
  headingOf,
  nadirMatrix,
  planDive,
  progressAt,
  UPPER_WARM_ALTITUDES,
  warmPoses,
} from './dive-path';

/** The game's start view: 400 m up, 145 m south of the HQ, looking at it (camera-rig.ts) */
function gameView(): Matrix4 {
  const m = new Matrix4();
  const eye = new Vector3(0, 400, -145);
  m.lookAt(eye, new Vector3(0, 0, 0), new Vector3(0, 1, 0));
  return m.setPosition(eye);
}

function forwardOf(m: Matrix4): Vector3 {
  const q = new Quaternion();
  m.decompose(new Vector3(), q, new Vector3());
  return new Vector3(0, 0, -1).applyQuaternion(q);
}

function upOf(m: Matrix4): Vector3 {
  const q = new Quaternion();
  m.decompose(new Vector3(), q, new Vector3());
  return new Vector3(0, 1, 0).applyQuaternion(q);
}

describe('dive-path', () => {
  it('reads the heading of a view looking north', () => {
    expect(headingOf(gameView()).toArray().map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 0, 1]);
  });

  it('looks straight down with the screen top along the heading', () => {
    const m = nadirMatrix(1000, new Vector3(1, 0, 0), new Matrix4());
    expect(forwardOf(m).y).toBeCloseTo(-1, 9);
    expect(upOf(m).x).toBeCloseTo(1, 9);
    expect(new Vector3().setFromMatrixPosition(m).y).toBe(1000);
  });

  it('starts straight above the HQ and ends in the game view exactly', () => {
    const plan = planDive(gameView());
    const start = divePoseAt(plan, 0, new Matrix4());
    const end = divePoseAt(plan, 1, new Matrix4());
    const p = new Vector3().setFromMatrixPosition(start);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(HANDOVER_ALTITUDE, 3);
    expect(p.z).toBeCloseTo(0, 6);
    expect(forwardOf(start).y).toBeCloseTo(-1, 6);
    expect(end.equals(gameView())).toBe(true);
  });

  it('halves the height in equal steps of progress', () => {
    const plan = planDive(gameView());
    const a = altitudeAt(plan, 0.25);
    const b = altitudeAt(plan, 0.5);
    const c = altitudeAt(plan, 0.75);
    expect(a / b).toBeCloseTo(b / c, 6);
    expect(progressAt(plan, b)).toBeCloseTo(0.5, 6);
  });

  it('keeps looking down high up and turns to the view only near the end', () => {
    const plan = planDive(gameView());
    expect(forwardOf(divePoseAt(plan, 0.5, new Matrix4())).y).toBeCloseTo(-1, 6);
    const late = forwardOf(divePoseAt(plan, 0.9, new Matrix4()));
    expect(late.y).toBeGreaterThan(-1);
    expect(late.y).toBeLessThan(forwardOf(gameView()).y + 0.5);
  });

  it('never dips below the view on the way down', () => {
    const plan = planDive(gameView());
    let last = Infinity;
    for (let i = 0; i <= 100; i++) {
      const y = new Vector3().setFromMatrixPosition(divePoseAt(plan, i / 100, new Matrix4())).y;
      expect(y).toBeLessThanOrEqual(last + 1e-6);
      expect(y).toBeGreaterThanOrEqual(400 - 1e-6);
      last = y;
    }
  });

  it('warms poses from the top, the game view left out', () => {
    const plan = planDive(gameView());
    const poses = warmPoses(plan);
    expect(poses).toHaveLength(6);
    expect(new Vector3().setFromMatrixPosition(poses[0]).y).toBeCloseTo(HANDOVER_ALTITUDE, 3);
    expect(new Vector3().setFromMatrixPosition(poses[5]).y).toBeGreaterThan(400);
  });

  it('warms the same poses above the HQ for any view the place ends in', () => {
    const low = warmPoses(planDive(gameView()), true);
    const high = new Matrix4().lookAt(new Vector3(300, 1100, -700), new Vector3(300, 0, 0), new Vector3(0, 1, 0));
    high.setPosition(300, 1100, -700);
    const other = warmPoses(planDive(high), true);
    expect(low).toHaveLength(UPPER_WARM_ALTITUDES);
    low.forEach((pose, i) => {
      const a = new Vector3().setFromMatrixPosition(pose);
      const b = new Vector3().setFromMatrixPosition(other[i]);
      expect(a.distanceTo(b)).toBeLessThan(1e-3 * a.y);
      expect(forwardOf(other[i]).y).toBeCloseTo(-1, 6);
    });
  });

  it('splits a dive so the zoom speed meets at the handover', () => {
    const { globeMs, gameMs } = diveDurations(2, 7, 9000);
    expect(globeMs + gameMs).toBe(9000);
    // Speed of the quadratic eases at the joint: 2 span / duration on each side
    expect((2 * 2) / globeMs).toBeCloseTo((2 * 7) / gameMs, 9);
    const dt = 1e-6;
    expect((easeIn(1) - easeIn(1 - dt)) / dt).toBeCloseTo((easeOut(dt) - easeOut(0)) / dt, 4);
  });
});
