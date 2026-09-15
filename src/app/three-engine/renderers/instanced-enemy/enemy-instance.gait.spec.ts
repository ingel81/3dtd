import { describe, it, expect, beforeEach } from 'vitest';
import { BufferGeometry, DataTexture, Float32BufferAttribute, FloatType, FrontSide, RGBAFormat, Scene, Vector3 } from 'three';
import { EnemyInstanceManager, type EnemyInstanceState } from './enemy-instance.manager';
import { ENEMY_TYPES } from '../../../configs/enemy-types.config';
import type { VATData } from './vat-baker';
import type { VATAnimationEntry } from './vat-clips';

/**
 * A walk clip stepped by the ground walked (EnemyTypeConfig.gaitStride), the
 * worm's legs and mandibles: the frame follows the way the instance has
 * come, not the clock, so it stands in the pause and runs faster at a higher
 * timescale only because the instance walks further per frame.
 */

const RING = 'worm-segment';
const HEAD = 'worm';
const RING_CONFIG = ENEMY_TYPES[RING];
const STRIDE = RING_CONFIG.gaitStride!;
const FRAMES = 32;

/** VAT data with one looping clip of FRAMES frames: enough for a pool, nothing is drawn. */
function clipVat(clip: string): VATData {
  const animations = new Map<string, VATAnimationEntry>([
    [clip, { name: clip, frameStart: 0, frameCount: FRAMES, duration: FRAMES / 30, totalTime: FRAMES / 30 }],
  ]);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  return {
    positionTexture: new DataTexture(new Float32Array(3 * FRAMES * 4), 3, FRAMES, RGBAFormat, FloatType),
    encoding: { type: FloatType, origin: [0, 0, 0], extent: [1, 1, 1], halfFloatError: 0 },
    vertexCount: 3,
    totalFrames: FRAMES,
    animations,
    geometry,
    diffuseMap: null,
    isUnlit: false,
    alpha: { mode: 'opaque', cutoff: 0 },
    fps: 30,
    texWidth: 3,
    rowsPerFrame: 1,
    baseColor: { r: 1, g: 1, b: 1 },
    side: FrontSide,
    modelMinY: 0,
    modelMaxY: 1,
  };
}

describe('Walk clip stepped by the ground walked (gaitStride)', () => {
  let manager: EnemyInstanceManager;

  beforeEach(() => {
    manager = new EnemyInstanceManager(new Scene());
    manager.createPool(RING, clipVat(RING_CONFIG.walkAnimation!), RING_CONFIG);
    manager.createPool(HEAD, clipVat(ENEMY_TYPES[HEAD].walkAnimation!), ENEMY_TYPES[HEAD]);
  });

  const frameOf = (state: EnemyInstanceState): number => state.pool.animFrameAttr.getX(state.index);

  /** A ring at (0, 0, z), walking along +z (heading 0). */
  function ringAt(id: string, z: number): EnemyInstanceState {
    const state = manager.addEnemy(id, RING, new Vector3(0, 0, z), 0)!;
    manager.updateEnemyState(state, new Vector3(0, 0, z), 0, RING_CONFIG.baseSpeed);
    return state;
  }

  const walk = (state: EnemyInstanceState, z: number): void =>
    manager.updateEnemyState(state, new Vector3(0, 0, z), 0, RING_CONFIG.baseSpeed);

  it('takes one loop of the clip per gaitStride metres walked', () => {
    const ring = ringAt('r', 0);
    manager.updateAnimations(0.016);
    expect(frameOf(ring)).toBe(0);

    walk(ring, STRIDE / 4);
    manager.updateAnimations(0.016);
    expect(frameOf(ring)).toBe(FRAMES / 4);

    // Along a bend the way counts, not the straight line back to the start
    const bend = new Vector3(STRIDE / 4, 0, STRIDE / 4);
    manager.updateEnemyState(ring, bend, 0, 0);
    manager.updateAnimations(0.016);
    expect(frameOf(ring)).toBe(FRAMES / 2);

    // A whole loop further on, the same frame
    manager.updateEnemyState(ring, bend.setZ(STRIDE / 4 + STRIDE), 0, 0);
    manager.updateAnimations(0.016);
    expect(ring.gait).toBeCloseTo(1.5 * STRIDE, 9);
    expect(frameOf(ring)).toBe(FRAMES / 2);
  });

  it('stands still while the instance stands, however far the clock runs', () => {
    const ring = ringAt('r', 0);
    walk(ring, 1.3);
    manager.updateAnimations(0.016);
    const frame = frameOf(ring);
    for (const seconds of [0.016, 0.5, 4, 30]) {
      walk(ring, 1.3);
      manager.updateAnimations(seconds);
      expect(frameOf(ring)).toBe(frame);
    }
  });

  it('steps faster only by walking further per frame (timescale)', () => {
    const slow = ringAt('slow', 0);
    const fast = ringAt('fast', 0);
    for (let i = 1; i <= 5; i++) {
      walk(slow, i * 0.1);
      walk(fast, i * 0.4);
    }
    expect(fast.gait).toBeCloseTo(4 * slow.gait, 9);
    expect(slow.gait).toBeCloseTo(0.5, 9);
  });

  it('starts rings a spacing apart along their way a quarter loop apart: the wave of the legs', () => {
    const spacing = ENEMY_TYPES[HEAD].chain!.spacing;
    // The Crawl clip's legs trail by WAVE = 0.25 loops per ring (worm_boss.py)
    expect((spacing / STRIDE) % 1).toBeCloseTo(0.75, 9);

    const front = ringAt('front', 10);
    const behind = ringAt('behind', 10 - spacing);
    manager.updateAnimations(0.016);
    expect(front.gait - behind.gait).toBeCloseTo(spacing, 9);
    expect((frameOf(behind) - frameOf(front) + FRAMES) % FRAMES).toBe(FRAMES / 4);
  });

  it('parts rings that come out at one place by what each has walked', () => {
    const first = ringAt('first', 0);
    walk(first, 2.5);
    const second = ringAt('second', 0);
    walk(first, 5);
    walk(second, 2.5);
    expect(first.gait - second.gait).toBeCloseTo(2.5, 9);
  });

  it('keeps the frame a ring died in', () => {
    const ring = ringAt('r', 0);
    walk(ring, 1.1);
    manager.updateAnimations(0.016);
    const frame = frameOf(ring);
    manager.playDeathAnimation('r');
    walk(ring, 2.9);
    manager.updateAnimations(3);
    expect(frameOf(ring)).toBe(frame);
  });

  it('takes the way walked along into the head pool', () => {
    const ring = ringAt('r', 0);
    walk(ring, 3);
    const head = manager.changeType('r', HEAD)!;
    expect(head.gait).toBeCloseTo(3, 9);
    manager.updateEnemyState(head, new Vector3(0, 0, 3.5), 0, 0);
    expect(head.gait).toBeCloseTo(3.5, 9);
  });
});
