import { afterEach, describe, expect, it } from 'vitest';
import { BandColumn, BandRoute, CorridorBand, PASSAGE_SPAN_M, bandPath, buildBand, smoothCentre } from './corridor-band';
import { corridorConfig, resetCorridorConfig, setCorridorConfig } from './route-corridor';

const CELL = 2;

/** Ground height at local (x, z). */
type Ground = (x: number, z: number) => number;

/** The columns over `ground`, their tops `top` (a car the mesh made hollow), none where `hole`. */
const columns = (ground: Ground, top: Ground = ground, hole?: (x: number, z: number) => boolean) =>
  (x: number, z: number): BandColumn | null => (hole?.(x, z) ? null : { ground: ground(x, z), top: top(x, z) });

/**
 * A street eastbound along z = 1, the middle of a row of cells, from x = 0 to
 * 120: right of travel is +z. `half`: the OSM half width; `wall`: how far the
 * rays leave room either side, per station.
 */
function street(wall = 7, half = 2.75, wallRight = wall): BandRoute {
  return {
    points: [{ x: 0, z: 1 }, { x: 120, z: 1 }],
    open: [true],
    streetHalfWidth: [half],
    wallLeft: [new Array<number>(60).fill(wall)],
    wallRight: [new Array<number>(60).fill(wallRight)],
  };
}

/** The station nearest to x. */
const at = (band: CorridorBand, x: number) => band.stations.reduce((a, b) => (Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a));

/** A parked car 4.5 m long from x = 55, `z0` to `z1`. */
const car = (z0: number, z1: number) => (x: number, z: number) => x >= 55 && x <= 59.5 && z > z0 && z < z1;

