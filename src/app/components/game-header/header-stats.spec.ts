import { describe, it, expect } from 'vitest';
import {
  COUNT_EXACT_BELOW,
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
