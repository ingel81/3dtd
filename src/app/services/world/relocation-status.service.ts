import { Injectable, signal } from '@angular/core';

/** What the hint over the map says while HQ or spawn move. */
export interface RelocationStatus {
  /** What is moved, the title of the hint */
  title: string;
  /** The step under way */
  step: string;
  /** Share of the step done, whole percent; null where there is none */
  percent: number | null;
}

/** A step and its share, as the corridor build reports them (CorridorBuild). */
type StepProgress = Pick<RelocationStatus, 'step' | 'percent'>;

/**
 * The hint over the map while HQ or spawn move (MapRelocationService). The
 * rebuild blocks the main thread for its whole length, and the corridor
 * build after it runs for seconds in a dense city; neither showed anything
 * on screen. Holds the signal RelocationStatusComponent shows.
 */
@Injectable({ providedIn: 'root' })
export class RelocationStatusService {
  readonly status = signal<RelocationStatus | null>(null);

  /** Bumped by show() and clear(), so what follow() handed out for an earlier move does nothing. */
  private generation = 0;

  /** Show the hint with `step` under way. */
  show(title: string, step: string): void {
    this.generation++;
    this.status.set({ title, step, percent: null });
  }

  clear(): void {
    this.generation++;
    this.status.set(null);
  }

  /**
   * Resolves once the browser has painted what is on screen now, after two
   * animation frames. Awaited before steps that block the main thread, so
   * the hint stands while they run.
   */
  painted(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }

  /**
   * Follow the corridor build of the move on the hint shown now: `report`
   * puts each step and its share on it (the signal changes only when one of
   * them does), `end` takes the hint away. Both do nothing once another move
   * has shown its own hint.
   */
  follow(): { report: (progress: StepProgress) => void; end: () => void } {
    const generation = this.generation;
    return {
      report: ({ step, percent }) => {
        const current = this.status();
        if (generation !== this.generation || !current) return;
        if (current.step !== step || current.percent !== percent) this.status.set({ ...current, step, percent });
      },
      end: () => {
        if (generation === this.generation) this.clear();
      },
    };
  }
}
