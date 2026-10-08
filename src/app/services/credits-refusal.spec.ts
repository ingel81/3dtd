import { describe, expect, it, vi } from 'vitest';
import { creditsRefusals, refuseForCredits } from './credits-refusal';
import { uiSound } from './ui-sound';

describe('refuseForCredits', () => {
  it('plays the refusal cue and counts the refusal for the credits plate', () => {
    const play = vi.spyOn(uiSound, 'play');
    const before = creditsRefusals();
    refuseForCredits();
    expect(play).toHaveBeenCalledWith('noMoney');
    expect(creditsRefusals()).toBe(before + 1);
    play.mockRestore();
  });
});
