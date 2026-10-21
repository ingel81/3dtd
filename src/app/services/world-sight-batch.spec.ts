import { describe, expect, it } from 'vitest';
import { WORLD_SIGHT_EVERY_MS, WorldSightBatch } from './world-sight-batch';

describe('WorldSightBatch (E291)', () => {
  const make = () => {
    const clock = { t: 0 };
    return { clock, batch: new WorldSightBatch<string>(() => clock.t) };
  };

  it('starts a batch of every waiting request at once, the next not before a second is up', () => {
    const { clock, batch } = make();
    batch.tick(['a', 'b'], true);
    expect([batch.allows('a'), batch.allows('b'), batch.size]).toEqual([true, true, 2]);
    // Answered: out of the batch, which ends
    batch.tick([], true);
    expect(batch.size).toBe(0);
    // New craters 0.4 s on: they wait, gathered, for the second to be up
    clock.t = 400;
    batch.tick(['c'], true);
    clock.t = 700;
    batch.tick(['c', 'd'], true);
    expect([batch.allows('c'), batch.allows('d')]).toEqual([false, false]);
    clock.t = WORLD_SIGHT_EVERY_MS;
    batch.tick(['c', 'd'], true);
    expect([batch.allows('c'), batch.allows('d')]).toEqual([true, true]);
  });

  it('keeps a request newer than its start for the next batch, and the batch until its last is answered', () => {
    const { clock, batch } = make();
    batch.tick(['a', 'b'], true);
    // b's tower asked again (a newer request replaced b), e came: neither joins
    clock.t = 1500;
    batch.tick(['a', 'b2', 'e'], true);
    expect([batch.allows('a'), batch.allows('b'), batch.allows('b2'), batch.allows('e')]).toEqual([true, false, false, false]);
    // a answered: the batch is done and the next starts, its time being up
    batch.tick(['b2', 'e'], true);
    expect([batch.allows('b2'), batch.allows('e')]).toEqual([true, true]);
  });

  it('waits for the drawn ground to hold every stamp, so the cube sees the crater wall', () => {
    const { batch } = make();
    batch.tick(['a'], false);
    expect(batch.allows('a')).toBe(false);
    batch.tick(['a'], true);
    expect(batch.allows('a')).toBe(true);
  });

  it('starts afresh after a reset (a new run or location)', () => {
    const { batch } = make();
    batch.tick(['a'], true);
    batch.reset();
    expect(batch.allows('a')).toBe(false);
    batch.tick(['b'], true);
    expect(batch.allows('b')).toBe(true);
  });
});
