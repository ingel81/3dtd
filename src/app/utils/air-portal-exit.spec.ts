import { describe, it, expect } from 'vitest';
import { airPortalExit, airPortalExitOffset, type AirPortalExit } from './air-portal-exit';
import {
  AIR_PORTAL_EXIT,
  PORTAL_DEPTH,
  PORTAL_MAX_SCALE,
  PORTAL_MIN_SCALE,
  PORTAL_OPENING_HEIGHT,
  portalDepthScale,
} from '../configs/marker-geometry.config';

// Bodies above their model origin at config scale (m), from the VAT bake's
// range: the bat's origin is in its middle, the dragon's below its feet.
const BAT = { min: -1.4, max: 1.29 };
const DRAGON = { min: 0.73, max: 12.16 };
const SCALES = [PORTAL_MIN_SCALE, 1, PORTAL_MAX_SCALE];

/** Offsets every 1 cm from path[0] to 10 m past the climb. */
function sampled(exit: AirPortalExit): number[] {
  const out: number[] = [];
  for (let cm = 0; cm <= (exit.climbEnd + 10) * 100; cm++) out.push(airPortalExitOffset(exit, cm / 100));
  return out;
}

describe('airPortalExit', () => {
  it.each(SCALES)('puts the middle of a body that fits on the middle of the opening (scale %s)', (scale) => {
    const exit = airPortalExit(scale, BAT.min, BAT.max, 0, 15);
    const opening = PORTAL_OPENING_HEIGHT * scale;
    expect(exit.from + (BAT.min + BAT.max) / 2).toBeCloseTo(opening / 2, 12);
    expect(exit.from + BAT.min).toBeGreaterThan(0);
    expect(exit.from + BAT.max).toBeLessThan(opening);
  });

  it('stands a body taller than the opening on the ground instead of reaching below it', () => {
    // 11.4 m of dragon in an 11 m opening
    const exit = airPortalExit(1, DRAGON.min, DRAGON.max, 0, 20);
    expect(exit.from + DRAGON.min).toBeCloseTo(0, 12);
  });

  it('centres the dragon once the opening is tall enough', () => {
    const exit = airPortalExit(PORTAL_MAX_SCALE, DRAGON.min, DRAGON.max, 0, 20);
    expect(exit.from + (DRAGON.min + DRAGON.max) / 2).toBeCloseTo((PORTAL_OPENING_HEIGHT * PORTAL_MAX_SCALE) / 2, 12);
  });

  it('puts a body without a measured range with its origin on the middle of the opening', () => {
    expect(airPortalExit(1, 0, 0, 0, 15).from).toBe(PORTAL_OPENING_HEIGHT / 2);
  });

  it('takes the altitude spread out: every unit of a type comes through the same height', () => {
    const altitudes = [-3, -0.4, 0, 2.7].map((spread) => airPortalExit(1, BAT.min, BAT.max, spread, 15).from + spread);
    for (const a of altitudes) expect(a).toBeCloseTo(altitudes[0], 12);
  });

  it.each(SCALES)('starts the climb holdPastFront past the front surface (scale %s)', (scale) => {
    const exit = airPortalExit(scale, BAT.min, BAT.max, 0, 15);
    const front = (PORTAL_DEPTH / 2) * portalDepthScale(scale);
    expect(exit.climbStart).toBeCloseTo(front + AIR_PORTAL_EXIT.holdPastFront, 12);
    expect(exit.climbEnd - exit.climbStart).toBeCloseTo(AIR_PORTAL_EXIT.climbDistance, 12);
    expect(exit.to).toBe(15);
  });
});

describe('airPortalExitOffset', () => {
  const exit = airPortalExit(1, BAT.min, BAT.max, 1.5, 15);

  it('holds the opening height from path[0] to the start of the climb', () => {
    for (const d of [0, 1, (PORTAL_DEPTH / 2), exit.climbStart]) expect(airPortalExitOffset(exit, d)).toBe(exit.from);
  });

  it('reaches the cruise height exactly and stays there', () => {
    expect(airPortalExitOffset(exit, exit.climbEnd)).toBe(exit.to);
    expect(airPortalExitOffset(exit, exit.climbEnd + 0.001)).toBe(exit.to);
    expect(airPortalExitOffset(exit, 10_000)).toBe(exit.to);
  });

  it('climbs monotonically, without overshoot and without a jump', () => {
    const offsets = sampled(exit);
    // Steepest point of the smoothstep: 1.5 times the mean slope, per cm
    const maxStep = (1.5 * (exit.to - exit.from)) / AIR_PORTAL_EXIT.climbDistance / 100;
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i]).toBeGreaterThanOrEqual(offsets[i - 1]);
      expect(offsets[i] - offsets[i - 1]).toBeLessThanOrEqual(maxStep + 1e-12);
      expect(offsets[i]).toBeGreaterThanOrEqual(exit.from);
      expect(offsets[i]).toBeLessThanOrEqual(exit.to);
    }
    // Eased in and out: the first and the last centimetre of the climb barely move
    const start = Math.round(exit.climbStart * 100);
    const end = Math.round(exit.climbEnd * 100);
    expect(offsets[start + 1] - offsets[start]).toBeLessThan(maxStep / 100);
    expect(offsets[end] - offsets[end - 1]).toBeLessThan(maxStep / 100);
  });

  it('descends the same way when the cruise height is below the opening', () => {
    const down: AirPortalExit = { ...exit, from: 12, to: 4 };
    const offsets = sampled(down);
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i]).toBeLessThanOrEqual(offsets[i - 1]);
      expect(offsets[i]).toBeLessThanOrEqual(12);
      expect(offsets[i]).toBeGreaterThanOrEqual(4);
    }
    expect(offsets[offsets.length - 1]).toBe(4);
  });

  it('depends on the distance flown only, however it was stepped', () => {
    // 20 m into the climb, reached in 7, 60 and 600 steps
    const target = exit.climbStart + 20;
    const reached = [7, 60, 600].map((steps) => {
      let flown = 0;
      for (let i = 0; i < steps; i++) flown += target / steps;
      return airPortalExitOffset(exit, flown);
    });
    for (const offset of reached) expect(offset).toBeCloseTo(airPortalExitOffset(exit, target), 9);
  });
});