describe('buildBand', () => {
  afterEach(() => resetCorridorConfig());

  it('lies in the middle of a level street between its walls', () => {
    const band = buildBand(street(2.25), columns(() => 0), CELL, 'band');
    for (const st of band.stations) {
      expect(st).toMatchObject({ kind: 'band', left: -2.25, right: 2.25 });
      expect(st.centre).toBeCloseTo(0, 9);
      expect(st.backbone!.offset).toBe(0);
    }
    expect(band.passages).toEqual([]);
  });

  it('moves the enemies off a car on the line into the middle of the street beside it, smoothly', () => {
    // A car on the line, the street 7 m either side: the backbone goes to the street on the left of it.
    const onCar = car(0.1, 1.9);
    const band = buildBand(street(), columns((x, z) => (onCar(x, z) ? 1.5 : 0)), CELL, 'band');
    const beside = at(band, 57);
    expect(beside.backbone!.offset).toBe(-2);
    expect(beside.left).toBe(-7);
    expect(beside.right).toBe(-1);
    // Within the band, edgeMargin off its edges, and back on the line away from the car.
    expect(beside.centre).toBeLessThanOrEqual(-1 - corridorConfig.edgeMargin + 1e-9);
    expect(beside.centre).toBeGreaterThanOrEqual(-7 + corridorConfig.edgeMargin - 1e-9);
    // The smoothed line swings out a few centimetres before it turns.
    expect(Math.abs(at(band, 15).centre)).toBeLessThan(0.1);
    expect(Math.abs(at(band, 105).centre)).toBeLessThan(0.1);
    // As gently as the worm bends.
    expect(band.maxCurvature).toBeLessThan(1 / 20);
    expect(band.maxSlope).toBeLessThan(0.25);
  });

  it('moves the line only as far as needed in minimal mode, and reads the mode from the settings', () => {
    const onCar = car(0.1, 1.9);
    const ground = columns((x, z) => (onCar(x, z) ? 1.5 : 0));
    const minimal = buildBand(street(), ground, CELL, 'minimal');
    // The edge 1 m left of the line, the enemies edgeMargin off it; the smoothed line a little further where it turns.
    expect(at(minimal, 57).centre).toBeLessThanOrEqual(-1 - corridorConfig.edgeMargin + 1e-9);
    expect(at(minimal, 57).centre).toBeGreaterThan(-3);
    expect(at(minimal, 57).centre).toBeGreaterThan(at(buildBand(street(), ground, CELL, 'band'), 57).centre);
    expect(minimal.maxCurvature).toBeLessThan(1 / 20);

    expect(setCorridorConfig({ centreMode: 'minimal' })).toEqual([]);
    expect(buildBand(street(), ground, CELL)).toEqual(minimal);
    expect(setCorridorConfig({ centreMode: 'middle' as never })).toEqual(["centreMode must be 'band' or 'minimal'"]);
  });

  it('lets enemies climb over a car that fills a narrow lane', () => {
    // Houses 2 m either side of the line, the rays leave 1.5 m.
    const onCar = car(-1, 3);
    const lane = columns((x, z) => (Math.abs(z - 1) >= 2 ? 8 : onCar(x, z) ? 1.5 : 0));
    const st = at(buildBand(street(1.5, 1.5), lane, CELL, 'band'), 57);
    expect(st).toMatchObject({ kind: 'climb', backbone: { offset: 0, y: 1.5 }, left: -1.5, right: 1.5 });
    expect(st.centre).toBeCloseTo(0, 6);
  });

  it('runs a passage under a jetty the mesh fills down to a narrow lane', () => {
    const jetty = columns((x, z) => (Math.abs(z - 1) >= 2 ? 8 : x >= 55.5 && x <= 58.5 ? 5 : 0));
    const band = buildBand(street(1.5, 1.5), jetty, CELL, 'band');
    expect(at(band, 57)).toMatchObject({ kind: 'passage', backbone: null, centre: 0 });
    // The jetty fills the cell from x = 56 to 58.
    expect(band.passages).toEqual([{ from: 56, to: 58 }]);
    const path = bandPath(street(1.5, 1.5), band);
    expect(path.some((p) => p.passage)).toBe(true);
  });

  /**
   * Playtest 2026-09-16, Rothenburg, the Weisser Turm over Georgengasse: a
   * gate tower is deeper along the street than the four stations either way
   * a passage used to be measured against, so the median over them was the
   * tower roof and only the two ends of the stretch came out as a passage.
   */
  it('runs a passage under a gate tower deeper than the stations around it', () => {
    // Houses 2 m either side of the line, the tower filled to the ground from x = 50 to 62.
    const gate = columns((x, z) => (Math.abs(z - 1) >= 2 ? 8 : x >= 50 && x <= 62 ? 20 : 0));
    const band = buildBand(street(1.5, 1.5), gate, CELL, 'band');
    const inside = band.stations.filter((st) => st.x > 50 && st.x < 62);
    expect(inside.length).toBeGreaterThan(4);
    for (const st of inside) expect(st, `${st.s}`).toMatchObject({ kind: 'passage', backbone: null });
    expect(band.passages).toHaveLength(1);
    // Every station knows the street under it, the ones on the tower included.
    for (const st of band.stations) expect(st.street, `${st.s}`).toBe(0);
  });

  /*
   * The second way into a passage, the cell the line runs through standing
   * on a roof while the backbone is still on the street, needs a line at an
   * angle to the cell lattice: only then can the nearest cell centre across
   * belong to one cell and the point itself to the next. On this street
   * along a row of cells the two are always the same cell. The scene
   * "Weisser Turm" in integration/corridor-band.scenes.spec.ts guards it on
   * the real line instead.
   */

  it('takes no passage on a street that climbs, and gives its slope back', () => {
    const band = buildBand(street(), columns((x) => 0.08 * x), CELL, 'band');
    expect(band.passages).toEqual([]);
    // The opening gives a straight slope back exactly, but for half a span
    // at each end of the route, where it reads up to `slope * span / 2` low.
    for (const st of band.stations) {
      expect(st.street!, `${st.s}`).toBeLessThanOrEqual(st.backbone!.y + 1e-9);
      expect(st.backbone!.y - st.street!, `${st.s}`).toBeLessThan(corridorConfig.roofRise);
    }
    for (const st of band.stations.filter((s) => s.s > PASSAGE_SPAN_M / 2 && s.s < 120 - PASSAGE_SPAN_M / 2)) {
      expect(st.street!, `${st.s}`).toBeCloseTo(st.backbone!.y, 6);
    }
  });

  it('ends the band at the top of the embankment on the valley side, and at the bank uphill', () => {
    const terrace: Ground = (_x, z) => {
      const off = z - 1;
      if (off > 3) return -0.09 - (off - 3) / 1.5;
      if (off < -3) return 0.09 + (-off - 3) / 1.5;
      return -0.03 * off;
    };
    const st = at(buildBand(street(), columns(terrace), CELL, 'band'), 31);
    expect(st.right).toBe(3);
    expect(st.left).toBe(-3);
  });

  it('keeps the backbone on the street beside a quay, not on the river', () => {
    const st = at(buildBand(street(), columns((_x, z) => (z - 1 > 3 ? -4 : 0)), CELL, 'band'), 31);
    expect(st.backbone).toEqual({ offset: 0, y: 0 });
    expect(st.right).toBe(3);
    expect(st.left).toBe(-7);
  });

  it('keeps the band on a road on a dam', () => {
    const dam: Ground = (_x, z) => -Math.max(0, Math.abs(z - 1) - 2.75) / 1.5;
    const st = at(buildBand(street(), columns(dam), CELL, 'band'), 31);
    expect(st.backbone!.offset).toBe(0);
    expect(st.left).toBe(-3);
    expect(st.right).toBe(3);
  });

  it('spans a street across a 15 % slope from wall to wall', () => {
    const st = at(buildBand(street(), columns((_x, z) => 0.15 * (z - 1)), CELL, 'band'), 31);
    expect(st.left).toBe(-7);
    expect(st.right).toBe(7);
    expect(st.centre).toBeCloseTo(0, 6);
  });

  it('ends the band before a small object on a square, not round it', () => {
    // A bench 0.6 m high 4 m right of the line, x 60 to 62.
    const bench = (x: number, z: number) => x > 60 && x < 62 && z > 4 && z < 6;
    const band = buildBand(street(), columns((x, z) => (bench(x, z) ? 0.6 : 0)), CELL, 'band');
    expect(at(band, 61).right).toBe(3);
    expect(at(band, 31).right).toBe(7);
    // A person the mesh made hollow: its top 1.7 m over the ground under it.
    const person = (x: number, z: number) => x > 60 && x < 62 && z > -4 && z < -2;
    const hollowBand = buildBand(street(), columns(() => 0, (x, z) => (person(x, z) ? 1.7 : 0)), CELL, 'band');
    expect(at(hollowBand, 61).left).toBe(-3);
  });

  it('passes over a cell without any column', () => {
    const st = at(buildBand(street(), columns(() => 0, () => 0, (x, z) => x > 30 && x < 32 && z > 4 && z < 6), CELL, 'band'), 31);
    expect(st.right).toBe(7);
  });

  it('gives the same band for the same input', () => {
    const onCar = car(0.1, 1.9);
    const ground = columns((x, z) => (onCar(x, z) ? 1.5 : 0));
    expect(buildBand(street(), ground, CELL, 'band')).toEqual(buildBand(street(), ground, CELL, 'band'));
  });
});

describe('smoothCentre', () => {
  it('stays within its bounds and on its pins, and follows the target elsewhere', () => {
    const n = 40;
    const target = Array.from({ length: n }, (_, k) => (k >= 15 && k < 25 ? 3 : 0));
    const lo = new Array<number>(n).fill(-5);
    const hi = new Array<number>(n).fill(5);
    for (let k = 18; k < 22; k++) lo[k] = 2.5;
    const pinned = target.map((_, k) => k === 0 || k === n - 1);
    const c = smoothCentre(target, lo, hi, pinned, 150);
    c.forEach((v, k) => {
      expect(v).toBeGreaterThanOrEqual(lo[k] - 1e-9);
      expect(v).toBeLessThanOrEqual(hi[k] + 1e-9);
    });
    expect(c[0]).toBe(0);
    expect(c[n - 1]).toBe(0);
    expect(c[20]).toBeGreaterThanOrEqual(2.5);
  });
});
