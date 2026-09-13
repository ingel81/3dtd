import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasSizeFollower } from './canvas-size-follower';

/** Stands in for the browser's ResizeObserver: `report()` is a change of the observed box. */
class FakeResizeObserver {
  static last: FakeResizeObserver | null = null;
  observed: Element[] = [];
  disconnected = false;
  constructor(private readonly callback: () => void) {
    FakeResizeObserver.last = this;
  }
  observe(el: Element): void {
    this.observed.push(el);
  }
  disconnect(): void {
    this.disconnected = true;
  }
  report(): void {
    if (!this.disconnected) this.callback();
  }
}

describe('CanvasSizeFollower', () => {
  const T = CanvasSizeFollower.THROTTLE_MS;
  let canvas: HTMLCanvasElement;
  let fit: ReturnType<typeof vi.fn<() => void>>;
  let follower: CanvasSizeFollower;
  const observer = () => FakeResizeObserver.last!;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    canvas = document.createElement('canvas');
    fit = vi.fn<() => void>();
    follower = new CanvasSizeFollower(canvas, fit);
  });

  afterEach(() => {
    follower.dispose();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('observes the canvas and fits at once on the first change', () => {
    expect(observer().observed).toEqual([canvas]);
    observer().report();
    expect(fit).toHaveBeenCalledTimes(1);
  });

  it('fits at most once per interval during a drag, and once more for the last size', () => {
    for (let i = 0; i < 10; i++) {
      observer().report();
      vi.advanceTimersByTime(10);
    }
    // Ten changes in 100 ms: a fit for the first, one for the latest when the throttle opens
    expect(fit).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(T);
    expect(fit).toHaveBeenCalledTimes(2);
  });

  it('fits a change after a quiet interval at once again', () => {
    observer().report();
    vi.advanceTimersByTime(T);
    observer().report();
    expect(fit).toHaveBeenCalledTimes(2);
  });

  it('stops observing and drops a pending fit on dispose', () => {
    observer().report();
    observer().report();
    follower.dispose();
    vi.advanceTimersByTime(T);
    expect(observer().disconnected).toBe(true);
    expect(fit).toHaveBeenCalledTimes(1);
  });

  it('does nothing without a ResizeObserver', () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('ResizeObserver', undefined);
    const bare = new CanvasSizeFollower(canvas, fit);
    bare.dispose();
    expect(fit).not.toHaveBeenCalled();
  });
});
