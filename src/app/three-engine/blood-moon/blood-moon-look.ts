import { BLOOD_MOON_LOOK } from '../../configs/blood-moon.config';
import { BloodMoonFade } from './blood-moon-fade';
import type { BloodMoonMood } from './blood-moon-mood';
import type { InstancedEnemyRenderer } from '../renderers/instanced-enemy/instanced-enemy.renderer';
import type { SearchlightRenderer } from '../renderers/searchlight/searchlight.renderer';
import type { OozeBandRenderer } from '../renderers/ooze/ooze-band.renderer';
import type { ThreeEffectsRenderer } from '../renderers/three-effects.renderer';

/** What follows the blood moon fade; each part is optional. */
export interface BloodMoonParts {
  /** Red tint over the picture, sky and fog */
  mood?: Pick<BloodMoonMood, 'setAmount' | 'dispose'>;
  /** Glowing enemies */
  enemies?: Pick<InstancedEnemyRenderer, 'setBloodMoon'>;
  /** Sweeping searchlights on the towers */
  searchlights?: Pick<SearchlightRenderer, 'setAmount' | 'advance'>;
  /** The oozes' slime bands: glow and tint like the enemies */
  oozes?: Pick<OozeBandRenderer, 'setBloodMoon'>;
  /** Blood, slime, ice and scorch decals: the mood's tint, as on the ground */
  groundMarks?: Pick<ThreeEffectsRenderer, 'setBloodMoon'>;
}

/**
 * The blood moon look of the scene (configs/blood-moon.config.ts), reached
 * as `engine.bloodMoon`. BloodMoonService says when a blood moon wave runs,
 * the display option whether the player wants the look at all. One fade
 * carries it in at the wave start and out at its end, and hands its amount
 * to the parts whenever it changes.
 *
 * The fade runs on the wall time between frames while the game runs and
 * holds while it is paused (`update(deltaMs, running)`): it takes as long at
 * 4x as at 1x, and a paused picture stays as it is.
 */
export class BloodMoonLook {
  private readonly fade = new BloodMoonFade(BLOOD_MOON_LOOK.fadeInMs, BLOOD_MOON_LOOK.fadeOutMs);
  private active = false;
  private enabled = true;
  /** What the parts were last given; they start at the normal look */
  private appliedAmount = 0;
  private appliedLinear = false;

  constructor(private readonly parts: BloodMoonParts = {}) {}

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

  /**
   * One render frame: `deltaMs` of wall time, `running` false while the game
   * is paused, `linearOutput` true while the frame goes through the
   * post-processing target (bloom or colour grading on).
   */
  update(deltaMs: number, running: boolean, linearOutput: boolean): void {
    if (running) {
      this.fade.step(deltaMs);
      // The beams sweep only while they show, on the same clock as the fade
      if (this.fade.amount > 0) this.parts.searchlights?.advance(deltaMs);
    }
    const amount = this.fade.amount;
    if (amount === this.appliedAmount && linearOutput === this.appliedLinear) return;
    this.appliedAmount = amount;
    this.appliedLinear = linearOutput;
    this.parts.mood?.setAmount(amount, linearOutput);
    this.parts.enemies?.setBloodMoon(amount, linearOutput);
    this.parts.oozes?.setBloodMoon(amount);
    this.parts.groundMarks?.setBloodMoon(amount, linearOutput);
    this.parts.searchlights?.setAmount(amount);
  }

  dispose(): void {
    this.parts.mood?.dispose();
  }

  private retarget(instant: boolean): void {
    const on = this.active && this.enabled;
    if (instant) this.fade.snap(on);
    else this.fade.setTarget(on);
  }
}
