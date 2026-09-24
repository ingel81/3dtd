import { describe, it, expect } from 'vitest';
import { LockstepStats, REPORT_EVERY_MS, statsLine } from './lockstep-stats';

describe('LockstepStats', () => {
  it('counts frames, the barrier, sub-steps, the lag, tick gaps and the input delay per period', () => {
    const stats = new LockstepStats();
    expect(stats.reportDue(0)).toBeNull();
    stats.frame(0, true, 0);
    stats.frame(4, false, 0);
    stats.frame(1, false, 2);
    stats.frame(1, false, 1);
    for (const at of [0, 60, 130, 190]) stats.tickArrived(at);
    stats.commandSent(100);
    stats.commandSent(110);
    stats.commandRan(180);
    stats.commandRan(250);

    const report = stats.reportDue(REPORT_EVERY_MS)!;
    expect(report).toMatchObject({ frames: 4, blocked: 0.25, steps: [1, 2, 0, 1], behindAvg: 0.75, behindMin: 0, inputs: 2 });
    expect(report.tickGapAvg).toBeCloseTo(190 / 3);
    expect(report.inputAvg).toBe(110);
    expect(report.inputMax).toBe(140);
    expect(statsLine(report)).toBe('4 frames, blocked 25%, steps 0:1 1:2 2:0 3+:1, behind 0.8 (min 0), ticks 63±5 ms, input 110 ms (max 140, n 2)');

    // A new period starts empty
    stats.frame(1, false, 0);
    expect(stats.reportDue(REPORT_EVERY_MS + 1)).toBeNull();
    expect(stats.reportDue(2 * REPORT_EVERY_MS)).toMatchObject({ frames: 1, blocked: 0, inputAvg: null });
  });
});
