import { describe, expect, it } from 'vitest';
import { towersWanted } from './path-coverage-upgrade.strategy';

describe('towersWanted', () => {
  it('asks for four towers and one more per wave, up to the cap', () => {
    expect(towersWanted(0, 20)).toBe(4);
    expect(towersWanted(5, 20)).toBe(9);
    expect(towersWanted(30, 20)).toBe(20);
    expect(towersWanted(30, 0)).toBe(34);
  });
});
