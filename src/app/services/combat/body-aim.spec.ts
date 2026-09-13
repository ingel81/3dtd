import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Vector3 } from 'three';
import { BodyAim, type BodyAimGrid, type BodyAimPoint } from './body-aim';
import { Tower } from '../../entities/tower.entity';
import type { Enemy } from '../../entities/enemy.entity';
import type { RouteCell } from '../../utils/route-cell';
import { METERS_PER_DEGREE_LAT } from '../../utils/geo-utils';
import { RouteBody, RouteBodyStations } from '../../utils/route-body';
import { lateralLimit } from '../../utils/route-corridor';

// At the equator a degree of longitude is as long as one of latitude
const flatSync = {
  geoToLocalSimpleInto: (lat: number, lon: number, height: number, target: Vector3): Vector3 =>
    target.set(lon * METERS_PER_DEGREE_LAT, height, -lat * METERS_PER_DEGREE_LAT),
};
// 200 m north, 3 m of corridor to each side
const stations = new RouteBodyStations(
  [
    { lat: 0, lon: 0, corridorLeft: 3, corridorRight: 3 },
    { lat: 200 / METERS_PER_DEGREE_LAT, lon: 0, corridorLeft: 3, corridorRight: 3 },
  ],
  flatSync,
  100,
);
/** Tower 15 m east of the route, level with station 50 (s = 100 m along the route). */
const TOWER_X = 15;
const TOWER_Z = stations.z[50];
/** Squared distance from the tower to the aim point on station `k`. */
const distSqTo = (k: number): number => (TOWER_X - LATERAL) ** 2 + (TOWER_Z - stations.z[k]) ** 2;
/** How far an aim point may lie off the centre line: inside the route cells */
const LATERAL = lateralLimit(3);

function oozeBetween(tail: number, tip: number): Enemy {
  const body = new RouteBody(stations);
  body.tailM = tail;
  body.tipM = tip;
  return { id: 'ooze', alive: true, body, transform: { terrainHeight: 101 } } as unknown as Enemy;
}

const point = (): BodyAimPoint => ({ lat: 0, lon: 0, height: 0, x: 0, y: 0, z: 0 });

describe('BodyAim', () => {
  let cells: Map<string, RouteCell>;
  let generation: number;
  let grid: BodyAimGrid;
  let tower: Tower;
  let aim: BodyAim;

  /** The cell under local (x, z), created on first use; the tower sees it. */
  function cellAt(x: number, z: number): RouteCell {
    const key = `${Math.floor(x / 2)},${Math.floor(z / 2)}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = { towerVisibility: new Map([[tower.id, true]]) } as unknown as RouteCell;
      cells.set(key, cell);
    }
    return cell;
  }

  beforeEach(() => {
    cells = new Map();
    generation = 1;
    grid = {
      getCellAt: (x, z) => cellAt(x, z),
      getGroundLocalYAt: () => 2,
      getGeneration: () => generation,
    };
    tower = new Tower({ lat: 0, lon: 0, height: 0 }, 'archer');
    tower.combat.range = 30;
    aim = new BodyAim(grid);
    aim.beginTower(tower, TOWER_X, TOWER_Z, null);
  });

  it('aims at the point of the body nearest to the tower, moved toward it inside the cells', () => {
    const ooze = oozeBetween(0, 200);
    expect(aim.distSq(ooze)).toBeCloseTo(distSqTo(50), 9);

    const out = point();
    expect(aim.aim(ooze, out)).toBe(true);
    expect(out.x).toBeCloseTo(LATERAL, 6);
    expect(out.z).toBeCloseTo(TOWER_Z, 9);
    expect(out.y).toBe(2);
    // The hit goes there, on the ground, in geo
    expect(ooze.body!.hit.lon * METERS_PER_DEGREE_LAT).toBeCloseTo(LATERAL, 6);
    expect(-ooze.body!.hit.lat * METERS_PER_DEGREE_LAT).toBeCloseTo(TOWER_Z, 6);
    expect(ooze.body!.hit.height).toBe(102);
    expect(out.height).toBe(102);
  });

  it('only aims at what lies between tail and tip', () => {
    const behind = oozeBetween(120, 200);
    expect(aim.distSq(behind)).toBeCloseTo(distSqTo(60), 9);

    aim.beginTower(tower, TOWER_X, TOWER_Z, null);
    expect(aim.distSq(oozeBetween(140, 200))).toBe(Infinity); // 40 m ahead, out of range
    expect(aim.aim(oozeBetween(140, 200), point())).toBe(false);
  });

  it('skips points the tower does not see', () => {
    cellAt(LATERAL, TOWER_Z).towerVisibility.set(tower.id, false);
    const ooze = oozeBetween(0, 200);
    // A station 2 m along, both neighbours are as far
    expect(aim.distSq(ooze)).toBeCloseTo(distSqTo(49), 9);
  });

  it('raycasts a point without an answer of the tower, at most a few per resolve', () => {
    for (const cell of cells.values()) cell.towerVisibility.clear();
    const hasLineOfSight = vi.fn(() => false);
    aim.beginTower(tower, TOWER_X, TOWER_Z, { hasLineOfSight });
    grid.getCellAt = (x, z) => {
      const cell = cellAt(x, z);
      cell.towerVisibility.clear();
      return cell;
    };
    generation++; // new cells, new view

    expect(aim.distSq(oozeBetween(0, 200))).toBe(Infinity);
    expect(hasLineOfSight).toHaveBeenCalledTimes(4);
    expect(hasLineOfSight.mock.calls[0]).toEqual([tower.id, expect.closeTo(LATERAL, 6), 3.5, expect.closeTo(TOWER_Z, 9)]);
  });

  it('keeps a resolve for the rest of the tower turn and starts over with the next', () => {
    const ooze = oozeBetween(0, 200);
    const first = aim.distSq(ooze);
    ooze.body!.tailM = 150; // the tail passed the tower in between
    expect(aim.distSq(ooze)).toBe(first);

    aim.beginTower(tower, TOWER_X, TOWER_Z, null);
    expect(aim.distSq(ooze)).toBe(Infinity);
  });

  it('builds the view again once the range grew', () => {
    const ahead = oozeBetween(140, 200);
    expect(aim.distSq(ahead)).toBe(Infinity);

    tower.combat.range = 50;
    aim.beginTower(tower, TOWER_X, TOWER_Z, null);
    expect(aim.distSq(ahead)).toBeCloseTo(distSqTo(70), 9);
  });

  it('has nothing for an enemy without a body or before a tower turn', () => {
    const zombie = { id: 'z', body: null } as unknown as Enemy;
    expect(aim.distSq(zombie)).toBe(Infinity);
    expect(new BodyAim(grid).distSq(oozeBetween(0, 200))).toBe(Infinity);
  });
});
