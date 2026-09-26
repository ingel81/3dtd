import { describe, expect, it } from 'vitest';
import { killOwnership } from './kill-ownership';
import type { KilledBy } from '../game-engine/events/event-types';

describe('killOwnership (TODO E44)', () => {
  // The gold's owner: the tower's owner while it stands, the first player once it is sold
  const standing = new Map([['t-ann', 'ann'], ['t-bob', 'bob']]);
  const creditOf = (by: KilledBy | null): string =>
    by?.kind === 'tower' ? standing.get(by.towerId) ?? 'ann' : by?.kind === 'ability' ? by.ownerId ?? 'ann' : 'ann';
  const logOf = (me: string) => killOwnership({ localPlayerId: me, killCreditPlayer: creditOf });

  it('gives a kill of a sold tower to one log, the one its gold went to', () => {
    const sold: KilledBy = { kind: 'tower', towerId: 't-gone' };
    expect(logOf('ann')(sold)).toBe(true);
    expect(logOf('bob')(sold)).toBe(false);
  });

  it("gives a standing tower's and an ability's kill to their owner", () => {
    expect(logOf('bob')({ kind: 'tower', towerId: 't-bob' })).toBe(true);
    expect(logOf('ann')({ kind: 'tower', towerId: 't-bob' })).toBe(false);
    expect(logOf('bob')({ kind: 'ability', ownerId: 'bob' } as KilledBy)).toBe(true);
  });

  it('counts a kill of no one in every log', () => {
    expect(logOf('bob')(null)).toBe(true);
  });
});
