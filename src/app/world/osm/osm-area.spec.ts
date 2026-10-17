import { describe, expect, it } from 'vitest';
import { areaWithin, fitArea, OSM_HQ_EDGE_M, OSM_MIN_SIDE, sameArea } from './osm-area';
import { OSM_WORLD_SIDE } from './import-osm';
import { OsmFrame } from './osm-parse';

describe('OSM world square (E209)', () => {
  const place = { lat: 49.7, lon: 9.26 };
  const geo = new OsmFrame(place.lat, place.lon);
  const at = (x: number, y: number, sideM: number) => ({ ...geo.geo({ x, y }), sideM });

  it('holds the side to its limits in steps of 100 m', () => {
    expect(fitArea(at(0, 0, 900), place).sideM).toBe(OSM_MIN_SIDE);
    expect(fitArea(at(0, 0, 5000), place).sideM).toBe(OSM_WORLD_SIDE);
    expect(fitArea(at(0, 0, 1849), place).sideM).toBe(1800);
  });

  it('moves the square only as far as the place keeps its room to the edge', () => {
    const free = fitArea(at(300, -200, 2000), place);
    expect(geo.point(free).x).toBeCloseTo(300, 1);
    expect(geo.point(free).y).toBeCloseTo(-200, 1);
    const held = fitArea(at(2000, -2000, 2000), place);
    expect(geo.point(held).x).toBeCloseTo(1000 - OSM_HQ_EDGE_M, 1);
    expect(geo.point(held).y).toBeCloseTo(-(1000 - OSM_HQ_EDGE_M), 1);
  });

  it('knows a square within the data of another', () => {
    const data = at(0, 0, 2400);
    expect(areaWithin(at(500, -500, 1400), data)).toBe(true);
    expect(areaWithin(at(600, 0, 1400), data)).toBe(false);
    expect(areaWithin(data, data)).toBe(true);
    expect(sameArea(data, at(0.2, 0, 2400))).toBe(true);
    expect(sameArea(data, at(0, 0, 2300))).toBe(false);
  });
});
