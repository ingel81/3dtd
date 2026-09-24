import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('three', () => ({
  Vector3: class {
    x = 0; y = 0; z = 0;
    constructor(x?: number, y?: number, z?: number) {
      this.x = x ?? 0;
      this.y = y ?? 0;
      this.z = z ?? 0;
    }
  },
}));

import { explainTowerTarget, TowerTargetConsole, type TowerTargetLookup } from './tower-target-console';
import { Tower } from '../../entities/tower.entity';
import { aimAt } from '../../entities/tower-aim';
import { Enemy } from '../../entities/enemy.entity';
import { GameEventBus } from '../../game-engine/game-event-bus';
import { METERS_PER_DEGREE_LAT as M } from '../../utils/geo-utils';
import type { RouteCell } from '../../utils/route-cell';
import type { RouteBody } from '../../utils/route-body';

// 100 m north; at the equator a degree of longitude is as long as one of latitude
const PATH = [
  { lat: 0, lon: 0, height: 0 },
  { lat: 100 / M, lon: 0, height: 0 },
];

/** A clump `s` metres along the path */
const clumpAt = (s: number): Enemy => new Enemy('slime-clump', PATH, undefined, 0, s / 100);

/** An Ice tower (range 60 m) `east` metres east of the path, level with `s` metres along it, its LOS resolved */
const iceAt = (s: number, east: number): Tower => {
  const tower = new Tower({ lat: s / M, lon: east / M, height: 0 }, 'ice');
  tower.losReady = true;
  return tower;
};

/** A route cell with `seen` as the tower's answer, none when undefined */
const cellSeenBy = (tower: Tower, seen: boolean | undefined): RouteCell =>
  ({ towerVisibility: new Map(seen === undefined ? [] : [[tower.id, seen]]) }) as unknown as RouteCell;

const lookup = (cell: RouteCell | undefined, isGridCell = (_cell: RouteCell) => true): TowerTargetLookup => ({
  cellOf: () => cell,
  isGridCell,
});

describe('explainTowerTarget', () => {
  it('leaves out a tower no enemy is near', () => {
    // 76 m away: past the range (60 m) and the candidate margin (66 m)
    expect(explainTowerTarget(iceAt(20, 15), [clumpAt(95)], lookup(undefined))).toBeNull();
  });

  it('names the target and what holds its fire: the cooldown and the turret', () => {
    const tower = iceAt(20, 15);
    const clump = clumpAt(20);
    expect(tower.findTarget([clump], false)).toBe(clump);
    tower.combat.fire();
    // The turret still turning to it
    aimAt(tower.aim, tower.aim.current + 1);

    expect(explainTowerTarget(tower, [clump], lookup(undefined))).toBe(
      `${tower.id} ice: target slime-clump ${clump.id} at 15.0 m, cooldown 3.0 s, turret not aligned`,
    );
  });

  it('without a target: asleep with the analysis behind it, LOS not resolved yet', () => {
    const tower = iceAt(20, 15);
    tower.isSleeping = true;
    expect(explainTowerTarget(tower, [clumpAt(20)], lookup(undefined))).toBe(
      `${tower.id} ice: no target, asleep, no candidate in visibleCells (1 near: 0 in cells it does not see, ` +
        '0 in cells without its LOS entry, 0 in cells it sees but missing from visibleCells, 1 off the grid; no entry and off the grid count as not visible)',
    );
    tower.losReady = false;
    expect(explainTowerTarget(tower, [clumpAt(20)], lookup(undefined))).toBe(`${tower.id} ice: no target, LOS not resolved yet`);
  });

  it('without a target: counts the visibleCells a rebuild of the grid replaced', () => {
    const tower = iceAt(20, 15);
    tower.isSleeping = true;
    const live = cellSeenBy(tower, true);
    tower.visibleCells = [cellSeenBy(tower, true), cellSeenBy(tower, true), live];
    // The clump stands in a cell of the new grid, which has no answer for the tower
    const rebuilt = cellSeenBy(tower, undefined);

    expect(explainTowerTarget(tower, [clumpAt(20)], lookup(rebuilt, (cell) => cell === live || cell === rebuilt))).toBe(
      `${tower.id} ice: no target, asleep, no candidate in visibleCells (1 near: 0 in cells it does not see, ` +
        '1 in cells without its LOS entry, 0 in cells it sees but missing from visibleCells, 0 off the grid; no entry and off the grid count as not visible), ' +
        '2 of 3 visibleCells not in the grid any more',
    );
  });

  it('without a target: what the cells under the clumps say for the tower', () => {
    const tower = iceAt(20, 15);
    const clumps = [clumpAt(10), clumpAt(20), clumpAt(30), clumpAt(40)];
    const cells = [cellSeenBy(tower, false), cellSeenBy(tower, undefined), cellSeenBy(tower, true), undefined];
    const cellOf = new Map(clumps.map((clump, i) => [clump, cells[i]]));

    expect(explainTowerTarget(tower, clumps, { cellOf: (enemy) => cellOf.get(enemy), isGridCell: () => true })).toBe(
      `${tower.id} ice: no target, no candidate in visibleCells (4 near: 1 in cells it does not see, ` +
        '1 in cells without its LOS entry, 1 in cells it sees but missing from visibleCells, 1 off the grid; no entry and off the grid count as not visible)',
    );
  });

  it('without a target: candidates only beyond its range, or in range and not taken yet', () => {
    const tower = iceAt(20, 15);
    const cell = cellSeenBy(tower, true);
    tower.visibleCells = [cell];
    // 62 m away: inside the candidate margin (66 m), past the range (60 m)
    const far = clumpAt(20 + Math.sqrt(62 ** 2 - 15 ** 2));

    expect(explainTowerTarget(tower, [far], lookup(cell))).toBe(
      `${tower.id} ice: no target, candidates only beyond its range (nearest 62.0 m of 60.0 m)`,
    );
    expect(explainTowerTarget(tower, [far, clumpAt(30)], lookup(cell))).toBe(
      `${tower.id} ice: no target, 2 candidate(s) in range not taken yet (nearest 18.0 m)`,
    );
  });
});

