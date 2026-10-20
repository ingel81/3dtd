import { afterEach, describe, it, expect, vi } from 'vitest';
import { GeocodingService, UNKNOWN_LOCATION_NAME } from './geocoding.service';

describe('GeocodingService name formatting', () => {
  const service = new GeocodingService();

  it('extractLocationName prefers the city', () => {
    expect(service.extractLocationName({ city: 'Musterdorf', county: 'Miltenberg' })).toBe('Musterdorf');
  });

  it('extractLocationName falls back to the unknown-location name', () => {
    expect(service.extractLocationName({})).toBe(UNKNOWN_LOCATION_NAME);
  });

  it('formatAddressShort joins street, city and country', () => {
    expect(service.formatAddressShort({ road: 'Hauptstraße', house_number: '5', town: 'Musterdorf', country: 'Germany' }))
      .toBe('Hauptstraße 5, Musterdorf, Germany');
    // The dice lands anywhere, so the country belongs in the name
    expect(service.formatAddressShort({ city: 'Tokyo', country: 'Japan' })).toBe('Tokyo, Japan');
  });

  it('formatAddressShort leaves out what the address does not name', () => {
    expect(service.formatAddressShort({ road: 'Hauptstraße', house_number: '5', town: 'Musterdorf' }))
      .toBe('Hauptstraße 5, Musterdorf');
    expect(service.formatAddressShort({ country: 'Japan' })).toBe('Japan');
  });

  it('formatAddressShort falls back to the unknown-location name', () => {
    expect(service.formatAddressShort({ county: 'Miltenberg' })).toBe(UNKNOWN_LOCATION_NAME);
  });

  it('the fallback reads in English', () => {
    expect(UNKNOWN_LOCATION_NAME).toBe('Unknown location');
  });
});

describe('GeocodingService search', () => {
  const answer = [{ place_id: 1, display_name: 'Marktplatz, Stuttgart', lat: '48.77', lon: '9.17', type: 'square', importance: 0.5 }];

  function setup() {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => answer }) as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    return { service: new GeocodingService(), fetchMock };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('asks Nominatim once per query, the same query again comes from the cache', async () => {
    const { service, fetchMock } = setup();
    service.search('Marktplatz');
    await vi.waitFor(() => expect(service.results()).toHaveLength(1));
    service.clearResults();
    service.search(' marktplatz ');
    expect(service.results()).toHaveLength(1);
    expect(service.isLoading()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reads the kind and the OSM object of each hit, and one place found twice is one hit (one request)', async () => {
    const twice = [
      { place_id: 7, display_name: 'Neustadt, Prag, Tschechien', lat: '50.077', lon: '14.425', type: 'cadastral', addresstype: 'cadastral', osm_type: 'relation', osm_id: 431323, importance: 0.4, address: { city: 'Prag', suburb: 'Neustadt', country: 'Tschechien' } },
      { place_id: 8, display_name: 'Neustadt, Prag, Tschechien', lat: '50.079', lon: '14.426', type: 'suburb', addresstype: 'suburb', osm_type: 'node', osm_id: 297896658, importance: 0.3, address: { city: 'Prag', suburb: 'Neustadt', country: 'Tschechien' } },
    ];
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => twice }) as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);
    const service = new GeocodingService();
    service.search('Neustadt');
    await vi.waitFor(() => expect(service.results()).toHaveLength(1));
    expect(service.results()[0]).toMatchObject({ placeId: 8, addressType: 'suburb', osm: { type: 'node', id: 297896658 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps a second between two requests (Nominatim allows one a second)', async () => {
    vi.useFakeTimers();
    const { service, fetchMock } = setup();
    service.search('Marktplatz');
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    service.search('Schlossplatz');
    await vi.advanceTimersByTimeAsync(900);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('asks nothing for a query under three characters', () => {
    const { service, fetchMock } = setup();
    service.search('ab');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(service.isLoading()).toBe(false);
  });
});
