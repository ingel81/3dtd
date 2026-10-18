// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { countryAt } from './countries.ts';
import { cellCentre, cellOf, nameFrom, PlaceResolver, type PlaceName } from './places.ts';

const node = (lat: number, lon: number, place: string, name: string) => ({ lat, lon, tags: { place, name } });

describe('countryAt', () => {
  it('names the country of a point, enclaves and border towns too', () => {
    expect(countryAt(49.7913, 9.9534)).toBe('DE'); // Würzburg
    expect(countryAt(49.7036, 9.2636)).toBe('DE'); // Miltenberg
    expect(countryAt(47.5596, 7.5886)).toBe('CH'); // Basel
    expect(countryAt(48.5734, 7.7521)).toBe('FR'); // Strasbourg
    expect(countryAt(43.9424, 12.4578)).toBe('SM'); // San Marino, inside Italy
    expect(countryAt(48.8566, 2.3522)).toBe('FR');
    expect(countryAt(-33.8688, 151.2093)).toBe('AU');
    expect(countryAt(50, -30)).toBeNull(); // the Atlantic
  });
});

describe('places', () => {
  it('puts a point into its cell and back to the cell\'s middle', () => {
    expect(cellOf(49.7913, 9.9534)).toBe('995,199');
    expect(cellCentre('995,199')).toEqual({ lat: expect.closeTo(49.775, 6), lon: expect.closeTo(9.975, 6) });
    expect(cellOf(-33.87, 151.21)).toBe('-678,3024');
  });

  it('names the town near for its size, with the part of town in front', () => {
    const at = { lat: 49.785, lon: 9.95 };
    const nodes = [
      node(49.7913, 9.9534, 'city', 'Würzburg'),
      node(49.79, 9.9, 'village', 'Höchberg'),
      node(49.7835, 9.948, 'suburb', 'Sanderau'),
    ];
    expect(nameFrom(at, nodes)).toBe('Sanderau, Würzburg');
    expect(nameFrom({ lat: 49.79, lon: 9.9 }, nodes.slice(0, 2))).toBe('Höchberg');
    expect(nameFrom(at, [])).toBeNull();
  });
});

describe('PlaceResolver', () => {
  const answer = (elements: unknown[]) =>
    Promise.resolve(new Response(JSON.stringify({ elements }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

  const setup = (fetchImpl: typeof fetch, idle = () => true) => {
    const stored = new Map<string, PlaceName>();
    let now = 0;
    const resolver = new PlaceResolver({
      upstream: 'http://overpass/api/interpreter',
      idle,
      store: (cell, place) => stored.set(cell, place),
      known: (cell) => stored.has(cell),
      fetchImpl,
      now: () => now,
      retryMs: 1000,
    });
    return { resolver, stored, advance: (ms: number) => (now += ms) };
  };

  it('asks its own Overpass once per cell and keeps the name with the country', async () => {
    const fetchImpl = vi.fn(() => answer([node(49.7913, 9.9534, 'city', 'Würzburg')]));
    const { resolver, stored } = setup(fetchImpl as unknown as typeof fetch);
    const cell = cellOf(49.79, 9.95);
    resolver.want(cell, { lat: 49.79, lon: 9.95 });
    resolver.want(cell);
    await vi.waitFor(() => expect(stored.get(cell)).toEqual({ name: 'Würzburg', country: 'DE' }));
    resolver.want(cell);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = decodeURIComponent(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    // Around the box's middle asked first, not the cell's
    expect(body).toMatch(/node\(around:12000,49\.7900,9\.9500\)\["place"~/);
  });

  it('leaves a cell nameless when Overpass fails, and asks again only after a while', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('busy', { status: 504 })));
    const { resolver, stored, advance } = setup(fetchImpl as unknown as typeof fetch);
    const cell = cellOf(50.05, 10.22);
    resolver.want(cell);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 10));
    resolver.want(cell);
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(stored.size).toBe(0);
    advance(1001);
    resolver.want(cell);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
  });

  it('waits while Overpass has no slot to spare', async () => {
    vi.useFakeTimers();
    try {
      let idle = false;
      const fetchImpl = vi.fn(() => answer([]));
      const { resolver } = setup(fetchImpl as unknown as typeof fetch, () => idle);
      resolver.want(cellOf(49.7, 9.26));
      await vi.advanceTimersByTimeAsync(5000);
      expect(fetchImpl).not.toHaveBeenCalled();
      idle = true;
      await vi.advanceTimersByTimeAsync(2000);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      resolver.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
