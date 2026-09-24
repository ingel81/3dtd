import type { Enemy } from '../../entities/enemy.entity';
import type { Tower } from '../../entities/tower.entity';
import type { RouteCell } from '../../utils/route-cell';
import type { RouteBodyStations } from '../../utils/route-body';

/** What BodyAim reads from the route grid (GlobalRouteGridService). */
export interface BodyAimGrid {
  getCellAt(localX: number, localZ: number): RouteCell | undefined;
  getGroundLocalYAt(localX: number, localZ: number): number | null;
  getGeneration(): number;
}

/** A tower's aim point on a body, see BodyAim.aim(). */
export interface BodyAimPoint {
  /** Geo, `height` on the ground */
  lat: number;
  lon: number;
  height: number;
  /** Local, `y` on the ground */
  x: number;
  y: number;
  z: number;
}

/**
 * The points of one path a tower could aim at, nearest first: per station
 * the point moved across the corridor toward the tower, within the lateral
 * limit so it lies in a route cell (route-corridor.ts), and only points in
 * range. Built once per tower, path and range.
 */
class TowerStationView {
  readonly station: Int32Array;
  readonly offset: Float64Array;
  readonly distSq: Float64Array;
  readonly x: Float64Array;
  readonly z: Float64Array;
  readonly cells: (RouteCell | undefined)[];
  /** Lowest and highest station in the view, for a quick miss */
  readonly minStation: number;
  readonly maxStation: number;

  constructor(
    readonly range: number,
    readonly generation: number,
    stations: RouteBodyStations,
    towerX: number,
    towerZ: number,
    grid: BodyAimGrid,
  ) {
    const rangeSq = range * range;
    const found: { k: number; offset: number; distSq: number; x: number; z: number }[] = [];
    for (let k = 0; k < stations.count; k++) {
      const dx = towerX - stations.x[k];
      const dz = towerZ - stations.z[k];
      const across = dx * stations.rightX[k] + dz * stations.rightZ[k];
      const limit = stations.lateralLimitAt(k, across);
      const offset = across < -limit ? -limit : across > limit ? limit : across;
      const x = stations.x[k] + stations.rightX[k] * offset;
      const z = stations.z[k] + stations.rightZ[k] * offset;
      const distSq = (towerX - x) ** 2 + (towerZ - z) ** 2;
      if (distSq <= rangeSq) found.push({ k, offset, distSq, x, z });
    }
    // Equal distances keep station order, so the pick does not depend on the sort
    found.sort((a, b) => a.distSq - b.distSq || a.k - b.k);

    const n = found.length;
    this.station = new Int32Array(n);
    this.offset = new Float64Array(n);
    this.distSq = new Float64Array(n);
    this.x = new Float64Array(n);
    this.z = new Float64Array(n);
    this.cells = new Array<RouteCell | undefined>(n);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < n; i++) {
      const p = found[i];
      this.station[i] = p.k;
      this.offset[i] = p.offset;
      this.distSq[i] = p.distSq;
      this.x[i] = p.x;
      this.z[i] = p.z;
      this.cells[i] = grid.getCellAt(p.x, p.z) ?? grid.getCellAt(stations.x[p.k], stations.z[p.k]);
      min = Math.min(min, p.k);
      max = Math.max(max, p.k);
    }
    this.minStation = min;
    this.maxStation = max;
  }

  get count(): number {
    return this.station.length;
  }
}

/**
 * Where towers shoot at enemies whose body lies along the route (the ooze,
 * RouteBody): at the point of the body nearest to the tower that is in its
 * range and sight. A body covers more of the route than a tower sees, so
 * the tip (`position`) is the wrong answer for most towers.
 *
 * TowerCombatService calls beginTower() for every tower while bodies are on
 * the map, then distSq() (Tower.findTarget) and aim(). Per tower and path
 * the candidate points are sorted once (TowerStationView); a resolve walks
 * them nearest first and stops at the first on the body that the tower
 * sees, by the tower's ground LOS of the cell under the point (its
 * LosMask). A point whose cell has no answer of the tower counts as not
 * seen, as for any other enemy (D2 in SIMULATOR_PLAN.md); there is no
 * raycast. Results are kept for the rest of the tower's turn, so
 * findTarget and the shot agree.
 */
export class BodyAim {
  private readonly views = new WeakMap<Tower, Map<RouteBodyStations, TowerStationView>>();

