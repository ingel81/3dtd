// FormsModule and the material spinner are partially compiled, which needs the JIT compiler
import '@angular/compiler';
import { describe, it, expect, vi } from 'vitest';

// The effect only copies a value set from outside into the field; not under test here
vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, effect: () => ({ destroy: () => undefined }) };
});

import { DestroyRef, Injector, runInInjectionContext, signal } from '@angular/core';
import { AddressAutocompleteComponent } from './address-autocomplete.component';
import { GeocodingService, type GeocodingResult } from '../services/location/geocoding.service';

/**
 * The hint under the address field of the location dialog (searchState), as
 * the template drives it: each keystroke goes through onSearchChange
 * ((ngModelChange)). GeocodingService is a stub with its signals; its
 * search() resets them for a query under three characters, as the real one
 * does, and starts loading from three on.
 */
function setup() {
  const results = signal<GeocodingResult[]>([]);
  const error = signal<string | null>(null);
  const isLoading = signal(false);
  const geocoding = {
    results,
    error,
    isLoading,
    search: (query: string) => {
      if (query.length < 3) {
        results.set([]);
        error.set(null);
        return;
      }
      isLoading.set(true);
    },
    clearResults: () => results.set([]),
  };
  const injector = Injector.create({
    providers: [
      { provide: GeocodingService, useValue: geocoding },
      { provide: DestroyRef, useValue: { onDestroy: () => () => undefined, destroyed: false } },
    ],
  });
  const field = runInInjectionContext(injector, () => new AddressAutocompleteComponent());
  return { field, results, isLoading };
}

describe('AddressAutocompleteComponent, the hint under the field', () => {
  it('asks for the characters still missing from the first one typed', () => {
    const { field } = setup();
    expect(field.searchState()).toBe('idle');

    field.onSearchChange('a');
    expect(field.searchState()).toBe('too-short');
    // The template's "{{ 3 - searchText().length }} more characters"
    expect(3 - field.searchText().length).toBe(2);
    field.onSearchChange('ab');
    expect(3 - field.searchText().length).toBe(1);
  });

  it('goes back to "Enter address..." when the field is emptied', () => {
    const { field } = setup();
    field.onSearchChange('ab');
    field.onSearchChange('');
    expect(field.searchState()).toBe('idle');
  });

  it('searches from the third character on and shows what came back', () => {
    const { field, results, isLoading } = setup();
    field.onSearchChange('abc');
    expect(field.searchState()).toBe('searching');
    isLoading.set(false);
    expect(field.searchState()).toBe('no-results');
    results.set([{} as GeocodingResult]);
    expect(field.searchState()).toBe('results');
  });
});
