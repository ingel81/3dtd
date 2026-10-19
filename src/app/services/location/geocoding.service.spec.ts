import { afterEach, describe, it, expect, vi } from 'vitest';
import { GeocodingService, UNKNOWN_LOCATION_NAME } from './geocoding.service';

describe('GeocodingService name formatting', () => {
  const service = new GeocodingService();

  it('extractLocationName prefers the city', () => {
    expect(service.extractLocationName({ city: 'Erlenbach', county: 'Miltenberg' })).toBe('Erlenbach');
  });

  it('extractLocationName falls back to the unknown-location name', () => {
    expect(service.extractLocationName({})).toBe(UNKNOWN_LOCATION_NAME);
  });

  it('formatAddressShort joins street, city and country', () => {
    expect(service.formatAddressShort({ road: 'Hauptstraße', house_number: '5', town: 'Erlenbach', country: 'Germany' }))
      .toBe('Hauptstraße 5, Erlenbach, Germany');
    // The dice lands anywhere, so the country belongs in the name
    expect(service.formatAddressShort({ city: 'Tokyo', country: 'Japan' })).toBe('Tokyo, Japan');
  });

  it('formatAddressShort leaves out what the address does not name', () => {
    expect(service.formatAddressShort({ road: 'Hauptstraße', house_number: '5', town: 'Erlenbach' }))
      .toBe('Hauptstraße 5, Erlenbach');
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
