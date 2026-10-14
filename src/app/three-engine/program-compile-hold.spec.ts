import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgramCompileHold } from './program-compile-hold';

describe('ProgramCompileHold', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('holds the draw until the compile is done', async () => {
    const hold = new ProgramCompileHold();
    let done!: () => void;
    const held = hold.hold(() => new Promise<void>((resolve) => (done = resolve)));
    expect(hold.holding).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(hold.holding).toBe(true);
    done();
    await held;
    expect(hold.holding).toBe(false);
  });

  it('lets the draw go after the time limit or a failed compile', async () => {
    const hold = new ProgramCompileHold(2000);
    void hold.hold(() => new Promise(() => undefined));
    await vi.advanceTimersByTimeAsync(1999);
    expect(hold.holding).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(hold.holding).toBe(false);

    await hold.hold(() => Promise.reject(new Error('context lost')));
    expect(hold.holding).toBe(false);
  });

  it('keeps holding for a newer compile when an older one ends first', async () => {
    const hold = new ProgramCompileHold();
    let first!: () => void;
    let second!: () => void;
    const a = hold.hold(() => new Promise<void>((resolve) => (first = resolve)));
    const b = hold.hold(() => new Promise<void>((resolve) => (second = resolve)));
    first();
    await a;
    expect(hold.holding).toBe(true);
    second();
    await b;
    expect(hold.holding).toBe(false);
  });
});
