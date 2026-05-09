import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OsmStreetService, BuildingFootprint } from './osm-street.service';

// Mock Angular DI — OsmStreetService uses inject(StreetCacheService)
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<typeof import('@angular/core')>('@angular/core');
  return {
    ...actual,
    inject: vi.fn(() => ({
      getCacheKey: vi.fn(() => 'mock-key'),
      load: vi.fn(async () => null),
      save: vi.fn(async () => { /* noop */ }),
      clear: vi.fn(async () => { /* noop */ }),
      clearAll: vi.fn(async () => { /* noop */ }),
    })),
  };
});

describe('OsmStreetService', () => {
  let service: OsmStreetService;

  beforeEach(() => {
    service = new OsmStreetService();
  });

  // ════════════════════════════════════════════════════════════
  // parseBuildingResponse (private — accessed via 'as any')
  // ════════════════════════════════════════════════════════════

  describe('parseBuildingResponse', () => {
    const parse = (elements: unknown[]) =>
      (service as unknown as { parseBuildingResponse: (r: { elements: unknown[] }) => BuildingFootprint[] })
        .parseBuildingResponse({ elements });

    it('parses nodes and ways into building footprints', () => {
      const result: BuildingFootprint[] = parse([
        { type: 'node', id: 1, lat: 48.0, lon: 9.0 },
        { type: 'node', id: 2, lat: 48.001, lon: 9.0 },
        { type: 'node', id: 3, lat: 48.001, lon: 9.001 },
        {
          type: 'way', id: 100, nodes: [1, 2, 3],
          tags: { building: 'residential', 'building:levels': '3' },
        },
      ]);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(100);
      expect(result[0].type).toBe('residential');
      expect(result[0].levels).toBe(3);
      expect(result[0].nodes).toHaveLength(3);
      expect(result[0].nodes[0].lat).toBe(48.0);
    });

    it('defaults to type "yes" and 2 levels when tags missing', () => {
      const result: BuildingFootprint[] = parse([
        { type: 'node', id: 1, lat: 48.0, lon: 9.0 },
        { type: 'node', id: 2, lat: 48.001, lon: 9.0 },
        { type: 'node', id: 3, lat: 48.001, lon: 9.001 },
        { type: 'way', id: 200, nodes: [1, 2, 3], tags: {} },
      ]);

      expect(result[0].type).toBe('yes');
      expect(result[0].levels).toBe(2);
    });

    it('clamps levels to minimum 1', () => {
      const result: BuildingFootprint[] = parse([
        { type: 'node', id: 1, lat: 48.0, lon: 9.0 },
        { type: 'node', id: 2, lat: 48.001, lon: 9.0 },
        { type: 'node', id: 3, lat: 48.001, lon: 9.001 },
        { type: 'way', id: 300, nodes: [1, 2, 3], tags: { building: 'yes', 'building:levels': '0' } },
      ]);

      expect(result[0].levels).toBe(1);
    });

    it('rounds fractional levels', () => {
      const result: BuildingFootprint[] = parse([
        { type: 'node', id: 1, lat: 48.0, lon: 9.0 },
        { type: 'node', id: 2, lat: 48.001, lon: 9.0 },
        { type: 'node', id: 3, lat: 48.001, lon: 9.001 },
        { type: 'way', id: 400, nodes: [1, 2, 3], tags: { building: 'yes', 'building:levels': '2.7' } },
      ]);

      expect(result[0].levels).toBe(3);
    });

    it('skips ways with fewer than 3 resolved nodes', () => {
      const result: BuildingFootprint[] = parse([
        { type: 'node', id: 1, lat: 48.0, lon: 9.0 },
        { type: 'node', id: 2, lat: 48.001, lon: 9.0 },
        { type: 'way', id: 500, nodes: [1, 2], tags: { building: 'yes' } },
      ]);

      expect(result).toHaveLength(0);
    });

    it('skips nodes referenced by way but not in response', () => {
      const result: BuildingFootprint[] = parse([
        { type: 'node', id: 1, lat: 48.0, lon: 9.0 },
        { type: 'node', id: 2, lat: 48.001, lon: 9.0 },
        // node 3 missing
        { type: 'way', id: 600, nodes: [1, 2, 3], tags: { building: 'yes' } },
      ]);

      // Only 2 resolved nodes → skipped
      expect(result).toHaveLength(0);
    });

    it('returns empty array for empty response', () => {
      expect(parse([])).toHaveLength(0);
    });
  });

  // ════════════════════════════════════════════════════════════
  // filterBuildingsNearRoutes
  // ════════════════════════════════════════════════════════════

  describe('filterBuildingsNearRoutes', () => {
    const makeBuilding = (id: number, lat: number, lon: number): BuildingFootprint => ({
      id,
      type: 'yes',
      levels: 2,
      nodes: [
        { id: id * 10 + 1, lat, lon },
        { id: id * 10 + 2, lat: lat + 0.0001, lon },
        { id: id * 10 + 3, lat: lat + 0.0001, lon: lon + 0.0001 },
      ],
    });

    it('returns all buildings when no routes given', () => {
      const buildings = [makeBuilding(1, 48.0, 9.0)];
      const result = service.filterBuildingsNearRoutes(buildings, []);
      expect(result).toHaveLength(1);
    });

    it('keeps buildings near a route', () => {
      // Building at 48.0, 9.0 — route passes through 48.0, 9.0
      const buildings = [makeBuilding(1, 48.0, 9.0)];
      const routes = [[{ lat: 48.0, lon: 9.0 }, { lat: 48.001, lon: 9.001 }]];
      const result = service.filterBuildingsNearRoutes(buildings, routes, 100);
      expect(result).toHaveLength(1);
    });

    it('filters out buildings far from routes', () => {
      // Building at 48.1, 9.1 — far from route at 48.0, 9.0
      const buildings = [makeBuilding(1, 48.1, 9.1)];
      const routes = [[{ lat: 48.0, lon: 9.0 }, { lat: 48.001, lon: 9.001 }]];
      const result = service.filterBuildingsNearRoutes(buildings, routes, 100);
      expect(result).toHaveLength(0);
    });

    it('filters mixed near/far buildings correctly', () => {
      const buildings = [
        makeBuilding(1, 48.0, 9.0),       // near route
        makeBuilding(2, 48.1, 9.1),       // far from route
        makeBuilding(3, 48.0005, 9.0005), // near route
      ];
      const routes = [[{ lat: 48.0, lon: 9.0 }, { lat: 48.001, lon: 9.001 }]];
      const result = service.filterBuildingsNearRoutes(buildings, routes, 100);
      expect(result).toHaveLength(2);
      expect(result.map(b => b.id)).toEqual([1, 3]);
    });
  });

  // ════════════════════════════════════════════════════════════
  // haversineDistance
  // ════════════════════════════════════════════════════════════

  describe('haversineDistance', () => {
    it('returns 0 for same point', () => {
      expect(service.haversineDistance(48.0, 9.0, 48.0, 9.0)).toBe(0);
    });

    it('calculates reasonable distance for known points', () => {
      // ~111m per 0.001 degree latitude
      const dist = service.haversineDistance(48.0, 9.0, 48.001, 9.0);
      expect(dist).toBeGreaterThan(100);
      expect(dist).toBeLessThan(120);
    });
  });
});
