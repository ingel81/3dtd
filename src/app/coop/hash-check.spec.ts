import { describe, expect, it } from 'vitest';
import { HASH_PARTS, HashCheck, firstDifferences, outOfStep, validDetail } from './hash-check';

describe('HashCheck (docs/COOP_PLAN.md, C5, S3)', () => {
  it('reports two players who differ at once, with no one to blame', () => {
    const check = new HashCheck();
    expect(check.report(30, 'a', 1)).toBeNull();
    expect(check.report(30, 'b', 2)).toEqual({ tick: 30, hashes: [['a', 1], ['b', 2]], outOfStep: [], parts: [] });
    // A tick is reported once
    expect(check.report(30, 'b', 3)).toBeNull();
  });

  it('waits for the third player, then names the one off the majority', () => {
    const check = new HashCheck();
    expect(check.report(30, 'a', 1, 3)).toBeNull();
    expect(check.report(30, 'b', 2, 3)).toBeNull();
    expect(check.report(30, 'c', 1, 3)).toEqual({ tick: 30, hashes: [['a', 1], ['b', 2], ['c', 1]], outOfStep: ['b'], parts: [] });
  });

  it('judges a tick whose last report never came once a later tick does', () => {
    const check = new HashCheck();
    check.report(30, 'a', 1, 3);
    check.report(30, 'b', 2, 3);
    expect(check.report(60, 'a', 5, 3)).toEqual({ tick: 30, hashes: [['a', 1], ['b', 2]], outOfStep: [], parts: [] });
  });

  it('stays quiet while everyone agrees', () => {
    const check = new HashCheck();
    for (const id of ['a', 'b', 'c']) expect(check.report(30, id, 7, 3)).toBeNull();
    expect(check.report(60, 'a', 8, 3)).toBeNull();
  });

  it('forgets old ticks whatever order they came in (relay review M3)', () => {
    const check = new HashCheck();
    // A huge tick first, then small ones going down: they must not pile up
    check.report(1_000_000, 'a', 1);
    for (let tick = 3000; tick >= 0; tick -= 30) check.report(tick, 'a', 1);
    const kept = (check as unknown as { byTick: Map<number, unknown> }).byTick.size;
    expect(kept).toBeLessThanOrEqual(21);
  });

  it('names the parts whose hashes differ (TODO E32)', () => {
    const check = new HashCheck();
    const parts = HASH_PARTS.map((_, i) => i);
    const other = parts.map((h, i) => (HASH_PARTS[i] === 'enemies' || HASH_PARTS[i] === 'ids' ? h + 100 : h));
    check.report(30, 'a', 1, 2, parts);
    expect(check.report(30, 'b', 2, 2, other)?.parts).toEqual(['ids', 'enemies']);
  });
});

describe('the detail of a desync (TODO E32)', () => {
  it('takes plain rows and refuses anything else', () => {
    expect(validDetail({ enemies: [['enemy-1', 48.1, 3]] })).toEqual({ enemies: [['enemy-1', 48.1, 3]] });
    expect(validDetail({ enemies: [['enemy-1', { x: 1 }]] })).toBeNull();
    expect(validDetail({ enemies: [[]] })).toBeNull();
    expect(validDetail({ enemies: [['x'.repeat(65), 1]] })).toBeNull();
    expect(validDetail({ enemies: 'x' })).toBeNull();
    expect(validDetail([1])).toBeNull();
    expect(validDetail(null)).toBeNull();
    // A key that is no part is left out
    expect(validDetail({ __proto__: [], other: [[1]] })).toEqual({});
  });

  it('names the first entities that differ, missing ones included', () => {
    const a = { enemies: [['enemy-1', 48.1, 3], ['enemy-2', 48.2, 3]], towers: [['tower-1', 0]] };
    const b = { enemies: [['enemy-1', 48.1, 3.5], ['enemy-3', 48.3, 3]], towers: [['tower-1', 0]] };
    expect(firstDifferences([['a', a], ['b', b]])).toEqual([
      { part: 'enemies', id: 'enemy-1', values: [['a', ['enemy-1', 48.1, 3]], ['b', ['enemy-1', 48.1, 3.5]]] },
      { part: 'enemies', id: 'enemy-2', values: [['a', ['enemy-2', 48.2, 3]], ['b', null]] },
      { part: 'enemies', id: 'enemy-3', values: [['a', null], ['b', ['enemy-3', 48.3, 3]]] },
    ]);
    expect(firstDifferences([['a', a], ['b', b]], 1)).toHaveLength(1);
    expect(firstDifferences([['a', a], ['b', a]])).toEqual([]);
  });
});

describe('outOfStep', () => {
  it('needs a strict majority', () => {
    expect(outOfStep([['a', 1], ['b', 1], ['c', 1], ['d', 3]])).toEqual(['d']);
    expect(outOfStep([['a', 1], ['b', 1], ['c', 2], ['d', 2]])).toEqual([]);
    expect(outOfStep([['a', 1], ['b', 2]])).toEqual([]);
  });
});
