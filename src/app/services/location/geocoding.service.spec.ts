import { describe, it, expect } from 'vitest';
import { GeocodingService, UNKNOWN_LOCATION_NAME } from './geocoding.service';

describe('GeocodingService name formatting', () => {
  const service = new GeocodingService();

  it('extractLocationName prefers the city', () => {
    expect(service.extractLocationName({ city: 'Erlenbach', county: 'Miltenberg' })).toBe('Erlenbach');
  });

  it('extractLocationName falls back to the unknown-location name', () => {
    expect(service.extractLocationName({})).toBe(UNKNOWN_LOCATION_NAME);
  });

  it('formatAddressShort joins street and city', () => {
    expect(service.formatAddressShort({ road: 'Hauptstraße', house_number: '5', town: 'Erlenbach' }))
      .toBe('Hauptstraße 5, Erlenbach');
  });

  it('formatAddressShort falls back to the unknown-location name', () => {
    expect(service.formatAddressShort({ county: 'Miltenberg' })).toBe(UNKNOWN_LOCATION_NAME);
  });

  it('the fallback reads in English', () => {
    expect(UNKNOWN_LOCATION_NAME).toBe('Unknown location');
  });
});
