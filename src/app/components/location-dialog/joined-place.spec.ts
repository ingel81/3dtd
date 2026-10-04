import { describe, expect, it } from 'vitest';
import { joinedPlaceResult, linkedPlaceResult } from './joined-place';
import { LINKED_SPAWN_ID } from '../../models/location.types';

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

describe('linkedPlaceResult', () => {
  it('carries the HQ and every spawn of a pasted link, bearing included', () => {
    const spawns = [{ lat: 48.87832, lon: 2.29851, portalBearing: 90 }, { lat: 48.86883, lon: 2.29135 }];
    const result = linkedPlaceResult({ lat: 48.8735, lon: 2.29588 }, spawns);
    expect(result.spawn).toEqual({ id: LINKED_SPAWN_ID, lat: 48.87832, lon: 2.29851, portalBearing: 90, isRandom: false });
    expect(result.spawns).toEqual(spawns);
  });

  it('draws a random spawn for a link without one', () => {
    const result = linkedPlaceResult({ lat: 48.8735, lon: 2.29588 }, []);
    expect(result.spawn.isRandom).toBe(true);
    expect(result.spawns).toBeUndefined();
  });
});
