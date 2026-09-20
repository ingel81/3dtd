import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CITY_POOL_URL, WORLD_DICE_FAILED, WorldDiceService, parseCityPool } from './world-dice.service';

/** The pool file as the generator writes it: one array per city. */
const poolFile = {
  fields: ['id', 'name', 'country', 'countryCode', 'continent', 'lat', 'lon', 'population', 'area', 'elevation', 'capital', 'google3d'],
  cities: [
    ['Q64', 'Berlin', 'Germany', 'DE', 'Europe', 52.517, 13.389, 3755251, 891.1, 34, 1, 1],
    ['Q1726', 'Munich', 'Germany', 'DE', 'Europe', 48.137, 11.576, 1512491, 310.7, 519, 0, 1],
    ['Q1490', 'Ulaanbaatar', 'Mongolia', 'MN', 'Asia', 47.921, 106.918, 1396288, 4704.4, 1350, 1, 0],
  ],
};

const answer = (body: unknown) => ({ ok: true, json: async () => body });

describe('parseCityPool', () => {
  it('reads a row into a city, area, elevation and 3D coverage included', () => {
    expect(parseCityPool(poolFile)[0]).toEqual({
      id: 'Q64',
      name: 'Berlin',
      country: 'Germany',
      countryCode: 'DE',
      continent: 'Europe',
      lat: 52.517,
      lon: 13.389,
      population: 3755251,
      area: 891.1,
      elevation: 34,
      capital: true,
      google3d: true,
    });
  });

  it('takes a missing area, elevation or 3D answer as none and leaves a row without coordinates out', () => {
    const city = parseCityPool({ cities: [['Q1', 'Nowhere', 'Test', 'TT', 'Europe', 1, 2, 100000, null, null, 0, null]] })[0];
    expect(city).toMatchObject({ area: null, elevation: null, capital: false, google3d: null });
    expect(parseCityPool({ cities: [['Q2', 'Broken', 'Test', 'TT', 'Europe', null, null, 1, null, null, 0]] })).toEqual([]);
    expect(parseCityPool(null)).toEqual([]);
  });
});

describe('WorldDiceService', () => {
  let service: WorldDiceService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service = new WorldDiceService();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('rolls a city from the shipped list and reads it only once', async () => {
    fetchMock.mockResolvedValue(answer(poolFile));

    const first = await service.rollRandomCity();
    const second = await service.rollRandomCity();

    expect(first?.name).toMatch(/Berlin|Munich/);
    expect(second).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(CITY_POOL_URL, expect.anything());
    expect(service.cities).toHaveLength(3);
  });

  it('rolls only cities Google covers with 3D data', async () => {
    fetchMock.mockResolvedValue(answer(poolFile));

    for (let roll = 0; roll < 30; roll++) {
      expect((await service.rollRandomCity())?.name).not.toBe('Ulaanbaatar');
    }
    expect(service.rollable.map((city) => city.name)).toEqual(['Berlin', 'Munich']);
  });

  it('rolls every city while none of them is marked', async () => {
    const unchecked = { ...poolFile, cities: poolFile.cities.map((row) => [...row.slice(0, 11), null]) };
    fetchMock.mockResolvedValue(answer(unchecked));

    await service.rollRandomCity();
    expect(service.rollable).toHaveLength(3);
  });

  it('says so when the list does not load', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });

    expect(await service.rollRandomCity()).toBeNull();
    expect(service.error()).toBe(WORLD_DICE_FAILED);
    expect(service.isLoading()).toBe(false);
  });

  it('reads the list again after a failed roll instead of failing for good', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    fetchMock.mockResolvedValueOnce(answer(poolFile));

    expect(await service.rollRandomCity()).toBeNull();
    // Regression: the rejected load stayed cached, so every later roll failed at once
    expect(await service.rollRandomCity()).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports a list without cities instead of rolling nothing', async () => {
    fetchMock.mockResolvedValue(answer({ cities: [] }));

    expect(await service.rollRandomCity()).toBeNull();
    expect(service.error()).toBe('No cities loaded');
  });
});
