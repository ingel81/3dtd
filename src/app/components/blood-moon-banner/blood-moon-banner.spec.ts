import { describe, it, expect } from 'vitest';
import { bloodMoonBanner } from './blood-moon-banner';

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
