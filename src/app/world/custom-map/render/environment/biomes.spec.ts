import { describe, expect, it } from 'vitest';
import { biomeLook, mixLook } from './biomes';

describe('mixLook', () => {
  const day = biomeLook('temperate', 'day');
  const night = biomeLook('temperate', 'night');

  it('is the first look at 0 and the second at 1', () => {
    const plain = (o: object): unknown => JSON.parse(JSON.stringify(o));
    expect(plain(mixLook(day, night, 0))).toEqual(plain(day));
    expect(plain(mixLook(day, night, 1))).toEqual(plain(night));
  });

  it('lies between both halfway: colours per channel, numbers linear', () => {
    const half = mixLook(day, night, 0.5);
    expect(half.sunIntensity).toBeCloseTo((day.sunIntensity + night.sunIntensity) / 2);
    expect(half.exposure).toBeCloseTo((day.exposure + night.exposure) / 2);
    const red = (c: number): number => (c >> 16) & 255;
    expect(red(half.zenith)).toBe(Math.round((red(day.zenith) + red(night.zenith)) / 2));
  });
});
