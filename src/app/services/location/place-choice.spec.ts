import { describe, expect, it } from 'vitest';
import { parseCoordinates, startSpawns, storedPlace } from './place-choice';

describe('storedPlace', () => {
  it('carries the HQ and every spawn, bearings included (a link, a favourite, a coop host)', () => {
    const spawns = [{ lat: 48.87832, lon: 2.29851, portalBearing: 90 }, { lat: 48.86883, lon: 2.29135 }];
    expect(storedPlace({ lat: 48.8735, lon: 2.29588 }, spawns)).toEqual({
      kind: 'stored',
      hq: { lat: 48.8735, lon: 2.29588 },
      spawns,
    });
  });

  it('keeps no spawn when the place had none: the game draws a random one', () => {
    expect(storedPlace({ lat: 1, lon: 2 }, [])).toEqual({ kind: 'stored', hq: { lat: 1, lon: 2 }, spawns: [] });
  });
});

describe('startSpawns', () => {
  it('loads a picked spawn, none for a random one, every spawn of a stored place', () => {
    const hq = { lat: 49.14, lon: 9.21, name: 'Heilbronn' };
    expect(startSpawns({ kind: 'place', hq, spawn: null })).toEqual([]);
    expect(startSpawns({ kind: 'place', hq, spawn: { lat: 49.15, lon: 9.22, name: 'Allee', portalBearing: 12 } }))
      .toEqual([{ lat: 49.15, lon: 9.22, portalBearing: 12 }]);
    expect(startSpawns(storedPlace(hq, [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }]))).toEqual([{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }]);
  });
});

describe('parseCoordinates', () => {
  it('reads decimal, cardinal, prefixed, degrees-minutes-seconds and a Google Maps URL', () => {
    expect(parseCoordinates('49.5432, 9.1234')).toEqual({ lat: 49.5432, lon: 9.1234 });
    expect(parseCoordinates('49.5432 9.1234')).toEqual({ lat: 49.5432, lon: 9.1234 });
    expect(parseCoordinates('33.86°S, 151.21°E')).toEqual({ lat: -33.86, lon: 151.21 });
    expect(parseCoordinates('N 49.5, W 9.25')).toEqual({ lat: 49.5, lon: -9.25 });
    const dms = parseCoordinates(`49°30'0"N 9°15'0"E`)!;
    expect(dms.lat).toBeCloseTo(49.5);
    expect(dms.lon).toBeCloseTo(9.25);
    expect(parseCoordinates('https://www.google.com/maps/@48.8584,2.2945,17z')).toEqual({ lat: 48.8584, lon: 2.2945 });
  });

  it('refuses what is out of range or no coordinates', () => {
    expect(parseCoordinates('91, 10')).toBeNull();
    expect(parseCoordinates('Heilbronn')).toBeNull();
  });
});
