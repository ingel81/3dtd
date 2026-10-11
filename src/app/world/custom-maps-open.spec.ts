import { describe, expect, it } from 'vitest';
import { CUSTOM_MAPS_RELEASED, customMapsByLink } from './custom-maps-open';

describe('customMapsByLink', () => {
  it('opens map links outside a production build, in one only once the maps are released', () => {
    expect(customMapsByLink(false)).toBe(true);
    expect(customMapsByLink(true)).toBe(CUSTOM_MAPS_RELEASED);
  });
});
