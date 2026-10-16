import { describe, expect, it } from 'vitest';
import { placeLabel } from './place-label';

describe('placeLabel', () => {
  it('names a house by its street and number and the locality, from the address details', () => {
    const line = '6, Am Thorwengert, Miltenberg-Nord, Miltenberg, Landkreis Miltenberg, Bayern, 63897, Deutschland';
    expect(placeLabel(line, { road: 'Am Thorwengert', house_number: '6', suburb: 'Miltenberg-Nord', town: 'Miltenberg', country: 'Deutschland' })).toBe('Am Thorwengert 6, Miltenberg');
  });

  it('puts a leading house number behind its street when only the line is there', () => {
    expect(placeLabel('6, Am Thorwengert, Miltenberg-Nord, Miltenberg, Bayern, 63897, Deutschland')).toBe('Am Thorwengert 6, Miltenberg-Nord');
    expect(placeLabel('12a, Hauptstraße, Erlenbach')).toBe('Hauptstraße 12a, Erlenbach');
  });

  it('keeps a street with its number and the town of a short line', () => {
    expect(placeLabel('Hauptstraße 51, Bad Wimpfen, Deutschland')).toBe('Hauptstraße 51, Bad Wimpfen');
  });

  it('names a town by itself and drops a postcode before a name', () => {
    expect(placeLabel('Miltenberg, Landkreis Miltenberg, Bayern, Deutschland')).toBe('Miltenberg');
    expect(placeLabel('74235, Erlenbach, Baden-Württemberg')).toBe('Erlenbach');
    expect(placeLabel('Miltenberg', { town: 'Miltenberg', county: 'Landkreis Miltenberg' })).toBe('Miltenberg');
  });

  it('falls back to the line when it is all there is', () => {
    expect(placeLabel('49.70360, 9.26470')).toBe('49.70360, 9.26470');
    expect(placeLabel('  Paris  ')).toBe('Paris');
  });
});
