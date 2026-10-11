import { MathUtils } from 'three';
import { OriginSync } from '../sim/core/sim-coords';
import { mapToGeo } from '../world/custom-map/map-document';
import { EllipsoidSync, originDegrees } from './ellipsoid-sync';

/**
 * The main thread and the simulation convert with the same origin bits
 * (2026-10-11): the simulation's OriginSync is built from getOrigin(), and
 * EllipsoidSync converts with exactly those degrees. Before, the main thread
 * kept the degrees as given; about one origin in eight differs from its trip
 * through radians in the last bit, and route points on whole metres fell
 * into other cells on the two sides.
 */
describe('EllipsoidSync origin', () => {
  /** Deterministic pseudo-random degrees with 7 decimals, as a place's URL keeps them */
  const degrees = (i: number, span: number) => Number((((i * 7919) % 100_000) / 100_000 * span - span / 2).toFixed(7));

  it('gives the simulation the degrees it converts with, and they survive a second trip', () => {
    let changed = 0;
    for (let i = 0; i < 2000; i++) {
      const lat = degrees(i, 160);
      const lon = degrees(i * 3 + 1, 340);
      const main = new EllipsoidSync(lat, lon, 12);
      const o = main.getOrigin();
      if (o.lat !== lat || o.lon !== lon) changed++;
      expect(originDegrees(o.lat * MathUtils.DEG2RAD)).toBe(o.lat);
      expect(new EllipsoidSync(o.lat, o.lon).getOrigin()).toMatchObject({ lat: o.lat, lon: o.lon });
      const sim = new OriginSync(o.lat, o.lon, o.height);
      for (const [dLat, dLon] of [[0.001, -0.002], [-0.0137, 0.0071]]) {
        const a = main.geoToLocalSimple(lat + dLat, lon + dLon, 3);
        const b = sim.geoToLocalSimple(lat + dLat, lon + dLon, 3);
        expect([a.x, a.y, a.z]).toEqual([b.x, b.y, b.z]);
      }
    }
    // The case the change is about exists among such places
    expect(changed).toBeGreaterThan(0);
  });

  it('puts a custom map\'s whole-metre nodes into the same 2 m cells on both sides, whatever the HQ', () => {
    for (let hy = -200; hy <= 200; hy += 7) {
      const hq = mapToGeo({ x: hy * 0.7, y: hy });
      const main = new EllipsoidSync(hq.lat, hq.lon, 0);
      const o = main.getOrigin();
      const sim = new OriginSync(o.lat, o.lon, o.height);
      for (let y = -240; y <= 240; y += 16) {
        const p = mapToGeo({ x: y * 0.5 + 2, y });
        const a = main.geoToLocalSimple(p.lat, p.lon, 0);
        const b = sim.geoToLocalSimple(p.lat, p.lon, 0);
        expect([Math.floor(a.x / 2), Math.floor(a.z / 2)]).toEqual([Math.floor(b.x / 2), Math.floor(b.z / 2)]);
      }
    }
  });
});
