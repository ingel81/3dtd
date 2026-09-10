import { describe, it, expect, beforeEach } from 'vitest';
import {
  BufferGeometry,
  DataTexture,
  Float32BufferAttribute,
  FloatType,
  Matrix4,
  Quaternion,
  RGBAFormat,
  Scene,
  Vector3,
} from 'three';
import { EnemyInstanceManager } from './enemy-instance.manager';
import { InstancedEnemyRenderer } from './instanced-enemy.renderer';
import { ENEMY_TYPES } from '../../../configs/enemy-types.config';
import type { VATData, VATAnimationEntry } from './vat-baker';

/** Minimal VAT data with the given clips: enough for a pool, nothing is drawn. */
function fakeVat(clips: string[]): VATData {
  const animations = new Map<string, VATAnimationEntry>();
  clips.forEach((name, i) =>
    animations.set(name, { name, frameStart: i * 10, frameCount: 10, duration: 1, totalTime: 1 }),
  );
  const frames = clips.length * 10;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  return {
    positionTexture: new DataTexture(new Float32Array(3 * frames * 4), 3, frames, RGBAFormat, FloatType),
    vertexCount: 3,
    totalFrames: frames,
    animations,
    geometry,
    diffuseMap: null,
    isUnlit: false,
    fps: 10,
    texWidth: 3,
    rowsPerFrame: 1,
    baseColor: { r: 1, g: 1, b: 1 },
    modelMinY: 0,
    modelMaxY: 1,
  };
}

// Has walk + run clips and a runSpeedMultiplier.
const CONFIG = ENEMY_TYPES['wallsmasher'];
const CLIPS = [CONFIG.walkAnimation!, CONFIG.runAnimation!];

/** Bit pattern of 16 floats, so -0 and +0 (or any last-bit difference) count as different. */
function bits(array: Float32Array, offset: number): number[] {
  return Array.from(new Uint32Array(array.buffer, array.byteOffset + offset * 4, 16));
}

describe('EnemyInstanceManager', () => {
  let manager: EnemyInstanceManager;

  beforeEach(() => {
    manager = new EnemyInstanceManager(new Scene());
    manager.createPool('wallsmasher', fakeVat(CLIPS), CONFIG);
  });

  it('counts the instances that are not walking', () => {
    manager.addEnemy('a', 'wallsmasher', new Vector3(), 0);
    manager.addEnemy('b', 'wallsmasher', new Vector3(), 0);
    expect(manager.nonWalkingCount).toBe(0);
    expect(manager.getSpeedMultiplier('a')).toBe(1);

    manager.startRunAnimation('a');
    manager.startRunAnimation('a'); // already running: counted once
    expect(manager.nonWalkingCount).toBe(1);
    expect(manager.getSpeedMultiplier('a')).toBe(CONFIG.runSpeedMultiplier);

    manager.startRunAnimation('b');
    manager.startWalkAnimation('b');
    manager.startWalkAnimation('b'); // already walking: no double decrement
    expect(manager.nonWalkingCount).toBe(1);

    manager.removeEnemy('a');
    expect(manager.nonWalkingCount).toBe(0);

    manager.startRunAnimation('b');
    manager.clear();
    expect(manager.nonWalkingCount).toBe(0);
  });

  it('does not count a run request on a dying instance', () => {
    manager.addEnemy('a', 'wallsmasher', new Vector3(), 0);
    manager.playDeathAnimation('a');
    manager.startRunAnimation('a');
    expect(manager.nonWalkingCount).toBe(0);
  });

  it('flags states released on removal and on clear', () => {
    const a = manager.addEnemy('a', 'wallsmasher', new Vector3(), 0)!;
    const b = manager.addEnemy('b', 'wallsmasher', new Vector3(), 0)!;
    expect(a.released).toBe(false);

    manager.removeEnemy('a');
    expect(a.released).toBe(true);
    expect(b.released).toBe(false);

    manager.clear();
    expect(b.released).toBe(true);
  });

  it('writes the matrix Matrix4.compose + setMatrixAt would, bit for bit', () => {
    const state = manager.addEnemy('a', 'wallsmasher', new Vector3(), 0)!;
    const array = state.pool.instancedMesh.instanceMatrix.array as Float32Array;
    const expected = new Float32Array(16);
    const up = new Vector3(0, 1, 0);
    const position = new Vector3(12.5, -3.25, 1e4 / 3);

    const check = (heading: number, extraRotation: number, scale: number, y: number) => {
      const q = new Quaternion().setFromAxisAngle(up, heading + (CONFIG.headingOffset ?? 0) + extraRotation);
      new Matrix4()
        .compose(new Vector3(position.x, y, position.z), q, new Vector3(scale, scale, scale))
        .toArray(expected);
      expect(bits(array, state.index * 16)).toEqual(bits(expected, 0));
    };

    for (const heading of [0, 0.3, -2.9, Math.PI, 1e-9, -0]) {
      manager.updateEnemyState(state, position, heading, 3);
      check(heading, 0, CONFIG.scale, position.y);
    }

    // Debug overrides take the other branches (scale, height delta, rotation).
    manager.applyDebugOverrides('a', { scale: 1.7, heightOffset: 2.5, rotation: 0.4 });
    for (const heading of [0.1, -1.2]) {
      manager.updateEnemyState(state, position, heading, 3);
      check(heading, 0.4, 1.7, position.y + (2.5 - CONFIG.heightOffset));
    }
  });
});

describe('InstancedEnemyRenderer slots', () => {
  it('keeps the health-bar slot on the state and releases the state on remove', async () => {
    const sync = { geoToLocal: () => new Vector3() };
    const renderer = new InstancedEnemyRenderer(new Scene(), sync as never, {} as never);
    (renderer as unknown as { instanceManager: EnemyInstanceManager }).instanceManager.createPool(
      'wallsmasher',
      fakeVat(CLIPS),
      CONFIG,
    );

    await renderer.create('a', 'wallsmasher', 0, 0, 0);
    await renderer.create('b', 'wallsmasher', 0, 0, 0);
    const a = renderer.resolveSlot('a')!;
    const b = renderer.resolveSlot('b')!;
    expect([a.healthBarIndex, b.healthBarIndex]).toEqual([0, 1]);

    renderer.remove('a');
    expect(a.released).toBe(true);
    expect(renderer.resolveSlot('a')).toBeNull();

    // The freed slots are handed to the next enemy, which gets a fresh state.
    await renderer.create('c', 'wallsmasher', 0, 0, 0);
    const c = renderer.resolveSlot('c')!;
    expect(c).not.toBe(a);
    expect(c.healthBarIndex).toBe(0);
  });
});
