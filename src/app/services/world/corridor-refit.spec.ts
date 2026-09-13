import { afterEach, describe, expect, it, vi } from 'vitest';
import { CorridorRefit } from './corridor-refit';
import { corridorConfig, resetCorridorConfig, setCorridorConfig } from '../../utils/route-corridor';

/**
 * The corridor is rebuilt from three places: once after the height update,
 * after settled tile batches for stations that were still on coarse tiles,
 * and from `__corridor.set()`. Each rebuild replaces routes and cells, so
 * none may run under towers, enemies or a wave. The first two measure a
 * slice per frame and keep the corridor as it was until the run is done.
 */
describe('CorridorRefit', () => {
  const BUDGET = CorridorRefit.MEASURE_BUDGET_MS;

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
      /** Slices a measurement takes; an unlimited budget takes it in one. */
      slices: 1,
    };
    const calls: string[] = [];
    const runs: { open: boolean; budgets: number[]; cancel: (reason: string) => void }[] = [];
    let frames: { tick: () => boolean; stopped: boolean }[] = [];
    const host = {
      ready: () => state.ready,
      towerCount: () => state.towers,
      enemyCount: () => state.enemies,
      waveRunning: () => state.wave,
      introRunning: () => state.intro,
      beginMeasurement: vi.fn(() => {
        calls.push('measure');
        let left = state.slices;
        const run = {
          open: true,
          budgets: [] as number[],
          step: (budget: number) => {
            run.budgets.push(budget);
            if (!run.open) return true;
            left = budget === Infinity ? 0 : left - 1;
            return left <= 0;
          },
          commit: () => {
            if (!run.open) return false;
            run.open = false;
            calls.push('commit');
            return state.changed;
          },
          cancel: (reason: string) => {
            if (!run.open) return;
            run.open = false;
            calls.push(`cancel: ${reason}`);
          },
        };
        runs.push(run);
        return run;
      }),
      hasUnmeasured: () => state.unmeasured,
      clearMeasurements: vi.fn(() => calls.push('clear')),
      rebuild: vi.fn(() => calls.push('rebuild')),
      cellCount: () => 1234,
      now: () => state.clock,
      eachFrame: vi.fn((tick: () => boolean) => {
        const frame = { tick, stopped: false };
        frames.push(frame);
        return () => {
          frame.stopped = true;
        };
      }),
      after: vi.fn((ms: number, callback: () => void) => {
        const timer = { at: state.clock + ms, callback, cancelled: false };
        timers.push(timer);
        return () => {
          timer.cancelled = true;
        };
      }),
    };
    let timers: { at: number; callback: () => void; cancelled: boolean }[] = [];
    /** Run the frames that are due; a tick that wants another frame waits for the next call. */
    const runFrames = (times = 1) => {
      for (let i = 0; i < times; i++) {
        const due = frames.filter((frame) => !frame.stopped);
        frames = [];
        for (const frame of due) if (frame.tick()) frames.push(frame);
      }
    };
    const pendingFrames = () => frames.filter((frame) => !frame.stopped).length;
    /** Move the clock to `to` and fire the timers due by then. */
    const advance = (to: number) => {
      state.clock = to;
      const due = timers.filter((timer) => !timer.cancelled && timer.at <= to);
      timers = timers.filter((timer) => !due.includes(timer));
      for (const timer of due) timer.callback();
    };
    const pendingTimers = () => timers.filter((timer) => !timer.cancelled).length;
    return {
      state, host, calls, runs, runFrames, pendingFrames, advance, pendingTimers, refit: new CorridorRefit(host),
    };
  }

  afterEach(() => resetCorridorConfig());

  describe('fitToTiles, after the height update', () => {
    it('measures a slice right away and the rest in the next frames, then rebuilds once when a corridor changed', () => {
      const { refit, state, calls, runs, runFrames, pendingFrames } = setup();
      state.slices = 3;

      refit.fitToTiles();
      expect(calls).toEqual(['measure']);
      runFrames();
      expect(calls).toEqual(['measure']);
      runFrames();

      expect(calls).toEqual(['measure', 'commit', 'rebuild']);
      expect(runs[0].budgets).toEqual([BUDGET, BUDGET, BUDGET]);
      expect(pendingFrames()).toBe(0);
    });

    it('is done within the call when one slice takes every station, as in DevWorld', () => {
      const { refit, calls, host } = setup();
      refit.fitToTiles();
      expect(calls).toEqual(['measure', 'commit', 'rebuild']);
      expect(host.eachFrame).not.toHaveBeenCalled();
    });

    it('does not rebuild when the measurement changed nothing', () => {
      const { refit, state, calls } = setup();
      state.changed = false;
      refit.fitToTiles();
      expect(calls).toEqual(['measure', 'commit']);
    });

    it('neither measures nor rebuilds under a tower, an enemy or a wave', () => {
      for (const block of ['towers', 'enemies', 'wave'] as const) {
        const { refit, state, calls } = setup();
        if (block === 'wave') state.wave = true;
        else state[block] = 1;
        refit.fitToTiles();
        expect(calls, block).toEqual([]);
      }
    });

    it('drops the run and keeps the corridor when a tower, an enemy or a wave turns up before it is done', () => {
      for (const block of ['towers', 'enemies', 'wave'] as const) {
        const { refit, state, calls, runs, runFrames, pendingFrames } = setup();
        state.slices = 3;
        refit.fitToTiles();

        if (block === 'wave') state.wave = true;
        else state[block] = 1;
        runFrames();

        expect(calls, block).toEqual(['measure', `cancel: ${refit.rebuildBlocker()}`]);
        expect(runs[0].budgets, block).toHaveLength(1);
        expect(pendingFrames(), block).toBe(0);
      }
    });

    it('leaves a run under way to finish instead of starting another', () => {
      const { refit, state, host, calls, runFrames } = setup();
      state.slices = 3;
      refit.fitToTiles();
      refit.fitToTiles();
      runFrames(2);
      expect(host.beginMeasurement).toHaveBeenCalledTimes(1);
      expect(calls).toEqual(['measure', 'commit', 'rebuild']);
    });

    it('starts afresh when the routes were replaced under a run', () => {
      const { refit, state, calls, runs, runFrames } = setup();
      state.slices = 3;
      refit.fitToTiles();
      // What PathAndRouteService.clearCache does on a spawn or location change.
      runs[0].cancel('routes replaced');
      refit.fitToTiles();
      runFrames(2);

      expect(calls).toEqual(['measure', 'cancel: routes replaced', 'measure', 'commit', 'rebuild']);
      expect(runs[0].budgets).toHaveLength(1);
    });

    it('stops the frames and drops the run on dispose', () => {
      const { refit, state, calls, runFrames, pendingFrames } = setup();
      state.slices = 3;
      refit.fitToTiles();
      refit.dispose();
      runFrames(3);
      expect(calls).toEqual(['measure', 'cancel: disposed']);
      expect(pendingFrames()).toBe(0);
    });
  });

  describe('remeasure, after a settled tile batch', () => {
    it('does nothing while no station waits for finer tiles, as in DevWorld', () => {
      const { refit, state, calls } = setup();
      state.unmeasured = false;
      refit.remeasure();
      expect(calls).toEqual([]);
    });

    it('measures the waiting stations and rebuilds when that changed the corridor', () => {
      const { refit, calls } = setup();
      refit.remeasure();
      expect(calls).toEqual(['measure', 'commit', 'rebuild']);
    });

    it('keeps the corridor when the stations are still on coarse tiles', () => {
      const { refit, state, calls } = setup();
      state.changed = false;
      refit.remeasure();
      expect(calls).toEqual(['measure', 'commit']);
    });

    it('waits under a tower, an enemy, a wave and during the intro flight', () => {
      for (const block of ['towers', 'enemies', 'wave', 'intro'] as const) {
        const { refit, state, calls } = setup();
        if (block === 'wave') state.wave = true;
        else if (block === 'intro') state.intro = true;
        else state[block] = 1;
        refit.remeasure();
        expect(calls, block).toEqual([]);
      }
    });

    it('leaves the stations to a run under way', () => {
      const { refit, state, host } = setup();
      state.slices = 3;
      refit.fitToTiles();
      refit.remeasure();
      expect(host.beginMeasurement).toHaveBeenCalledTimes(1);
    });

    it('measures at most every three seconds, whether or not the last run changed anything', () => {
      const { refit, state, host } = setup();
      state.changed = false;
      refit.remeasure();
      state.clock = CorridorRefit.REMEASURE_INTERVAL_MS - 1;
      refit.remeasure();
      expect(host.beginMeasurement).toHaveBeenCalledTimes(1);
      state.clock = CorridorRefit.REMEASURE_INTERVAL_MS;
      refit.remeasure();
      expect(host.beginMeasurement).toHaveBeenCalledTimes(2);
    });

    it('does not count a blocked call against the interval', () => {
      const { refit, state, host, calls } = setup();
      state.intro = true;
      refit.remeasure();
      state.intro = false;
      state.clock = 100;
      refit.remeasure();
      expect(host.beginMeasurement).toHaveBeenCalledTimes(1);
      expect(calls).toEqual(['measure', 'commit', 'rebuild']);
    });

    it('tries again by itself once the interval is up, without another tile batch', () => {
      const { refit, state, host, advance, pendingTimers } = setup();
      state.changed = false;
      refit.remeasure();
      state.clock = 2000;
      refit.remeasure();
      expect(host.beginMeasurement).toHaveBeenCalledTimes(1);
      expect(pendingTimers()).toBe(1);

      advance(CorridorRefit.REMEASURE_INTERVAL_MS);
      expect(host.beginMeasurement).toHaveBeenCalledTimes(2);
      expect(pendingTimers()).toBe(0);
    });

    it('tries again every interval while the intro flight runs and measures once it has landed', () => {
      const { refit, state, calls, advance, pendingTimers } = setup();
      state.intro = true;
      refit.remeasure();
      advance(CorridorRefit.REMEASURE_INTERVAL_MS);
      expect(calls).toEqual([]);
      expect(pendingTimers()).toBe(1);

      state.intro = false;
      advance(2 * CorridorRefit.REMEASURE_INTERVAL_MS);
      expect(calls).toEqual(['measure', 'commit', 'rebuild']);
      expect(pendingTimers()).toBe(0);
    });

    it('tries again after a run under way, for the stations it passed before their tiles came', () => {
      const { refit, state, host, runFrames, advance } = setup();
      state.slices = 3;
      refit.fitToTiles();
      refit.remeasure();
      runFrames(2);
      expect(host.beginMeasurement).toHaveBeenCalledTimes(1);

      advance(CorridorRefit.REMEASURE_INTERVAL_MS);
      expect(host.beginMeasurement).toHaveBeenCalledTimes(2);
    });

    it('does not try again under a tower, an enemy or a wave', () => {
      for (const block of ['towers', 'enemies', 'wave'] as const) {
        const { refit, state, pendingTimers } = setup();
        if (block === 'wave') state.wave = true;
        else state[block] = 1;
        refit.remeasure();
        expect(pendingTimers(), block).toBe(0);
      }
    });

    it('keeps one retry waiting however many batches settle meanwhile', () => {
      const { refit, state, host } = setup();
      state.intro = true;
      refit.remeasure();
      refit.remeasure();
      refit.remeasure();
      expect(host.after).toHaveBeenCalledTimes(1);
    });

    it('drops a waiting retry on dispose', () => {
      const { refit, state, calls, advance, pendingTimers } = setup();
      state.intro = true;
      refit.remeasure();
      refit.dispose();
      state.intro = false;
      advance(CorridorRefit.REMEASURE_INTERVAL_MS);
      expect(pendingTimers()).toBe(0);
      expect(calls).toEqual([]);
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

    it('passes the problems on, rebuilds nothing and leaves a run under way alone', () => {
      const { refit, state, calls, runs } = setup();
      state.slices = 3;
      refit.fitToTiles();
      expect(refit.change(() => setCorridorConfig({ taper: -1 }))).toBe('Not changed: taper must be a number from 0.05 to 5.');
      expect(calls).toEqual(['measure']);
      expect(runs[0].open).toBe(true);
    });

    it('measures again from scratch in one go when the rays or stations change, then rebuilds', () => {
      const { refit, state, calls, runs } = setup();
      state.slices = 3;
      expect(refit.change(() => setCorridorConfig({ rayHeightHigh: 3 }))).toBe(
        'Corridor rebuilt, measured again: 1234 cells. Widths per stretch: __routes.describe()',
      );
      expect(calls).toEqual(['clear', 'measure', 'commit', 'rebuild']);
      expect(runs[0].budgets).toEqual([Infinity]);
    });

    it('reshapes what was measured for the other settings, and rebuilds even if nothing new was measured', () => {
      const { refit, state, calls } = setup();
      state.changed = false;
      expect(refit.change(() => setCorridorConfig({ bulgeLength: 14 }))).toBe(
        'Corridor rebuilt: 1234 cells. Widths per stretch: __routes.describe()',
      );
      expect(calls).toEqual(['measure', 'commit', 'rebuild']);
    });

    it('cancels a run under way first: it measured with the old settings', () => {
      const { refit, state, calls, runFrames, pendingFrames } = setup();
      state.slices = 3;
      refit.fitToTiles();
      refit.change(() => setCorridorConfig({ rayHeightLow: 0.8 }));
      runFrames(3);
      expect(calls).toEqual(['measure', 'cancel: settings changed', 'clear', 'measure', 'commit', 'rebuild']);
      expect(pendingFrames()).toBe(0);
    });
  });
});
