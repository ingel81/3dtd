import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { programsReady } from './programs-ready';

describe('programsReady', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('waits until every program the renderer holds is compiled, whichever material uses it now', async () => {
    const ready = [true, false, false];
    const renderer = { info: { programs: ready.map((_, k) => ({ isReady: () => ready[k] })) } };
    let done = false;
    void programsReady(renderer).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(100);
    expect(done).toBe(false);
    ready[1] = true;
    await vi.advanceTimersByTimeAsync(100);
    expect(done).toBe(false);
    ready[2] = true;
    await vi.advanceTimersByTimeAsync(20);
    expect(done).toBe(true);
  });

  it('gives up after the time limit', async () => {
    const renderer = { info: { programs: [{ isReady: () => false }] } };
    let done = false;
    void programsReady(renderer, 500).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(490);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(30);
    expect(done).toBe(true);
  });
});
