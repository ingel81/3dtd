import { describe, it, expect } from 'vitest';
import { Group, Matrix4, Object3D, Vector3 } from 'three';
import { TOWER_TYPES } from '../../configs/tower-types.config';
import { SawArms } from './tower-saw-arms';

/** Where the model docks the saws, in the turret part's frame (chainsaw.glb) */
const DOCKS: Record<string, [number, number, number]> = {
  saw_down: [-0.016, 0.185, 0.391],
  saw_side: [0.485, 0.327, -0.014],
  saw_up: [-0.016, 0.69, 0.392],
};

/** The Chainsaw's turret part with its three saws where the model docks them */
function turret(): Object3D {
  const part = new Group();
  part.name = 'turret_top';
  for (const arm of TOWER_TYPES.chainsaw.sawArms!) {
    const saw = new Object3D();
    saw.name = arm.node;
    saw.position.set(...DOCKS[arm.node]);
    part.add(saw);
  }
  part.updateMatrixWorld(true);
  return part;
}

describe('SawArms', () => {
  it('rest docked, go out to their targets within 1.2 s and come home without one', () => {
    const part = turret();
    const arms = new SawArms(TOWER_TYPES.chainsaw, part);
    const saw = part.getObjectByName('saw_down')!;
    const home = saw.position.clone();
    expect(arms.mesh.count).toBeGreaterThan(0);

    const target = new Vector3(0, 0, 3);
    arms.setTargets([target, null, null]);
    for (let i = 0; i < 72; i++) arms.update(1 / 60);
    // At the target, its mount short of it
    expect(saw.position.distanceTo(target)).toBeLessThan(0.6);
    expect(saw.scale.x).toBeCloseTo(1.25, 5);
    expect(part.getObjectByName('saw_up')!.position.distanceTo(home)).toBeLessThan(1);

    arms.setTargets([]);
    for (let i = 0; i < 72; i++) arms.update(1 / 60);
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

  it('at work a saw strokes sideways across its enemy, not up and down (E241)', () => {
    const part = turret();
    const arms = new SawArms(TOWER_TYPES.chainsaw, part);
    const saw = part.getObjectByName('saw_down')!;
    // Straight out along +z: across is x
    arms.setTargets([new Vector3(0, 0, 3), null, null]);
    for (let i = 0; i < 90; i++) arms.update(1 / 60);
    const lo = saw.position.clone();
    const hi = saw.position.clone();
    for (let i = 0; i < 60; i++) {
      arms.update(1 / 60);
      lo.min(saw.position);
      hi.max(saw.position);
    }
    expect(hi.x - lo.x).toBeGreaterThan(0.25);
    expect(hi.y - lo.y).toBeLessThan(0.05);
    expect(hi.x - lo.x).toBeGreaterThan(2 * (hi.z - lo.z));
    // Home again it stops stroking
    arms.setTargets([]);
    for (let i = 0; i < 60; i++) arms.update(1 / 60);
    expect(saw.position.distanceTo(new Vector3(...DOCKS['saw_down']))).toBeLessThan(1e-6);
    arms.dispose();
  });

  it('strokes each saw at its own pace, not all arms in one move', () => {
    const part = turret();
    const arms = new SawArms(TOWER_TYPES.chainsaw, part);
    const down = part.getObjectByName('saw_down')!;
    const up = part.getObjectByName('saw_up')!;
    // Two enemies straight out along +z: both saws stroke along x
    arms.setTargets([new Vector3(-0.5, 0, 2.4), null, new Vector3(0.5, 0, 3.4)]);
    for (let i = 0; i < 120; i++) arms.update(1 / 60);
    const a: number[] = [];
    const b: number[] = [];
    for (let i = 0; i < 180; i++) {
      arms.update(1 / 60);
      a.push(down.position.x);
      b.push(up.position.x);
    }
    const mean = (v: number[]) => v.reduce((sum, x) => sum + x, 0) / v.length;
    const ma = mean(a);
    const mb = mean(b);
    let ab = 0;
    let aa = 0;
    let bb = 0;
    for (let i = 0; i < a.length; i++) {
      ab += (a[i] - ma) * (b[i] - mb);
      aa += (a[i] - ma) ** 2;
      bb += (b[i] - mb) ** 2;
    }
    expect(Math.abs(ab / Math.sqrt(aa * bb))).toBeLessThan(0.7);
    arms.dispose();
  });

  it('runs a chain round each bar, idling docked and spinning up at work, blurred past the strobe limit (E241)', () => {
    const part = turret();
    const arms = new SawArms(TOWER_TYPES.chainsaw, part);
    const saw = part.getObjectByName('saw_down')!;
    // Links of saw_down in its own frame, one frame apart: how far the nearest moved
    const step = (): number => {
      const linksIn = (): Vector3[] => {
        saw.updateMatrix();
        const toSaw = new Matrix4().copy(saw.matrix).invert();
        const m = new Matrix4();
        const out: Vector3[] = [];
        for (let i = 0; i < arms.chain.count; i++) {
          arms.chain.getMatrixAt(i, m);
          const p = new Vector3().setFromMatrixPosition(m).applyMatrix4(toSaw);
          // saw_down's bar lies along +z of its frame, the others' links are far off
          if (p.length() < 1) out.push(p);
        }
        return out;
      };
      const before = linksIn();
      arms.update(1 / 60);
      const after = linksIn();
      const moved = after.map((p) => Math.min(...before.map((q) => q.distanceTo(p))));
      return moved.reduce((a, b) => a + b, 0) / moved.length;
    };
    arms.update(1 / 60);
    expect(arms.chain.count).toBeGreaterThan(30);
    const idle = step();
    expect(idle).toBeGreaterThan(0.002);
    arms.setTargets([new Vector3(0, 0, 3), null, null]);
    for (let i = 0; i < 90; i++) arms.update(1 / 60);
    const cutting = step();
    expect(cutting).toBeGreaterThan(2.5 * idle);
    // Never past 0.45 of a link a frame (0.042), so it cannot seem to stand or run back
    expect(cutting).toBeLessThan(0.45 * 0.042 + 1e-3);
    arms.dispose();
    expect(part.getObjectByName('saw_chain')).toBeUndefined();
  });

  it('never lets two arms or saws touch, at work, stroking, side by side or on one enemy (E241)', () => {
    // An arm's radius and a saw's, as built (tower-saw-arms.ts), and where the bodies leave the torso side by side
    const ARM = 0.15;
    const SAW = 0.17;
    const TORSO = 0.125;
    const N = 32;
    const curves = [0, 1, 2].map(() => Array.from({ length: N + 1 }, () => new Vector3()));
    const saws = [0, 1, 2].map((): [Vector3, Vector3] => [new Vector3(), new Vector3()]);
    const sizes = [0, 0, 0];
    const at = (a: Vector3, b: Vector3, p: Vector3) => {
      const ab = b.clone().sub(a);
      const t = Math.min(1, Math.max(0, p.clone().sub(a).dot(ab) / Math.max(1e-12, ab.lengthSq())));
      return a.clone().addScaledVector(ab, t).distanceTo(p);
    };
    // Segment to segment, by sampling one of them densely: plenty for a test
    const segments = (a0: Vector3, a1: Vector3, b0: Vector3, b1: Vector3) => {
      let d = Infinity;
      for (let i = 0; i <= 20; i++) d = Math.min(d, at(b0, b1, a0.clone().lerp(a1, i / 20)));
      return d;
    };
    const worst = { gap: Infinity, what: '' };
    const measure = (arms: SawArms, label: string) => {
      const part = arms.mesh.parent!;
      for (let k = 0; k < 3; k++) {
        arms.shape(k, curves[k], saws[k]);
        sizes[k] = part.getObjectByName(TOWER_TYPES.chainsaw.sawArms![k].node)!.scale.x;
      }
      const note = (gap: number, what: string) => {
        if (gap < worst.gap) {
          worst.gap = gap;
          worst.what = `${label}: ${what}`;
        }
      };
      for (let a = 0; a < 3; a++) {
        for (let b = a + 1; b < 3; b++) {
          note(segments(saws[a][0], saws[a][1], saws[b][0], saws[b][1]) - SAW * (sizes[a] + sizes[b]), `saws ${a} ${b}`);
          let bodies = Infinity;
          for (let i = 0; i < N; i++) {
            for (let j = 0; j < N; j++) {
              if (i < TORSO * N && j < TORSO * N) continue;
              bodies = Math.min(bodies, segments(curves[a][i], curves[a][i + 1], curves[b][j], curves[b][j + 1]));
            }
          }
          note(bodies - 2 * ARM, `bodies ${a} ${b}`);
          for (const [s, o] of [[a, b], [b, a]]) {
            let d = Infinity;
            for (let j = 0; j < N; j++) d = Math.min(d, segments(saws[s][0], saws[s][1], curves[o][j], curves[o][j + 1]));
            note(d - SAW * sizes[s] - ARM, `saw ${s} body ${o}`);
          }
        }
      }
    };
    // Enemies along a road at distance `d` across angle `angle`, `spacing` apart, walking at `speed`
    const road = (d: number, angle: number, spacing: number, count: number, speed: number) => (t: number) => {
      const along = new Vector3(Math.cos(angle), 0, -Math.sin(angle));
      const mid = new Vector3(Math.sin(angle), 0, Math.cos(angle)).multiplyScalar(d);
      return Array.from({ length: count }, (_, i) => mid.clone().addScaledVector(along, (i - (count - 1) / 2) * spacing + speed * t - 0.6));
    };
    const scenes: [string, (t: number) => Vector3[]][] = [
      ['clump', (t) => [new Vector3(0.1, 0, 2.5 + 0.1 * t), new Vector3(-0.15, 0, 2.6), new Vector3(0.05, 0, 2.35)]],
      ['one enemy', (t) => [new Vector3(0.3 * t - 0.6, 0, 2.4)]],
      ['two enemies', (t) => [new Vector3(0.3 * t - 0.6, 0, 2.4), new Vector3(0.3 * t, 0, 2.5)]],
      ...[1.6, 2.5, 3.4].flatMap((d) => [0, Math.PI / 4, -Math.PI / 4].map((angle): [string, (t: number) => Vector3[]] =>
        [`road ${d} at ${Math.round((angle * 180) / Math.PI)} deg`, road(d, angle, 0.55, 3, 0.4)])),
      ['crowd past the side', road(1.8, Math.PI / 2.5, 0.4, 3, 0.6)],
    ];
    for (const [label, enemies] of scenes) {
      const part = turret();
      const arms = new SawArms(TOWER_TYPES.chainsaw, part);
      measure(arms, `${label} docked`);
      for (let f = 0; f < 240; f++) {
        // The simulation lists them nearest first, free arms on the farthest
        const list = enemies(f / 60).sort((p, q) => p.length() - q.length());
        arms.setTargets([0, 1, 2].map((k) => list[Math.min(k, list.length - 1)]));
        arms.update(1 / 60);
        measure(arms, `${label} at ${f}`);
      }
      // And home again
      arms.setTargets([]);
      for (let f = 0; f < 60; f++) {
        arms.update(1 / 60);
        measure(arms, `${label} home ${f}`);
      }
      arms.dispose();
    }
    expect(worst.gap, worst.what).toBeGreaterThanOrEqual(0);
  });
});
