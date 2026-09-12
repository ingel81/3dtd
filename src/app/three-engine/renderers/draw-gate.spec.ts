import { describe, it, expect } from 'vitest';
import { Group, Mesh, Object3D, Scene } from 'three';
import { DrawGate, findDrawGates } from './draw-gate';

describe('DrawGate', () => {
  it('hides its objects while the pool is empty', () => {
    const a = new Mesh();
    const b = new Mesh();
    const gate = new DrawGate([a, b]);
    expect([a.visible, b.visible]).toEqual([false, false]);

    gate.setCount(3);
    expect([a.visible, b.visible]).toEqual([true, true]);
    gate.setCount(1);
    expect(a.visible).toBe(true);

    gate.setCount(0);
    expect([a.visible, b.visible]).toEqual([false, false]);
  });

  it('touches the objects only when the pool turns empty or non-empty', () => {
    const mesh = new Mesh();
    const gate = new DrawGate([mesh]);
    gate.setCount(2);
    // Someone else hides the mesh for a moment (the LOS cube render does).
    mesh.visible = false;
    gate.setCount(5);
    expect(mesh.visible).toBe(false);
  });

  it('keeps a pool hidden by its owner hidden, filled or not', () => {
    const mesh = new Mesh();
    const gate = new DrawGate([mesh]);
    gate.setShown(false);
    gate.setCount(4);
    expect(mesh.visible).toBe(false);

    gate.setShown(true);
    expect(mesh.visible).toBe(true);
    gate.setCount(0);
    gate.setShown(false);
    gate.setShown(true);
    expect(mesh.visible).toBe(false);
  });

  it('draws an empty pool while forced, then falls back to its count', () => {
    const mesh = new Mesh();
    const gate = new DrawGate([mesh]);
    gate.setForced(true);
    expect(mesh.visible).toBe(true);

    gate.setForced(false);
    expect(mesh.visible).toBe(false);

    gate.setForced(true);
    gate.setCount(2);
    gate.setForced(false);
    expect(mesh.visible).toBe(true);
  });
});

describe('findDrawGates', () => {
  it('finds each gate below the root once', () => {
    const scene = new Scene();
    const group = new Group();
    scene.add(group);
    const bg = new Mesh();
    const fg = new Mesh();
    const other = new Mesh();
    scene.add(bg, fg);
    group.add(other);
    const twoPass = new DrawGate([bg, fg]);
    const nested = new DrawGate([other]);
    new DrawGate([new Object3D()]); // not in the scene

    const found = findDrawGates(scene);
    expect(found).toHaveLength(2);
    expect(found).toContain(twoPass);
    expect(found).toContain(nested);
  });
});
