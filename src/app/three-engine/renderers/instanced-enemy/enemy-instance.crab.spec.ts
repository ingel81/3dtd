import { describe, it, expect, beforeEach } from 'vitest';
import {
  BufferGeometry,
  DataTexture,
  Float32BufferAttribute,
  FloatType,
  FrontSide,
  InstancedBufferAttribute,
  Matrix4,
  Quaternion,
  RGBAFormat,
  Scene,
  Vector3,
} from 'three';
import { EnemyInstanceManager, type EnemyInstanceState, type TypePool } from './enemy-instance.manager';
import { ENEMY_TYPES } from '../../../configs/enemy-types.config';
import type { VATData } from './vat-baker';
import type { VATAnimationEntry } from './vat-clips';

/** Minimal VAT data with the given clips of 10 frames and 1 s each: enough for a pool, nothing is drawn. */
function fakeVat(clips: string[]): VATData {
  const animations = new Map<string, VATAnimationEntry>();
  clips.forEach((name, i) => animations.set(name, { name, frameStart: i * 10, frameCount: 10, duration: 1, totalTime: 1 }));
  const frames = clips.length * 10;
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  return {
    positionTexture: new DataTexture(new Float32Array(3 * frames * 4), 3, frames, RGBAFormat, FloatType),
    encoding: { type: FloatType, origin: [0, 0, 0], extent: [1, 1, 1], halfFloatError: 0 },
    vertexCount: 3,
    totalFrames: frames,
    animations,
    geometry,
    diffuseMap: null,
    isUnlit: false,
    alpha: { mode: 'opaque', cutoff: 0 },
    fps: 10,
    texWidth: 3,
    rowsPerFrame: 1,
    baseColor: { r: 1, g: 1, b: 1 },
    side: FrontSide,
    modelMinY: 0,
    modelMaxY: 1,
    turret: null,
  };
}

const JUMPER = ENEMY_TYPES['jumper'];
const CRAB = JUMPER.crabGait!;
const HALF = Math.PI / 2;

/** The turn about +y of the instance's matrix, rad */
function shownHeading(pool: TypePool, state: EnemyInstanceState): number {
  const m = new Matrix4();
  pool.instancedMesh.getMatrixAt(state.index, m);
  const q = new Quaternion();
  m.decompose(new Vector3(), q, new Vector3());
  const forward = new Vector3(0, 0, 1).applyQuaternion(q);
  return Math.atan2(forward.x, forward.z);
}

/** Clip phase the instance shows, 0 to 1 */
function shownPhase(pool: TypePool, state: EnemyInstanceState): number {
  const entry = pool.vatData.animations.get(state.currentAnim)!;
  const attr = pool.animFrameAttr;
  return (attr.getX(state.index) - entry.frameStart + attr.getZ(state.index)) / entry.frameCount;
}

