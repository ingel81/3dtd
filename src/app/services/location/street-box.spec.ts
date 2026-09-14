import { describe, expect, it } from 'vitest';
import { GeoBox, boxAreaKm2, boxAround, boxMinus, boxesOverlap, mergeStreets, wayTouchesBox } from './street-box';
import type { Street, StreetNetwork } from './osm-street.service';

/**
 * The box arithmetic behind loadStreets taking over the streets it loaded
 * before: which strips of a new box are still missing, which loaded ways
 * run through it, and the network put together from both.
 */
describe('street-box', () => {
  const BOX: GeoBox = { minLat: 0, maxLat: 2, minLon: 0, maxLon: 2 };
  const node = (id: number, lat: number, lon: number) => ({ id, lat, lon });

  describe('boxMinus', () => {
    it('is the whole box when the cut misses it, and nothing when the cut covers it', () => {
      expect(boxMinus(BOX, { minLat: 3, maxLat: 4, minLon: 0, maxLon: 2 })).toEqual([BOX]);
      expect(boxMinus(BOX, { minLat: -1, maxLat: 3, minLon: -1, maxLon: 3 })).toEqual([]);
    });

    it('leaves the east half after a move one radius east, as past an edge of the loaded streets', () => {
      expect(boxMinus(BOX, { minLat: 0, maxLat: 2, minLon: -1, maxLon: 1 })).toEqual([
        { minLat: 0, maxLat: 2, minLon: 1, maxLon: 2 },
      ]);
    });

    it('leaves a strip over the whole width and one beside the cut after a move past a corner', () => {
      expect(boxMinus(BOX, { minLat: -1, maxLat: 1, minLon: -1, maxLon: 1 })).toEqual([
        { minLat: 1, maxLat: 2, minLon: 0, maxLon: 2 },
        { minLat: 0, maxLat: 1, minLon: 1, maxLon: 2 },
      ]);
    });

    it('rings a cut inside the box with four strips', () => {
      const parts = boxMinus(BOX, { minLat: 0.5, maxLat: 1.5, minLon: 0.5, maxLon: 1.5 });
      expect(parts).toHaveLength(4);
      expect(parts.reduce((sum, part) => sum + (part.maxLat - part.minLat) * (part.maxLon - part.minLon), 0)).toBeCloseTo(3);
    });
  });

  it('tells overlapping boxes from ones that only share an edge', () => {
    expect(boxesOverlap(BOX, { minLat: 1, maxLat: 3, minLon: 1, maxLon: 3 })).toBe(true);
    expect(boxesOverlap(BOX, { minLat: 2, maxLat: 3, minLon: 0, maxLon: 2 })).toBe(false);
  });

  it('measures the box loadStreets asks for, 2000 m around a point, as 16 km²', () => {
    expect(boxAreaKm2(boxAround(48.8566, 2.3522, 2000))).toBeCloseTo(16, 1);
  });

  describe('wayTouchesBox', () => {
    it('takes a way with a node in the box and one that only crosses it', () => {
      expect(wayTouchesBox([node(1, 1, 1), node(2, 5, 5)], BOX)).toBe(true);
      expect(wayTouchesBox([node(1, 1, -1), node(2, 1, 3)], BOX)).toBe(true);
    });

    it('leaves a way that passes beside the box or cuts past its corner', () => {
      expect(wayTouchesBox([node(1, 3, -1), node(2, 3, 3)], BOX)).toBe(false);
      expect(wayTouchesBox([node(1, 1.5, -1), node(2, 3, 0.5)], BOX)).toBe(false);
    });
  });

  describe('mergeStreets', () => {
    const street = (id: number, ...nodes: ReturnType<typeof node>[]): Street => ({ id, name: `Way ${id}`, type: 'residential', nodes });
    const network = (...streets: Street[]): StreetNetwork => ({
      streets,
      nodes: new Map(streets.flatMap((s) => s.nodes).map((n) => [n.id, n])),
      bounds: { minLat: -2, maxLat: 2, minLon: -2, maxLon: 2 },
    });

    it('keeps the loaded ways through the box, adds the fetched ones once and orders them by id', () => {
      const outside = street(1, node(10, -1, -1), node(11, -1, -1.5));
      const across = street(5, node(50, 1, -1), node(51, 1, 1));
      const inside = street(3, node(30, 0.5, 0.5), node(31, 0.6, 0.6));
      const fetchedAcross = { ...across, name: 'fetched' };
      const fresh = street(4, node(40, 1.5, 1.5), node(41, 1.8, 1.5));

      const merged = mergeStreets(network(outside, across, inside), network(fetchedAcross, fresh), BOX);

      expect(merged.streets.map((s) => s.id)).toEqual([3, 4, 5]);
      expect(merged.streets.find((s) => s.id === 5)?.name).toBe('fetched');
      expect([...merged.nodes.keys()].sort((a, b) => a - b)).toEqual([30, 31, 40, 41, 50, 51]);
      expect(merged.bounds).toBe(BOX);
    });

    it('cuts the loaded streets down to the box when nothing was fetched', () => {
      const merged = mergeStreets(network(street(1, node(10, -1, -1), node(11, -1, -1.5)), street(2, node(20, 1, 1), node(21, 1, 1.2))), null, BOX);
      expect(merged.streets.map((s) => s.id)).toEqual([2]);
    });
  });
});
