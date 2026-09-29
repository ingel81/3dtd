import { Injectable, inject } from '@angular/core';
import { PresentationService } from '../presentation/presentation.service';

/**
 * Coop: how long a shot shown at the click waits for the simulation's own
 * shot, which then stays quiet (no second sound, flash or recoil), ms. The
 * simulation's comes a tick and the way over the relay later.
 */
export const PREDICTED_SHOT_WINDOW_MS = 400;

/** Both sides of one shot ask within this, ms: the presentation (ops) and the HUD (the event) of one packet */
const SAME_SHOT_MS = 100;

/**
 * The manned tower's shot shown at the click in coop (TowerControlService):
 * the simulation's shot that follows plays without its muzzle flash, sound
 * and recoil. The presentation asks take() before it plays flash and sound
 * (registered with PresentationService.setShotPrediction), TowerControlService
 * before the recoil; both get the same answer for one shot, in either order.
 */
@Injectable({ providedIn: 'root' })
export class ShotPrediction {
  constructor() {
    inject(PresentationService).setShotPrediction((towerId) => this.take(towerId));
  }

  private shown: { towerId: string; at: number } | null = null;
  /** The shot take() found shown, for the other side's take() of the same shot */
  private quiet: { towerId: string; at: number } | null = null;

  /** A shot of `towerId` was shown now */
  predict(towerId: string, now: number = performance.now()): void {
    this.shown = { towerId, at: now };
  }

  /** Forget the shown shot (out of the tower) */
  clear(): void {
    this.shown = null;
    this.quiet = null;
  }

  /**
   * Whether this shot of `towerId` was shown at the click already; consumes
   * the prediction.
   */
  take(towerId: string, now: number = performance.now()): boolean {
    const quiet = this.quiet;
    if (quiet) {
      this.quiet = null;
      if (quiet.towerId === towerId && now - quiet.at <= SAME_SHOT_MS) return true;
    }
    const shown = this.shown;
    if (!shown || shown.towerId !== towerId) return false;
    this.shown = null;
    if (now - shown.at > PREDICTED_SHOT_WINDOW_MS) return false;
    this.quiet = { towerId, at: now };
    return true;
  }
}
