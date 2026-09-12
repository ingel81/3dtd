import { afterEach, describe, expect, it, vi } from 'vitest';
import { CorridorRefit } from './corridor-refit';
import { corridorConfig, resetCorridorConfig, setCorridorConfig } from '../../utils/route-corridor';

/**
 * The corridor is rebuilt from three places: once after the height update,
 * after settled tile batches for stations that were still on coarse tiles,
 * and from `__corridor.set()`. Each rebuild replaces routes and cells, so
 * none may run under towers, enemies or a wave.
 */
describe('CorridorRefit', () => {
  /** A game with a location loaded, nothing on the map, stations waiting for finer tiles. */
  function setup() {
    const state = {
      ready: true,
      towers: 0,
      enemies: 0,
      wave: false,
      intro: false,
      changed: true,
      unmeasured: true,
      clock: 0,
    };
    const calls: string[] = [];
    const host = {
      ready: () => state.ready,
      towerCount: () => state.towers,
      enemyCount: () => state.enemies,
      waveRunning: () => state.wave,
      introRunning: () => state.intro,
      measure: vi.fn(() => {
        calls.push('measure');
        return state.changed;
      }),
      hasUnmeasured: () => state.unmeasured,
      clearMeasurements: vi.fn(() => calls.push('clear')),
      rebuild: vi.fn(() => calls.push('rebuild')),
      cellCount: () => 1234,
      now: () => state.clock,
    };
    return { state, host, calls, refit: new CorridorRefit(host) };
  }

  afterEach(() => resetCorridorConfig());

  describe('fitToTiles, after the height update', () => {
    it('measures and rebuilds when a corridor changed', () => {
      const { refit, calls } = setup();
      expect(refit.fitToTiles()).toBe(true);
      expect(calls).toEqual(['measure', 'rebuild']);
    });

    it('does not rebuild when the measurement changed nothing', () => {
      const { refit, state, calls } = setup();
      state.changed = false;
      expect(refit.fitToTiles()).toBe(false);
      expect(calls).toEqual(['measure']);
    });

    it('neither measures nor rebuilds under a tower, an enemy or a wave', () => {
      for (const block of ['towers', 'enemies', 'wave'] as const) {
        const { refit, state, calls } = setup();
        if (block === 'wave') state.wave = true;
        else state[block] = 1;
        expect(refit.fitToTiles(), block).toBe(false);
        expect(calls, block).toEqual([]);
      }
    });
  });

  describe('remeasure, after a settled tile batch', () => {
    it('does nothing while no station waits for finer tiles, as in DevWorld', () => {
      const { refit, state, calls } = setup();
      state.unmeasured = false;
      expect(refit.remeasure()).toBe(false);
      expect(calls).toEqual([]);
    });

    it('measures the waiting stations and rebuilds when that changed the corridor', () => {
      const { refit, calls } = setup();
      expect(refit.remeasure()).toBe(true);
      expect(calls).toEqual(['measure', 'rebuild']);
    });

    it('keeps the corridor when the stations are still on coarse tiles', () => {
      const { refit, state, calls } = setup();
      state.changed = false;
      expect(refit.remeasure()).toBe(false);
      expect(calls).toEqual(['measure']);
    });

    it('waits under a tower, an enemy, a wave and during the intro flight', () => {
      for (const block of ['towers', 'enemies', 'wave', 'intro'] as const) {
        const { refit, state, calls } = setup();
        if (block === 'wave') state.wave = true;
        else if (block === 'intro') state.intro = true;
        else state[block] = 1;
        expect(refit.remeasure(), block).toBe(false);
        expect(calls, block).toEqual([]);
      }
    });

    it('measures at most every three seconds, whether or not the last run changed anything', () => {
      const { refit, state, host } = setup();
      state.changed = false;
      refit.remeasure();
      state.clock = CorridorRefit.REMEASURE_INTERVAL_MS - 1;
      refit.remeasure();
      expect(host.measure).toHaveBeenCalledTimes(1);
      state.clock = CorridorRefit.REMEASURE_INTERVAL_MS;
      refit.remeasure();
      expect(host.measure).toHaveBeenCalledTimes(2);
    });

    it('does not count a blocked call against the interval', () => {
      const { refit, state, host } = setup();
      state.intro = true;
      refit.remeasure();
      state.intro = false;
      state.clock = 100;
      expect(refit.remeasure()).toBe(true);
      expect(host.measure).toHaveBeenCalledTimes(1);
    });
  });

  describe('change, from __corridor.set()', () => {
    it('refuses without a location and under a tower, and leaves the settings alone', () => {
      const apply = vi.fn(() => setCorridorConfig({ maxHalfWidth: 8 }));
      const first = setup();
      first.state.ready = false;
      expect(first.refit.change(apply)).toBe('Not changed: no location loaded.');
      const second = setup();
      second.state.towers = 2;
      expect(second.refit.change(apply)).toBe('Not changed: towers stand on the map, sell them first.');
      expect(apply).not.toHaveBeenCalled();
      expect(corridorConfig.maxHalfWidth).toBe(7);
    });

    it('passes the problems on and rebuilds nothing', () => {
      const { refit, calls } = setup();
      expect(refit.change(() => setCorridorConfig({ taper: -1 }))).toBe('Not changed: taper must be a number from 0.05 to 5.');
      expect(calls).toEqual([]);
    });

    it('measures again from scratch when the rays or stations change, then rebuilds', () => {
      const { refit, calls } = setup();
      expect(refit.change(() => setCorridorConfig({ rayHeightHigh: 3 }))).toBe(
        'Corridor rebuilt, measured again: 1234 cells. Widths per stretch: __routes.describe()',
      );
      expect(calls).toEqual(['clear', 'measure', 'rebuild']);
    });

    it('reshapes what was measured for the other settings, and rebuilds even if nothing new was measured', () => {
      const { refit, state, calls } = setup();
      state.changed = false;
      expect(refit.change(() => setCorridorConfig({ bulgeLength: 14 }))).toBe(
        'Corridor rebuilt: 1234 cells. Widths per stretch: __routes.describe()',
      );
      expect(calls).toEqual(['measure', 'rebuild']);
    });
  });
});
