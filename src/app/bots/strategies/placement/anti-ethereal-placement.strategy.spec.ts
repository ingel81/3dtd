import { describe, expect, it } from 'vitest';
import { antiEtherealWanted } from './anti-ethereal-placement.strategy';

describe('antiEtherealWanted', () => {
  it('wants none during the bootstrap', () => {
    expect(antiEtherealWanted(0)).toBe(0);
    expect(antiEtherealWanted(1)).toBe(0);
  });

  it('wants one as soon as the bootstrap stands', () => {
    expect(antiEtherealWanted(2)).toBe(1);
    expect(antiEtherealWanted(5)).toBe(1);
  });

  it('keeps a quarter of the towers against ethereal armor', () => {
    expect(antiEtherealWanted(12)).toBe(3);
    expect(antiEtherealWanted(40)).toBe(10);
  });
});
