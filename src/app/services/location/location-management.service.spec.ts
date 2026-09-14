import { describe, it, expect, beforeEach } from 'vitest';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { LocationManagementService } from './location-management.service';
import { GeocodingService } from './geocoding.service';
import { PathAndRouteService } from '../world/path-route.service';

describe('LocationManagementService', () => {
  let service: LocationManagementService;
  let hasRoutes: ReturnType<typeof signal<boolean>>;

  function create(): LocationManagementService {
    const injector = Injector.create({
      providers: [
        // Nur für inject() im Feld-Initializer; die getesteten Pfade geocoden nicht
        { provide: GeocodingService, useValue: {} },
        { provide: PathAndRouteService, useValue: { hasRoutes } },
        { provide: LocationManagementService, useFactory: () => {
          return runInInjectionContext(injector, () => new LocationManagementService());
        }},
      ],
    });
    return injector.get(LocationManagementService);
  }

  beforeEach(() => {
    localStorage.clear();
    hasRoutes = signal(false);
    service = create();
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

  describe('favorites', () => {
    const PARIS = { lat: 48.8584, lon: 2.2945 };
    const stored = () => JSON.parse(localStorage.getItem('td_favorites_v2')!);

    it('saves any number of favorites, each under the name it was given', () => {
      service.hq.set(PARIS);
      service.spawns.set([{ lat: 48.862, lon: 2.2945 }]);
      for (let i = 1; i <= 12; i++) service.saveFavorite(`Place ${i}`);

      expect(service.favorites()).toHaveLength(12);
      expect(service.favorites()[11]).toMatchObject({ hq: PARIS, spawns: [{ lat: 48.862, lon: 2.2945 }], name: 'Place 12' });
      expect(stored()).toHaveLength(12);
    });

    it('saves without a name when the field was emptied, and nothing without an HQ', () => {
      service.saveFavorite('  ');
      expect(service.favorites()).toEqual([]);

      service.hq.set(PARIS);
      service.saveFavorite('  ');
      expect(service.favorites()[0]).not.toHaveProperty('name');
    });

    it('renames, reorders and deletes, and keeps each change for the next start', () => {
      service.hq.set(PARIS);
      service.saveFavorite('A');
      service.saveFavorite('B');
      service.saveFavorite('C');
      const [a, b, c] = service.favorites().map((f) => f.id);

      service.renameFavorite(b, 'Bee');
      service.moveFavorite(c, -1);
      service.deleteFavorite(a);

      expect(service.favorites().map((f) => f.name)).toEqual(['C', 'Bee']);
      expect(create().favorites().map((f) => f.id)).toEqual([c, b]);
    });
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
      expect(create().recents().map((r) => r.name)).toEqual(['Heilbronn']);
    });

    it('offers a place for the list only once a route joins spawn and HQ', () => {
      service.hq.set({ lat: 49.17, lon: 9.26 });
      service.spawns.set([{ lat: 49.175, lon: 9.26 }]);
      service.displayName.set('Heilbronn');
      // HQ, spawn and name are there, the route is not (yet, or it failed)
      expect(service.recentCandidate()).toBeNull();

      hasRoutes.set(true);
      expect(service.recentCandidate()).toEqual({
        hq: { lat: 49.17, lon: 9.26 },
        spawns: [{ lat: 49.175, lon: 9.26 }],
        name: 'Heilbronn',
      });
    });

    it('offers nothing while the name still resolves or no spawn is set', () => {
      hasRoutes.set(true);
      service.hq.set({ lat: 49.17, lon: 9.26 });
      service.spawns.set([{ lat: 49.175, lon: 9.26 }]);
      service.displayName.set('Loading...');
      expect(service.recentCandidate()).toBeNull();

      service.displayName.set('Heilbronn');
      service.spawns.set([]);
      expect(service.recentCandidate()).toBeNull();
    });
  });
});
