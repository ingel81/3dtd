import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { MissileFlight, planMissileLaunch } from './missile-flight';
import { MISSILE_LAUNCH_LOOK } from '../configs/visual-effects.config';

/** The nuclear strike's warning with the silo, game seconds */
const WARNING_S = 6.5;
const START = new Vector3(100, 20.5, -40);
/** One frame at 60 fps as a share of the flight */
const FRAME_U = 1 / 60 / WARNING_S;

const DEG = 180 / Math.PI;

/** A flight from START to a target `distance` m away along +x, `rise` m higher than the start */
function flightOver(distance: number, rise = 0, durationS = WARNING_S): { flight: MissileFlight; target: Vector3 } {
  const target = new Vector3(START.x + distance, START.y + rise, START.z);
  return { flight: new MissileFlight().plan(START, target, durationS), target };
}

/** Positions and directions every frame at 60 fps */
function frames(flight: MissileFlight): { position: Vector3; direction: Vector3 }[] {
  const out: { position: Vector3; direction: Vector3 }[] = [];
  const count = Math.round(flight.duration * 60);
  for (let k = 0; k <= count; k++) {
    const position = new Vector3();
    const direction = new Vector3();
    flight.at(k / count, position, direction);
    out.push({ position, direction });
  }
  return out;
}

const DISTANCES = [0, 30, 120, 400, 1000, 1600];

