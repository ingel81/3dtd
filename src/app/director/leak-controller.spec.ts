import { describe, it, expect } from 'vitest';
import {
  LeakController,
  leakRatio,
  LEAK_ADAPT_WINDOW,
  LEAK_TARGET_LO,
  LEAK_TARGET_HI,
  LEAK_MULT_MAX,
  LEAK_MULT_MIN,
} from './leak-controller';

/**
 * This loop has shipped two bugs whose symptoms every other metric hid, so the
 * tests target those failure modes directly rather than the happy path.
 */
describe('LeakController', () => {
  const feed = (g: LeakController, leak: number, waves: number, survived = true) => {
    for (let i = 0; i < waves; i++) g.recordWave(leak, survived);
    return g.leakMultiplier;
  };
  const mid = (LEAK_TARGET_LO + LEAK_TARGET_HI) / 2;

  describe('status, for the decision explainer', () => {
    it('is warming up until the window is full', () => {
      const g = new LeakController();
      feed(g, 0, LEAK_ADAPT_WINDOW - 1);
      expect(g.status).toEqual({
        multiplier: 1, samples: LEAK_ADAPT_WINDOW - 1, meanLeak: null, lastStep: 'warming-up',
      });
    });

    it('reports opening, holding and closing with the window mean', () => {
      const g = new LeakController();
      feed(g, 0, LEAK_ADAPT_WINDOW);
      expect(g.status).toMatchObject({ lastStep: 'opened', meanLeak: 0, samples: LEAK_ADAPT_WINDOW });
      expect(g.status.multiplier).toBe(g.leakMultiplier);

      feed(g, mid, LEAK_ADAPT_WINDOW);
      expect(g.status.lastStep).toBe('held');
      expect(g.status.meanLeak).toBeCloseTo(mid, 6);

      feed(g, 0.5, 1);                     // window mean (3 * mid + 0.5) / 4 is above the band
      expect(g.status.lastStep).toBe('closed');
    });

    it('reports the back-off when a wave ends the run', () => {
      const g = new LeakController();
      feed(g, mid, LEAK_ADAPT_WINDOW);
      g.recordWave(1, false);
      expect(g.status.lastStep).toBe('backed-off');
    });

    it('starts over on reset', () => {
      const g = new LeakController();
      feed(g, 0, LEAK_ADAPT_WINDOW * 2);
      g.reset();
      expect(g.status).toEqual({ multiplier: 1, samples: 0, meanLeak: null, lastStep: 'warming-up' });
    });
  });

  it('holds steady inside the target band', () => {
    // The invariant both historical bugs violated: a defense that is behaving
    // exactly as intended must not move the budget at all.
    expect(feed(new LeakController(), mid, 50)).toBe(1);
  });

  it('opens the budget when nothing is getting through', () => {
    expect(feed(new LeakController(), 0, 20)).toBeGreaterThan(1);
  });

  it('closes the budget when too much is arriving', () => {
    const g = new LeakController();
    feed(g, 0, 20);
    const opened = g.leakMultiplier;
    expect(feed(g, 0.5, 20)).toBeLessThan(opened);
  });

  it('reaches useful scale within a single run', () => {
    // The failure that made every director equivalent. The multiplier has to
    // clear ~1.6 just to undo the stale kill-realism discount; the fixed 5%
    // step it replaced needed ~170 waves against runs of ~60, so it never got
    // there (measured median 1.28) and the cap stayed pinned to exactly what
    // the defense could kill.
    expect(feed(new LeakController(), 0, 40)).toBeGreaterThan(1.6);
  });

  it('backs off hard when a run ends', () => {
    const g = new LeakController();
    feed(g, 0, 20);
    const before = g.leakMultiplier;
    g.recordWave(0.2, false);
    expect(g.leakMultiplier).toBeLessThan(before);
  });

  it('does not steer before it has a full window', () => {
    const g = new LeakController();
    for (let i = 0; i < LEAK_ADAPT_WINDOW - 1; i++) {
      g.recordWave(0, true);
      expect(g.leakMultiplier).toBe(1);
    }
  });

  it('stays within its bounds under sustained pressure', () => {
    expect(feed(new LeakController(), 0, 500)).toBeLessThanOrEqual(LEAK_MULT_MAX);
    expect(feed(new LeakController(), 1, 500)).toBeGreaterThanOrEqual(LEAK_MULT_MIN);
  });

  it('does not ratchet across runs after reset', () => {
    // The bug that held median run length at 6 waves against a target of 80:
    // the multiplier survived into the next game, so a fresh run opened against
    // waves sized for a defense that had already been dismantled.
    const g = new LeakController();
    feed(g, 0, 40);
    expect(g.leakMultiplier).toBeGreaterThan(1);
    g.reset();
    expect(g.leakMultiplier).toBe(1);
  });

  it('treats a cleared small wave as no evidence of headroom', () => {
    // Steering on kill-share raised the budget whenever the defense killed
    // everything — but a small wave is cleared BECAUSE it is small. Leak ratio
    // and kill share agree here (nothing leaked, everything died); what matters
    // is that the response is bounded and reversible, not a one-way ratchet.
    const g = new LeakController();
    feed(g, 0, 100);
    const climbed = g.leakMultiplier;
    expect(climbed).toBeLessThanOrEqual(LEAK_MULT_MAX);
    expect(feed(g, mid, 20)).toBe(climbed);   // settles instead of drifting on
  });

  it('ignores non-finite and out-of-range leak ratios', () => {
    const g = new LeakController();
    expect(() => feed(g, Number.NaN, 10)).not.toThrow();
    expect(Number.isFinite(g.leakMultiplier)).toBe(true);
    const h = new LeakController();
    feed(h, 5, 20);
    expect(h.leakMultiplier).toBeGreaterThanOrEqual(LEAK_MULT_MIN);
  });
});

describe('leakRatio', () => {
  it('counts the enemies that reached the base', () => {
    expect(leakRatio([1, 1, 0.5, 0.2])).toBe(0.5);
  });

  it('books ability kills as leaks', () => {
    // Two struck enemies died at 0.3 and 0.6; one enemy arrived
    expect(leakRatio([0.3, 0.6, 0.9, 1], 2)).toBe(0.75);
  });

  it('stays null without per-enemy data, ability kills or not', () => {
    expect(leakRatio([], 3)).toBeNull();
  });

  it('never exceeds the whole wave', () => {
    expect(leakRatio([1, 0.5], 5)).toBe(1);
  });
});
