import { describe, expect, it } from 'vitest';
import { loopSentences, type BudgetBreakdown, type LoopReading } from './wave-explanation';

/** A budget wave's numbers with the loop at `regulator` after `loop` */
function breakdown(regulator: number, loop: Partial<LoopReading>): BudgetBreakdown {
  return {
    row: 12, strength: 1, regulator, regulatorMin: 0.5, regulatorMax: 2.5, targetPressure: 0.025,
    budget: 40, window: 60, delivered: 40, capped: false, types: [],
    loop: { measured: 0.03, lastWave: 0.01, target: 0.025, samples: 5, minSamples: 2, step: 'held', change: 1, ...loop },
  };
}

describe('the pressure loop in plain words (E113)', () => {
  it('measured: the last waves against the target, and the last wave alone', () => {
    expect(loopSentences(breakdown(1.2, {})).measured)
      .toBe('The last waves cost 3 % of the HP on average, the target is 2.5 %; the last wave alone 1 %.');
    expect(loopSentences(breakdown(1.2, { lastWave: null })).measured)
      .toBe('The last waves cost 3 % of the HP on average, the target is 2.5 %.');
  });

  it('holds near the target, says when it sits at a stop', () => {
    expect(loopSentences(breakdown(1.2, {})).response).toBe('Close enough to the target: the budget stays at ×1.2.');
    expect(loopSentences(breakdown(2.5, { step: 'opened', change: 1 })).response)
      .toBe('Too easy: the budget goes up ×1 to ×2.5 (its highest).');
    expect(loopSentences(breakdown(0.5, { step: 'closed', change: 0.8 })).response)
      .toBe('Too hard: the budget goes down ×0.8 to ×0.5 (its lowest).');
  });

  it('says why it does not open when every enemy is at its limit', () => {
    expect(loopSentences(breakdown(1.4, { step: 'blocked' })).response)
      .toBe('Too easy, but every enemy type was already at its limit, so more budget would not make the wave harder: it stays at ×1.4.');
  });
});
