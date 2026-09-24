import { describe, it, expect } from 'vitest';
import { GameRng, mulberry32, newRunSeed } from './game-rng';

/** The first `n` numbers of a stream. */
const take = (next: () => number, n: number) => Array.from({ length: n }, () => next());

describe('GameRng', () => {
  it('gives the same numbers twice for the same seed', () => {
    expect(take(new GameRng(42).stream('director'), 8))
      .toEqual(take(new GameRng(42).stream('director'), 8));
  });

  it('gives different numbers for different seeds', () => {
    expect(take(new GameRng(42).stream('spawn'), 8))
      .not.toEqual(take(new GameRng(43).stream('spawn'), 8));
  });

  it('keeps the streams independent: drawing from one does not move another', () => {
    // The point of separate streams: if a bot decides differently, the enemies
    // must not shift, or an A/B comparison measures the random source.
    const a = new GameRng(7);
    const b = new GameRng(7);
    take(a.stream('bot'), 20);
    expect(take(a.stream('enemy'), 5)).toEqual(take(b.stream('enemy'), 5));
  });

  it('hands out the same function for a stream, so a caller can hold on to it', () => {
    const rng = new GameRng(1);
    expect(rng.stream('spawn')).toBe(rng.stream('spawn'));
  });

  it('starts every stream over on reset, with the given seed', () => {
    const rng = new GameRng(9);
    const before = take(rng.stream('director'), 4);
    rng.reset(9);
    expect(take(rng.stream('director'), 4)).toEqual(before);
  });

  it('takes a fresh seed on reset when none is given', () => {
    const rng = new GameRng(9);
    rng.reset();
    expect(rng.seed).not.toBe(9);
  });

  it('stays inside [0,1)', () => {
    const next = new GameRng(newRunSeed()).stream('enemy');
    for (const v of take(next, 500)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('takes the seed asked for before the reset, so a restart cannot draw over it', () => {
    const rng = new GameRng(9);

    rng.useNextSeed(4242);
    rng.reset();                 // the restart's own reset, without a seed

    expect(rng.seed).toBe(4242);
  });

  it('forgets the wish once it was used', () => {
    const rng = new GameRng(9);
    rng.useNextSeed(4242);
    rng.reset();

    rng.reset();

    expect(rng.seed).not.toBe(4242);
  });

  it('keeps a handed-out stream working across a reset, drawing from the new seed', () => {
    // The wave and enemy managers take their streams once per location. A
    // restart used to replace the functions, so they went on with the old
    // seed while the run log named the new one.
    const rng = new GameRng(9);
    const held = rng.stream('enemy');
    take(held, 3);
    rng.reset(77);
    expect(take(held, 4)).toEqual(take(new GameRng(77).stream('enemy'), 4));
  });

  it('draws the same numbers as mulberry32 over the stream seed', () => {
    const a = new GameRng(5).stream('spawn');
    const b = new GameRng(5).stream('spawn');
    expect(take(a, 6)).toEqual(take(b, 6));
  });

  it('puts every stream back where getState() found it', () => {
    const rng = new GameRng(11);
    take(rng.stream('director'), 3);
    take(rng.stream('enemy'), 7);
    const state = rng.getState();
    const after = {
      director: take(rng.stream('director'), 4),
      enemy: take(rng.stream('enemy'), 4),
      bot: take(rng.stream('bot'), 4),
    };

    const other = new GameRng(999);
    const held = other.stream('enemy');
    other.setState(state);

    expect(other.seed).toBe(11);
    expect(take(other.stream('director'), 4)).toEqual(after.director);
    expect(take(held, 4)).toEqual(after.enemy);
    expect(take(other.stream('bot'), 4)).toEqual(after.bot);
  });

  it('gives plain data from getState()', () => {
    const state = new GameRng(3).getState();
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('mulberry32 is the documented sequence, so a reference run keeps its numbers', () => {
    // Pinned: a change here silently rewrites every seeded run and every
    // reference file built from one.
    expect(take(mulberry32(1), 3).map((v) => v.toFixed(10)))
      .toEqual(['0.6270739406', '0.0027357212', '0.5274470400']);
  });
});