describe('MissileFlight', () => {
  it('starts on the start point, straight up, and stands there through the ignition', () => {
    for (const distance of DISTANCES) {
      const { flight } = flightOver(distance);
      const position = new Vector3();
      const direction = new Vector3();
      flight.at(0, position, direction);
      expect(position.distanceTo(START), `${distance} m`).toBeLessThan(1e-6);
      expect(direction.y, `${distance} m`).toBeCloseTo(1, 6);
      flight.at(flight.ignition / flight.duration, position);
      expect(position.distanceTo(START), `${distance} m`).toBeLessThan(1e-6);
    }
    expect(flightOver(400).flight.ignition).toBe(MISSILE_LAUNCH_LOOK.flight.ignition.seconds);
  });

  it('ends exactly on the target, its height included, at the end of its time', () => {
    for (const distance of DISTANCES) {
      for (const rise of [-60, 0, 45]) {
        const { flight, target } = flightOver(distance, rise);
        const position = new Vector3();
        flight.at(1, position);
        expect(position.equals(target), `${distance} m, ${rise} m`).toBe(true);
        expect(flight.distanceAt(WARNING_S)).toBe(flight.length);
        // A frame before, just short of it
        flight.at(1 - FRAME_U, position);
        expect(position.distanceTo(target)).toBeGreaterThan(0);
        expect(position.distanceTo(target)).toBeLessThan(flight.length / 20);
      }
    }
  });

  it('tops out high above both ends, higher the farther the target, at least the minimum', () => {
    const { apex } = MISSILE_LAUNCH_LOOK.flight;
    let last = 0;
    for (const distance of DISTANCES) {
      for (const rise of [-60, 0, 45]) {
        const { flight, target } = flightOver(distance, rise);
        const top = Math.max(...frames(flight).map((f) => f.position.y));
        const above = MissileFlight.apexAbove(distance);
        expect(top, `${distance} m, ${rise} m`).toBeGreaterThanOrEqual(Math.max(START.y, target.y) + above - 1);
        expect(above).toBeGreaterThanOrEqual(apex.min);
      }
      expect(MissileFlight.apexAbove(distance)).toBeGreaterThanOrEqual(last);
      last = MissileFlight.apexAbove(distance);
    }
    expect(MissileFlight.apexAbove(30)).toBe(apex.min);
    expect(MissileFlight.apexAbove(1000)).toBeGreaterThan(2 * apex.min);
  });

  it('dives almost straight down onto the target, clear of the buildings', () => {
    for (const distance of DISTANCES) {
      const { flight, target } = flightOver(distance);
      const position = new Vector3();
      const direction = new Vector3();
      flight.at(1, position, direction);
      expect(direction.y, `${distance} m`).toBeLessThan(-0.99);
      // The last 30 m of height within 10 degrees of straight down, the last 100 m within 25
      for (let d = flight.length; d > 0; d -= 0.5) {
        flight.atDistance(d, position, direction);
        const height = position.y - target.y;
        if (height > 100) break;
        const offVertical = Math.acos(-direction.y) * DEG;
        expect(offVertical, `${distance} m, ${height.toFixed(0)} m up`).toBeLessThan(height > 30 ? 25 : 10);
      }
    }
  });

  it('lifts off slowly out of the shaft, as fast whatever the distance, then speeds up, coasts over the apex and dives fastest', () => {
    for (const distance of DISTANCES) {
      const { flight } = flightOver(distance);
      const { ignition, lift } = MISSILE_LAUNCH_LOOK.flight;
      // A second after the ignition still within a few metres of the start
      const oneSecond = ignition.seconds + 1;
      expect(flight.distanceAt(oneSecond)).toBeCloseTo(0.5 * lift.acceleration, 6);
      expect(flight.speedAt(oneSecond)).toBeCloseTo(lift.acceleration, 6);
      // Faster at the end than anywhere before, slower at the apex than climbing to it
      const all = frames(flight);
      const apex = all.reduce((best, f, k) => (f.position.y > all[best].position.y ? k : best), 0);
      const speeds = all.map((_, k) => flight.speedAt((k / (all.length - 1)) * flight.duration));
      const peakClimb = Math.max(...speeds.slice(0, apex));
      expect(speeds[apex], `${distance} m`).toBeLessThan(peakClimb);
      expect(speeds[all.length - 2], `${distance} m`).toBeGreaterThan(Math.max(...speeds.slice(0, all.length - 2)) - 1e-6);
    }
  });

  it('moves forward all the time, never back along its way', () => {
    for (const distance of DISTANCES) {
      const { flight } = flightOver(distance);
      let last = 0;
      for (let k = 0; k <= 400; k++) {
        const d = flight.distanceAt((k / 400) * WARNING_S);
        expect(d, `${distance} m`).toBeGreaterThanOrEqual(last - 1e-9);
        last = d;
      }
    }
  });

  it('turns smoothly: never more than a few degrees a frame, a short flight turning over the top instead of flipping', () => {
    for (const distance of DISTANCES) {
      const all = frames(flightOver(distance).flight);
      let sharpest = 0;
      for (let k = 1; k < all.length; k++) {
        const turn = Math.acos(Math.min(1, all[k - 1].direction.dot(all[k].direction))) * DEG;
        sharpest = Math.max(sharpest, turn);
      }
      expect(sharpest, `${distance} m`).toBeLessThan(8);
    }
    // Straight up and down onto its own start: it swings out at the top
    const { flight } = flightOver(0);
    const aside = Math.max(...frames(flight).map((f) => Math.hypot(f.position.x - START.x, f.position.z - START.z)));
    expect(aside).toBeGreaterThan(MISSILE_LAUNCH_LOOK.flight.swing / 2);
  });

  it('points its direction along the way it moves', () => {
    const { flight } = flightOver(700, -20);
    const a = new Vector3();
    const b = new Vector3();
    const direction = new Vector3();
    for (const u of [0.35, 0.5, 0.7, 0.9, 0.98]) {
      flight.at(u, a, direction);
      flight.at(u + 1e-4, b);
      expect(b.sub(a).normalize().dot(direction), `u ${u}`).toBeGreaterThan(0.999);
    }
  });

  it('gives the time it passes a point along its way, the inverse of distanceAt', () => {
    const { flight } = flightOver(900, 30);
    for (const share of [0, 0.004, 0.1, 0.35, 0.5, 0.8, 1]) {
      const d = share * flight.length;
      const t = flight.timeAtDistance(d);
      expect(flight.distanceAt(t), `share ${share}`).toBeCloseTo(d, 0);
    }
  });

  it('fits a shorter warning too, ending on the target in its time', () => {
    const { flight, target } = flightOver(500, 0, 1.5);
    const position = new Vector3();
    flight.at(1, position);
    expect(position.equals(target)).toBe(true);
    let last = 0;
    for (let k = 0; k <= 90; k++) {
      const d = flight.distanceAt((k / 90) * 1.5);
      expect(d).toBeGreaterThanOrEqual(last - 1e-9);
      last = d;
    }
    expect(last).toBe(flight.length);
  });

  it('starts a launch at the nozzle in the shaft, above the silo base', () => {
    const site = new Vector3(5, 12, 8);
    const flight = planMissileLaunch(new MissileFlight(), site, new Vector3(300, 10, 8), WARNING_S);
    const position = new Vector3();
    flight.at(0, position);
    expect(position).toEqual(new Vector3(5, 12 + MISSILE_LAUNCH_LOOK.missile.baseHeight, 8));
  });

  it('plans the same flight from the same start, target and time', () => {
    const a = flightOver(640, 12).flight;
    const b = new MissileFlight().plan(new Vector3(0, 0, 0), new Vector3(9, 9, 9), 2);
    b.plan(START, new Vector3(START.x + 640, START.y + 12, START.z), WARNING_S);
    const pa = new Vector3();
    const pb = new Vector3();
    for (const u of [0.1, 0.4, 0.77, 1]) {
      a.at(u, pa);
      b.at(u, pb);
      expect(pb.distanceTo(pa)).toBeLessThan(1e-9);
    }
  });
});
