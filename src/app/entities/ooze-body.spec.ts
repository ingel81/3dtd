import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { METERS_PER_DEGREE_LAT } from '../utils/geo-utils';
import { RouteBodyStations } from '../utils/route-body';
import { OozeBody } from './ooze-body';

const sync = {
  geoToLocalSimpleInto: (_lat: number, _lon: number, _h: number, target: Vector3): Vector3 => target.set(0, 0, 0),
};
const stations = new RouteBodyStations(
  [{ lat: 0, lon: 0 }, { lat: 300 / METERS_PER_DEGREE_LAT, lon: 0 }],
  sync,
  0,
);

describe('OozeBody', () => {
  it('keeps its tail at the start until the body is maxLengthM long', () => {
    const body = new OozeBody(stations, 80, 0);
    body.grow(30);
    expect(body.tailM).toBe(0);
    expect(body.tipM).toBe(30);
    body.grow(80);
    expect(body.tailM).toBe(0);
    expect(body.lengthM).toBe(80);
  });

  it('then follows the tip at maxLengthM', () => {
    const body = new OozeBody(stations, 80, 0);
    body.grow(95);
    expect(body.tailM).toBe(15);
    body.grow(140);
    expect(body.tailM).toBe(60);
    expect(body.lengthM).toBe(80);
  });

  it('flows into the HQ at most as far as the body is long', () => {
    const body = new OozeBody(stations, 80, 0);
    body.grow(300);
    body.arrived = true;
    expect(body.flowIn(30)).toBe(30);
    expect(body.lengthM).toBe(50);
    expect(body.flowedIn).toBe(false);
    expect(body.flowIn(70)).toBe(50);
    expect(body.flowedIn).toBe(true);
    expect(body.flowIn(10)).toBe(0);
  });

  it('charges whole points and settles the rest once in', () => {
    const body = new OozeBody(stations, 80, 0);
    expect(body.owe(0.4)).toBe(0);
    expect(body.owe(0.7)).toBe(1);
    expect(body.owe(0.3)).toBe(0);
    expect(body.settle()).toBe(0); // 0.4 left, rounds down
    expect(body.owe(0.6)).toBe(0);
    expect(body.settle()).toBe(1);
  });

  it('starts where the ooze joins its path and never moves back', () => {
    const body = new OozeBody(stations, 80, 40);
    expect(body.tailM).toBe(40);
    body.grow(55);
    body.grow(50);
    expect(body.tipM).toBe(55);
    expect(body.tailM).toBe(40);
  });
});
