/**
 * TowerLos as request and answer: a second need while one waits asks again
 * with a new generation, only the answer to the latest applies, a logged
 * mask without a generation still answers, and the generations go through
 * a snapshot.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GameEventBus } from '../../game-engine/game-event-bus';
import { TowerLos } from './tower-los';
import { TOWER_TYPES } from '../../configs/tower-types.config';
import type { GlobalRouteGridService } from '../../services/world/global-route-grid.service';
import type { SimCoords } from '../../sim/core/sim-coords';
import type { Tower } from '../../entities/tower.entity';
import type { LosMask } from '../../utils/los-mask';

const MASK = {} as LosMask;

function tower(id: string): Tower {
  return {
    id,
    ownerId: 'local',
    typeConfig: TOWER_TYPES['dual-gatling'],
    position: { lat: 48.1, lon: 9.1, height: 0 },
    combat: { range: TOWER_TYPES['dual-gatling'].range },
    losReady: false,
    losMask: null,
    visibleCells: [],
  } as unknown as Tower;
}

describe('TowerLos', () => {
  let bus: GameEventBus;
  let los: TowerLos;
  let air: boolean;
  let needed: { towerId: string; reason: string; generation: number; range: number; canTargetAir: boolean }[];
  let resolved: string[];

  beforeEach(() => {
    bus = new GameEventBus();
    air = false;
    const grid = {
      isInitialized: () => true,
      unregisterTower: vi.fn(),
      applyLosMask: vi.fn(() => []),
    } as unknown as GlobalRouteGridService;
    const coords = { sync: { geoToLocalSimple: () => ({ x: 0, y: 0, z: 0 }) } } as unknown as SimCoords;
    los = new TowerLos(grid, coords, bus, () => air);
    needed = [];
    resolved = [];
    bus.on('tower:los-needed', (e) => needed.push(e));
    bus.on('tower:los-resolved', (e) => resolved.push(`${e.towerId}:${e.reason}`));
  });

  it('asks again when the range grows before the first answer, and takes only the answer to that', () => {
    const t = tower('tower-1');
    los.register(t);
    t.combat.range *= 1.5;
    los.recompute(t, 'upgrade');

    expect(needed.map((e) => [e.reason, e.generation, e.range])).toEqual([
      ['place', 1, TOWER_TYPES['dual-gatling'].range],
      // Never had its sight: still all of it, with the range it has now
      ['place', 2, TOWER_TYPES['dual-gatling'].range * 1.5],
    ]);
    // The answer rendered for the first request no longer counts
    expect(los.applyMask(t, MASK, 1)).toBe(false);
    expect(los.isAwaiting(t)).toBe(true);
    expect(t.losReady).toBe(false);
    expect(los.applyMask(t, MASK, 2)).toBe(true);
    expect(t.losReady).toBe(true);
    expect(resolved).toEqual(['tower-1:place']);
  });

  it('asks again with air for an air retrofit that comes while an upgrade waits', () => {
    const t = tower('tower-1');
    los.register(t);
    los.applyMask(t, MASK, 1);
    los.recompute(t, 'upgrade');
    air = true;
    los.recompute(t, 'retrofit');

    expect(needed.slice(1).map((e) => [e.reason, e.generation, e.canTargetAir])).toEqual([
      ['upgrade', 2, false],
      ['retrofit', 3, true],
    ]);
    expect(los.applyMask(t, MASK, 2)).toBe(false);
    expect(los.applyMask(t, MASK, 3)).toBe(true);
    expect(resolved).toEqual(['tower-1:place', 'tower-1:retrofit']);
  });

  it('lets a mask without a generation (a log from before) answer what waits', () => {
    const t = tower('tower-1');
    los.register(t);
    los.recompute(t, 'upgrade');
    expect(los.applyMask(t, MASK)).toBe(true);
    expect(los.isAwaiting(t)).toBe(false);
  });

  it('keeps generations and the counter through a snapshot, and asks with them on a live restore', () => {
    const a = tower('tower-1');
    const b = tower('tower-2');
    los.register(a);
    los.register(b);
    los.recompute(a, 'upgrade');
    const entries = los.awaitingEntries();
    const next = los.generation;
    expect(entries).toEqual([['tower-1', 'place', 3], ['tower-2', 'place', 2]]);

    const fresh = new TowerLos(
      { isInitialized: () => true, unregisterTower: vi.fn(), applyLosMask: vi.fn(() => []) } as unknown as GlobalRouteGridService,
      { sync: { geoToLocalSimple: () => ({ x: 0, y: 0, z: 0 }) } } as unknown as SimCoords,
      bus,
      () => false,
    );
    needed = [];
    fresh.restoreAwaiting(entries.map(([id, why, gen]) => [id === 'tower-1' ? a : b, why, gen] as const), next, true);
    expect(needed.map((e) => [e.towerId, e.generation])).toEqual([['tower-1', 3], ['tower-2', 2]]);
    expect(fresh.generation).toBe(next);
    // The host's answer for the latest request applies on the restored client
    expect(fresh.applyMask(a, MASK, 3)).toBe(true);
  });

  it('asks again for every waiting tower with the same generation (announceAwaiting)', () => {
    const t = tower('tower-1');
    los.register(t);
    needed = [];
    los.announceAwaiting();
    expect(needed.map((e) => [e.towerId, e.generation])).toEqual([['tower-1', 1]]);
  });
});
