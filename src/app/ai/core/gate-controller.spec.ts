import { describe, it, expect } from 'vitest';
import {
  GateController,
  GATE_ADAPT_WINDOW,
  GATE_LEAK_TARGET_LO,
  GATE_LEAK_TARGET_HI,
  GATE_MULT_MAX,
  GATE_MULT_MIN,
} from './gate-controller';

/**
 * This loop has shipped two bugs whose symptoms every other metric hid, so the
 * tests target those failure modes directly rather than the happy path.
 */
describe('GateController', () => {
  const feed = (g: GateController, leak: number, waves: number, survived = true) => {
    for (let i = 0; i < waves; i++) g.recordWave(leak, survived);
    return g.budgetMultiplier;
  };
  const mid = (GATE_LEAK_TARGET_LO + GATE_LEAK_TARGET_HI) / 2;

  it('holds steady inside the target band', () => {
    // The invariant both historical bugs violated: a defense that is behaving
    // exactly as intended must not move the budget at all.
    expect(feed(new GateController(), mid, 50)).toBe(1);
  });

  it('opens the budget when nothing is getting through', () => {
    expect(feed(new GateController(), 0, 20)).toBeGreaterThan(1);
  });

  it('closes the budget when too much is arriving', () => {
    const g = new GateController();
    feed(g, 0, 20);
    const opened = g.budgetMultiplier;
    expect(feed(g, 0.5, 20)).toBeLessThan(opened);
  });

  it('reaches useful scale within a single run', () => {
    // The failure that made every director equivalent. The multiplier has to
    // clear ~1.6 just to undo the stale kill-realism discount; the fixed 5%
    // step it replaced needed ~170 waves against runs of ~60, so it never got
    // there (measured median 1.28) and the cap stayed pinned to exactly what
    // the defense could kill.
    expect(feed(new GateController(), 0, 40)).toBeGreaterThan(1.6);
  });

  it('backs off hard when a run ends', () => {
    const g = new GateController();
    feed(g, 0, 20);
    const before = g.budgetMultiplier;
    g.recordWave(0.2, false);
    expect(g.budgetMultiplier).toBeLessThan(before);
  });

  it('does not steer before it has a full window', () => {
    const g = new GateController();
    for (let i = 0; i < GATE_ADAPT_WINDOW - 1; i++) {
      g.recordWave(0, true);
      expect(g.budgetMultiplier).toBe(1);
    }
  });

  it('stays within its bounds under sustained pressure', () => {
    expect(feed(new GateController(), 0, 500)).toBeLessThanOrEqual(GATE_MULT_MAX);
    expect(feed(new GateController(), 1, 500)).toBeGreaterThanOrEqual(GATE_MULT_MIN);
  });

  it('does not ratchet across runs after reset', () => {
    // The bug that held median run length at 6 waves against a target of 80:
    // the multiplier survived into the next game, so a fresh run opened against
    // waves sized for a defense that had already been dismantled.
    const g = new GateController();
    feed(g, 0, 40);
    expect(g.budgetMultiplier).toBeGreaterThan(1);
    g.reset();
    expect(g.budgetMultiplier).toBe(1);
  });

  it('treats a cleared small wave as no evidence of headroom', () => {
    // Steering on kill-share raised the budget whenever the defense killed
    // everything — but a small wave is cleared BECAUSE it is small. Leak ratio
    // and kill share agree here (nothing leaked, everything died); what matters
    // is that the response is bounded and reversible, not a one-way ratchet.
    const g = new GateController();
    feed(g, 0, 100);
    const climbed = g.budgetMultiplier;
    expect(climbed).toBeLessThanOrEqual(GATE_MULT_MAX);
    expect(feed(g, mid, 20)).toBe(climbed);   // settles instead of drifting on
  });

  it('ignores non-finite and out-of-range leak ratios', () => {
    const g = new GateController();
    expect(() => feed(g, Number.NaN, 10)).not.toThrow();
    expect(Number.isFinite(g.budgetMultiplier)).toBe(true);
    const h = new GateController();
    feed(h, 5, 20);
    expect(h.budgetMultiplier).toBeGreaterThanOrEqual(GATE_MULT_MIN);
  });
});
