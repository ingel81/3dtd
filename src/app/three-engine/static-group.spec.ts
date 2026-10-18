import { Group, Matrix4, Mesh, Object3D, Scene, Vector3 } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StaticGroup, drawnInWorldSpace } from './static-group';

/** A scene at the origin as the game's and the editor's: its own matrix not composed every frame */
function stage(): { scene: Scene; root: StaticGroup } {
  const scene = new Scene();
  scene.matrixAutoUpdate = false;
  const root = new StaticGroup();
  scene.add(root);
  return { scene, root };
}

/** A tree of groups with meshes, `n` meshes in all */
function tree(n: number): { top: Group; leaves: Mesh[] } {
  const top = new Group();
  const leaves: Mesh[] = [];
  for (let k = 0; k < n; k++) {
    const cell = new Group();
    cell.position.set(k, 0, 0);
    const mesh = new Mesh();
    mesh.position.set(0, k, 0);
    cell.add(mesh);
    top.add(cell);
    leaves.push(mesh);
  }
  return { top, leaves };
}

function worldOf(o: Object3D): Vector3 {
  return new Vector3().setFromMatrixPosition(o.matrixWorld);
}

/** The matrix multiplications of one call */
function multiplications(run: () => void): number {
  const spy = vi.spyOn(Matrix4.prototype, 'multiplyMatrices');
  try {
    run();
    return spy.mock.calls.length;
  } finally {
    spy.mockRestore();
  }
}

afterEach(() => vi.restoreAllMocks());

describe('StaticGroup', () => {
  it('multiplies nothing in a frame where nothing changed', () => {
    const { scene, root } = stage();
    const { top } = tree(200);
    root.add(top);
    // The first frame computes the subtree it got
    expect(multiplications(() => scene.updateMatrixWorld())).toBeGreaterThanOrEqual(400);
    expect(multiplications(() => scene.updateMatrixWorld())).toBe(0);
    // A plain group under the same scene keeps three's behaviour: its children multiply every frame
    const plain = new Group();
    plain.add(tree(200).top);
    scene.add(plain);
    scene.updateMatrixWorld();
    expect(multiplications(() => scene.updateMatrixWorld())).toBeGreaterThanOrEqual(400);
  });

  it('carries a move to every world matrix below', () => {
    const { scene, root } = stage();
    const { top, leaves } = tree(5);
    root.add(top);
    scene.updateMatrixWorld();
    root.position.set(100, 0, -40);
    root.updateMatrix();
    scene.updateMatrixWorld();
    expect(worldOf(leaves[3])).toEqual(new Vector3(103, 3, -40));
    // updateMatrixWorld(true) at once, as the map's placeAt does
    root.position.set(-7, 0, 9);
    root.updateMatrix();
    root.updateMatrixWorld(true);
    expect(worldOf(leaves[4])).toEqual(new Vector3(-3, 4, 9));
  });

  it('computes an object added anywhere below in the next frame, and only it', () => {
    const { scene, root } = stage();
    root.position.set(50, 0, 0);
    root.updateMatrix();
    const { top } = tree(100);
    root.add(top);
    scene.updateMatrixWorld();
    // Deep inside, after the subtree was computed: a cell built later (a level of detail, an edit)
    const cell = top.children[10];
    const late = new Mesh();
    late.position.set(0, 0, 5);
    cell.add(late);
    const n = multiplications(() => scene.updateMatrixWorld());
    expect(worldOf(late)).toEqual(new Vector3(60, 0, 5));
    expect(n).toBe(1);
    // A group added with children of its own, children added under it later too
    const branch = tree(3).top;
    top.add(branch);
    scene.updateMatrixWorld();
    const deeper = new Mesh();
    deeper.position.set(1, 1, 1);
    branch.children[2].add(deeper);
    scene.updateMatrixWorld();
    expect(worldOf(deeper)).toEqual(new Vector3(53, 1, 1));
    // Added and taken out before the frame: nothing to compute
    const gone = new Mesh();
    cell.add(gone);
    cell.remove(gone);
    expect(multiplications(() => scene.updateMatrixWorld())).toBe(0);
  });

  it('recomputes all of it after invalidate, for an object moved in place', () => {
    const { scene, root } = stage();
    const { top, leaves } = tree(4);
    root.add(top);
    scene.updateMatrixWorld();
    leaves[2].position.set(0, 0, 8);
    scene.updateMatrixWorld();
    expect(worldOf(leaves[2]).z).toBe(0);
    root.invalidate();
    scene.updateMatrixWorld();
    expect(worldOf(leaves[2])).toEqual(new Vector3(2, 0, 8));
  });

  it('updates its moving parts every frame', () => {
    const { scene, root } = stage();
    root.position.set(10, 0, 0);
    root.updateMatrix();
    const banner = new Mesh();
    root.addMoving(banner);
    scene.updateMatrixWorld();
    for (let k = 1; k <= 3; k++) {
      banner.position.y = k;
      expect(multiplications(() => scene.updateMatrixWorld())).toBe(1);
      expect(worldOf(banner)).toEqual(new Vector3(10, k, 0));
    }
    root.remove(banner);
    expect(multiplications(() => scene.updateMatrixWorld())).toBe(0);
  });

  it('lets a StaticGroup inside go by its own rules, and follows a new parent', () => {
    const { scene, root } = stage();
    const inner = new StaticGroup();
    const { top, leaves } = tree(3);
    inner.add(top);
    root.add(inner);
    root.position.set(5, 0, 0);
    root.updateMatrix();
    scene.updateMatrixWorld();
    expect(worldOf(leaves[1])).toEqual(new Vector3(6, 1, 0));
    const late = new Mesh();
    leaves[1].parent!.add(late);
    expect(multiplications(() => scene.updateMatrixWorld())).toBe(1);
    expect(worldOf(late)).toEqual(new Vector3(6, 0, 0));
    // Lifted out beside its old parent (the map's sight blockers into the scene) at its own place
    scene.add(inner);
    inner.position.set(5, 0, 0);
    inner.updateMatrix();
    scene.updateMatrixWorld();
    expect(worldOf(leaves[2])).toEqual(new Vector3(7, 2, 0));
    expect(multiplications(() => scene.updateMatrixWorld())).toBe(0);
  });

  it('passes over objects drawn in world space in the frame update (drawnInWorldSpace)', () => {
    const scene = new Scene();
    scene.matrixAutoUpdate = false;
    const pool = Array.from({ length: 500 }, () => drawnInWorldSpace(new Mesh()));
    scene.add(...pool);
    expect(multiplications(() => scene.updateMatrixWorld())).toBe(0);
    pool[3].visible = true;
    expect(multiplications(() => scene.updateMatrixWorld())).toBe(0);
    expect(pool[3].matrixWorld.equals(new Matrix4())).toBe(true);
  });
});
