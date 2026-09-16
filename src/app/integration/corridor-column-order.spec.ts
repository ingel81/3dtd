/**
 * Integration Test: the cells of a corridor build read the same heights,
 * whatever sampled the columns before them
 *
 * Playtest 2026-09-16, Tokyo (PLAYTEST 745): one session gave three
 * corridors, a cold load, a location change in game and `__corridor.reset()`,
 * with the same stations, cells and tile depth and error under every column,
 * and different heights. A second reset changed nothing.
 *
 * The three differ in what may sample columns between the build emptying the
 * column cache and the cells reading it (CorridorBuild, steps 2 to 4): a cold
 * load measures every station there; a reset reuses the stored measurements
 * and measures none (`clearance.start stations=0`); on a location change a
 * settled tile batch can land between two measuring slices and have the
 * street overlay sample its heights (VisualizationFacadeService.onTilesLoaded).
 * The cache used to hold what the point of its first caller showed. Now a
 * station casts its columns past the cache (measureStreetClearance), and
 * every cached column stands at the centre of its bucket (columnCentre).
 *
 * Real: TerrainQueries with its column cache, GlobalRouteGrid and its cell
 * sampler, and the ray path of 3d-tiles-renderer (LibraryTiles). Synthetic:
 * the tiles, an uneven 2.5D mesh cut into 5 m tiles of the finest LOD.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { BufferGeometry, DoubleSide, Float32BufferAttribute, Mesh, MeshBasicMaterial } from 'three';
import { LibraryTiles } from '../../test/library-tiles-fixture';
import { TerrainQueries } from '../three-engine/terrain-queries';
import type { EllipsoidSync } from '../three-engine/ellipsoid-sync';
import { GlobalRouteGrid } from '../utils/global-route-grid';
import { DEG_TO_RAD, METERS_PER_DEGREE_LAT } from '../utils/geo-utils';
import { corridorConfig, resetCorridorConfig } from '../utils/route-corridor';
import type { RouteWaypoint } from '../models/game.types';

afterEach(() => resetCorridorConfig());

/** The street: eastbound along z = 1.15 from x = 0.2 to 40.2, 3 m either side. */
const LINE_Z = 1.15;
const LENGTH = 40;
const START_X = 0.2;
/** One station every 2 m, 0.2 m east of a cell centre: its column lies in the cache bucket of that cell's. */
const STATIONS = 20;

/** Ground bumps of 0.15 m, a few centimetres apart within one column cache bucket. */
const ground = (x: number, z: number) => 0.15 * Math.sin(3 * x) * Math.sin(2.5 * z + 1);

const material = new MeshBasicMaterial({ side: DoubleSide });

/** 0.25 m between vertices, 20 quads a tile; the lattice lies off the cell centres. */
const STEP = 0.25;
const QUADS = 20;

/** The mesh of `ground` as tiles of the finest LOD, x -4.4 to 45.6 and z -8.9 to 11.1. */
function tiles(): LibraryTiles {
  const built = new LibraryTiles();
  for (let tx = 0; tx < 10; tx++) {
    for (let tz = 0; tz < 4; tz++) {
      const x0 = -4.4 + tx * QUADS * STEP;
      const z0 = -8.9 + tz * QUADS * STEP;
      const positions: number[] = [];
      for (let j = 0; j <= QUADS; j++) {
        for (let i = 0; i <= QUADS; i++) positions.push(x0 + i * STEP, ground(x0 + i * STEP, z0 + j * STEP), z0 + j * STEP);
      }
      const index: number[] = [];
      for (let j = 0; j < QUADS; j++) {
        for (let i = 0; i < QUADS; i++) {
          const a = j * (QUADS + 1) + i;
          index.push(a, a + QUADS + 1, a + 1, a + 1, a + QUADS + 1, a + QUADS + 2);
        }
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
      geometry.setIndex(index);
      built.add(new Mesh(geometry, material), 3, 2);
    }
  }
  return built;
}

const ORIGIN = { lat: 48.776, lon: 9.183 };
const M_PER_DEG_LON = METERS_PER_DEGREE_LAT * Math.cos(ORIGIN.lat * DEG_TO_RAD);
/** The flat projection EllipsoidSync.geoToLocalSimple uses: x east, z south. */
const sync = {
  geoToLocalSimple: (lat: number, lon: number, height: number) => ({
    x: (lon - ORIGIN.lon) * M_PER_DEG_LON,
    y: height,
    z: -(lat - ORIGIN.lat) * METERS_PER_DEGREE_LAT,
  }),
};
const geo = (x: number, z: number) => ({ lat: ORIGIN.lat - z / METERS_PER_DEGREE_LAT, lon: ORIGIN.lon + x / M_PER_DEG_LON });
const at = (x: number, z: number): RouteWaypoint => ({ ...geo(x, z), corridorLeft: 3, corridorRight: 3 });

/** Every station of the street measured, as a cold load's build does before the cells. */
function measureStations(queries: TerrainQueries): void {
  for (let k = 0; k < STATIONS; k++) {
    queries.measureStreetClearance(
      START_X + 2 * k + 1, LINE_Z, 0, 1,
      [corridorConfig.rayHeightLow, corridorConfig.rayHeightHigh], corridorConfig.maxHalfWidth,
    );
  }
}

/** The street overlay's heights at a node every 4 m, as a settled tile batch has it sample them (renderStreets). */
function streetHeights(queries: TerrainQueries): void {
  for (let x = START_X + 0.95; x < START_X + LENGTH; x += 4) {
    const node = geo(x, LINE_Z);
    const prev = geo(x - 4, LINE_Z);
    const next = geo(x + 4, LINE_Z);
    queries.getGroundHeightEstimate(node.lat, node.lon, prev.lat, prev.lon, next.lat, next.lon);
  }
}

/** One build over the same tiles: the column cache emptied, `before` sampling first, then the cells; their heights. */
function build(queries: TerrainQueries, before: (queries: TerrainQueries) => void): string[] {
  queries.clearHeightCache();
  before(queries);
  const grid = new GlobalRouteGrid();
  grid.initialize((x, z) => queries.sampleColumn(x, z), sync as never);
  grid.generateFromRoutes([[at(START_X, LINE_Z), at(START_X + LENGTH, LINE_Z)]]);
  return grid
    .dumpCellsInBox({ xMin: -Infinity, xMax: Infinity, zMin: -Infinity, zMax: Infinity })
    .map((cell) => `${cell.x},${cell.z}:${cell.terrainHeight}`)
    .sort();
}

describe('The cells of a corridor build, PLAYTEST 745', () => {
  it('get the same heights whether the stations were measured first, nothing was, or the street overlay was', () => {
    const world = tiles();
    const queries = new TerrainQueries(sync as unknown as EllipsoidSync, { tiles: () => world.renderer, devTerrain: () => null });

    const coldLoad = build(queries, measureStations);
    const reset = build(queries, () => undefined);
    const tileBatchBetweenSlices = build(queries, (q) => {
      streetHeights(q);
      measureStations(q);
    });

    expect(coldLoad.length).toBeGreaterThan(60);
    expect(reset).toEqual(coldLoad);
    expect(tileBatchBetweenSlices).toEqual(coldLoad);
  });
});
