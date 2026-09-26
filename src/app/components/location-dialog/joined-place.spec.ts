import { describe, expect, it } from 'vitest';
import { joinedPlaceResult } from './joined-place';

describe('joinedPlaceResult', () => {
  it('carries the host HQ and every spawn, the first as the spawn', () => {
    const result = joinedPlaceResult({
      hq: { lat: 48.1, lon: 9.2 },
      spawns: [{ lat: 48.11, lon: 9.21 }, { lat: 48.09, lon: 9.19 }],
    });
    expect(result).toEqual({
      confirmed: true,
      hq: { lat: 48.1, lon: 9.2, name: '', displayName: '' },
      spawn: { id: 'spawn-1', lat: 48.11, lon: 9.21 },
      spawns: [{ lat: 48.11, lon: 9.21 }, { lat: 48.09, lon: 9.19 }],
    });
  });

  it('puts the spawn on the HQ when the host sent none', () => {
    const result = joinedPlaceResult({ hq: { lat: 1, lon: 2 }, spawns: [] });
    expect(result.spawn).toEqual({ id: 'spawn-1', lat: 1, lon: 2 });
    expect(result.spawns).toEqual([]);
  });
});
