import { Injectable, NgZone, inject, signal } from '@angular/core';

/** Stations of the corridor measurement under way, see PathAndRouteService.clearanceProgress. */
export interface StationProgress {
  done: number;
  total: number;
}

/** What the hint over the map says while the HQ moves. */
export interface RelocationStatus {
  /** What is moved, the title of the hint */
  title: string;
  /** The step under way */
  step: string;
  /** Share of the corridor measured, whole percent; null before the measurement */
  percent: number | null;
}

/** Step shown while the corridor of the new routes is measured */
export const MEASURING_STEP = 'Measuring the corridor';

/**
 * The hint over the map while the HQ moves (MapRelocationService). The
 * rebuild blocks the main thread for its whole length, and the corridor
 * measurement after it runs for seconds in a dense city; neither showed
 * anything on screen. Holds the signal RelocationStatusComponent shows,
 * and the frame loop that follows the measurement.
 */
@Injectable({ providedIn: 'root' })
export class RelocationStatusService {
  private readonly zone = inject(NgZone);

  readonly status = signal<RelocationStatus | null>(null);

  /** Bumped by show() and clear(), so a followCorridor() of an earlier move stops. */
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
   * Show the corridor measurement under way until it ends: reads
   * `progress` once a frame, outside Angular (the signal changes only with
   * the percentage), and when it gives null clears the hint and calls
   * `done`. A measurement that is over before the call ends it at once.
   * Stops without `done` when another move shows its own hint.
   */
  followCorridor(progress: () => StationProgress | null, done: () => void): void {
    const generation = this.generation;
    const tick = (): void => {
      if (generation !== this.generation) return;
      const now = progress();
      if (!now) {
        this.clear();
        done();
        return;
      }
      const percent = now.total > 0 ? Math.floor((100 * now.done) / now.total) : 0;
      const current = this.status();
      if (current && (current.step !== MEASURING_STEP || current.percent !== percent)) {
        this.status.set({ ...current, step: MEASURING_STEP, percent });
      }
      requestAnimationFrame(tick);
    };
    this.zone.runOutsideAngular(tick);
  }
}
