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

  /** The place of a link, as the start reads it */
  const read = () => url.parseLink(window.location.search);

  it('writes a turned spawn with its bearing and reads it back', () => {
    const link = url.urlFor(HQ, [{ lat: 48.78, lon: 9.19, portalBearing: 187.46 }, { lat: 48.79, lon: 9.2 }]);

    expect(link).toBe('/?l=48.77580,9.18290&s=48.78000,9.19000,187.5;48.79000,9.20000');
    expect(url.parseLink(link)).toEqual({
      hq: HQ,
      spawns: [{ lat: 48.78, lon: 9.19, portalBearing: 187.5 }, { lat: 48.79, lon: 9.2 }],
    });
  });

  it('reads HQ and every spawn from a pasted link of any host', () => {
    const place = url.parseLink('localhost:4200/?l=48.87350,2.29588&s=48.87832,2.29851;48.86883,2.29135,90.0');

    expect(place).toEqual({
      hq: { lat: 48.8735, lon: 2.29588 },
      spawns: [{ lat: 48.87832, lon: 2.29851 }, { lat: 48.86883, lon: 2.29135, portalBearing: 90 }],
    });
    expect(url.parseLink('https://example.org/play/?s=48.1,2.2')).toBeNull();
    expect(url.parseLink('48.8735, 2.29588')).toBeNull();
  });

  it('reads a URL from before the bearing: the spawn has none and faces along its route', () => {
    open('?l=48.77580,9.18290&s=48.78000,9.19000');

    const spawns = read()!.spawns;
    expect(spawns).toEqual([{ lat: 48.78, lon: 9.19 }]);
    expect(spawns[0]).not.toHaveProperty('portalBearing');
  });

  it('keeps a spawn whose bearing is no number without it, and drops malformed spawns', () => {
    open('?l=48.77580,9.18290&s=48.78000,9.19000,north;48.79,9.2,10,4;91,9.2,10');

    const spawns = read()!.spawns;
    expect(spawns).toEqual([{ lat: 48.78, lon: 9.19 }]);
    expect(spawns[0]).not.toHaveProperty('portalBearing');
  });

  it('reads a place in its canonical form back exactly as it wrote it, also south and west', () => {
    for (let i = 0; i < 500; i++) {
      const hq = canonicalCoords({ lat: -89.9 + i * 0.3597530864219, lon: 179.9 - i * 0.7195061728439 });
      const spawn = canonicalCoords({ lat: hq.lat + 0.0023456789, lon: hq.lon - 0.0046123457 });
      expect(url.parseLink(url.urlFor(hq, [spawn]))).toEqual({ hq, spawns: [spawn] });
    }
  });

  it('keeps the wave source the tab was opened with in a link to a place', () => {
    open('?waves=budget');
    expect(url.urlFor(HQ, [])).toBe('/?l=48.77580,9.18290&waves=budget');
  });

  it("names a world with a link of its own, an own tileset, beside its place; the tiles' place needs none", () => {
    expect(url.urlFor(HQ, [], { kind: 'tileset', id: 'campus' })).toBe('/?l=48.77580,9.18290&world=tileset%3Acampus');
    expect(url.urlFor(HQ, [], { kind: 'tiles', source: 'cesium' })).toBe('/?l=48.77580,9.18290');
  });

  it("puts a place and its world back into this page's address, the switches kept", () => {
    open('?bot=manual');
    const here = new URL(url.hereUrl(HQ, [{ lat: 48.78, lon: 9.19 }], { kind: 'custom-map', mapId: 'demo', contentHash: 'h' }));
    expect(here.searchParams.get('bot')).toBe('manual');
    expect(url.parseLink(here.search)).toEqual({ hq: HQ, spawns: [{ lat: 48.78, lon: 9.19 }] });
    expect(here.searchParams.get('world')).toBe('map:demo');
  });

  it('makes a share link of a place without writing the address', () => {
    open('');
    expect(url.getShareUrl(HQ, [])).toBe(`${window.location.origin}/?l=48.77580,9.18290`);
    expect(window.location.search).toBe('');
  });

  it('takes no bearing on the HQ', () => {
    open('?l=48.77580,9.18290,90&s=48.78000,9.19000');
    expect(read()).toBeNull();
  });
});
