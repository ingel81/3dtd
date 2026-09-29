import { describe, it, expect, vi } from 'vitest';
import {
  WaveAlertAnnouncer,
  waveAlertView,
  countAntiAirTowers,
  countAntiEtherealTowers,
  waveBrings,
  upcomingWaveAlert,
} from './wave-alert';

describe('waveBrings (run plan rules, the default source)', () => {
  it('reads the air units from the plan row', () => {
    expect(waveBrings('air', 7)).toBe(true); // Bat Swarm
    expect(waveBrings('air', 16)).toBe(true); // Chaos Wave, hornets in the mix
    expect(waveBrings('air', 6)).toBe(false); // Spider Swarm
  });

  it('reads the ethereal enemies from the plan row', () => {
    expect(waveBrings('ethereal', 13)).toBe(true); // Ghost Surge
    expect(waveBrings('ethereal', 17)).toBe(true); // Wraith Storm
    expect(waveBrings('ethereal', 7)).toBe(false);
  });

  it('knows the waves past the campaign as well', () => {
    expect(waveBrings('air', 50)).toBe(true); // Boss: Dragon Flight
    expect(waveBrings('air', 31)).toBe(false); // Light Mix
    expect(waveBrings('ethereal', 35)).toBe(true); // Wraith Storm
    expect(waveBrings('ethereal', 31)).toBe(false);
  });
});

describe('upcomingWaveAlert', () => {
  it('warns two waves ahead', () => {
    expect(upcomingWaveAlert('air', 5, 0)).toEqual({ kind: 'air', wave: 7, wavesAhead: 2, answering: 0 });
    expect(upcomingWaveAlert('ethereal', 11, 0)).toEqual({ kind: 'ethereal', wave: 13, wavesAhead: 2, answering: 0 });
  });

  it('warns for the next wave and keeps the nearest one', () => {
    expect(upcomingWaveAlert('air', 6, 3)).toEqual({ kind: 'air', wave: 7, wavesAhead: 1, answering: 3 });
  });

  it('stays quiet when neither of the next two waves brings the kind', () => {
    expect(upcomingWaveAlert('air', 0, 0)).toBeNull();
    expect(upcomingWaveAlert('air', 4, 0)).toBeNull();
    expect(upcomingWaveAlert('ethereal', 5, 0)).toBeNull();
  });
});

describe('WaveAlertAnnouncer', () => {
  const alertFor = (wave: number) => ({ kind: 'air' as const, wave, wavesAhead: 2, answering: 0 });
  /** Let the tone's answer reach the announcer. */
  const answered = () => new Promise((resolve) => setTimeout(resolve, 0));
  /** A tone that answers when the test says so. */
  function pendingTone() {
    let answer!: (played: boolean) => void;
    const tone = new Promise<boolean>((resolve) => { answer = resolve; });
    return { tone, answer };
  }

  it('plays once per air wave, also when the alert is shown again', async () => {
    const announcer = new WaveAlertAnnouncer();
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
    const announcer = new WaveAlertAnnouncer();
    const play = vi.fn(async () => true);
    announcer.update(5, alertFor(7), play);
    await answered();
    announcer.update(0, null, play); // restart or new location
    announcer.update(5, alertFor(7), play);
    expect(play).toHaveBeenCalledTimes(2);
  });

  it('counts a wave as announced only once the tone came out', async () => {
    const announcer = new WaveAlertAnnouncer();
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
    const announcer = new WaveAlertAnnouncer();
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
    const announcer = new WaveAlertAnnouncer();
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

describe('countAntiEtherealTowers', () => {
  it('counts magic, ice and lightning, not arrows or fire', () => {
    expect(countAntiEtherealTowers(['archer', 'fire', 'magic', 'ice', 'lightning'])).toBe(3);
  });
});

describe('waveAlertView', () => {
  it('flags a defense without anti-air', () => {
    const view = waveAlertView({ kind: 'air', wave: 7, wavesAhead: 2, answering: 0 }, false);
    expect(view).toMatchObject({
      title: 'Air · Wave 7',
      when: 'in 2 waves',
      defense: 'No tower hits air yet',
      covered: false,
    });
  });

  it('counts the anti-air towers', () => {
    expect(waveAlertView({ kind: 'air', wave: 8, wavesAhead: 1, answering: 1 }, false))
      .toMatchObject({ when: 'next wave', defense: '1 tower hits air', covered: true });
    expect(waveAlertView({ kind: 'air', wave: 8, wavesAhead: 1, answering: 4 }, false).defense)
      .toBe('4 towers hit air');
  });

  it('names the towers that hit air in the tooltip', () => {
    const before = waveAlertView({ kind: 'air', wave: 7, wavesAhead: 2, answering: 0 }, false).tooltip;
    expect(before).toContain('Archer Tower');
    expect(before).toMatch(/\(after research\)/);
    const after = waveAlertView({ kind: 'air', wave: 7, wavesAhead: 2, answering: 0 }, true).tooltip;
    expect(after).not.toMatch(/\(after research\)/);
  });

  it('warns of ethereal enemies with the towers that hurt them', () => {
    const view = waveAlertView({ kind: 'ethereal', wave: 13, wavesAhead: 1, answering: 0 }, false);
    expect(view).toMatchObject({
      icon: 'ghost',
      title: 'Ethereal · Wave 13',
      when: 'next wave',
      defense: 'No tower hurts ethereal yet',
      covered: false,
    });
    for (const name of ['Magic Tower', 'Ice Tower', 'Lightning Tower']) expect(view.tooltip).toContain(name);
    expect(view.tooltip).not.toContain('Archer Tower');
    expect(waveAlertView({ kind: 'ethereal', wave: 13, wavesAhead: 1, answering: 2 }, false).defense)
      .toBe('2 towers hurt ethereal');
  });
});
