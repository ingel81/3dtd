import { describe, it, expect } from 'vitest';
import type { CommandLogEntry } from '../managers/game-state/command-log';
import { commandMarkers, formatReplaySpeed, formatReplayTime } from './replay-bar-view';

describe('commandMarkers', () => {
  const entry = (step: number, type = 'command:sell-tower'): CommandLogEntry => ({ step, playerId: 'local', command: { type } });

  it('places a tick per command along the wave', () => {
    expect(commandMarkers([entry(100), entry(125), entry(199)], 100, 200)).toEqual([
      { percent: 0 },
      { percent: 25 },
      { percent: 99 },
    ]);
  });

  it('merges ticks that would touch', () => {
    const entries = [entry(1100), entry(1101), entry(1102), entry(6000)];
    expect(commandMarkers(entries, 1000, 11_000).map((m) => m.percent)).toEqual([1, 50]);
  });

  it('leaves out what is outside the wave, the aim and the lines of sight', () => {
    const entries = [entry(50), entry(150, 'command:tower-aim'), entry(160, 'los:resolved'), entry(170), entry(250)];
    expect(commandMarkers(entries, 100, 200)).toEqual([{ percent: 70 }]);
  });

  it('has none for a wave without length', () => {
    expect(commandMarkers([entry(0)], 0, 0)).toEqual([]);
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