describe('TowerTargetConsole (__towerTargets)', () => {
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (globalThis as Record<string, unknown>)['__towerTargets'];
  });

  /** An Ice tower 15 m beside a clump in a cell it sees, and an ooze whose split hands that clump out */
  const setup = () => {
    const bus = new GameEventBus();
    const tower = iceAt(20, 15);
    const clump = clumpAt(20);
    const cell = cellSeenBy(tower, true);
    tower.visibleCells = [cell];
    const probe = new TowerTargetConsole({
      gameState: () =>
        ({
          towerManager: { getAllActive: () => [tower] },
          enemyManager: { getAlive: () => [clump] },
          getGlobalRouteGrid: () => ({ getCellAt: () => cell }),
          getEventBus: () => bus,
        }) as never,
      engineInit: {
        getEngine: () => ({ sync: { geoToLocalSimple: () => ({ x: 0, y: 0, z: 0 }) }, towers: {} }) as never,
      },
    });
    probe.install();
    const api = (globalThis as Record<string, unknown>)['__towerTargets'] as (() => string) & { watch: (on?: boolean) => string };
    const ooze = new Enemy('ooze', PATH);
    ooze.body = {} as RouteBody;
    const split = (enemy = ooze): void => bus.emit({ type: 'enemy:split', enemy, children: [clump] });
    return { tower, clump, probe, api, split, ooze };
  };

  const lines = (): unknown[] => log.mock.calls.map((call: unknown[]) => call[0]);

  it('logs nothing unless watching; watching, a line per tower near the clumps each second for 6 s after the split', () => {
    const { tower, probe, api, split, ooze } = setup();
    split();
    vi.advanceTimersByTime(3_000);
    expect(log).not.toHaveBeenCalled();

    api.watch();
    split();
    vi.advanceTimersByTime(999);
    expect(log).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(lines()).toEqual([
      `[TowerTargets] ${ooze.id} +1 s, 1 clump(s)`,
      `[TowerTargets] ${tower.id} ice: no target, 1 candidate(s) in range not taken yet (nearest 15.0 m)`,
    ]);
    vi.advanceTimersByTime(10_000);
    expect(log).toHaveBeenCalledTimes(12);

    api.watch(false);
    split();
    vi.advanceTimersByTime(3_000);
    expect(log).toHaveBeenCalledTimes(12);
    probe.uninstall();
    expect((globalThis as Record<string, unknown>)['__towerTargets']).toBeUndefined();
  });

  it('stops once the clumps are gone', () => {
    const { clump, api, split, ooze } = setup();
    api.watch();
    split();
    clump.health.takeDamage(clump.health.hp);
    vi.advanceTimersByTime(3_000);
    expect(lines()).toEqual([`[TowerTargets] ${ooze.id}: all clumps gone`]);
  });

  it('follows each ooze that breaks up for its own 6 s, the one before it included', () => {
    const { api, split, ooze } = setup();
    const second = new Enemy('ooze', PATH);
    second.body = {} as RouteBody;
    api.watch();
    split();
    vi.advanceTimersByTime(3_000);
    split(second);
    vi.advanceTimersByTime(3_000);
    const heads = (enemy: Enemy) => lines().filter((line) => String(line).startsWith(`[TowerTargets] ${enemy.id} +`));
    expect(heads(ooze)).toHaveLength(6);
    expect(heads(second)).toHaveLength(3);
    api.watch(false);
    vi.advanceTimersByTime(3_000);
    expect(heads(second)).toHaveLength(3);
  });

  it('__towerTargets() prints a table of the towers with an enemy near', () => {
    const table = vi.spyOn(console, 'table').mockImplementation(() => undefined);
    const { tower, api } = setup();
    expect(api()).toBe('1 tower(s) with an enemy near.');
    expect(table).toHaveBeenCalledWith([
      { tower: tower.id, why: 'no target, 1 candidate(s) in range not taken yet (nearest 15.0 m)', sleeping: false, visibleCells: 1 },
    ]);
  });
});