describe('crab gait (EnemyTypeConfig.crabGait)', () => {
  let manager: EnemyInstanceManager;
  let pool: TypePool;

  beforeEach(() => {
    manager = new EnemyInstanceManager(new Scene());
    manager.createPool('jumper', fakeVat([JUMPER.walkAnimation!, CRAB.sideAnimation, JUMPER.deathAnimation!]), JUMPER);
    pool = (manager as unknown as { pools: Map<string, TypePool> }).pools.get('jumper')!;
  });

  it('comes out across its way and scuttles, backwards when its front looks left of the way', () => {
    const states = ['enemy-1', 'enemy-2'].map((id) => manager.addEnemy(id, 'jumper', new Vector3(), 0.3)!);
    manager.updateAnimations(0.01);
    expect(new Set(states.map((s) => s.crabSide))).toEqual(new Set([1, -1]));
    for (const state of states) {
      expect(state.bodyTurn).toBe(state.crabSide * HALF);
      expect(state.currentAnim).toBe(CRAB.sideAnimation);
      // Its side clip steps to the body's left: forwards where the front looks right of the way
      expect(state.crabReverse).toBe(state.crabSide === 1);
      manager.updateEnemyState(state, new Vector3(), 0.3, JUMPER.baseSpeed);
      expect(shownHeading(pool, state)).toBeCloseTo(0.3 + state.bodyTurn, 5);
    }
  });

  it("turns its front to its gun's side, past the walk, the turret keeping its aim", () => {
    // Turret joints without a model: the attribute the shader would read
    pool.turretAttr = new InstancedBufferAttribute(new Float32Array(manager.capacityOf('jumper') * 4), 4);
    const state = manager.addEnemy('enemy-1', 'jumper', new Vector3(), 0)!;
    state.crabSide = -1;
    state.bodyTurn = -HALF;
    // The guns aim across while the simulation keeps the side: the turret alone turns
    manager.setTurret(state, 1, 0, -1);
    expect(state.crabSide).toBe(-1);
    expect(state.turretYaw).toBeCloseTo(1 + HALF, 6);
    // No side yet: it keeps the one it has
    manager.setTurret(state, 1, 0, 0);
    expect(state.crabSide).toBe(-1);

    manager.setTurret(state, 1, 0, 1);
    expect(state.crabSide).toBe(1);
    const seen = new Set<string>();
    const dt = 0.05;
    for (let t = 0; t < Math.PI / CRAB.turnRate + 0.2; t += dt) {
      manager.updateAnimations(dt);
      seen.add(state.currentAnim);
      if (Math.abs(state.bodyTurn) < Math.PI / 4) expect(state.currentAnim).toBe(JUMPER.walkAnimation);
    }
    expect(seen).toEqual(new Set([CRAB.sideAnimation, JUMPER.walkAnimation]));
    expect(state.bodyTurn).toBe(HALF);
    expect(state.crabReverse).toBe(true);
    // The guns aim where the simulation has them, whatever the body does
    manager.setTurret(state, 1, 0, 1);
    expect(state.turretYaw + state.bodyTurn).toBeCloseTo(1, 6);
  });

  it('keeps the phase it shows when its clip turns round, so the feet do not jump', () => {
    const state = manager.addEnemy('enemy-1', 'jumper', new Vector3(), 0)!;
    state.crabSide = -1;
    state.bodyTurn = -HALF;
    state.speedMultiplier = 1;
    manager.updateAnimations(0.33 / state.animSpeed);
    expect(state.crabReverse).toBe(false);
    const before = shownPhase(pool, state);
    // Straight across to the other side in one frame of no time: the phase stays
    state.crabSide = 1;
    state.bodyTurn = HALF;
    manager.updateAnimations(0);
    expect(state.crabReverse).toBe(true);
    expect(shownPhase(pool, state)).toBeCloseTo(before, 6);
  });

  it('steps where the feet land, forwards at the footfall phases, backwards where they lift', () => {
    const phases = JUMPER.footstep!.phases;
    for (const side of [-1, 1]) {
      const state = manager.addEnemy(`enemy-${side + 5}`, 'jumper', new Vector3(), 0)!;
      state.crabSide = side;
      state.bodyTurn = side * HALF;
      state.speedMultiplier = 1;
      manager.updateAnimations(0);
      const expected = side === -1 ? phases : CRAB.reverseFootstepPhases;
      // Count the steps against the clip phase shown, across a little more than one loop in small frames
      const at: number[] = [];
      manager.onFootstep = () => at.push(shownPhase(pool, state));
      for (let i = 0; i < 210; i++) manager.updateAnimations(0.005 / state.animSpeed);
      expect(at).toHaveLength(expected.length);
      at.sort((a, b) => a - b);
      [...expected].sort((a, b) => a - b).forEach((p, i) => expect(Math.min(Math.abs(at[i] - p), 1 - Math.abs(at[i] - p))).toBeLessThan(0.01));
      manager.removeEnemy(state.id);
    }
  });
});
