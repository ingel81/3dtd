import { describe, it, expect } from 'vitest';
import { FramePacer } from './frame-pacer';

/**
 * Feeds `frames` rAF timestamps at `hz` into the pacer, each shifted by a
 * deterministic pseudo-random jitter of up to `jitterMs`, and returns the
 * timestamps of the frames that ran.
 */
function simulate(pacer: FramePacer, hz: number, frames: number, jitterMs = 0, startMs = 1000): number[] {
  const period = 1000 / hz;
  const ran: number[] = [];
  for (let i = 0; i < frames; i++) {
    const t = startMs + i * period + jitterMs * Math.sin(i * 12.9898);
    if (pacer.shouldRun(t)) ran.push(t);
  }
  return ran;
}

function gaps(times: number[]): number[] {
  return times.slice(1).map((t, i) => t - times[i]);
}

describe('FramePacer', () => {
  it('runs every frame without a cap', () => {
    expect(simulate(new FramePacer(0), 144, 1440)).toHaveLength(1440);
  });

  it('runs the first frame after a reset', () => {
    const pacer = new FramePacer(30);
    expect(pacer.shouldRun(5000)).toBe(true);
    expect(pacer.shouldRun(5001)).toBe(false);
    pacer.reset();
    expect(pacer.shouldRun(5002)).toBe(true);
  });

  it('keeps every frame of a 60 Hz display under a 60 fps cap despite jitter', () => {
    expect(simulate(new FramePacer(60), 60, 1200, 0.5)).toHaveLength(1200);
  });

  it('keeps every frame of a display slightly slower than the cap', () => {
    // Plenty of "60 Hz" panels run at 59.94. A cap of 60 must be a no-op there.
    expect(simulate(new FramePacer(60), 59.94, 3600, 0.5)).toHaveLength(3600);
  });

  it('runs every other frame of a 60 Hz display under a 30 fps cap', () => {
    const ran = simulate(new FramePacer(30), 60, 600, 0.5);
    expect(ran).toHaveLength(300);
    for (const gap of gaps(ran)) {
      expect(gap).toBeGreaterThan(31);
      expect(gap).toBeLessThan(35.5);
    }
  });

  it('does not collapse a 50 fps cap on 60 Hz to 30', () => {
    const ran = simulate(new FramePacer(50), 60, 600);
    expect(ran.length).toBeGreaterThanOrEqual(499);
    expect(ran.length).toBeLessThanOrEqual(501);
  });

  it('holds the cap on high refresh displays', () => {
    for (const fps of [60, 30]) {
      const ran = simulate(new FramePacer(fps), 144, 1440, 0.3); // 10 s
      expect(ran.length).toBeGreaterThanOrEqual(fps * 10 - 2);
      expect(ran.length).toBeLessThanOrEqual(fps * 10 + 1);
    }
  });

  it('resumes at the cap after a long stall instead of bursting', () => {
    const pacer = new FramePacer(30);
    simulate(pacer, 60, 60, 0, 0);
    // Five seconds without a frame, e.g. a hidden tab.
    const after = simulate(pacer, 60, 60, 0, 6000);
    expect(after[0]).toBe(6000);
    expect(after.length).toBeGreaterThanOrEqual(30);
    expect(after.length).toBeLessThanOrEqual(31);
  });

  // Refresh rates one to four times the cap: 60 on 60 Hz, the 30 fps cap on
  // 60 Hz and 60 on 120 Hz, model previews at 30 fps on 90 and 120 Hz.
  const MULTIPLES: [fps: number, hz: number][] = [[60, 60], [30, 60], [60, 120], [30, 90], [30, 120]];

  it('keeps even gaps at multiples of the cap, also after stalls', () => {
    const bad: string[] = [];
    for (const [fps, hz] of MULTIPLES) {
      const interval = 1000 / fps;
      const pacer = new FramePacer(fps);
      let start = 1000;
      // Two seconds of frames, then again after a tile-load or GC hitch, a
      // longer one and a tab switch.
      for (const stallMs of [0, 70, 100, 250, 5000]) {
        start += stallMs;
        for (const gap of gaps(simulate(pacer, hz, hz * 2, 0.5, start))) {
          if (Math.abs(gap - interval) > 3) bad.push(`${fps}@${hz} after ${stallMs} ms: ${gap.toFixed(1)} ms`);
        }
        start += 2000;
      }
    }
    expect(bad).toEqual([]);
  });

  it('catches up at most one frame after a short hitch, then keeps even gaps', () => {
    const bad: string[] = [];
    for (const [fps, hz] of MULTIPLES) {
      const interval = 1000 / fps;
      const pacer = new FramePacer(fps);
      let start = 1000;
      simulate(pacer, hz, hz, 0.5, start);
      // One to six dropped vsyncs, too short to count as a stall.
      for (let dropped = 1; dropped <= 6; dropped++) {
        start += 1000 + dropped * (1000 / hz);
        for (const gap of gaps(simulate(pacer, hz, hz, 0.5, start)).slice(1)) {
          if (Math.abs(gap - interval) > 3) bad.push(`${fps}@${hz} after ${dropped} dropped: ${gap.toFixed(1)} ms`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
