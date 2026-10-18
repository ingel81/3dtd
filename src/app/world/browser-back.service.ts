import { Injectable } from '@angular/core';

/** One step back of a view (a question, an overlay, a menu, up a level); true when it took one */
export type BackStep = () => boolean;

/** The history entry the page keeps on top of its own, so the browser's Back stays in the page */
const GUARD = { tdBack: true };

/**
 * The browser's Back button in the one window (docs/WORLDS_NAVIGATION_PLAN.md,
 * 3.8): no navigation changes the address, so Back would leave the page
 * from anywhere, a world menu or a run included. Instead it goes one step
 * up, as Esc does: the views that show register their step, the one shown
 * last asks first. One history entry stands on top of the page's own while
 * a view is registered; Back takes it, a step is taken and the entry comes
 * back. With no step left (the globes, nothing open) Back leaves the page
 * as it always did.
 */
@Injectable({ providedIn: 'root' })
export class BrowserBack {
  private readonly steps: BackStep[] = [];
  private guarded = false;

  /** `step` takes Back while its view stands, until the returned call (the view's DestroyRef) */
  register(step: BackStep): () => void {
    this.steps.push(step);
    this.guard();
    return () => {
      const at = this.steps.lastIndexOf(step);
      if (at >= 0) this.steps.splice(at, 1);
    };
  }

  private guard(): void {
    if (this.guarded || typeof window === 'undefined') return;
    this.guarded = true;
    window.history.pushState(GUARD, '', window.location.href);
    window.addEventListener('popstate', this.onBack);
  }

  private readonly onBack = (): void => {
    for (let i = this.steps.length - 1; i >= 0; i--) {
      if (this.steps[i]()) {
        window.history.pushState(GUARD, '', window.location.href);
        return;
      }
    }
    // Nothing to step back to: Back leaves the page, as it means in a browser
    window.removeEventListener('popstate', this.onBack);
    this.guarded = false;
    window.history.back();
  };
}
