import { describe, it, expect, vi } from 'vitest';
import {
  AirAlertAnnouncer,
  airAlertView,
  countAntiAirTowers,
  curriculumWaveHasAir,
  upcomingAirAlert,
} from './air-alert';
import { CURRICULUM_FORCED_THROUGH_WAVE } from '../../../configs/wave-curriculum.config';

describe('curriculumWaveHasAir', () => {
  it('reads the air units from the curriculum template', () => {
    expect(curriculumWaveHasAir(7)).toBe(true); // Bat Swarm
    expect(curriculumWaveHasAir(16)).toBe(true); // Chaos Wave, hornets in the mix
    expect(curriculumWaveHasAir(6)).toBe(false); // Spider Swarm
  });

  it('knows nothing past the curriculum', () => {
    expect(curriculumWaveHasAir(CURRICULUM_FORCED_THROUGH_WAVE + 1)).toBe(false);
  });
});

describe('upcomingAirAlert', () => {
  it('warns two waves ahead', () => {
    expect(upcomingAirAlert(5, 0)).toEqual({ wave: 7, wavesAhead: 2, antiAirTowers: 0 });
  });

  it('warns for the next wave and keeps the nearest one', () => {
    expect(upcomingAirAlert(6, 3)).toEqual({ wave: 7, wavesAhead: 1, antiAirTowers: 3 });
  });

  it('stays quiet when neither of the next two waves flies', () => {
    expect(upcomingAirAlert(0, 0)).toBeNull();
    expect(upcomingAirAlert(4, 0)).toBeNull();
  });
});

describe('AirAlertAnnouncer', () => {
  const alertFor = (wave: number) => ({ wave, wavesAhead: 2, antiAirTowers: 0 });
  /** Let the tone's answer reach the announcer. */
  const answered = () => new Promise((resolve) => setTimeout(resolve, 0));
  /** A tone that answers when the test says so. */
  function pendingTone() {
    let answer!: (played: boolean) => void;
    const tone = new Promise<boolean>((resolve) => { answer = resolve; });
    return { tone, answer };
  }

  it('plays once per air wave, also when the alert is shown again', async () => {
    const announcer = new AirAlertAnnouncer();
    const play = vi.fn(async () => true);
    announcer.update(5, alertFor(7), play);
    await answered();
    announcer.update(5, null, play); // the wave runs
    announcer.update(6, alertFor(7), play);
    expect(play).toHaveBeenCalledTimes(1);

    announcer.update(14, alertFor(16), play);
    expect(play).toHaveBeenCalledTimes(2);
  });

  it('plays again for the same wave in a new run', async () => {
    const announcer = new AirAlertAnnouncer();
    const play = vi.fn(async () => true);
    announcer.update(5, alertFor(7), play);
    await answered();
    announcer.update(0, null, play); // restart or new location
    announcer.update(5, alertFor(7), play);
    expect(play).toHaveBeenCalledTimes(2);
  });

  it('counts a wave as announced only once the tone came out', async () => {
    const announcer = new AirAlertAnnouncer();
    const play = vi.fn(async () => false); // no audio yet, or its buffer is missing
    announcer.update(5, alertFor(7), play);
    await answered();
    play.mockRejectedValueOnce(new Error('audio failed'));
    announcer.update(5, alertFor(7), play);
    await answered();
    play.mockResolvedValue(true);
    announcer.update(5, alertFor(7), play);
    await answered();
    announcer.update(5, alertFor(7), play);
    expect(play).toHaveBeenCalledTimes(3);
  });

  it('does not ask again while the tone has not answered', async () => {
    const announcer = new AirAlertAnnouncer();
    const { tone, answer } = pendingTone();
    const play = vi.fn(() => tone);
    announcer.update(5, alertFor(7), play);
    announcer.update(5, alertFor(7), play); // e.g. a tower was placed meanwhile
    expect(play).toHaveBeenCalledTimes(1);

    answer(true);
    await answered();
    announcer.update(5, alertFor(7), play);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('does not credit a tone that answers after a new run started to that run', async () => {
    const announcer = new AirAlertAnnouncer();
    const first = pendingTone();
    const play = vi.fn(() => first.tone);
    announcer.update(5, alertFor(7), play);
    announcer.update(0, null, play); // restart before the tone answered
    play.mockResolvedValueOnce(false);
    announcer.update(5, alertFor(7), play);
    first.answer(true);
    await answered();

    play.mockResolvedValue(true);
    announcer.update(5, alertFor(7), play);
    expect(play).toHaveBeenCalledTimes(3);
  });
});

describe('countAntiAirTowers', () => {
  it('counts towers that hit air, the research-gated ones only after research', () => {
    const placed = ['archer', 'dual-gatling', 'research-center'] as const;
    expect(countAntiAirTowers(placed, false)).toBe(1);
    expect(countAntiAirTowers(placed, true)).toBe(2);
  });
});

describe('airAlertView', () => {
  it('flags a defense without anti-air', () => {
    const view = airAlertView({ wave: 7, wavesAhead: 2, antiAirTowers: 0 }, false);
    expect(view).toMatchObject({
      title: 'Air · Wave 7',
      when: 'in 2 waves',
      defense: 'No tower hits air yet',
      covered: false,
    });
  });

  it('counts the anti-air towers', () => {
    expect(airAlertView({ wave: 8, wavesAhead: 1, antiAirTowers: 1 }, false))
      .toMatchObject({ when: 'next wave', defense: '1 tower hits air', covered: true });
    expect(airAlertView({ wave: 8, wavesAhead: 1, antiAirTowers: 4 }, false).defense)
      .toBe('4 towers hit air');
  });

  it('names the towers that hit air in the tooltip', () => {
    const before = airAlertView({ wave: 7, wavesAhead: 2, antiAirTowers: 0 }, false).tooltip;
    expect(before).toContain('Archer Tower');
    expect(before).toMatch(/\(after research\)/);
    const after = airAlertView({ wave: 7, wavesAhead: 2, antiAirTowers: 0 }, true).tooltip;
    expect(after).not.toMatch(/\(after research\)/);
  });
});
