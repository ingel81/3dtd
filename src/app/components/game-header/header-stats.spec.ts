import { describe, it, expect } from 'vitest';
import {
  COUNT_EXACT_BELOW,
  CREDITS_COUNT_MS,
  CREDITS_DELTA_SHOW_MS,
  CREDITS_DELTA_SUM_MS,
  CreditsDeltaTracker,
  countedValue,
  hqLevel,
  hqSegmentsLit,
  waveProgressPercent,
  CREDITS_EXACT_BELOW,
  HQ_EXACT_BELOW,
  hqReadout,
  statReadout,
} from './header-stats';

describe('statReadout', () => {
  it('shows figures below the threshold exactly, without a tooltip', () => {
    expect(statReadout(0, COUNT_EXACT_BELOW)).toEqual({ text: '0', exact: '0', tooltip: '' });
    expect(statReadout(99_999, COUNT_EXACT_BELOW)).toEqual({ text: '99999', exact: '99,999', tooltip: '' });
  });

  it('shortens from the threshold on and puts the exact figure in the tooltip', () => {
    expect(statReadout(100_000, COUNT_EXACT_BELOW)).toEqual({ text: '100k', exact: '100,000', tooltip: '100,000' });
    expect(statReadout(1_234_567, COUNT_EXACT_BELOW)).toEqual({ text: '1.2M', exact: '1,234,567', tooltip: '1,234,567' });
  });

  it('keeps credits exact through 999,999', () => {
    expect(statReadout(100_146, CREDITS_EXACT_BELOW)).toEqual({ text: '100146', exact: '100,146', tooltip: '' });
    expect(statReadout(999_999, CREDITS_EXACT_BELOW).text).toBe('999999');
    expect(statReadout(1_000_000, CREDITS_EXACT_BELOW)).toEqual({ text: '1M', exact: '1,000,000', tooltip: '1,000,000' });
  });

  it('keeps even an absurd cheat total short', () => {
    expect(statReadout(987_654_321, CREDITS_EXACT_BELOW).text).toBe('987M');
  });

  it('reads fractions down and negative input as 0', () => {
    expect(statReadout(1250.7, COUNT_EXACT_BELOW).text).toBe('1250');
    expect(statReadout(-5, COUNT_EXACT_BELOW)).toEqual({ text: '0', exact: '0', tooltip: '' });
  });
});

describe('hqReadout', () => {
  it('shows value, max and the share of health in play', () => {
    expect(hqReadout(72, 100)).toEqual({
      text: '72',
      exact: '72 / 100',
      tooltip: '',
      max: '100',
      percent: 72,
    });
  });

  it('keeps the max at full health and shows an empty bar at 0', () => {
    expect(hqReadout(100, 100)).toMatchObject({ max: '100', percent: 100, tooltip: '' });
    expect(hqReadout(0, 100)).toMatchObject({ text: '0', max: '100', percent: 0 });
  });

  it('drops the max past it and shows a full bar, the tooltip keeps the max', () => {
    expect(hqReadout(1100, 100)).toEqual({
      text: '1100',
      exact: '1,100 / 100',
      tooltip: '1,100 / 100',
      max: null,
      percent: 100,
    });
  });

  it('shortens a cheated HQ health from 10,000 on', () => {
    expect(hqReadout(HQ_EXACT_BELOW - 1, 100).text).toBe('9999');
    expect(hqReadout(101_100, 100)).toEqual({
      text: '101k',
      exact: '101,100 / 100',
      tooltip: '101,100 / 100',
      max: null,
      percent: 100,
    });
  });
});

describe('hqLevel and hqSegmentsLit', () => {
  it('turns warm below 30 % and shows the stripe below 10 %', () => {
    expect(hqLevel(100)).toBe('ok');
    expect(hqLevel(30)).toBe('ok');
    expect(hqLevel(29.9)).toBe('low');
    expect(hqLevel(10)).toBe('low');
    expect(hqLevel(9.9)).toBe('critical');
    expect(hqLevel(0)).toBe('critical');
  });

  it('lights a segment per started tenth, the last one goes out at 0', () => {
    expect(hqSegmentsLit(100)).toBe(10);
    expect(hqSegmentsLit(28)).toBe(3);
    expect(hqSegmentsLit(7)).toBe(1);
    expect(hqSegmentsLit(0.2)).toBe(1);
    expect(hqSegmentsLit(0)).toBe(0);
  });
});

describe('waveProgressPercent', () => {
  it('fills with the share of the wave that is gone', () => {
    expect(waveProgressPercent(true, 50, 50)).toBe(0);
    expect(waveProgressPercent(true, 50, 18)).toBe(64);
    expect(waveProgressPercent(true, 50, 0)).toBe(100);
  });

  it('stays empty between waves and for a wave of unknown size', () => {
    expect(waveProgressPercent(false, 50, 10)).toBe(0);
    expect(waveProgressPercent(true, 0, 0)).toBe(0);
  });
});

describe('CreditsDeltaTracker', () => {
  it('shows a gain with a plus and a spend with a real minus', () => {
    const tracker = new CreditsDeltaTracker();
    expect(tracker.change(25, 0)).toMatchObject({ text: '+25', kind: 'gain' });
    expect(tracker.change(-1500, 1000)).toMatchObject({ text: '−1,500', kind: 'loss' });
  });

  it('adds up changes within the window under one id', () => {
    const tracker = new CreditsDeltaTracker();
    const first = tracker.change(25, 0)!;
    const sum = tracker.change(25, CREDITS_DELTA_SUM_MS - 50)!;
    expect(sum).toMatchObject({ id: first.id, amount: 50, text: '+50' });
    const later = tracker.change(10, CREDITS_DELTA_SUM_MS * 3)!;
    expect(later.id).not.toBe(first.id);
    expect(later.text).toBe('+10');
  });

  it('shows nothing for a sum of 0', () => {
    const tracker = new CreditsDeltaTracker();
    tracker.change(150, 0);
    expect(tracker.change(-150, 100)).toBeNull();
    expect(tracker.change(40, CREDITS_DELTA_SHOW_MS)).toMatchObject({ text: '+40' });
  });
});

describe('countedValue', () => {
  it('counts in whole numbers and lands on the target', () => {
    expect(countedValue(100, 200, 0)).toBe(100);
    const mid = countedValue(100, 200, CREDITS_COUNT_MS / 2);
    expect(mid).toBeGreaterThan(150);
    expect(mid).toBeLessThan(200);
    expect(Number.isInteger(mid)).toBe(true);
    expect(countedValue(100, 200, CREDITS_COUNT_MS)).toBe(200);
    expect(countedValue(200, 50, CREDITS_COUNT_MS + 1)).toBe(50);
  });
});
