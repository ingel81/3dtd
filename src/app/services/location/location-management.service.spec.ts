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

  describe('recent locations', () => {
    it('records a place on top and persists it', () => {
      service.recordRecent({ lat: 49.17, lon: 9.26 }, [{ lat: 49.175, lon: 9.26 }], 'Heilbronn');
      service.recordRecent({ lat: 48.87, lon: 2.33 }, [{ lat: 48.875, lon: 2.33 }], 'Paris');
      expect(service.recents().map((r) => r.name)).toEqual(['Paris', 'Heilbronn']);
      expect(JSON.parse(localStorage.getItem('td_recent_locations_v1')!)).toHaveLength(2);
    });

    it('skips the DevWorld origin', () => {
      service.recordRecent({ lat: 0, lon: 0 }, [{ lat: 0.005, lon: 0 }], 'DevWorld');
      expect(service.recents()).toEqual([]);
    });

    it('loads the stored list on construction', () => {
      service.recordRecent({ lat: 49.17, lon: 9.26 }, [{ lat: 49.175, lon: 9.26 }], 'Heilbronn');
      const injector = Injector.create({
        providers: [
          { provide: GeocodingService, useValue: {} },
          { provide: LocationManagementService, useFactory: () => {
            return runInInjectionContext(injector, () => new LocationManagementService());
          }},
        ],
      });
      expect(injector.get(LocationManagementService).recents().map((r) => r.name)).toEqual(['Heilbronn']);
    });
  });
});
