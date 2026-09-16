/**
 * Snapshots: the walkable band on the columns of corridor snapshots (playtest 748, utils/corridor-band.ts)
 *
 * Each fixture in fixtures/band is a stretch of a route cut from a corridor
 * snapshot (tmp/snapshots), as fixtures/band/README.md says: the route points
 * in the snapshot's local frame, the walls the clearance fitting gave, and the
 * columns buildBand reads there. On the band of 790bff72 the stations each
 * test names came out as in the snapshot, to 2 cm.
 *
 * Playtest 748: each station took the lowest cell across on its own. Where a
 * cell beside the street lay a little lower or an object stood between the
 * two sides, neighbouring stations laid their bands on different sides of it,
 * and the taper along the route cut each down to its backbone: 0 to 1.5 m
 * where every walk alone was 4 to 14 m wide (tmp/fix1/reports/cornerband.md).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BandColumn, BandRoute, BandStation, CorridorBand, bandPath, buildBand } from '../utils/corridor-band';
import { corridorConfig } from '../utils/route-corridor';
import { segmentTouchesCell } from '../utils/route-grid-builder';

/** A fixture as fixtures/band/README.md describes it, the fields the tests read. */
interface Fixture {
  stations: [number, number];
  first: number;
  cellSize: number;
  route: {
    points: [number, number][];
    open: boolean[];
    covered: boolean[];
    streetHalfWidth: number[];
    wallLeft: number[][];
    wallRight: number[][];
  };
  columns: [number, number, number, number][];
}

interface Stretch {
  route: BandRoute;
  /** The column of lattice cell (gx, gz), null without one. */
  column: (gx: number, gz: number) => BandColumn | null;
  cellSize: number;
  band: CorridorBand;
  /** The stations the fixture names by their index in the snapshot. */
  named: (from: number, to: number) => BandStation[];
}

function stretch(name: string): Stretch {
  const fixture = JSON.parse(readFileSync(join('src', 'app', 'integration', 'fixtures', 'band', `${name}.json`), 'utf-8')) as Fixture;
  const route: BandRoute = { ...fixture.route, points: fixture.route.points.map(([x, z]) => ({ x, z })) };
  const cells = new Map(fixture.columns.map(([gx, gz, ground, top]) => [`${gx},${gz}`, { ground, top }]));
  const column = (gx: number, gz: number) => cells.get(`${gx},${gz}`) ?? null;
  const size = fixture.cellSize;
  const band = buildBand(route, (x, z) => column(Math.floor(x / size), Math.floor(z / size)), size);
  return {
    route,
    column,
    cellSize: size,
    band,
    named: (from, to) => band.stations.slice(from - fixture.first, to - fixture.first + 1),
  };
}

const at = (st: BandStation) => `${st.segment}:${st.k}`;

/**
 * No station narrower than 2.5 m, each overlapping the one before by at least
 * `edgeMargin`, and the OSM line, which runs on the street at these stations,
 * inside each band.
 */
function expectOneWideBand(stations: readonly BandStation[]): void {
  stations.forEach((st, i) => {
    expect(st.right - st.left, at(st)).toBeGreaterThanOrEqual(2.5);
    expect(st.left, at(st)).toBeLessThanOrEqual(0);
    expect(st.right, at(st)).toBeGreaterThanOrEqual(0);
    const before = stations[i - 1];
    if (before) expect(Math.min(before.right, st.right) - Math.max(before.left, st.left), at(st)).toBeGreaterThanOrEqual(corridorConfig.edgeMargin);
  });
}

