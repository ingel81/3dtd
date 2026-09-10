import { describe, it, expect, beforeEach } from 'vitest';
import { Injector, runInInjectionContext } from '@angular/core';
import { LocationManagementService } from './location-management.service';
import { GeocodingService } from './geocoding.service';

describe('LocationManagementService', () => {
  let service: LocationManagementService;

  beforeEach(() => {
    localStorage.clear();
    const injector = Injector.create({
      providers: [
        // Nur für inject() im Feld-Initializer; die getesteten Pfade geocoden nicht
        { provide: GeocodingService, useValue: {} },
        { provide: LocationManagementService, useFactory: () => {
          return runInInjectionContext(injector, () => new LocationManagementService());
        }},
      ],
    });
    service = injector.get(LocationManagementService);
  });

  it('starts with the no-location name', () => {
    expect(service.displayName()).toBe('No location');
    expect(service.hasLocation()).toBe(false);
  });

  it('reset() restores the same name it starts with', () => {
    service.displayName.set('Erlenbach');
    service.reset();
    expect(service.displayName()).toBe('No location');
    expect(service.hq()).toBeNull();
  });
});
