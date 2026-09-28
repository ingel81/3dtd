import { describe, it, expect } from 'vitest';
import { LockstepPacer } from './lockstep-pacer';
import { TICK_SUB_STEPS, type LockstepLink } from '../../coop/lockstep';

/** A link whose relay closed every tick up to `closed`; the hash reports it got */
function link(closed: number) {
  const reports: number[] = [];
  const l = {
    confirmedTick: () => closed,
    reportHash: (tick: number) => reports.push(tick),
  } as unknown as LockstepLink;
  return { l, reports };
}

/** Walk the pacer's barrier over every boundary up to `ticks` */
function walk(pacer: LockstepPacer, ticks: number): void {
  for (let boundary = 0; boundary <= ticks * TICK_SUB_STEPS; boundary++) pacer.open(() => boundary);
}

describe('LockstepPacer hash reports', () => {
  const host = { hashBreakdown: () => ({ total: 1, parts: [], entities: {} }), runTick: () => undefined };

  it('reports every HASH_EVERY_TICKS ticks by default', () => {
    const pacer = new LockstepPacer(host);
    const { l, reports } = link(100);
    pacer.set(l);
    walk(pacer, 61);
    expect(reports).toEqual([0, 30, 60]);
  });

  it('reports every tick for a hunt of a desync (?hashEvery=1)', () => {
    const pacer = new LockstepPacer(host);
    const { l, reports } = link(100);
    pacer.set(l, 1);
    walk(pacer, 4);
    expect(reports).toEqual([0, 1, 2, 3, 4]);
  });
});
