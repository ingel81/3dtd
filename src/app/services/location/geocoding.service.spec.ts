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
