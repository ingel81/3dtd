import { describe, expect, it } from 'vitest';
import { InstanceList, type InstanceSource } from './instance-list';

/** Objects whose matrix holds their index in every value, so a slot tells whose instance it holds */
function source(n: number): InstanceSource {
  const matrices = new Float32Array(n * 16);
  for (let i = 0; i < n; i++) matrices.fill(i, i * 16, i * 16 + 16);
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.fill(i / 10, i * 3, i * 3 + 3);
  return { matrices, colors };
}

/** The objects in the list, casters and the rest, each as its matrix says; and whether every table entry agrees */
function contents(list: InstanceList, table: Int32Array): { casting: number[]; rest: number[]; consistent: boolean } {
  const m = list.matrices.array as Float32Array;
  const at = (slot: number) => m[slot * 16];
  const casting = Array.from({ length: list.casters }, (_, s) => at(s)).sort((a, b) => a - b);
  const rest = Array.from({ length: list.count - list.casters }, (_, s) => at(list.casters + s)).sort((a, b) => a - b);
  let consistent = true;
  for (let i = 0; i < table.length; i++) {
    const slot = table[i];
    if (slot < 0) continue;
    if (at(slot) !== i || list.ownerAt(slot) !== i || !list.ownedBy(slot, table) || slot >= list.count) consistent = false;
  }
  return { casting, rest, consistent };
}

describe('InstanceList', () => {
  it('keeps the casters first through inserts, removals and casting changes, and every owner knows its slot', () => {
    const n = 8;
    const src = source(n);
    const table = new Int32Array(n).fill(-1);
    const list = new InstanceList(n, true);
    list.insert(table, 0, src, false, 0);
    list.insert(table, 1, src, true, 0);
    list.insert(table, 2, src, false, 0.25);
    list.insert(table, 3, src, true, 0);
    list.insert(table, 4, src, false, 0);
    expect(contents(list, table)).toEqual({ casting: [1, 3], rest: [0, 2, 4], consistent: true });
    // The fade and the colour travel with their instance
    expect(list.fades.array[table[2]]).toBe(0.25);
    expect(list.colors!.array[table[4] * 3]).toBeCloseTo(0.4);

    list.remove(table, 1);
    expect(table[1]).toBe(-1);
    expect(contents(list, table)).toEqual({ casting: [3], rest: [0, 2, 4], consistent: true });
    list.setCasting(table, 2, true);
    expect(contents(list, table)).toEqual({ casting: [2, 3], rest: [0, 4], consistent: true });
    expect(list.fades.array[table[2]]).toBe(0.25);
    list.setCasting(table, 3, false);
    expect(contents(list, table)).toEqual({ casting: [2], rest: [0, 3, 4], consistent: true });
    list.remove(table, 0);
    list.remove(table, 2);
    expect(contents(list, table)).toEqual({ casting: [], rest: [3, 4], consistent: true });
    expect(list.count).toBe(2);
  });

  it('follows its owner when the asset moves its last object into a gap', () => {
    const src = source(4);
    const table = new Int32Array(4).fill(-1);
    const list = new InstanceList(4, false);
    list.insert(table, 1, src, true, 0);
    list.insert(table, 3, src, false, 0);
    // Object 3 becomes object 0 (its matrix too, as the asset copies it)
    src.matrices.fill(0, 48, 64);
    list.rename(table, 3, 0);
    list.rewrite(table, 0, { ...src, matrices: src.matrices.copyWithin(0, 48, 64) });
    expect(table[3]).toBe(-1);
    expect(contents(list, table)).toEqual({ casting: [1], rest: [0], consistent: true });
  });

  it('serves owners from several tables in one list, each with its own values for the extras', () => {
    const a = new Int32Array(2).fill(-1);
    const b = new Int32Array(2).fill(-1);
    const list = new InstanceList(4, false, [2]);
    list.insert(a, 0, { ...source(2), extras: [[7, 7]] }, false, 0);
    list.insert(b, 1, { ...source(2), extras: [[9, 9]] }, true, 0);
    expect(list.ownedBy(a[0], a)).toBe(true);
    expect(list.ownedBy(b[1], a)).toBe(false);
    expect(Array.from(list.extras[0].array.slice(b[1] * 2, b[1] * 2 + 2))).toEqual([9, 9]);
    list.remove(b, 1);
    expect(Array.from(list.extras[0].array.slice(a[0] * 2, a[0] * 2 + 2))).toEqual([7, 7]);
  });

  it('uploads what changed as one range, and keeps a range three has not uploaded yet', () => {
    const src = source(64);
    const table = new Int32Array(64).fill(-1);
    const list = new InstanceList(64, false);
    for (let i = 0; i < 40; i++) list.insert(table, i, src, false, 0);
    list.flush();
    const ranges = () => list.matrices.updateRanges.map((r) => [r.start / 16, r.count / 16]);
    expect(ranges()).toEqual([[0, 40]]);
    // Not uploaded (a hidden mesh): the next flush still covers it, in one range
    list.setFade(table, 39, 0.5);
    list.flush();
    expect(ranges()).toEqual([[0, 40]]);
    // Uploaded: only what changed after
    list.matrices.onUploadCallback();
    list.setFade(table, 20, 0.5);
    list.setFade(table, 30, 0.5);
    list.flush();
    expect(ranges()).toEqual([[20, 11]]);
    expect(list.fades.updateRanges).toEqual([{ start: 20, count: 11 }]);
    // Nothing changed: nothing to hand over
    list.matrices.onUploadCallback();
    const version = list.matrices.version;
    list.flush();
    expect(list.matrices.version).toBe(version);
  });
});
