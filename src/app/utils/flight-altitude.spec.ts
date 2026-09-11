import { describe, it, expect } from 'vitest';
import {
  type FlightProfile,
  countReliable,
  createFlightProfile,
  pickSamples,
  safeGround,
  skylineMax,
  stepAltitude,
} from './flight-altitude';

const MAX_ERROR = 20;
const SPAN = 6;

function put(p: FlightProfile, i: number, ground: number, error: number, top = ground): void {
  p.ground[i] = ground;
  p.top[i] = top;
  p.error[i] = error;
}

describe('safeGround', () => {
  it('keine Treffer: nimmt den Rückfallwert (Routenhöhe)', () => {
    const p = createFlightProfile(50);
    expect(safeGround(p, 10, SPAN, MAX_ERROR, 480)).toBe(480);
  });

  it('nur ein grobes Sample tief unter der Oberfläche: bleibt beim Rückfallwert', () => {
    const p = createFlightProfile(50);
    put(p, 10, -3154, 3000);
    expect(safeGround(p, 10, SPAN, MAX_ERROR, 480)).toBe(480);
  });

  it('grobes Sample über dem Rückfallwert: nimmt das höhere', () => {
    const p = createFlightProfile(50);
    put(p, 11, 510, 60);
    expect(safeGround(p, 10, SPAN, MAX_ERROR, 480)).toBe(510);
  });

  it('verlässliches Sample in Reichweite gewinnt, auch unter dem Rückfallwert', () => {
    const p = createFlightProfile(50);
    put(p, 10, -3154, 3000);
    put(p, 13, 470, 5);
    expect(safeGround(p, 10, SPAN, MAX_ERROR, 480)).toBe(470);
  });

  it('verlässliches Sample nur weit weg: nie unter dem Rückfallwert', () => {
    const p = createFlightProfile(50);
    put(p, 40, 300, 5); // Talsohle am anderen Ende der Route
    expect(safeGround(p, 10, SPAN, MAX_ERROR, 480)).toBe(480);
    put(p, 40, 520, 5);
    expect(safeGround(p, 10, SPAN, MAX_ERROR, 480)).toBe(520);
  });

  it('nimmt auch einen verlässlichen Boden von genau 0 m', () => {
    const p = createFlightProfile(50);
    put(p, 40, 0, 5);
    expect(safeGround(p, 10, SPAN, MAX_ERROR, -10)).toBe(0);
  });
});

describe('stepAltitude', () => {
  it('begrenzt Steig- und Sinkrate', () => {
    expect(stepAltitude(100, 200, -Infinity, 0.1, 45, 14)).toBeCloseTo(104.5, 9);
    expect(stepAltitude(100, 0, -Infinity, 0.1, 45, 14)).toBeCloseTo(98.6, 9);
  });

  it('hebt die Kamera sofort auf die Untergrenze, wenn der Boden steigt', () => {
    expect(stepAltitude(100, 140, 120, 0.016, 45, 14)).toBe(120);
  });
});

describe('pickSamples', () => {
  it('lässt verlässliche Stellen aus und hält das Budget ein', () => {
    const p = createFlightProfile(20);
    put(p, 3, 500, 5);
    put(p, 4, 500, 900);
    const out: number[] = [];
    pickSamples(p, 2, 6, 2, 0, MAX_ERROR, out);
    expect(out).toEqual([2, 4]);
  });

  it('kommt reihum an jede offene Stelle, auch wenn die ersten nie treffen', () => {
    const p = createFlightProfile(30);
    const out: number[] = [];
    const seen = new Set<number>();
    let cursor = 0;
    for (let frame = 0; frame < 10; frame++) {
      cursor = pickSamples(p, 5, 14, 2, cursor, MAX_ERROR, out);
      out.forEach(i => seen.add(i));
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });
});

describe('Fahrt bei kaltem Cache (späte Treffer)', () => {
  it('bleibt nahe am plausiblen Boden, zieht späte feine Samples nach und fällt nie darunter', () => {
    const MIN_ALTITUDE = 22;
    const HARD_CLEARANCE = 5;
    const ROUTE_GROUND = 480;
    const TRUE_GROUND = 530;
    const dt = 1 / 60;

    const p = createFlightProfile(40);
    // Erst nur grobe Kacheln: Sehnen weit unter der Oberfläche
    for (let i = 0; i < 40; i++) put(p, i, -3154, 3000);

    let currentY = safeGround(p, 20, SPAN, MAX_ERROR, ROUTE_GROUND) + MIN_ALTITUDE;
    let lowest = Infinity;

    for (let frame = 0; frame < 240; frame++) {
      // Nach einer Sekunde kommen die feinen Tiles
      if (frame === 60) for (let i = 0; i < 40; i++) put(p, i, TRUE_GROUND, 5);

      const ground = safeGround(p, 20, SPAN, MAX_ERROR, ROUTE_GROUND);
      const desired = Math.max(ground + MIN_ALTITUDE, skylineMax(p, 11, 29) + 18);
      const floor = ground + HARD_CLEARANCE;
      const before = currentY;
      currentY = stepAltitude(currentY, desired, floor, dt, 45, 14);

      expect(currentY).toBeGreaterThanOrEqual(floor);
      if (frame < 60) expect(currentY).toBe(ROUTE_GROUND + MIN_ALTITUDE);
      // Ein Frame bewegt sich höchstens um die Steigrate oder bis zur Untergrenze
      expect(currentY - before).toBeLessThanOrEqual(Math.max(45 * dt, floor - before) + 1e-9);
      lowest = Math.min(lowest, currentY);
    }

    expect(lowest).toBeGreaterThan(ROUTE_GROUND);
    expect(currentY).toBeCloseTo(TRUE_GROUND + MIN_ALTITUDE, 3);
  });
});

describe('countReliable', () => {
  it('zählt nur Samples aus feinen Tiles', () => {
    const p = createFlightProfile(5);
    put(p, 0, 500, 5);
    put(p, 1, 500, 20);
    put(p, 2, -3000, 3000);
    expect(countReliable(p, MAX_ERROR)).toBe(2);
  });
});
