import { describe, expect, it } from 'vitest';
import { laneLengthRows } from './lane-length-rows';

describe('laneLengthRows', () => {
  it('adds the new lane after the others, against their average', () => {
    const { rows, deltaPercent } = laneLengthRows([620, 410], { target: { kind: 'add' }, meters: 780 });
    expect(rows.map((r) => [r.label, r.meters, r.edited])).toEqual([['Spawn 1', 620, false], ['Spawn 2', 410, false], ['New', 780, true]]);
    expect(rows[2].share).toBe(1);
    expect(rows[1].share).toBeCloseTo(410 / 780);
    // 780 against (620 + 410) / 2 = 515
    expect(deltaPercent).toBe(51);
  });

  it('puts a moved lane in its own place, and says nothing while the cursor has no route', () => {
    const moved = laneLengthRows([620, 410, 500], { target: { kind: 'move', index: 1 }, meters: 300 });
    expect(moved.rows.map((r) => [r.meters, r.edited])).toEqual([[620, false], [300, true], [500, false]]);
    expect(moved.deltaPercent).toBe(-46);
    const nowhere = laneLengthRows([620, 410], { target: { kind: 'move', index: 0 }, meters: null });
    expect(nowhere.rows[0]).toMatchObject({ meters: null, share: 0, edited: true });
    expect(nowhere.deltaPercent).toBeNull();
  });

  it('one spawn in place of all is the only lane, with nothing to compare', () => {
    const { rows, deltaPercent } = laneLengthRows([620, 410], { target: { kind: 'all' }, meters: 700 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: 'Spawn 1', meters: 700, share: 1, edited: true });
    expect(deltaPercent).toBeNull();
  });
});
