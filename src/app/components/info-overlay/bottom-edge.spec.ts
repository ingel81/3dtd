import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeBottomEdge } from './bottom-edge';

/** A ResizeObserver that runs its callback when the test says so. */
class FakeResizeObserver {
  static last: FakeResizeObserver | null = null;
  observed: { el: Element; options?: ResizeObserverOptions } | null = null;
  disconnected = false;

  constructor(private readonly callback: () => void) {
    FakeResizeObserver.last = this;
  }

  observe(el: Element, options?: ResizeObserverOptions): void {
    this.observed = { el, options };
  }

  disconnect(): void {
    this.disconnected = true;
  }

  fire(): void {
    this.callback();
  }
}

/**
 * The info overlay reports its bottom edge through this, and the ability
 * bar starts its room below it (UIStore.infoOverlayBottom).
 */
describe('observeBottomEdge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeResizeObserver.last = null;
  });

  it('reports top plus border-box height on every resize, until stopped', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    // The expanded overlay: 12 px from the top, 101 px tall
    const el = { offsetTop: 12, offsetHeight: 101 } as HTMLElement;
    const report = vi.fn();

    const stop = observeBottomEdge(el, report);
    const observer = FakeResizeObserver.last!;
    expect(observer.observed).toEqual({ el, options: { box: 'border-box' } });

    observer.fire();
    expect(report).toHaveBeenLastCalledWith(113);

    // Collapsed to the FPS row
    (el as { offsetHeight: number }).offsetHeight = 23;
    observer.fire();
    expect(report).toHaveBeenLastCalledWith(35);

    stop();
    expect(observer.disconnected).toBe(true);
  });

  it('reports nothing where there is no ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const report = vi.fn();
    const stop = observeBottomEdge({ offsetTop: 12, offsetHeight: 101 } as HTMLElement, report);
    stop();
    expect(report).not.toHaveBeenCalled();
  });
});