/** The cells the enemies' line runs through on the pieces from or to one of `stations` (claimSegmentCells). */
function lineCells(s: Stretch, stations: readonly BandStation[]): { gx: number; gz: number }[] {
  const path = bandPath(s.route, s.band);
  const cells = new Map<string, { gx: number; gz: number }>();
  for (let i = 0; i + 1 < path.length; i++) {
    const [a, b] = [path[i], path[i + 1]];
    const near = (p: { x: number; z: number }) => stations.some((st) => Math.hypot(st.x + st.rx * st.centre - p.x, st.z + st.rz * st.centre - p.z) < 1e-6);
    if (!near(a) && !near(b)) continue;
    for (let gx = Math.floor(Math.min(a.x, b.x) / s.cellSize); gx <= Math.floor(Math.max(a.x, b.x) / s.cellSize); gx++) {
      for (let gz = Math.floor(Math.min(a.z, b.z) / s.cellSize); gz <= Math.floor(Math.max(a.z, b.z) / s.cellSize); gz++) {
        if (segmentTouchesCell(s.cellSize, a, b, gx, gz)) cells.set(`${gx},${gz}`, { gx, gz });
      }
    }
  }
  return [...cells.values()];
}

/**
 * The line runs through no cell whose column shows a low object over a
 * hollow (a hedge, a car, a post): its top more than `stepRise` and at most
 * `roofRise` over its ground, as the band's walk judges it.
 */
function expectLineOffObjects(s: Stretch, stations: readonly BandStation[]): void {
  for (const { gx, gz } of lineCells(s, stations)) {
    const column = s.column(gx, gz);
    if (column === null) continue;
    const over = column.top - column.ground;
    expect(over > corridorConfig.stepRise && over <= corridorConfig.roofRise, `cell ${gx},${gz} ${over.toFixed(2)} m`).toBe(false);
  }
}

describe('the walkable band on the columns of corridor snapshots (playtest 748)', () => {
  /*
   * Stuttgart, Königstraße into the bend at the Schlossplatz: a verge under a
   * hedge on the west side lay 0.46 m under the street, and station 188 took
   * it; a post stood in the mouth of the next street, and 192 laid its band
   * north of it. 189 had 0.00 m, 190 0.10 m.
   */
  it('Stuttgart, 179 to 199: one band on the street through the bend, the hedge still ends 187', () => {
    const s = stretch('stuttgart-748');
    const stations = s.named(179, 199);
    expectOneWideBand(stations);
    expectLineOffObjects(s, stations);
    // Nor along the verge under the hedge, 298.72 m against 299.14 to 299.27 m on the street round the bend.
    const verge = lineCells(s, stations).filter(({ gx, gz }) => gx === 63 && (gz === 77 || gz === 79));
    expect(verge).toEqual([]);
    // The rays stopped at the hedge 2.5 m right of 187: its band ends there.
    expect(s.named(187, 187)[0].right).toBeCloseTo(2, 6);
  });

  /* Berlin, Platz der Republik: a low hollow object between the two sides of the path, the backbones either side. */
  it('Berlin, 155 to 163: one band beside the object between the two sides', () => {
    const s = stretch('berlin-748');
    const stations = s.named(155, 163);
    expectOneWideBand(stations);
    expectLineOffObjects(s, stations);
  });

  /* Paris, Place de Varsovie: a row of hollow cells, the ground behind it 3 cm lower, 65 and 66 took it. */
  it('Paris, 60 to 66: one band on the near side of the row of objects', () => {
    const s = stretch('paris-748');
    const stations = s.named(60, 66);
    expectOneWideBand(stations);
    expectLineOffObjects(s, stations);
  });

  /*
   * Narrow where the rays leave no more room: low obstacles either side of a
   * lane in Rothenburg (the rays free for 1.6 to 1.8 m, `minHalfWidth` left),
   * one left of the street in Stuttgart.
   */
  it('keeps the band narrow where the walls leave no more room', () => {
    for (const st of stretch('rothenburg-narrow').named(91, 94)) {
      expect(st.left, at(st)).toBe(-corridorConfig.minHalfWidth);
      expect(st.right, at(st)).toBe(corridorConfig.minHalfWidth);
    }
    for (const st of stretch('stuttgart-narrow').named(93, 94)) expect(st.left, at(st)).toBe(-corridorConfig.minHalfWidth);
  });
});
