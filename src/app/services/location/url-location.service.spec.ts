import { afterEach, describe, expect, it } from 'vitest';
import { UrlLocationService } from './url-location.service';
import { canonicalCoords } from '../../utils/geo-utils';

/**
 * The location URL: HQ and spawns, a spawn with the compass bearing of its
 * portal where the player turned it (SavedSpawn.portalBearing).
 */
describe('UrlLocationService', () => {
  const url = new UrlLocationService();
  const HQ = { lat: 48.7758, lon: 9.1829 };
  const open = (search: string) => window.history.replaceState({}, '', `/${search}`);

  afterEach(() => open(''));

  it('writes a turned spawn with its bearing and reads it back', () => {
    url.updateUrl(HQ, [{ lat: 48.78, lon: 9.19, portalBearing: 187.46 }, { lat: 48.79, lon: 9.2 }]);

    expect(window.location.search).toBe('?l=48.77580,9.18290&s=48.78000,9.19000,187.5;48.79000,9.20000');
    expect(url.parseFromUrl()).toEqual({
      hq: HQ,
      spawns: [{ lat: 48.78, lon: 9.19, portalBearing: 187.5 }, { lat: 48.79, lon: 9.2 }],
    });
  });

  it('reads a URL from before the bearing: the spawn has none and faces along its route', () => {
    open('?l=48.77580,9.18290&s=48.78000,9.19000');

    const spawns = url.parseFromUrl()!.spawns;
    expect(spawns).toEqual([{ lat: 48.78, lon: 9.19 }]);
    expect(spawns[0]).not.toHaveProperty('portalBearing');
  });

  it('keeps a spawn whose bearing is no number without it, and drops malformed spawns', () => {
    open('?l=48.77580,9.18290&s=48.78000,9.19000,north;48.79,9.2,10,4;91,9.2,10');

    const spawns = url.parseFromUrl()!.spawns;
    expect(spawns).toEqual([{ lat: 48.78, lon: 9.19 }]);
    expect(spawns[0]).not.toHaveProperty('portalBearing');
  });

  it('reads a place in its canonical form back exactly as it wrote it, also south and west', () => {
    for (let i = 0; i < 500; i++) {
      const hq = canonicalCoords({ lat: -89.9 + i * 0.3597530864219, lon: 179.9 - i * 0.7195061728439 });
      const spawn = canonicalCoords({ lat: hq.lat + 0.0023456789, lon: hq.lon - 0.0046123457 });
      url.updateUrl(hq, [spawn]);
      expect(url.parseFromUrl()).toEqual({ hq, spawns: [spawn] });
    }
  });

  it('takes no bearing on the HQ', () => {
    open('?l=48.77580,9.18290,90&s=48.78000,9.19000');
    expect(url.parseFromUrl()).toBeNull();
  });
});
