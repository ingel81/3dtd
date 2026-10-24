import { heightAt } from '../../../map-ops/grid';
import { createMapDocument } from '../../custom-map/map-create';
import type { MapPaths } from '../../custom-map/map-document';
import type { OsmArea } from '../osm-parse';
import { FACE_OUT, placeRailWalls, TRACK_WALL_ASSET, WALL_MIN } from './rail-walls';
import type { RailPlan } from './rails-types';

/** A road along y = 0 (6 m wide) and a line along y = 12, the bed's ground `bed` metres over the road's */
function world(bed: number, areas: OsmArea[] = []) {
  const doc = createMapDocument({ id: 't', name: 't', width: 200, depth: 200, cellSize: 2, splatResolution: 128, starter: false });
  const t = doc.terrain;
  const g = t.grid;
  const levelled = new Uint8Array(g.columns * g.rows);
  for (let j = 0; j < g.rows; j++) {
    for (let i = 0; i < g.columns; i++) {
      const y = j * g.cellSize - 100;
      const k = j * g.columns + i;
      // The road's band and its verge at 0; past 6 m the bed's level (as levelBeds leaves it: one sample's step)
      g.heights[k] = y > 6 ? bed : 0;
      if (y > 6) levelled[k] = 1;
    }
  }
  const paths: MapPaths = {
    nodes: [
      { id: 'a', x: -90, y: 0 },
      { id: 'b', x: 90, y: 0 },
    ],
    edges: [{ id: 'e1', a: 'a', b: 'b', width: 6, kind: 'road', street: 'secondary' }],
  };
  const plan = {
    chains: [{ line: [{ x: -90, y: 12 }, { x: 90, y: 12 }], at: [0, 180], length: 180, nodes: [null, null], ways: [], profile: null }],
    crossings: [],
    bridges: [],
    overpasses: [],
    streets: [],
    tunnels: [],
    mouths: [],
  } as unknown as RailPlan;
  return { t, plan, paths, levelled: (k: number) => levelled[k] === 1, areas };
}

describe('OSM walls between a road and a bed', () => {
  it('stands a wall at the edge of a road under a bed, the ground behind it at the road, its shelf at the bed', () => {
    const w = world(3);
    const { objects, report } = placeRailWalls(w.t, w.plan, w.paths, w.levelled, { areas: w.areas });
    expect(report.pieces).toBeGreaterThan(0);
    expect(report.bedHigher).toBe(report.pieces);
    expect(objects.every((o) => o.asset === TRACK_WALL_ASSET)).toBe(true);
    // Its face at the road's edge (3 m and a hand), facing the road (model +z: map (-sin r, cos r))
    const o = objects[0];
    expect(o.y).toBeCloseTo(3.25, 1);
    expect(Math.cos(o.rotation)).toBeCloseTo(-1, 3);
    // The top at the bed's level, under its ballast
    expect(heightAt(w.t, o.x, o.y) + o.z).toBeCloseTo(3 - 0.05, 1);
    // The run as long as the road (less its ends), each piece stretched to its length
    expect(report.metres).toBeGreaterThan(150);
    // Behind the face the ground at the road's level: the low side is flat to the face
    expect(heightAt(w.t, 0, 4)).toBeCloseTo(0, 3);
    expect(heightAt(w.t, 0, 6)).toBeCloseTo(0, 3);
  });

  it('stands a wall out from a road over a bed in a cutting, facing the bed', () => {
    const w = world(-3);
    const { objects, report } = placeRailWalls(w.t, w.plan, w.paths, w.levelled, { areas: w.areas });
    expect(report.pieces).toBeGreaterThan(0);
    expect(report.bedHigher).toBe(0);
    const o = objects[0];
    expect(o.y).toBeCloseTo(3.25 + FACE_OUT, 1);
    expect(Math.cos(o.rotation)).toBeCloseTo(1, 3);
    expect(heightAt(w.t, o.x, o.y) + o.z).toBeCloseTo(-0.05, 1);
  });

  it('stands none under the step, on a car park, or away from a bed', () => {
    const low = world(WALL_MIN - 0.2);
    expect(placeRailWalls(low.t, low.plan, low.paths, low.levelled, { areas: [] }).objects).toEqual([]);
    const lot = world(3);
    const parking = { id: 1, tags: { amenity: 'parking' }, outer: [[{ x: -95, y: 2 }, { x: 95, y: 2 }, { x: 95, y: 9 }, { x: -95, y: 9 }]], inner: [], area: 1330 } as unknown as OsmArea;
    expect(placeRailWalls(lot.t, lot.plan, lot.paths, lot.levelled, { areas: [parking] }).objects).toEqual([]);
    const land = world(3);
    expect(placeRailWalls(land.t, land.plan, land.paths, () => false, { areas: [] }).objects).toEqual([]);
  });
});
