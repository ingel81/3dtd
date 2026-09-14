/**
 * Playtest 352, 353 and 362 (night 2026-09-14): what the boss bar at the top
 * says for the worm and the ooze. The component as it runs, fed over the
 * event bus by the real EnemyManager (rendering mocked); its 8 Hz poll runs
 * on fake timers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('three', async () => {
  const mod = await import('@/test/mocks/three.mock');
  return { ...mod };
});

import { DestroyRef, Injector, NgZone, runInInjectionContext } from '@angular/core';
import { BossBarComponent } from './boss-bar.component';
import { GameStateManager } from '../../managers/game-state.manager';
import { createTestManagers, TestManagers, tickEngine } from '../../integration/test-helpers';
import { ENEMY_TYPES } from '../../configs/enemy-types.config';
import { METERS_PER_DEGREE_LAT } from '../../utils/geo-utils';
import type { GeoPosition } from '../../models/game.types';
import type { WormGroup } from '../../managers/worm/worm-group';

/** Straight route north, a waypoint every 50 m */
function northPath(meters: number): GeoPosition[] {
  const points: GeoPosition[] = [];
  for (let m = 0; m < meters; m += 50) {
    points.push({ lat: 48.776 + m / METERS_PER_DEGREE_LAT, lon: 9.183, height: 300 });
  }
  points.push({ lat: 48.776 + meters / METERS_PER_DEGREE_LAT, lon: 9.183, height: 300 });
  return points;
}

describe('Boss bar for the worm and the ooze (playtest 352, 353, 362)', () => {
  let m: TestManagers;
  let bar: BossBarComponent;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    m = createTestManagers();
    const injector = Injector.create({
      providers: [
        { provide: GameStateManager, useValue: { getEventBus: () => m.eventBus } },
        { provide: NgZone, useValue: { runOutsideAngular: (fn: () => unknown) => fn() } },
        { provide: DestroyRef, useValue: { onDestroy: () => () => undefined, destroyed: false } },
      ],
    });
    bar = runInInjectionContext(injector, () => new BossBarComponent());
  });

  afterEach(() => {
    m.enemyManager.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  /** One poll of the bar (125 ms) */
  const poll = (): void => {
    vi.advanceTimersByTime(125);
  };

  const wormOut = (): WormGroup => {
    const group = m.enemyManager.spawn(northPath(400), 'worm').worm!.group;
    tickEngine(m, 20_000);
    return group;
  };

  it('352: one bar "Skarnax" for the whole worm, however many rings are out', () => {
    expect(ENEMY_TYPES['worm'].name).toBe('Skarnax');
    const group = wormOut();
    // Every ring is an enemy of the boss type
    const rings = m.enemyManager.getAlive().filter((e) => e.worm?.group === group);
    expect(rings.length).toBeGreaterThan(5);
    expect(rings.every((e) => e.typeConfig.isBoss)).toBe(true);

    poll();
    expect(bar.view()).toMatchObject({ name: 'Skarnax', percent: 100, others: [], more: 0 });
  });

  it('353: a destroyed ring splits it: "Skarnax ×2", one bar with the HP of both parts; gone with the last ring', () => {
    const group = wormOut();
    m.enemyManager.kill(group.segments[5]!);
    tickEngine(m, 5_000);
    expect(group.chains).toHaveLength(2);

    poll();
    const view = bar.view()!;
    expect(view.name).toBe('Skarnax ×2');
    expect(view.others).toEqual([]);
    expect(view.percent).toBeLessThan(100);
    expect(view.percent).toBeCloseTo((group.hp() / group.maxHp) * 100, 0);

    m.eventBus.emit({ type: 'debug:kill-all' });
    expect(group.remaining).toBe(0);
    poll();
    expect(bar.view()).toBeNull();
  });

  it('362: the "Ooze" bar empties with the body flowing into the HQ and goes once all of it is in', () => {
    const ooze = m.enemyManager.spawn(northPath(120), 'ooze');
    tickEngine(m, 30_000);
    poll();
    expect(bar.view()).toMatchObject({ name: 'Ooze', percent: 100 });

    // The tip arrives after 40 s; 20 s later about 60 of the 80 m are in
    tickEngine(m, 30_000);
    expect(ooze.body!.lengthM).toBeLessThan(40);
    poll();
    expect(bar.view()!.percent).toBeCloseTo((ooze.body!.lengthM / 80) * 100, 0);

    tickEngine(m, 30_000);
    expect(m.enemyManager.getById(ooze.id)).toBeNull();
    poll();
    expect(bar.view()).toBeNull();
  });
});
