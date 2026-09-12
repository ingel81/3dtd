import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';

// Angular DI replaced by a registry: inject() hands out what the test put there.
const injectionRegistry: Record<string, unknown> = {};
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  return {
    ...actual,
    Injectable: () => (target: unknown) => target,
    effect: () => ({ destroy: () => undefined }),
    inject: (token: { name?: string }) => injectionRegistry[token?.name ?? ''],
  };
});

import { TowerPlacementService } from './tower-placement.service';
import { Tower } from '../entities/tower.entity';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT, haversineDistance } from '../utils/geo-utils';
import type { GeoPosition } from '../models/game.types';

/**
 * One rule source for the player and the bots: validateTowerPosition (mouse
 * preview, click, training session) and placementChecker (bot candidate
 * search) answer alike. The rules themselves are covered in
 * tower-placement-rules.spec.ts.
 */
describe('TowerPlacementService placement checks', () => {
  const HQ = { lat: 48.0, lon: 9.0 };
  const M_PER_DEG_LON = METERS_PER_DEGREE_LAT * Math.cos(HQ.lat * DEG_TO_RAD);
  /** Geo point `east` and `north` meters from the HQ. */
  const at = (east: number, north: number) => ({
    lat: HQ.lat + north / METERS_PER_DEGREE_LAT,
    lon: HQ.lon + east / M_PER_DEG_LON,
  });

  const bounds = { minLat: 47.99, maxLat: 48.02, minLon: 8.99, maxLon: 9.02 };
  /** Spawn 1 km north, route straight down 100 m east of the HQ. */
  const spawn = at(100, 1000);
  const route: GeoPosition[] = [at(100, 1000), at(100, 0)];

  let service: TowerPlacementService;
  let towers: Tower[];
  let getAll: ReturnType<typeof vi.fn>;
  let getCachedPaths: ReturnType<typeof vi.fn>;

  const init = (streets: unknown[] = [{}]) =>
    service.initialize(
      {} as never,
      { streets, bounds } as never,
      { haversineDistance } as never,
      HQ,
      { towerManager: { getAll } } as never,
    );

  beforeEach(() => {
    injectionRegistry['UIStore'] = {
      buildMode: signal(false),
      selectedTowerType: signal(null),
      buildValidationReason: signal(null),
      perTowerLosFilter: signal('both'),
    };
    injectionRegistry['AssetManagerService'] = {};
    injectionRegistry['GlobalRouteGridService'] = { addCellsChangedListener: () => () => undefined };
    injectionRegistry['ResearchStore'] = {};
    injectionRegistry['TowerDefenseStore'] = {
      spawnPoints: signal([{ id: 'sp-1', name: 'Spawn', color: '#f00', ...spawn }]),
    };
    getCachedPaths = vi.fn(() => new Map([['sp-1', route]]));
    injectionRegistry['PathAndRouteService'] = { getCachedPaths };

    const existing = at(0, 500);
    towers = [new Tower({ ...existing, height: 0 }, 'archer')];
    // A new array per call, like EntityManager.getAll() after a placement.
    getAll = vi.fn(() => [...towers]);

    service = new TowerPlacementService();
  });

  afterEach(() => {
    service.dispose();
  });

  it('answers like validateTowerPosition, rule by rule', () => {
    init();
    const check = service.placementChecker();
    const cases: [string, { lat: number; lon: number }, string | undefined][] = [
      ['free spot', at(0, 300), undefined],
      ['outside the play area', at(0, 3000), 'Outside play area'],
      ['next to the HQ', at(0, 10), 'Too close to HQ'],
      ['next to the spawn', at(60, 990), 'Too close to spawn'],
      ['next to a tower', at(0, 505), 'Too close to another tower'],
      ['next to the route', at(95, 300), 'Too close to route'],
    ];
    for (const [, p, reason] of cases) {
      const result = check(p.lat, p.lon);
      expect(result).toEqual(service.validateTowerPosition(p.lat, p.lon));
      expect(result.valid).toBe(reason === undefined);
      expect(result.reason).toBe(reason);
    }
  });

  it('assembles the context once per checker, not per position', () => {
    init();
    getAll.mockClear();
    getCachedPaths.mockClear();

    const check = service.placementChecker();
    for (let north = 100; north < 900; north += 15) check(at(0, north).lat, at(0, north).lon);

    expect(getAll).toHaveBeenCalledTimes(1);
    expect(getCachedPaths).toHaveBeenCalledTimes(1);
  });

  it('is a snapshot: a tower placed afterwards needs a new checker', () => {
    init();
    const before = service.placementChecker();
    towers.push(new Tower({ ...at(0, 300), height: 0 }, 'archer'));

    const spot = at(0, 303);
    expect(before(spot.lat, spot.lon).valid).toBe(true);
    expect(service.placementChecker()(spot.lat, spot.lon).reason).toBe('Too close to another tower');
  });

  it('rejects every position until the world is ready', () => {
    expect(service.placementChecker()(HQ.lat, HQ.lon)).toEqual({
      valid: false, reason: 'Service not initialized',
    });
    init([]);
    const spot = at(0, 300);
    expect(service.validateTowerPosition(spot.lat, spot.lon)).toEqual({
      valid: false, reason: 'No streets loaded',
    });
  });
});
