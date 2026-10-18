import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { releaseContext, settleContexts } from './context-release';

describe('releaseContext', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    settleContexts();
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it('loses a released context once the next view stands and the page idles, not before', () => {
    const old = { forceContextLoss: vi.fn() };
    releaseContext(old);
    vi.advanceTimersByTime(5_000);
    expect(old.forceContextLoss).not.toHaveBeenCalled();
    settleContexts();
    expect(old.forceContextLoss).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(old.forceContextLoss).toHaveBeenCalledTimes(1);
    // Settled once: a later view loses nothing again
    settleContexts();
    vi.runAllTimers();
    expect(old.forceContextLoss).toHaveBeenCalledTimes(1);
  });

  it('loses it after a while when no view comes', () => {
    const old = { forceContextLoss: vi.fn() };
    releaseContext(old);
    vi.advanceTimersByTime(19_000);
    expect(old.forceContextLoss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_000);
    vi.runAllTimers();
    expect(old.forceContextLoss).toHaveBeenCalledTimes(1);
  });

  it('goes on with the others when one fails', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const broken = { forceContextLoss: vi.fn(() => { throw new Error('gone'); }) };
    const fine = { forceContextLoss: vi.fn() };
    releaseContext(broken);
    releaseContext(fine);
    settleContexts();
    vi.runAllTimers();
    expect(fine.forceContextLoss).toHaveBeenCalledTimes(1);
  });
});
