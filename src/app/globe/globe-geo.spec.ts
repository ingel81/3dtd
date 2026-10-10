import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import {
  EARTH_A,
  EARTH_B,
  LANDING_SUN_ELEVATION,
  ecefOf,
  gmst,
  landingSun,
  subsolarPoint,
  sunElevation,
  sweptSun,
  upOf,
} from './globe-geo';

describe('globe-geo', () => {
  it('puts the equator and the pole on the WGS84 axes', () => {
    const v = new Vector3();
    expect(ecefOf(0, 0, 0, v).x).toBeCloseTo(EARTH_A, 3);
    expect(ecefOf(90, 0, 0, v).z).toBeCloseTo(EARTH_B, 3);
    expect(ecefOf(0, 90, 1000, v).y).toBeCloseTo(EARTH_A + 1000, 3);
  });

  it('has the up vector along the height', () => {
    const ground = ecefOf(48.78, 9.18, 0, new Vector3());
    const high = ecefOf(48.78, 9.18, 500_000, new Vector3());
    const up = upOf(48.78, 9.18, new Vector3());
    expect(high.sub(ground).normalize().dot(up)).toBeCloseTo(1, 9);
  });

  it('turns the sky 280.46 degrees at J2000', () => {
    expect((gmst(new Date('2000-01-01T12:00:00Z')) * 180) / Math.PI).toBeCloseTo(280.46, 2);
  });

  it('has the sun over the equator at the equinox and over the tropic at the solstice', () => {
    expect(Math.abs(subsolarPoint(new Date('2024-03-20T03:06:00Z')).lat)).toBeLessThan(0.05);
    expect(subsolarPoint(new Date('2024-06-20T20:51:00Z')).lat).toBeCloseTo(23.44, 1);
    expect(subsolarPoint(new Date('2024-12-21T09:20:00Z')).lat).toBeCloseTo(-23.44, 1);
  });

  it('has the sun near Greenwich at noon UTC, off by the equation of time only', () => {
    // 2024-04-15: the equation of time is about 0, the sun stands over 0 degrees at 12:00 UTC
    expect(Math.abs(subsolarPoint(new Date('2024-04-15T12:00:00Z')).lon)).toBeLessThan(0.5);
    // 2024-11-03: solar noon comes 16.4 minutes early, at 12:00 UTC the sun is 4.1 degrees west
    expect(subsolarPoint(new Date('2024-11-03T12:00:00Z')).lon).toBeCloseTo(-4.1, 0);
  });

  it('measures the sun high at noon and below the horizon at midnight', () => {
    const sun = subsolarPoint(new Date('2024-06-20T11:23:00Z'));
    expect(sunElevation({ lat: 48.78, lon: 9.18 }, sun)).toBeCloseTo(90 - 48.78 + 23.44, 0);
    const night = subsolarPoint(new Date('2024-06-20T23:23:00Z'));
    expect(sunElevation({ lat: 48.78, lon: 9.18 }, night)).toBeLessThan(0);
  });

  describe('landingSun', () => {
    const stuttgart = { lat: 48.78, lon: 9.18 };

    it('keeps the sun where the place lies in day', () => {
      const now = { lat: 10, lon: 5 };
      expect(landingSun(stuttgart, now)).toBe(now);
    });

    it('brings a morning sun over a place in the night, high enough', () => {
      const midnight = subsolarPoint(new Date('2024-06-20T23:23:00Z'));
      const landing = landingSun(stuttgart, midnight);
      expect(sunElevation(stuttgart, landing)).toBeGreaterThanOrEqual(LANDING_SUN_ELEVATION);
      expect(landing.lon).toBeGreaterThan(stuttgart.lon);
    });

    it('lights a place in the polar night', () => {
      const svalbard = { lat: 78.2, lon: 15.6 };
      const winter = subsolarPoint(new Date('2024-12-21T12:00:00Z'));
      expect(sunElevation(svalbard, winter)).toBeLessThan(0);
      expect(sunElevation(svalbard, landingSun(svalbard, winter))).toBeGreaterThan(0);
    });
  });

  describe('sweptSun', () => {
    it('runs west like time, through the date line', () => {
      const from = { lat: 0, lon: -170 };
      const to = { lat: 10, lon: 170 };
      expect(sweptSun(from, to, 0)).toEqual(from);
      const half = sweptSun(from, to, 0.5);
      expect(Math.abs(half.lon)).toBeCloseTo(180, 6);
      expect(half.lat).toBeCloseTo(5, 6);
      expect(sweptSun(from, to, 1).lon).toBeCloseTo(170, 6);
    });

    it('goes the long way west when the target lies a little east', () => {
      const mid = sweptSun({ lat: 0, lon: 0 }, { lat: 0, lon: 10 }, 0.5);
      expect(mid.lon).toBeCloseTo(-175, 6);
    });
  });
});
