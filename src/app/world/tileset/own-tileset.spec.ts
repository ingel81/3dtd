import { Injector, runInInjectionContext, signal } from '@angular/core';
import { ConfigService } from '../../core/services/config.service';
import { OsmStreetService } from '../../services/location/osm-street.service';
import { OWN_TILESET_CAPABILITIES } from '../tiles/tiles-world';
import { WorldProviderRegistry, WorldUnavailableError } from '../world-provider-registry';
import { parseOwnTilesets } from './own-tileset';

const KALASATAMA = {
  id: 'kalasatama',
  name: 'Helsinki Kalasatama (2017)',
  url: 'http://localhost:4310/kalasatama/tileset/tileset.json',
  attribution: 'Helsingin kaupunki, CC BY 4.0',
  center: { lat: 60.18449, lon: 24.97745 },
  radiusM: 1400,
};
const { center, radiusM, ...rest } = KALASATAMA;
const PARSED = { ...rest, coverage: { center, radiusM } };

describe('parseOwnTilesets()', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('takes a full entry, its area as the coverage, with its height offset and error scale', () => {
    expect(parseOwnTilesets([KALASATAMA])).toEqual([PARSED]);
    expect(parseOwnTilesets([{ ...KALASATAMA, heightOffsetM: -18.5 }])).toEqual([{ ...PARSED, heightOffsetM: -18.5 }]);
    expect(parseOwnTilesets([{ ...KALASATAMA, geometricErrorScale: 20 }])).toEqual([{ ...PARSED, geometricErrorScale: 20 }]);
    expect(parseOwnTilesets([{ ...KALASATAMA, geometricErrorScale: 0 }])).toEqual([PARSED]);
  });

  it('names an entry without a name by its id and leaves a missing attribution empty', () => {
    const { id, url } = KALASATAMA;
    expect(parseOwnTilesets([{ id, url, center, radiusM }])).toEqual([
      { id, url, name: 'kalasatama', attribution: '', coverage: { center, radiusM } },
    ]);
  });

  it('drops a broken entry with a warning and keeps the others', () => {
    const tilesets = parseOwnTilesets([
      { ...KALASATAMA, id: '' },
      { ...KALASATAMA, url: 42 },
      { ...KALASATAMA, center: { lat: 'x', lon: 24 } },
      { ...KALASATAMA, center: { lat: 95, lon: 24 } },
      { ...KALASATAMA, radiusM: 0 },
      null,
      KALASATAMA,
    ]);
    expect(tilesets).toEqual([PARSED]);
    expect(console.warn).toHaveBeenCalledTimes(6);
  });

  it('reads anything but a list as none', () => {
    expect(parseOwnTilesets(undefined)).toEqual([]);
    expect(parseOwnTilesets({ kalasatama: KALASATAMA })).toEqual([]);
  });
});

describe('the own tileset world', () => {
  let registry: WorldProviderRegistry;

  beforeEach(() => {
    const injector = Injector.create({
      providers: [
        { provide: OsmStreetService, useValue: {} },
        { provide: ConfigService, useValue: { ownTilesets: signal(parseOwnTilesets([{ ...KALASATAMA, heightOffsetM: 18 }])) } },
      ],
    });
    registry = runInInjectionContext(injector, () => new WorldProviderRegistry());
  });

  it('is a TilesWorld of the listed set: real place, no credentials, its attribution as the credit', () => {
    const ref = { kind: 'tileset', id: 'kalasatama' } as const;
    expect(registry.capabilities('tileset')).toBe(OWN_TILESET_CAPABILITIES);
    expect(OWN_TILESET_CAPABILITIES).toMatchObject({ realPlace: true, ecef: true, streaming: true, credentials: false });

    const world = registry.create(ref, { lat: center.lat, lon: center.lon, height: 0 });
    expect(world.ref).toEqual(ref);
    expect(world.capabilities).toBe(OWN_TILESET_CAPABILITIES);
    expect(world.attribution()[0]).toBe(KALASATAMA.attribution);
    // No Google or Cesium logo
    expect(registry.logos(ref)).toEqual([]);
    expect(registry.coverage(ref)).toEqual({ center, radiusM });
  });

  it('names a set the config does not list, and the Google tiles have no area', () => {
    const missing = { kind: 'tileset', id: 'nowhere' } as const;
    expect(() => registry.create(missing, { lat: 0, lon: 0, height: 0 })).toThrow(WorldUnavailableError);
    expect(registry.coverage(missing)).toBeNull();
    expect(registry.coverage({ kind: 'tiles', source: 'cesium' })).toBeNull();
  });
});
