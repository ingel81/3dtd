/**
 * Snapshots: the leg to the HQ on the columns of corridor snapshots (utils/carried-height.ts)
 *
 * Playtest 2026-09-16: at Audi NSU Neckarsulm and at Erlenbach BBH the cells
 * of the last metres to the HQ stood on the roof of the HQ's building, the
 * red line ran up its facade, and enemies walked into the house and came out
 * through the roof. Each fixture in fixtures/hq-leg is the end of the route
 * cut from the corridor snapshot the user took there (fixtures/hq-leg/README.md):
 * the last street segment, the leg and the cells within 30 m of the HQ with
 * the height the game gave them and the column it read.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RouteWaypoint } from '../models/game.types';
import type { ColumnSample } from '../three-engine/column-sample';
import { CARRY_STEP_RISE_M } from '../utils/carried-height';
import { GlobalRouteGrid } from '../utils/global-route-grid';
import { corridorConfig } from '../utils/route-corridor';

/** A fixture as fixtures/hq-leg/README.md describes it. */
interface Fixture {
  cellSize: number;
  route: { points: [number, number][]; offStreet: boolean[]; left: number[]; right: number[] };
  streetY: number;
  cells: [x: number, z: number, heightM: number, ground: number, top: number][];
}

const load = (name: string): Fixture =>
  JSON.parse(readFileSync(join('src', 'app', 'integration', 'fixtures', 'hq-leg', `${name}.json`), 'utf-8')) as Fixture;

/** The route cells of the fixture's route over the fixture's columns: the column of the cell a point lies in. */
function build(fixture: Fixture): GlobalRouteGrid {
  const size = fixture.cellSize;
  const columns = new Map(fixture.cells.map(([x, z, , ground, top]) => [`${x},${z}`, { ground, top }]));
  const column = (x: number, z: number): ColumnSample | null => {
    const hit = columns.get(`${(Math.floor(x / size) + 0.5) * size},${(Math.floor(z / size) + 0.5) * size}`);
    return hit ? { groundY: hit.ground, topY: hit.top, tileDepth: 25, tileGeometricError: 2 } : null;
  };
  const { points, offStreet, left, right } = fixture.route;
  const waypoints = points.map(([x, z], i): RouteWaypoint => (i < points.length - 1
    ? { lat: z, lon: x, corridorLeft: left[i], corridorRight: right[i], ...(offStreet[i] ? { offStreet: true } : {}) }
    : { lat: z, lon: x }));
  const grid = new GlobalRouteGrid();
  grid.initialize(column as never, { geoToLocalSimple: (lat: number, lon: number) => ({ x: lon, y: 0, z: lat }) } as never);
  grid.generateFromRoutes([waypoints]);
  return grid;
}

describe('the leg to the HQ on the columns of corridor snapshots (playtest 2026-09-16)', () => {
  for (const [name, place] of [['neckarsulm-audi', 'Audi NSU Neckarsulm'], ['erlenbach-bbh', 'Erlenbach BBH']] as const) {
    it(`${place}: runs the leg into the building at the street's level, where the snapshot had its cells on the roof`, () => {
      const fixture = load(name);
      const grid = build(fixture);
      const street = fixture.streetY;
      // Within 4 m of the leg: the street before it climbs past its level further off.
      const [[ax, az], [bx, bz]] = fixture.route.points.slice(1);
      const offLeg = (x: number, z: number) => {
        const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / ((bx - ax) ** 2 + (bz - az) ** 2)));
        return Math.hypot(ax + (bx - ax) * t - x, az + (bz - az) * t - z);
      };
      const onRoof = fixture.cells.filter(([x, z, heightM]) => offLeg(x, z) <= 4 && heightM - street > corridorConfig.roofRise);
      expect(onRoof.length, 'cells on the roof in the snapshot').toBeGreaterThan(2);

      // The cells the snapshot had on the roof, the HQ's among them, where the red line ends: at the street's level.
      const claimed = onRoof.filter(([x, z]) => grid.getCellAt(x, z)?.heightSampled);
      expect(claimed.length).toBe(onRoof.length);
      for (const [x, z, heightM] of claimed) {
        const y = grid.getCellAt(x, z)!.terrainHeight;
        expect(Math.abs(y - street), `${x},${z}: ${y}, in the snapshot ${heightM}`).toBeLessThanOrEqual(CARRY_STEP_RISE_M);
      }
      expect(Math.abs(grid.getGroundLocalYAt(0, 0)! - street)).toBeLessThanOrEqual(CARRY_STEP_RISE_M);
      // And every other cell of the leg.
      const legCells = grid.getCellsInRange(0, 0, 40).filter((c) => c.surface === 'approach' && c.heightSampled);
      expect(legCells.length).toBeGreaterThan(5);
      for (const cell of legCells) {
        expect(Math.abs(cell.terrainHeight - street), `${cell.x},${cell.z}`).toBeLessThanOrEqual(CARRY_STEP_RISE_M);
      }
    });

    it(`${place}: leaves the cells of the street before the leg as the snapshot had them`, () => {
      const fixture = load(name);
      const grid = build(fixture);
      const heights = new Map(fixture.cells.map(([x, z, heightM]) => [`${x},${z}`, heightM]));
      // The street's cells the snapshot has a column for; the fixture's half widths are the narrowest of each segment's band.
      const ground = grid.getCellsInRange(0, 0, 40).filter((c) => c.surface === 'ground' && c.sample.state === 'stable');
      expect(ground.length).toBeGreaterThan(5);
      for (const cell of ground) expect(cell.terrainHeight, `${cell.x},${cell.z}`).toBeCloseTo(heights.get(`${cell.x},${cell.z}`)!, 6);
    });
  }
});
