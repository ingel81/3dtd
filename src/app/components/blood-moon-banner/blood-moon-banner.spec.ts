import { describe, it, expect, vi } from 'vitest';
import { BloodMoonBannerTiming, bloodMoonBanner } from './blood-moon-banner';

describe('bloodMoonBanner', () => {
  it('announces a blood moon wave', () => {
    expect(bloodMoonBanner(14, true)).toEqual({ wave: 'Wave 14', announcement: 'Blood moon, wave 14.' });
    expect(bloodMoonBanner(21, true)?.wave).toBe('Wave 21');
  });

  it('stays quiet on any other wave', () => {
    expect(bloodMoonBanner(13, true)).toBeNull();
    expect(bloodMoonBanner(15, true)).toBeNull();
  });

  it('stays quiet while the look is switched off', () => {
    expect(bloodMoonBanner(14, false)).toBeNull();
  });
});

/** The banner fades out from 2000 ms; each run is a fake Web Animation at its start. */
function setup() {
  const runs: { currentTime: number | null; cancel: ReturnType<typeof vi.fn> }[] = [];
  const timing = new BloodMoonBannerTiming(() => {
    const run = {
      currentTime: 0 as number | null,
      cancel: vi.fn(() => {
        run.currentTime = null;
      }),
    };
    runs.push(run);
    return run;
  }, 2000);
  return { timing, runs };
}

describe('BloodMoonBannerTiming', () => {
  it('plays at once when no boss intro runs', () => {
    const { timing, runs } = setup();
    timing.show();
    expect(runs).toHaveLength(1);
  });

  it('holds a banner due during a boss intro until the intro is over', () => {
    const { timing, runs } = setup();
    timing.setIntroActive(true);
    timing.show();
    expect(runs).toHaveLength(0);
    timing.setIntroActive(false);
    expect(runs).toHaveLength(1);
  });

  it('takes the banner off the screen when an intro starts and plays it in full afterwards', () => {
    const { timing, runs } = setup();
    timing.show();
    runs[0].currentTime = 1200;
    timing.setIntroActive(true);
    expect(runs[0].cancel).toHaveBeenCalled();
    timing.setIntroActive(false);
    expect(runs).toHaveLength(2);
    expect(runs[1].currentTime).toBe(0);
  });

  it('does not bring back a banner that was already fading out or over', () => {
    const { timing, runs } = setup();
    timing.show();
    runs[0].currentTime = 2500;
    timing.setIntroActive(true);
    timing.setIntroActive(false);
    expect(runs).toHaveLength(1);

    // A finished Web Animation keeps its end time
    timing.show();
    runs[1].currentTime = 3600;
    timing.setIntroActive(true);
    timing.setIntroActive(false);
    expect(runs).toHaveLength(2);
  });

  it('plays a held banner once, not on every later intro', () => {
    const { timing, runs } = setup();
    timing.setIntroActive(true);
    timing.show();
    timing.setIntroActive(false);
    timing.setIntroActive(false);
    expect(runs).toHaveLength(1);
    runs[0].currentTime = 3600;
    timing.setIntroActive(true);
    timing.setIntroActive(false);
    expect(runs).toHaveLength(1);
  });

  it('drops a held banner and stops a running one on a reset', () => {
    const { timing, runs } = setup();
    timing.setIntroActive(true);
    timing.show();
    timing.reset();
    timing.setIntroActive(false);
    expect(runs).toHaveLength(0);

    timing.show();
    timing.reset();
    expect(runs[0].cancel).toHaveBeenCalled();
  });

  it('shows nothing when there is no animation to play', () => {
    const timing = new BloodMoonBannerTiming(() => null, 2000);
    expect(() => {
      timing.show();
      timing.setIntroActive(true);
      timing.setIntroActive(false);
    }).not.toThrow();
  });
});
