/**
 * SimLoop over a stand-in core and timers the spec fires by hand: when it
 * passes, what it publishes, how it waits.
 */
import { describe, it, expect, vi } from 'vitest';
import { PASS_BUDGET_MS, SimLoop, type LoopTimers } from './sim-loop';
import type { SimFramePacket } from '../protocol/packet';

/** The loop's timers, fired by the spec: `soon` one message at a time, `later` one timer */
function timers() {
  let queued: (() => void) | null = null;
  let timer: { run: () => void; ms: number } | null = null;
  const self: LoopTimers & { clock: number; message(): boolean; elapse(): number | null; readonly waitMs: number | null } = {
    clock: 1000,
    now: () => self.clock,
    soon: (run) => {
      queued = run;
    },
    later: (run, ms) => (timer = { run, ms }),
    cancel: (handle) => {
      if (timer === handle) timer = null;
    },
    /** The message to itself arrives; false when none is on its way */
    message: () => {
      const run = queued;
      queued = null;
      run?.();
      return run !== null;
    },
    /** The timer fires after its time; null when none is set */
    elapse: () => {
      const due = timer;
      if (!due) return null;
      timer = null;
      self.clock += due.ms;
      due.run();
      return due.ms;
    },
    get waitMs() {
      return timer?.ms ?? null;
    },
  };
  return self;
}

const packet = (frame: number) => ({ frame }) as SimFramePacket;

function setup(idle: number[]) {
  const t = timers();
  const passes: [number, number][] = [];
  let frame = 0;
  const core = {
    publishes: true,
    pass: vi.fn((now: number, deadline: number) => {
      passes.push([now, deadline]);
      return core.publishes ? packet(++frame) : null;
    }),
    idleMs: vi.fn(() => idle.shift() ?? Infinity),
  };
  const published: number[] = [];
  const failed = vi.fn();
  const loop = new SimLoop(core, (p) => published.push(p.frame), failed, t);
  return { t, core, passes, published, failed, loop };
}

describe('SimLoop', () => {
  it('does nothing until it is woken, then passes with the budget as its deadline and publishes', () => {
    const { t, passes, published, loop } = setup([]);
    expect(t.message()).toBe(false);
    loop.wake();
    expect(passes).toEqual([]);
    t.message();
    expect(passes).toEqual([[1000, 1000 + PASS_BUDGET_MS]]);
    expect(published).toEqual([1]);
    // Nothing due and no timer: it sleeps until the next wake
    expect(t.message()).toBe(false);
    expect(t.waitMs).toBeNull();
  });

  it('goes on at once while work is due, and lets a message in between two passes', () => {
    const { t, core, published, loop } = setup([0, 0, 4]);
    loop.wake();
    t.message();
    expect(core.pass).toHaveBeenCalledTimes(1);
    // Not in the same task: the next pass waits for its own message
    t.message();
    t.message();
    expect(published).toEqual([1, 2, 3]);
    expect(t.message()).toBe(false);
    expect(t.waitMs).toBe(4);
  });

  it('sleeps until the next sub-step is due, and a wake meanwhile passes at once instead', () => {
    const { t, core, loop } = setup([12, 5, 7]);
    loop.wake();
    t.message();
    expect(t.waitMs).toBe(12);
    expect(t.elapse()).toBe(12);
    expect(core.pass).toHaveBeenCalledTimes(2);
    expect(t.waitMs).toBe(5);

    loop.wake();
    expect(t.waitMs).toBeNull();
    t.message();
    expect(core.pass).toHaveBeenCalledTimes(3);
    expect(t.waitMs).toBe(7);
  });

  it('passes once for several wakes before it ran', () => {
    const { t, core, loop } = setup([]);
    loop.wake();
    loop.wake();
    loop.wake();
    t.message();
    expect(t.message()).toBe(false);
    expect(core.pass).toHaveBeenCalledTimes(1);
  });

  it('publishes nothing for a pass without a packet', () => {
    const { t, core, published, loop } = setup([]);
    core.publishes = false;
    loop.wake();
    t.message();
    expect(core.pass).toHaveBeenCalledTimes(1);
    expect(published).toEqual([]);
  });

  it('stops for good when a pass throws, and says so once', () => {
    const { t, core, failed, loop } = setup([0]);
    const boom = new Error('boom');
    core.pass.mockImplementationOnce(() => {
      throw boom;
    });
    loop.wake();
    t.message();
    expect(failed).toHaveBeenCalledWith(boom);
    loop.wake();
    expect(t.message()).toBe(false);
    expect(core.pass).toHaveBeenCalledTimes(1);
  });

  it('stop() drops a pass already on its way and the timer', () => {
    const { t, core, loop } = setup([9]);
    loop.wake();
    t.message();
    expect(t.waitMs).toBe(9);
    loop.stop();
    expect(t.waitMs).toBeNull();
    loop.wake();
    t.message();
    expect(core.pass).toHaveBeenCalledTimes(1);
  });
});