  // The tower whose turn it is, and what was resolved for it
  private tower: Tower | null = null;
  private towerX = 0;
  private towerZ = 0;
  private readonly resolvedEnemies: Enemy[] = [];
  private readonly resolvedIndex: number[] = [];
  private readonly resolvedViews: (TowerStationView | null)[] = [];

  constructor(private readonly grid: BodyAimGrid) {}

  /** Start `tower`'s turn: it stands at local (x, z). */
  beginTower(tower: Tower, x: number, z: number): void {
    this.tower = tower;
    this.towerX = x;
    this.towerZ = z;
    this.resolvedEnemies.length = 0;
    this.resolvedIndex.length = 0;
    this.resolvedViews.length = 0;
  }

  /** No tower's turn: nothing resolves until the next beginTower(). */
  endTurn(): void {
    this.tower = null;
  }

  /** Squared distance (m²) from the tower to its aim point on `enemy`, Infinity without one. */
  distSq(enemy: Enemy): number {
    const slot = this.resolve(enemy);
    if (slot < 0) return Infinity;
    const index = this.resolvedIndex[slot];
    return index < 0 ? Infinity : this.resolvedViews[slot]!.distSq[index];
  }

  /**
   * The tower's aim point on `enemy`, written into `out`, and the body's
   * hit put there (RouteBody.hit). False without one; `out` is then left.
   */
  aim(enemy: Enemy, out: BodyAimPoint): boolean {
    const slot = this.resolve(enemy);
    if (slot < 0 || this.resolvedIndex[slot] < 0) return false;
    const view = this.resolvedViews[slot]!;
    const i = this.resolvedIndex[slot];
    const body = enemy.body!;
    const st = body.stations;
    const k = view.station[i];
    const groundY = this.grid.getGroundLocalYAt(view.x[i], view.z[i])
      ?? enemy.transform.terrainHeight - st.originHeight;
    body.setHit(k, view.offset[i], groundY);
    out.lat = body.hit.lat;
    out.lon = body.hit.lon;
    out.height = body.hit.height;
    out.x = view.x[i];
    out.y = groundY;
    out.z = view.z[i];
    return true;
  }

  /**
   * The tower's aim point on `enemy`, local (ground height there), written
   * into `out` without putting the body's hit there, unlike aim(). For a
   * test that may not shoot (the manned tower's aim ray). False without one.
   */
  peekLocal(enemy: Enemy, out: { x: number; y: number; z: number }): boolean {
    const slot = this.resolve(enemy);
    if (slot < 0 || this.resolvedIndex[slot] < 0) return false;
    const view = this.resolvedViews[slot]!;
    const i = this.resolvedIndex[slot];
    out.x = view.x[i];
    out.y = this.grid.getGroundLocalYAt(view.x[i], view.z[i])
      ?? enemy.transform.terrainHeight - enemy.body!.stations.originHeight;
    out.z = view.z[i];
    return true;
  }

  /** Slot of `enemy` in this turn's results, resolving it first; -1 for an enemy without a body or turn. */
  private resolve(enemy: Enemy): number {
    const tower = this.tower;
    const body = enemy.body;
    if (tower === null || !body) return -1;
    for (let slot = 0; slot < this.resolvedEnemies.length; slot++) {
      if (this.resolvedEnemies[slot] === enemy) return slot;
    }

    const view = this.viewFor(tower, body.stations);
    const first = body.firstStation();
    const last = body.lastStation();
    let found = -1;
    if (view.count > 0 && last >= view.minStation && first <= view.maxStation) {
      for (let i = 0; i < view.count; i++) {
        const k = view.station[i];
        if (k < first || k > last) continue;
        if (view.cells[i]?.towerVisibility.get(tower.id) === true) {
          found = i;
          break;
        }
      }
    }

    this.resolvedEnemies.push(enemy);
    this.resolvedIndex.push(found);
    this.resolvedViews.push(view);
    return this.resolvedEnemies.length - 1;
  }

  /** The tower's view of `stations`, built again once its range or the grid's cells changed. */
  private viewFor(tower: Tower, stations: RouteBodyStations): TowerStationView {
    let byStations = this.views.get(tower);
    if (!byStations) {
      byStations = new Map();
      this.views.set(tower, byStations);
    }
    const range = tower.combat.range;
    const generation = this.grid.getGeneration();
    let view = byStations.get(stations);
    if (!view || view.range !== range || view.generation !== generation) {
      view = new TowerStationView(range, generation, stations, this.towerX, this.towerZ, this.grid);
      byStations.set(stations, view);
    }
    return view;
  }
}
