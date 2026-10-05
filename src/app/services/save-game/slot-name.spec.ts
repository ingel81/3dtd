import { describe, expect, it } from 'vitest';
import { defaultSlotName, shortPlaceName } from './slot-name';

describe('slot names', () => {
  it('takes the town of the header name', () => {
    expect(shortPlaceName('Hauptstraße 51, Bad Wimpfen, Deutschland')).toBe('Bad Wimpfen');
    expect(shortPlaceName('Bad Wimpfen, Deutschland')).toBe('Bad Wimpfen');
    expect(shortPlaceName('Heilbronn')).toBe('Heilbronn');
  });

  it('keeps coordinates and odd names as they are', () => {
    expect(shortPlaceName('49.2312, 9.1601')).toBe('49.2312, 9.1601');
    expect(shortPlaceName('-33.8688, 151.2093')).toBe('-33.8688, 151.2093');
    expect(shortPlaceName('  Unknown location ')).toBe('Unknown location');
  });

  it('names a save after the town and the wave', () => {
    expect(defaultSlotName('Hauptstraße 51, Bad Wimpfen, Deutschland', 2)).toBe('Bad Wimpfen, wave 2');
  });
});
