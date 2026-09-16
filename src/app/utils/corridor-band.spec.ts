import { afterEach, describe, expect, it } from 'vitest';
import { BandColumn, BandRoute, CorridorBand, PASSAGE_SPAN_M, bandPath, buildBand, smoothCentre } from './corridor-band';
import { corridorConfig, resetCorridorConfig, setCorridorConfig } from './route-corridor';
import { segmentTouchesCell } from './route-grid-builder';

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
    covered: [false],
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

  /**
   * Playtest 748, Stuttgart: a verge under a hedge beside the street lay
   * 0.46 m lower, and one station found it within its window. It laid its
   * band on the verge, the stations around it on the street, and the taper
   * along the route cut both down to nothing.
   */
  it('keeps the band on the street past a lower verge one station finds behind a hedge', () => {
    // The street 7 m either side; at x 60 to 62 a hedge 1 to 3 m right of the line and the verge behind it 0.4 m down.
    const hedge = (x: number, z: number) => x > 60 && x < 62 && z > 2 && z < 4;
    const verge = (x: number, z: number) => x > 60 && x < 62 && z > 4 && z < 6;
    const band = buildBand(street(7, 3.5), columns((x, z) => (verge(x, z) ? -0.4 : 0), (x, z) => (hedge(x, z) ? 1.2 : verge(x, z) ? -0.4 : 0)), CELL, 'band');
    for (const st of band.stations.filter((s) => s.x > 40 && s.x < 80)) {
      expect(st.backbone!.y, `${st.s}`).toBe(0);
      expect(st.left, `${st.s}`).toBe(-7);
      expect(st.right, `${st.s}`).toBeGreaterThanOrEqual(1);
    }
    // The hedge ends the band beside it, and the band narrows before it.
    expect(at(band, 61).right).toBeCloseTo(1, 9);
    expect(at(band, 57).right).toBeCloseTo(3, 9);
  });

  /** Playtest 748, Berlin and Paris: an object between the two sides of the street, the ground behind it a few centimetres lower at one station, then at the next on the other side. */
  it('keeps the band on one side of an object between the two sides of the street', () => {
    // A post on the line from x 50 to 60; the ground 3 cm lower right of it, left of it at x 54 to 56.
    const post = (x: number, z: number) => x > 50 && x < 60 && z > 0 && z < 2;
    const dip = (x: number, z: number) => (x > 54 && x < 56 ? z < 0 : z > 2) && x > 50 && x < 60;
    const band = buildBand(street(), columns((x, z) => (dip(x, z) ? -0.03 : 0), (x, z) => (post(x, z) ? 1.2 : dip(x, z) ? -0.03 : 0)), CELL, 'band');
    const beside = band.stations.filter((st) => st.x > 50 && st.x < 60);
    expect(beside.length).toBeGreaterThan(3);
    const side = Math.sign(beside[0].backbone!.offset);
    for (const st of beside) {
      expect(Math.sign(st.backbone!.offset), `${st.s}`).toBe(side);
      expect(st.right - st.left, `${st.s}`).toBeGreaterThanOrEqual(5);
    }
  });

  /** The Shibuya snapshot rebuilt on modelled columns: stations with nothing plausible across split the chain, and each piece chose its own side. */
  it('keeps one side past a station with no way across', () => {
    // A post on the line from x 30 to 90; the ground 3 cm lower left of it before x 60, right of it after; at x 58 to
    // 60 every cell across hollow, a barrier the mesh made hollow.
    const post = (x: number, z: number) => x > 30 && x < 90 && z > 0 && z < 2;
    const dip = (x: number, z: number) => x > 30 && x < 90 && (x < 60 ? z < 0 : z > 2);
    const barrier = (x: number) => x > 58 && x < 60;
    const band = buildBand(street(), columns((x, z) => (dip(x, z) ? -0.03 : 0), (x, z) => (post(x, z) || barrier(x) ? 1.2 : dip(x, z) ? -0.03 : 0)), CELL, 'band');
    expect(at(band, 59).kind).toBe('fixed');
    const beside = band.stations.filter((st) => st.x > 32 && st.x < 88 && st.kind !== 'fixed');
    const side = Math.sign(beside[0].backbone!.offset);
    for (const st of beside) {
      expect(Math.sign(st.backbone!.offset), `${st.s}`).toBe(side);
      expect(st.right - st.left, `${st.s}`).toBeGreaterThanOrEqual(5);
    }
  });

  it('changes sides where a long row of objects leaves no way round it', () => {
    // A row of posts on the line from x 20 to 100; a wall 0.5 m left of the line from x 60, 0.5 m right of it before.
    const row = (x: number, z: number) => x > 20 && x < 100 && z > 0 && z < 2;
    const route = street();
    route.wallLeft = [route.wallLeft[0].map((w, k) => (2 * k + 1 >= 60 ? 0.5 : w))];
    route.wallRight = [route.wallRight[0].map((w, k) => (2 * k + 1 < 60 ? 0.5 : w))];
    const band = buildBand(route, columns(() => 0, (x, z) => (row(x, z) ? 1.2 : 0)), CELL, 'band');
    for (const st of band.stations.filter((s) => s.x > 22 && s.x < 98)) {
      expect(st.kind, `${st.s}`).toBe('band');
      if (st.x < 60) expect(st.right, `${st.s}`).toBeLessThanOrEqual(-1);
      else expect(st.left, `${st.s}`).toBeGreaterThanOrEqual(1);
    }
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

  /**
   * Playtest 747: the same gate tower loaded twice, the cell lattice 19 cm
   * apart, gave two passages and one. A lane at an angle to the lattice,
   * shifted by every quarter cell: the line crosses cells between two
   * stations, and which cells lie under a station depends on the shift.
   */
  describe('wherever the cell lattice lies', () => {
    const shifts = Array.from({ length: 64 }, (_, i) => [Math.floor(i / 8) * 0.25, (i % 8) * 0.25] as const);

    /**
     * A lane 4 m wide between houses 8 m high, 120 m long at `angle` to the
     * lattice from (dx, 1 + dz), covered `cover(s)` high `s` metres along it,
     * a tunnel from OSM from `tunnel[0]` to `tunnel[1]` metres along it. The
     * rays leave 1.5 m either side.
     */
    const lane = (angle: number, [dx, dz]: readonly [number, number], cover: (s: number) => number, tunnel?: readonly [number, number]) => {
      const [ux, uz] = [Math.cos(angle), Math.sin(angle)];
      const [x0, z0] = [dx, 1 + dz];
      const along = (x: number, z: number) => (x - x0) * ux + (z - z0) * uz;
      const across = (x: number, z: number) => (z - z0) * ux - (x - x0) * uz;
      const cuts = tunnel ? [0, tunnel[0], tunnel[1], 120] : [0, 120];
      const segments = cuts.slice(1).map((end, i) => ({ length: end - cuts[i], tunnel: tunnel !== undefined && i === 1 }));
      const walls = () => segments.map((seg) => new Array<number>(Math.round(seg.length / corridorConfig.stationSpacing)).fill(1.5));
      const route: BandRoute = {
        points: cuts.map((s) => ({ x: x0 + s * ux, z: z0 + s * uz })),
        open: segments.map((seg) => !seg.tunnel),
        covered: segments.map((seg) => seg.tunnel),
        streetHalfWidth: segments.map(() => 1.5),
        wallLeft: walls(),
        wallRight: walls(),
      };
      const ground = columns((x, z) => (Math.abs(across(x, z)) >= 2 ? 8 : cover(along(x, z))));
      return { route, ground, along };
    };

    /** What covers the lane from `from` to `to`, and how many passages the band lists. */
    const covers: readonly { what: string; from: number; to: number; cover: (s: number) => number; tunnel?: readonly [number, number]; listed: number }[] = [
      { what: 'a jetty', from: 55.5, to: 58.5, cover: (s) => (s >= 55.5 && s <= 58.5 ? 5 : 0), listed: 1 },
      { what: 'a gate tower', from: 50, to: 62, cover: (s) => (s >= 50 && s <= 62 ? 20 : 0), listed: 1 },
      // In 747 the lane before the tower was covered 2.7 to 2.9 m over the street, 2.3 m at one station.
      {
        what: 'a vault whose soffit dips under roofRise for 2 m', from: 40, to: 52,
        cover: (s) => (s >= 40 && s <= 52 ? (s >= 45 && s < 47 ? 2.2 : 2.8) : 0), listed: 1,
      },
      // The mesh of a gate tower reaching past the mouth of its archway, the street open for 2 m before it: the
      // archway is longer, no passage of its own.
      { what: 'the mesh before an archway from OSM', from: 48, to: 58, cover: (s) => (s >= 48 && s < 56 ? 20 : 0), tunnel: [58, 64], listed: 0 },
    ];
    for (const { what, from, to, cover, tunnel, listed } of covers) {
      it(`runs one passage under ${what}, and the line runs through no cell on it outside the passage`, () => {
        for (const angle of [0, 0.5, Math.PI / 4]) {
          for (const shift of shifts) {
            const at = `angle ${angle.toFixed(2)} lattice ${shift.join(', ')}`;
            const { route, ground, along } = lane(angle, shift, cover, tunnel);
            const band = buildBand(route, ground, CELL, 'band');
            expect(band.passages, at).toHaveLength(listed);
            // Every station whose cell lies under the cover whatever the lattice is part of it, none two cells off it.
            const inside = CELL * Math.SQRT1_2;
            for (const st of band.stations) {
              const s = along(st.x, st.z);
              if (s >= from + inside && s <= to - inside) expect(st.kind, `${at} s ${s.toFixed(2)}`).toBe('passage');
              if ((s < from - 2 * CELL || s > to + 2 * CELL) && !route.covered[st.segment]) expect(st.kind, `${at} s ${s.toFixed(2)}`).not.toBe('passage');
            }
            // Every cell the line runs through outside the passage (claimSegmentCells) is on the street.
            const path = bandPath(route, band);
            for (let i = 0; i + 1 < path.length; i++) {
              if (path[i].passage) continue;
              const [a, b] = [path[i], path[i + 1]];
              for (let gx = Math.floor(Math.min(a.x, b.x) / CELL); gx <= Math.floor(Math.max(a.x, b.x) / CELL); gx++) {
                for (let gz = Math.floor(Math.min(a.z, b.z) / CELL); gz <= Math.floor(Math.max(a.z, b.z) / CELL); gz++) {
                  if (!segmentTouchesCell(CELL, a, b, gx, gz)) continue;
                  expect(ground((gx + 0.5) * CELL, (gz + 0.5) * CELL)!.ground, `${at} cell ${gx},${gz}`).toBeLessThanOrEqual(corridorConfig.roofRise);
                }
              }
            }
          }
        }
      });
    }
  });

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

  /**
   * Playtest 748: round the outside of a turn the band's edge runs round the
   * corner, metres longer than the route. Measured along the route alone, the
   * narrower street after a turn narrowed the wide one before it on the
   * outside, where it never comes near the other street's houses.
   */
  describe('turning between a wide and a narrower street', () => {
    /**
     * A street `first` m either side of its line from (1.3, 1.1), 60 m along
     * x to the joint, turning `deg` degrees towards +z (right of travel) into
     * one `second` m either side, 60 m on. Houses 8 m high beyond both, the
     * corner square; the rays stop `wallMargin` short of them, or at
     * `maxHalfWidth`.
     */
    const bend = (deg: number, first: number, second: number) => {
      const turn = (deg * Math.PI) / 180;
      const joint = { x: 61.3, z: 1.1 };
      const legs = [{ x: 1, z: 0 }, { x: Math.cos(turn), z: Math.sin(turn) }];
      const points = [{ x: 1.3, z: 1.1 }, joint, { x: joint.x + 60 * legs[1].x, z: joint.z + 60 * legs[1].z }];
      const inStreet = (x: number, z: number) => [[-Infinity, second, first], [-first, Infinity, second]].some(([from, to, half], i) => {
        const along = (x - joint.x) * legs[i].x + (z - joint.z) * legs[i].z;
        return along >= from && along <= to && Math.abs((z - joint.z) * legs[i].x - (x - joint.x) * legs[i].z) <= half;
      });
      const walls = (side: number) => [0, 1].map((i) => {
        const [a, b] = [points[i], points[i + 1]];
        return Array.from({ length: 30 }, (_, k) => {
          const x = a.x + (b.x - a.x) * ((k + 0.5) / 30);
          const z = a.z + (b.z - a.z) * ((k + 0.5) / 30);
          for (let m = 0.25; m <= corridorConfig.maxHalfWidth; m += 0.25) {
            if (!inStreet(x - side * legs[i].z * m, z + side * legs[i].x * m)) return m - corridorConfig.wallMargin;
          }
          return corridorConfig.maxHalfWidth;
        });
      });
      const route: BandRoute = { points, open: [true, true], covered: [false, false], streetHalfWidth: [first, second], wallLeft: walls(-1), wallRight: walls(1) };
      const cell = (v: number) => (Math.floor(v / CELL) + 0.5) * CELL;
      return { route, ground: columns((x, z) => (inStreet(cell(x), cell(z)) ? 0 : 8)) };
    };

    for (const deg of [30, 60, 90, -90]) {
      for (const [first, second] of [[7, 4], [4, 7]]) {
        it(`keeps the wide street's band out to its walls round the outside of a ${deg} degree turn, ${first} m then ${second} m`, () => {
          const { route, ground } = bend(deg, first, second);
          const band = buildBand(route, ground, CELL, 'band');
          const wide = first > second ? 0 : 1;
          const near = band.stations.filter((st) => st.segment === wide && Math.abs(st.s - 60) < 10);
          expect(near.length).toBeGreaterThan(3);
          // Turning right, the outside is left. Measured along the route alone the edge lay 1.25 to 2.25 m inside the
          // wall; the walk itself ends up to half a metre short of it, where the cells meet the square corner.
          for (const st of near) {
            const wall = (deg > 0 ? route.wallLeft : route.wallRight)[st.segment][st.k];
            const edge = deg > 0 ? -st.left : st.right;
            expect(edge, `${st.segment}:${st.k}`).toBeGreaterThanOrEqual(wall - 1);
          }
        });
      }
    }
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
