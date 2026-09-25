import { describe, expect, it } from 'vitest';
import { HashCheck, outOfStep } from './hash-check';

describe('HashCheck (docs/COOP_PLAN.md, C5, S3)', () => {
  it('reports two players who differ at once, with no one to blame', () => {
    const check = new HashCheck();
    expect(check.report(30, 'a', 1)).toBeNull();
    expect(check.report(30, 'b', 2)).toEqual({ tick: 30, hashes: [['a', 1], ['b', 2]], outOfStep: [] });
    // A tick is reported once
    expect(check.report(30, 'b', 3)).toBeNull();
  });

  it('waits for the third player, then names the one off the majority', () => {
    const check = new HashCheck();
    expect(check.report(30, 'a', 1, 3)).toBeNull();
    expect(check.report(30, 'b', 2, 3)).toBeNull();
    expect(check.report(30, 'c', 1, 3)).toEqual({ tick: 30, hashes: [['a', 1], ['b', 2], ['c', 1]], outOfStep: ['b'] });
  });

  it('judges a tick whose last report never came once a later tick does', () => {
    const check = new HashCheck();
    check.report(30, 'a', 1, 3);
    check.report(30, 'b', 2, 3);
    expect(check.report(60, 'a', 5, 3)).toEqual({ tick: 30, hashes: [['a', 1], ['b', 2]], outOfStep: [] });
  });

  it('stays quiet while everyone agrees', () => {
    const check = new HashCheck();
    for (const id of ['a', 'b', 'c']) expect(check.report(30, id, 7, 3)).toBeNull();
    expect(check.report(60, 'a', 8, 3)).toBeNull();
  });
});

describe('outOfStep', () => {
  it('needs a strict majority', () => {
    expect(outOfStep([['a', 1], ['b', 1], ['c', 1], ['d', 3]])).toEqual(['d']);
    expect(outOfStep([['a', 1], ['b', 1], ['c', 2], ['d', 2]])).toEqual([]);
    expect(outOfStep([['a', 1], ['b', 2]])).toEqual([]);
  });
});
