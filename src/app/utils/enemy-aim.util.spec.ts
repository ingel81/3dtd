import { afterEach, describe, expect, it } from 'vitest';
import {
  AnimationClip,
  Bone,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  MeshBasicMaterial,
  QuaternionKeyframeTrack,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
} from 'three';
import { bakeVAT } from '../three-engine/renderers/instanced-enemy/vat-baker';
import { vatClips } from '../three-engine/renderers/instanced-enemy/vat-clips';
import { getEnemyAimOffsetY } from './enemy-aim.util';
import { Enemy } from '../entities/enemy.entity';
import { ELITE_SIZE } from '../configs/enemy-types.config';

const NATIVE = ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'exp', 'log', 'pow', 'hypot'] as const;
const M = Math as unknown as Record<string, (...args: number[]) => number>;
const original = Object.fromEntries(NATIVE.map((fn) => [fn, M[fn]]));

/** Every native transcendental off in its last bits, as another engine's might be (and more) */
function skewNativeMath(): void {
  for (const fn of NATIVE) {
    const native = original[fn];
    M[fn] = (...args: number[]) => {
      const r = native(...args);
      return r === 0 || !Number.isFinite(r) ? r : r * (1 + 2 ** -40);
    };
  }
}

function restoreMath(): void {
  for (const fn of NATIVE) M[fn] = original[fn];
}

/** A bone that swings a triangle a quarter turn about x: three.js slerps between its keys with Math.acos and Math.sin */
function swingingTriangle(): Group {
  const bone = new Bone();
  bone.name = 'root';
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0.3, 1.7, 0.2, 0, 1.3, 0.9], 3));
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(new Array(12).fill(0), 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
  const root = new Group();
  root.add(bone, mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new Skeleton([bone]));
  return root;
}

const s = Math.SQRT1_2;
const walk = new AnimationClip('walk', 1, [
  new QuaternionKeyframeTrack('root.quaternion', [0, 1], [0, 0, 0, 1, s, 0, 0, s]),
]);
const die = new AnimationClip('die', 1, [
  new QuaternionKeyframeTrack('root.quaternion', [0, 1], [0, 0, 0, 1, 0.3, 0.1, 0, Math.sqrt(0.9)]),
]);
const clips = vatClips({ walkAnimation: 'walk', deathAnimation: 'die', animationSpeed: 1 });

function bakeRange(): { min: number; max: number } {
  const vat = bakeVAT(swingingTriangle(), [walk, die], clips, 1)!;
  return { min: vat.modelMinY, max: vat.modelMaxY };
}

/** An enemy of a type whose config carries the natively baked extent */
function enemyWith(range: { min: number; max: number }): Enemy {
  return { typeConfig: { id: 'skew-test', scale: 1.7, modelRangeY: range }, sizeScale: 1.7 } as unknown as Enemy;
}

describe('enemy aim offset across engines (TODO E28)', () => {
  afterEach(restoreMath);

  it('aims from the config, not from a bake that takes other bits from native sin and acos', () => {
    const native = bakeRange();
    const enemy = enemyWith(native);
    const aim = getEnemyAimOffsetY(enemy);
    skewNativeMath();
    const skewed = bakeRange();
    // The bake itself follows the engine's trigonometry: another engine measures other bits
    expect(skewed).not.toEqual(native);
    // What the simulation reads does not come from it
    expect(getEnemyAimOffsetY(enemy)).toBe(aim);
    expect(aim).toBe(((native.min + native.max) / 2) * 1.7);
  });
});

describe('getEnemyAimOffsetY of an elite', () => {
  it('aims at the middle of the bigger model an elite is drawn with', () => {
    const path = [{ lat: 0, lon: 0 }, { lat: 0.001, lon: 0 }];
    const plain = new Enemy('tank', path);
    const elite = new Enemy('tank', path);
    elite.elite = true;
    expect(getEnemyAimOffsetY(elite)).toBeCloseTo(getEnemyAimOffsetY(plain) * ELITE_SIZE, 6);
  });
});
