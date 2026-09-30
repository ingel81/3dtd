/**
 * The slide between two states of the simulation (state-lerp.ts): its clock,
 * and an enemy instance sliding by it (EnemyInstanceManager), shown where
 * the shader puts it (shownPosition does the shader's sum on this thread).
 */
import { describe, it, expect } from 'vitest';
import { BufferGeometry, DataTexture, Float32BufferAttribute, FloatType, FrontSide, RGBAFormat, Scene, Vector3 } from 'three';
import { STATE_LERP_JUMP_M, StateLerp, stateLerpParam } from './state-lerp';
import { EnemyInstanceManager } from './instanced-enemy/enemy-instance.manager';
import { ENEMY_TYPES } from '../../configs/enemy-types.config';
import type { VATData } from './instanced-enemy/vat-baker';

describe('StateLerp', () => {
  it('runs from 0 at a state to 1 one interval later, and stays there', () => {
    const lerp = new StateLerp();
    expect(lerp.uniform.value).toBe(1);
    lerp.begin(1000);
    expect(lerp.uniform.value).toBe(0);
    lerp.update(1000 + lerp.interval / 2);
    expect(lerp.uniform.value).toBeCloseTo(0.5, 6);
    lerp.update(5000);
    expect(lerp.uniform.value).toBe(1);
  });

  it('follows the time between the states, smoothed and within bounds', () => {
    const lerp = new StateLerp();
    let now = 0;
    for (let i = 0; i < 60; i++) lerp.begin((now += 50));
    expect(lerp.interval).toBeCloseTo(50, 0);
    // One long stall does not take the interval with it
    lerp.begin(now + 5000);
    expect(lerp.interval).toBeLessThan(70);
  });

  it('tells how much of the old slide is left when the next state comes early', () => {
    const lerp = new StateLerp();
    lerp.begin(1000);
    expect(lerp.begin(1000 + lerp.interval / 4)).toBeCloseTo(0.75, 6);
    // On time or late: nothing left
    expect(lerp.begin(9000)).toBe(0);
  });

  it('is off with ?interp=off: nothing slides', () => {
    expect(stateLerpParam('?devworld&interp=off')).toBe(false);
    expect(stateLerpParam('?devworld')).toBe(true);
    const lerp = new StateLerp(false);
    expect(lerp.begin(1000)).toBe(0);
    lerp.update(1001);
    expect(lerp.uniform.value).toBe(1);
  });
});

function fakeVat(): VATData {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  return {
    positionTexture: new DataTexture(new Float32Array(3 * 10 * 4), 3, 10, RGBAFormat, FloatType),
    encoding: { type: FloatType, origin: [0, 0, 0], extent: [1, 1, 1], halfFloatError: 0 },
    vertexCount: 3, totalFrames: 10, animations: new Map(), geometry, diffuseMap: null, isUnlit: false,
    alpha: { mode: 'opaque', cutoff: 0 }, fps: 10, texWidth: 3, rowsPerFrame: 1, baseColor: { r: 1, g: 1, b: 1 },
    side: FrontSide, modelMinY: 0, modelMaxY: 1,
  };
}

describe('an enemy instance between two states', () => {
  function setup(enabled = true) {
    const lerp = new StateLerp(enabled);
    const manager = new EnemyInstanceManager(new Scene(), undefined, lerp);
    manager.createPool('zombie', fakeVat(), ENEMY_TYPES['zombie']);
    const state = manager.addEnemy('enemy-1', 'zombie', new Vector3(0, 0, 0), 0)!;
    const shownX = () => manager.shownPosition(state, new Vector3()).x;
    /** A state at `now` puts the enemy at `x` */
    const stateAt = (now: number, x: number) => {
      manager.beginState(now);
      manager.updateEnemyState(state, new Vector3(x, 0, 0), 0);
    };
    return { lerp, manager, state, shownX, stateAt };
  }

  it('slides from where it was shown to its newest state over one interval', () => {
    const { lerp, manager, shownX, stateAt } = setup();
    stateAt(1000, 0);
    stateAt(1033, 1);
    expect(manager.lastOffset.x).toBeCloseTo(-1, 6);
    expect(shownX()).toBeCloseTo(0, 6);
    lerp.update(1033 + lerp.interval / 2);
    expect(shownX()).toBeCloseTo(0.5, 6);
    lerp.update(1033 + lerp.interval);
    expect(shownX()).toBeCloseTo(1, 6);
  });

  it('goes on without a jump when the next state comes early', () => {
    const { lerp, shownX, stateAt } = setup();
    stateAt(1000, 0);
    stateAt(1033, 1);
    lerp.update(1033 + lerp.interval / 2);
    const before = shownX();
    stateAt(1033 + lerp.interval / 2, 2);
    expect(shownX()).toBeCloseTo(before, 6);
    lerp.update(5000);
    expect(shownX()).toBeCloseTo(2, 6);
  });

  it('stands at once after a jump, in a new slot, and with the slide off', () => {
    const { manager, shownX, stateAt } = setup();
    stateAt(1000, 0);
    stateAt(1033, STATE_LERP_JUMP_M + 1);
    expect(shownX()).toBe(STATE_LERP_JUMP_M + 1);

    // A slot taken again starts without the offset of the enemy before
    stateAt(1066, STATE_LERP_JUMP_M + 2);
    manager.removeEnemy('enemy-1');
    const next = manager.addEnemy('enemy-2', 'zombie', new Vector3(50, 0, 0), 0)!;
    expect(manager.shownPosition(next, new Vector3()).x).toBe(50);

    const off = setup(false);
    off.stateAt(1000, 0);
    off.stateAt(1033, 1);
    expect(off.shownX()).toBe(1);
    expect(off.manager.lastOffset.x).toBe(0);
  });

  it('leaves a corpse where it was shown: later states do not slide it again', () => {
    const { lerp, manager, shownX, stateAt } = setup();
    stateAt(1000, 0);
    stateAt(1033, 1);
    lerp.update(1033 + lerp.interval / 2);
    manager.playDeathAnimation('enemy-1');
    expect(shownX()).toBeCloseTo(0.5, 6);
    // The next states move the living; the corpse is not written and stays
    stateAt(1066, 2);
    expect(shownX()).toBeCloseTo(0.5, 6);
    lerp.update(1080);
    expect(shownX()).toBeCloseTo(0.5, 6);
  });
});
