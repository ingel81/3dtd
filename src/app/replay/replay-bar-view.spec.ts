import { describe, it, expect } from 'vitest';
import { ReplayRecording } from './replay-recording';
import { commandMarkers, formatReplaySpeed, formatReplayTime } from './replay-bar-view';

describe('commandMarkers', () => {
  function recording(duration: number, commandMs: number[]): ReplayRecording {
    const rec = new ReplayRecording();
    rec.reset(1, 0, 100, 0, null);
    rec.beginFrame(duration);
    rec.endFrame();
    for (const ms of commandMs) rec.pushCommand(ms, { type: 'command:sell-tower' });
    return rec;
  }

  it('places a tick per command along the wave', () => {
    expect(commandMarkers(recording(10_000, [0, 2500, 10_000]))).toEqual([
      { percent: 0 },
      { percent: 25 },
      { percent: 100 },
    ]);
  });

  it('merges ticks that would touch', () => {
    expect(commandMarkers(recording(100_000, [1000, 1100, 1200, 50_000])).map((m) => m.percent)).toEqual([1, 50]);
  });

  it('has none for a recording without length', () => {
    expect(commandMarkers(recording(0, [0]))).toEqual([]);
  });
});

describe('formatReplayTime', () => {
  it('writes minutes and seconds', () => {
    expect(formatReplayTime(0)).toBe('0:00');
    expect(formatReplayTime(9_999)).toBe('0:09');
    expect(formatReplayTime(72_000)).toBe('1:12');
    expect(formatReplayTime(-5)).toBe('0:00');
  });
});

describe('formatReplaySpeed', () => {
  it('writes the speed with an x', () => {
    expect(formatReplaySpeed(0.25)).toBe('0.25x');
    expect(formatReplaySpeed(4)).toBe('4x');
  });
});
