import { isBloodMoonWave } from '../../configs/blood-moon.config';

export interface BloodMoonBanner {
  /** Under the title: "Wave 14" */
  wave: string;
  /** For screen readers */
  announcement: string;
}

/**
 * The banner a wave start shows, null when the wave has no blood moon or
 * its look is switched off (display option): there is nothing to announce.
 */
export function bloodMoonBanner(wave: number, lookEnabled: boolean): BloodMoonBanner | null {
  if (!lookEnabled || !isBloodMoonWave(wave)) return null;
  return { wave: `Wave ${wave}`, announcement: `Blood moon, wave ${wave}.` };
}

/** What the timing needs of the banner's Web Animation. */
export interface BannerRun {
  readonly currentTime: CSSNumberish | null;
  cancel(): void;
}

/**
 * When the banner plays around a boss intro (W35 is a blood moon and the
 * worm's boss wave). The intro's veil darkens the canvas around its cuts
 * and its title card has the screen in between; a banner under it would
 * play out half hidden. So a banner due while an intro runs waits for its
 * end, and one on screen when an intro starts goes and plays again in full
 * afterwards, unless it had already begun to fade out.
 */
export class BloodMoonBannerTiming {
  private run: BannerRun | null = null;
  private pending = false;
  private introActive = false;

  /**
   * @param play starts the banner's animation; null where there is none
   *   (no element yet, no Web Animations)
   * @param fadeOutAtMs where in the animation the fade-out begins
   */
  constructor(
    private readonly play: () => BannerRun | null,
    private readonly fadeOutAtMs: number,
  ) {}

  /** A blood moon wave started. */
  show(): void {
    this.cancel();
    if (this.introActive) this.pending = true;
    else this.run = this.play();
  }

  /** The boss intro started or ended (BossIntroService.active). */
  setIntroActive(active: boolean): void {
    if (active === this.introActive) return;
    this.introActive = active;
    if (active) {
      const time = this.run?.currentTime;
      if (time !== null && time !== undefined && Number(time) < this.fadeOutAtMs) this.pending = true;
      this.cancel();
    } else if (this.pending) {
      this.pending = false;
      this.run = this.play();
    }
  }

  /** Restart or location change: nothing waits and nothing plays. */
  reset(): void {
    this.pending = false;
    this.cancel();
  }

  private cancel(): void {
    this.run?.cancel();
    this.run = null;
  }
}
