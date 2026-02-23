import { describe, it, expect } from 'vitest';
import { haversineDistance, fastDistance, fastDistanceSq, geoDistance, geoDistanceFast, geoDistanceFastSq, findNearestRouteDistance } from './geo-utils';

describe('geo-utils', () => {
  // Well-known coordinates
  const STUTTGART = { lat: 48.7758, lon: 9.1829 };
  const BERLIN = { lat: 52.5200, lon: 13.4050 };
  const EQUATOR_ZERO = { lat: 0, lon: 0 };

  describe('haversineDistance()', () => {
    it('returns 0 for identical points', () => {
      const d = haversineDistance(48.0, 9.0, 48.0, 9.0);
      expect(d).toBe(0);
    });

    it('calculates Stuttgart↔Berlin ~510km', () => {
      const d = haversineDistance(
        STUTTGART.lat, STUTTGART.lon,
        BERLIN.lat, BERLIN.lon
      );
      // Known distance ~510km, allow ±20km tolerance
      expect(d).toBeGreaterThan(490_000);
      expect(d).toBeLessThan(530_000);
    });

    it('is symmetric (A→B = B→A)', () => {
      const d1 = haversineDistance(STUTTGART.lat, STUTTGART.lon, BERLIN.lat, BERLIN.lon);
      const d2 = haversineDistance(BERLIN.lat, BERLIN.lon, STUTTGART.lat, STUTTGART.lon);
      expect(d1).toBeCloseTo(d2, 6);
    });

    it('handles equator distances correctly', () => {
      // 1 degree longitude at equator ≈ 111.32 km
      const d = haversineDistance(0, 0, 0, 1);
      expect(d).toBeGreaterThan(110_000);
      expect(d).toBeLessThan(112_000);
    });

    it('handles anti-meridian crossing (lon 179 → -179)', () => {
      const d = haversineDistance(0, 179, 0, -179);
      // Should be ~2 degrees at equator ≈ 222.6 km
      expect(d).toBeGreaterThan(220_000);
      expect(d).toBeLessThan(225_000);
    });

    it('handles north pole to south pole', () => {
      const d = haversineDistance(90, 0, -90, 0);
      // Half circumference ≈ 20,015 km
      expect(d).toBeGreaterThan(19_500_000);
      expect(d).toBeLessThan(20_500_000);
    });

    it('handles very small distances (same neighborhood)', () => {
      // ~100m offset in lat
      const d = haversineDistance(48.7758, 9.1829, 48.7767, 9.1829);
      expect(d).toBeGreaterThan(80);
      expect(d).toBeLessThan(120);
    });
  });

  describe('fastDistance()', () => {
    it('returns 0 for identical points', () => {
      const d = fastDistance(48.0, 9.0, 48.0, 9.0);
      expect(d).toBe(0);
    });

    it('is accurate within 1% of haversine for short distances (<200m)', () => {
      // ~100m offset
      const lat1 = 48.7758, lon1 = 9.1829;
      const lat2 = 48.7767, lon2 = 9.1835;

      const hd = haversineDistance(lat1, lon1, lat2, lon2);
      const fd = fastDistance(lat1, lon1, lat2, lon2);

      const error = Math.abs(hd - fd) / hd;
      expect(error).toBeLessThan(0.01); // <1% error
    });

    it('is accurate within 1% for ~50m distance', () => {
      const lat1 = 48.7758, lon1 = 9.1829;
      const lat2 = 48.7762, lon2 = 9.1832;

      const hd = haversineDistance(lat1, lon1, lat2, lon2);
      const fd = fastDistance(lat1, lon1, lat2, lon2);

      const error = Math.abs(hd - fd) / hd;
      expect(error).toBeLessThan(0.01);
    });

    it('handles equator correctly', () => {
      // Small distance at equator
      const d = fastDistance(0, 0, 0, 0.001);
      // ~111m
      expect(d).toBeGreaterThan(100);
      expect(d).toBeLessThan(120);
    });

    it('is approximately symmetric (slight asymmetry from flat-earth cos(lat1))', () => {
      const d1 = fastDistance(48.7, 9.1, 48.8, 9.2);
      const d2 = fastDistance(48.8, 9.2, 48.7, 9.1);
      // fastDistance uses cos(lat1) for lon scaling, so A→B ≠ B→A exactly
      // but difference should be <1% for nearby points
      const error = Math.abs(d1 - d2) / Math.max(d1, d2);
      expect(error).toBeLessThan(0.01);
    });
  });

  describe('geoDistance() wrapper', () => {
    it('produces same result as haversineDistance', () => {
      const d1 = geoDistance(STUTTGART, BERLIN);
      const d2 = haversineDistance(STUTTGART.lat, STUTTGART.lon, BERLIN.lat, BERLIN.lon);
      expect(d1).toBe(d2);
    });

    it('returns 0 for same point', () => {
      expect(geoDistance(STUTTGART, STUTTGART)).toBe(0);
    });
  });

  describe('geoDistanceFast() wrapper', () => {
    it('produces same result as fastDistance', () => {
      const pos1 = { lat: 48.7758, lon: 9.1829 };
      const pos2 = { lat: 48.7767, lon: 9.1835 };

      const d1 = geoDistanceFast(pos1, pos2);
      const d2 = fastDistance(pos1.lat, pos1.lon, pos2.lat, pos2.lon);
      expect(d1).toBe(d2);
    });

    it('returns 0 for same point', () => {
      expect(geoDistanceFast(EQUATOR_ZERO, EQUATOR_ZERO)).toBe(0);
    });
  });

  describe('fastDistanceSq()', () => {
    it('returns 0 for identical points', () => {
      const d = fastDistanceSq(48.0, 9.0, 48.0, 9.0);
      expect(d).toBe(0);
    });

    it('equals fastDistance() squared for known points', () => {
      const lat1 = 48.7758, lon1 = 9.1829;
      const lat2 = 48.7767, lon2 = 9.1835;

      const fd = fastDistance(lat1, lon1, lat2, lon2);
      const fdSq = fastDistanceSq(lat1, lon1, lat2, lon2);

      expect(fdSq).toBeCloseTo(fd * fd, 6);
    });

    it('equals fastDistance() squared at equator', () => {
      const fd = fastDistance(0, 0, 0, 0.001);
      const fdSq = fastDistanceSq(0, 0, 0, 0.001);

      expect(fdSq).toBeCloseTo(fd * fd, 6);
    });

    it('can be used for range comparisons', () => {
      const lat1 = 48.7758, lon1 = 9.1829;
      const lat2 = 48.7767, lon2 = 9.1835;

      const fd = fastDistance(lat1, lon1, lat2, lon2);
      const fdSq = fastDistanceSq(lat1, lon1, lat2, lon2);
      const range = fd + 1; // just beyond the distance

      // Both comparisons should agree
      expect(fd <= range).toBe(true);
      expect(fdSq <= range * range).toBe(true);

      const shortRange = fd - 1; // just within the distance
      expect(fd <= shortRange).toBe(false);
      expect(fdSq <= shortRange * shortRange).toBe(false);
    });
  });

  describe('geoDistanceFastSq() wrapper', () => {
    it('produces same result as fastDistanceSq', () => {
      const pos1 = { lat: 48.7758, lon: 9.1829 };
      const pos2 = { lat: 48.7767, lon: 9.1835 };

      const d1 = geoDistanceFastSq(pos1, pos2);
      const d2 = fastDistanceSq(pos1.lat, pos1.lon, pos2.lat, pos2.lon);
      expect(d1).toBe(d2);
    });

    it('returns 0 for same point', () => {
      expect(geoDistanceFastSq(EQUATOR_ZERO, EQUATOR_ZERO)).toBe(0);
    });
  });

  describe('findNearestRouteDistance()', () => {
    // Route along lat=48.0 from lon=11.0 to lon=11.001 (~75m east-west)
    const route: { lat: number; lon: number }[] = [
      { lat: 48.0, lon: 11.0 },
      { lat: 48.0, lon: 11.0005 },
      { lat: 48.0, lon: 11.001 },
    ];

    it('returns Infinity when no routes provided', () => {
      expect(findNearestRouteDistance([], 48.0, 11.0)).toBe(Infinity);
    });

    it('returns ~0 for a point directly on the route', () => {
      const dist = findNearestRouteDistance([route], 48.0, 11.0005);
      expect(dist).toBeLessThan(1);
    });

    it('point 5m from route → distance ~5m (under MIN_DISTANCE_TO_ROUTE)', () => {
      // ~5m north: 0.000045 degrees lat
      const dist = findNearestRouteDistance([route], 48.000045, 11.0005);
      expect(dist).toBeGreaterThan(3);
      expect(dist).toBeLessThan(7);
    });

    it('point 15m from route → distance ~15m (over MIN_DISTANCE_TO_ROUTE)', () => {
      // ~15m north: 0.000135 degrees lat
      const dist = findNearestRouteDistance([route], 48.000135, 11.0005);
      expect(dist).toBeGreaterThan(12);
      expect(dist).toBeLessThan(18);
    });

    it('checks segment distance, not just node distance', () => {
      const singleRoute = [
        { lat: 48.0, lon: 11.0 },
        { lat: 48.0, lon: 11.001 },
      ];
      // Point at midpoint but 10m north
      const midLon = 11.0005;
      const segDist = findNearestRouteDistance([singleRoute], 48.00009, midLon);
      const nodeDist = haversineDistance(48.00009, midLon, 48.0, 11.0);
      // Segment distance should be less than distance to nearest node
      expect(segDist).toBeLessThan(nodeDist);
    });

    it('works with multiple routes and returns minimum', () => {
      const route1 = [{ lat: 48.0, lon: 11.0 }, { lat: 48.0, lon: 11.001 }];
      const route2 = [{ lat: 48.001, lon: 11.0 }, { lat: 48.001, lon: 11.001 }];
      // Point between routes, closer to route1
      const dist = findNearestRouteDistance([route1, route2], 48.0002, 11.0005);
      const d1 = findNearestRouteDistance([route1], 48.0002, 11.0005);
      const d2 = findNearestRouteDistance([route2], 48.0002, 11.0005);
      expect(dist).toBeCloseTo(Math.min(d1, d2), 6);
    });

    it('point next to non-route street has no effect (Infinity without routes)', () => {
      // This test verifies that without routes, the function returns Infinity
      // (i.e., non-route streets are not checked)
      expect(findNearestRouteDistance([], 48.0, 11.0)).toBe(Infinity);
    });
  });

  describe('Edge cases', () => {
    it('negative latitudes (southern hemisphere)', () => {
      const d = haversineDistance(-33.87, 151.21, -37.81, 144.96); // Sydney → Melbourne
      expect(d).toBeGreaterThan(700_000);
      expect(d).toBeLessThan(900_000);
    });

    it('both functions handle lat=0, lon=0 (null island)', () => {
      expect(haversineDistance(0, 0, 0, 0)).toBe(0);
      expect(fastDistance(0, 0, 0, 0)).toBe(0);
    });

    it('very close to poles', () => {
      const d = haversineDistance(89.999, 0, 89.999, 180);
      // At 89.999°N, opposite longitudes are only ~22m apart
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThan(250);
    });
  });
});
