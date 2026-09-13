import { BLOOD_MOON_LOOK } from '../../configs/blood-moon.config';
import { BloodMoonFade } from './blood-moon-fade';

/**
 * The blood moon look of the scene (configs/blood-moon.config.ts), reached
 * as `engine.bloodMoon`. BloodMoonService says when a blood moon wave runs,
 * the display option whether the player wants the look at all. One fade
 * carries it in at the wave start and out at its end.
 *
 * The fade runs on the wall time between frames while the game runs and
 * holds while it is paused (`update(deltaMs, running)`): it takes as long at
 * 4x as at 1x, and a paused picture stays as it is.
 */
export class BloodMoonLook {
  private readonly fade = new BloodMoonFade(BLOOD_MOON_LOOK.fadeInMs, BLOOD_MOON_LOOK.fadeOutMs);
  private active = false;
  private enabled = true;

  /** A blood moon wave runs, or none; `instant` skips the fade (reset, new game). */
  setActive(active: boolean, instant = false): void {
    this.active = active;
    this.retarget(instant);
  }

  /**
   * Display option. Off drops the look at once; on while a blood moon wave
   * runs fades it back in.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.retarget(!enabled);
  }

  /** A blood moon wave runs (whether or not the look shows). */
  get isActive(): boolean {
    return this.active;
  }

  /** 0 = normal look, 1 = full blood moon */
  get amount(): number {
    return this.fade.amount;
  }

  /** One render frame: `deltaMs` of wall time, `running` false while the game is paused. */
  update(deltaMs: number, running: boolean): void {
    if (running) this.fade.step(deltaMs);
  }

  private retarget(instant: boolean): void {
    const on = this.active && this.enabled;
    if (instant) this.fade.snap(on);
    else this.fade.setTarget(on);
  }
}
