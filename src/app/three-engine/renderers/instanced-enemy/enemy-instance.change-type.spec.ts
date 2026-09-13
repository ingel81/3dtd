import { describe, it, expect, beforeEach } from 'vitest';
import { BoxGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, Scene, Vector3 } from 'three';
import { EnemyInstanceManager, type TypePool } from './enemy-instance.manager';
import { bakeStaticVAT } from './vat-baker';
import { ENEMY_TYPES } from '../../../configs/enemy-types.config';

/**
 * The worm boss on the static instancing path: head and ring are static
 * models (hasAnimations false), baked by bakeStaticVAT into one-frame VATs,
 * and a segment that becomes the head of its worm moves from the ring's pool
 * into the head's (changeType, via InstancedEnemyRenderer.setRenderType).
 */

const HEAD = 'worm';
const RING = 'worm-segment';

/** A static model of two boxes, standing in for the chitin head or ring. */
function staticModel(width: number, height: number): Group {
  const root = new Group();
  const shell = new Mesh(new BoxGeometry(width, height, 1, 2, 2, 2), new MeshStandardMaterial({ color: 0x665544 }));
  shell.position.y = height / 2;
  const spike = new Mesh(new BoxGeometry(0.2, 0.6, 0.2), new MeshStandardMaterial({ color: 0x332211 }));
  spike.position.set(0, height + 0.3, 0);
  root.add(shell, spike);
  return root;
}

/** The 16 floats of an instance matrix as bit patterns, so any last-bit change counts. */
function matrixBits(pool: TypePool, index: number): number[] {
  const matrix = new Matrix4();
  pool.instancedMesh.getMatrixAt(index, matrix);
  return Array.from(new Uint32Array(Float32Array.from(matrix.elements).buffer));
}

function tintAt(pool: TypePool, index: number): number[] {
  return [pool.tintColorAttr.getX(index), pool.tintColorAttr.getY(index), pool.tintColorAttr.getZ(index)];
}

describe('Worm pool switch on the static instancing path', () => {
  let manager: EnemyInstanceManager;
  let headPool: TypePool;
  let ringPool: TypePool;

  beforeEach(() => {
    manager = new EnemyInstanceManager(new Scene());
    manager.createPool(HEAD, bakeStaticVAT(staticModel(1.4, 2.0), ENEMY_TYPES[HEAD].scale)!, ENEMY_TYPES[HEAD]);
    manager.createPool(RING, bakeStaticVAT(staticModel(1.2, 1.5), ENEMY_TYPES[RING].scale)!, ENEMY_TYPES[RING]);
    headPool = poolOf(HEAD);
    ringPool = poolOf(RING);
  });

  /** The pool of `typeId`, through a slot taken and given back again. */
  function poolOf(typeId: string): TypePool {
    const id = `pool-of-${typeId}`;
    const state = manager.addEnemy(id, typeId, new Vector3(), 0)!;
    const pool = state.pool;
    manager.removeEnemy(id);
    return pool;
  }

  function spawnRing(id: string) {
    const state = manager.addEnemy(id, RING, new Vector3(10, 2, -5), 0)!;
    manager.updateEnemyState(state, new Vector3(10, 2, -5), 1.1, 3);
    return state;
  }

  it('bakes head and ring as one-frame static VATs', () => {
    for (const pool of [headPool, ringPool]) {
      expect(pool.vatData.totalFrames).toBe(1);
      expect([...pool.vatData.animations.keys()]).toEqual(['static']);
    }
    expect(spawnRing('s').currentAnim).toBe('static');
  });

  it('moves a ring that becomes the head into the head pool where it stood, tints and health bar slot along', () => {
    const ring = spawnRing('s1');
    ring.healthBarIndex = 7;
    ring.debugScale = 1.3;
    manager.setPoisonVisual('s1', true);
    manager.setBurnVisual('s1', true);
    const matrix = matrixBits(ringPool, ring.index);
    const tint = tintAt(ringPool, ring.index);

    const head = manager.changeType('s1', HEAD)!;

    expect(ring.released).toBe(true);
    expect(manager.getState('s1')).toBe(head);
    expect(head.typeId).toBe(HEAD);
    expect(head.pool).toBe(headPool);
    expect(head.currentAnim).toBe('static');
    expect(matrixBits(headPool, head.index)).toEqual(matrix);
    expect(tintAt(headPool, head.index)).toEqual(tint);
    expect(head).toMatchObject({ healthBarIndex: 7, debugScale: 1.3, poisoned: true, burning: true, frozen: false });
    // The ring's slot is free and parked out of sight
    expect(ringPool.instances.has('s1')).toBe(false);
    const parked = new Matrix4();
    ringPool.instancedMesh.getMatrixAt(ring.index, parked);
    expect(new Vector3().setFromMatrixPosition(parked).y).toBe(-10000);
    expect(manager.count).toBe(1);
  });

  it('keeps the enemy where it is for its own type or a type without a pool', () => {
    const ring = spawnRing('s1');
    expect(manager.changeType('s1', RING)).toBe(ring);
    expect(manager.changeType('s1', 'no-such-type')).toBe(ring);
    expect(ring.released).toBe(false);
    expect(manager.getState('s1')).toBe(ring);
    expect(manager.changeType('nobody', HEAD)).toBeNull();
  });

  it('takes the next frame in the head pool', () => {
    spawnRing('s1');
    const head = manager.changeType('s1', HEAD)!;
    manager.updateEnemyState(head, new Vector3(14, 3, -2), 0.4, 3);
    const matrix = new Matrix4();
    headPool.instancedMesh.getMatrixAt(head.index, matrix);
    expect(new Vector3().setFromMatrixPosition(matrix).toArray()).toEqual([14, 3, -2]);
  });
});
