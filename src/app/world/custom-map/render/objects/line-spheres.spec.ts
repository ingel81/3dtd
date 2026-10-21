import { describe, expect, it } from 'vitest';
import { LineSpheres } from './line-spheres';

describe('LineSpheres', () => {
  /** Pieces of radius 1 along x, by id */
  const pieces = new Map<string, [number, number, number, number]>();
  const sphereOf = (id: string, out: Float32Array) => {
    const p = pieces.get(id);
    if (p) out.set(p);
    return !!p;
  };
  const refreshed = (lines: LineSpheres) => {
    const out = new Map<string, number[]>();
    lines.refresh(sphereOf, (id, x, y, z, r) => out.set(id, [x, y, z, r]));
    return out;
  };

  it('gives every piece of a line the sphere round all its pieces, and works out only the lines that changed', () => {
    const lines = new LineSpheres();
    for (let k = 0; k < 5; k++) {
      pieces.set(`a${k}`, [k * 10, 0, 0, 1]);
      lines.set(`a${k}`, 'a');
    }
    pieces.set('b0', [0, 0, 50, 1]);
    lines.set('b0', 'b');
    const first = refreshed(lines);
    expect(first.get('a0')).toEqual([20, 0, 0, 21]);
    expect(first.get('a4')).toEqual([20, 0, 0, 21]);
    expect(first.get('b0')).toEqual([0, 0, 50, 1]);
    expect(lines.due).toBe(false);
    // A piece of `a` moves: only `a` again
    pieces.set('a4', [60, 0, 0, 1]);
    lines.set('a4', 'a');
    const second = refreshed(lines);
    expect([...second.keys()].sort()).toEqual(['a0', 'a1', 'a2', 'a3', 'a4']);
    expect(second.get('a1')).toEqual([30, 0, 0, 31]);
  });

  it('lets a piece leave its line for another or none, and forgets a line without pieces', () => {
    const lines = new LineSpheres();
    pieces.set('c0', [0, 0, 0, 1]);
    pieces.set('c1', [10, 0, 0, 1]);
    lines.set('c0', 'c');
    lines.set('c1', 'c');
    refreshed(lines);
    lines.set('c1', null);
    expect(refreshed(lines).get('c0')).toEqual([0, 0, 0, 1]);
    lines.remove('c0');
    expect(lines.due).toBe(false);
    expect(refreshed(lines).size).toBe(0);
  });
});
