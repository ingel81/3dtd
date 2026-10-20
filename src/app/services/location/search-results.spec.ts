import { describe, expect, it } from 'vitest';
import { de } from '../../i18n/messages/de';
import { en } from '../../i18n/messages/en';
import type { GeocodingResult } from './geocoding.service';
import { contextLines, mergeSamePlaces } from './search-results';

/** A hit as GeocodingService makes it from Nominatim's answer (fields of real answers of 2026-10-20, shortened) */
function hit(o: Partial<GeocodingResult> & { name: string; id: number }): GeocodingResult {
  const { name, id, ...rest } = o;
  return { placeId: id, displayName: `${name}, ${rest.address?.country ?? ''}`, lat: 0, lon: 0, type: 'administrative', importance: 0.5, osm: { type: 'relation', id }, ...rest };
}

/** The search hits tell places of one name apart and fold doubles of one place (E278) */
describe('search results', () => {
  it('folds the same OSM object, and a place\'s area and point of the same name close together', () => {
    const area = hit({ name: 'Neustadt', id: 431323, type: 'cadastral', addressType: 'cadastral', lat: 50.077, lon: 14.425, address: { city: 'Prag', suburb: 'Neustadt', country: 'Tschechien' } });
    const point = hit({ name: 'Neustadt', id: 297896658, osm: { type: 'node', id: 297896658 }, type: 'suburb', addressType: 'suburb', lat: 50.079, lon: 14.426, address: { city: 'Prag', suburb: 'Neustadt', country: 'Tschechien' } });
    const again = { ...area, placeId: 99 };
    const other = hit({ name: 'Neustadt in Holstein', id: 382433, addressType: 'town', lat: 54.1, lon: 10.8, address: { town: 'Neustadt in Holstein', county: 'Kreis Ostholstein', state: 'Schleswig-Holstein', country: 'Deutschland' } });
    // The point names its kind (a suburb), the cadastral area none: the point stands for both
    expect(mergeSamePlaces([area, point, again, other])).toEqual([point, other]);
    expect(mergeSamePlaces([other, area, again])).toEqual([other, area]);
  });

  it('keeps places of one name that lie apart', () => {
    const il = hit({ name: 'Springfield', id: 126326, addressType: 'city', lat: 39.8, lon: -89.6, address: { city: 'Springfield', county: 'Sangamon County', state: 'Illinois', country: 'United States' } });
    const ma = hit({ name: 'Springfield', id: 1181618, addressType: 'city', lat: 42.1, lon: -72.6, address: { city: 'Springfield', county: 'Hampden County', state: 'Massachusetts', country: 'United States' } });
    expect(mergeSamePlaces([il, ma])).toHaveLength(2);
  });

  it('says kind and where in the player\'s language, the names as Nominatim gave them', () => {
    const hamburg = hit({ name: 'Hamburg', id: 62782, addressType: 'city', address: { city: 'Hamburg', country: 'Deutschland' } });
    const town = hit({ name: 'Town of Hamburg', id: 10492087, addressType: 'town', address: { town: 'Town of Hamburg', county: 'Erie County', state: 'New York', country: 'Vereinigte Staaten von Amerika' } });
    const hessen = hit({ name: 'Neustadt (Hessen)', id: 225497, addressType: 'municipality', address: { town: 'Neustadt (Hessen)', county: 'Landkreis Marburg-Biedenkopf', state: 'Hessen', country: 'Deutschland' } });
    const odd = hit({ name: 'Neustadt', id: 1, addressType: 'cadastral', address: { country: 'Tschechien' } });
    expect(contextLines(de, [hamburg, town, hessen, odd])).toEqual([
      'Stadt | Deutschland',
      'Stadt | New York, Vereinigte Staaten von Amerika',
      'Gemeinde | Hessen, Deutschland',
      'Tschechien',
    ]);
    expect(contextLines(en, [hamburg, hessen])).toEqual(['City | Deutschland', 'Municipality | Hessen, Deutschland']);
  });

  it('names the county where two hits of one name would read alike', () => {
    const a = hit({ name: 'Springfield', id: 1, addressType: 'city', address: { city: 'Springfield', county: 'Clark County', state: 'Ohio', country: 'United States' } });
    const b = hit({ name: 'Springfield', id: 2, addressType: 'city', lat: 1, address: { city: 'Springfield', county: 'Greene County', state: 'Ohio', country: 'United States' } });
    const c = hit({ name: 'Springfield', id: 3, addressType: 'city', address: { city: 'Springfield', county: 'Sangamon County', state: 'Illinois', country: 'United States' } });
    expect(contextLines(en, [a, b, c])).toEqual([
      'City | Clark County, Ohio, United States',
      'City | Greene County, Ohio, United States',
      'City | Illinois, United States',
    ]);
  });

  it('leaves the place itself out of where it lies: a state found as such', () => {
    const state = hit({ name: 'Bayern', id: 2145268, addressType: 'state', address: { state: 'Bayern', country: 'Deutschland' } });
    expect(contextLines(de, [state])).toEqual(['Bundesland | Deutschland']);
  });
});
