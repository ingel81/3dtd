import { describe, it, expect } from 'vitest';
import { meterSample, speedShort } from './sim-meter.service';
import type { LoadStats } from '../../sim/client/load-stats';

const window: LoadStats = {
  wallMs: 1000, packets: 60, applies: 60, emptyPackets: 0, subSteps: 240, tickMs: 720, gameMs: 3800, events: 0, ops: 0,
  apply: { state: 30, ops: 6, events: 12, present: 60, listeners: 12 },
};

describe('meterSample', () => {
  it('reads a second of packets and sounds as the FPS display shows it', () => {
    const sample = meterSample(
      window,
      { before: { requested: 1000, played: 900 }, after: { requested: 11000, played: 932 } },
      { fps: 144, speedSet: 4, paused: false, enemies: 5000 },
    );
    expect(sample.speed).toBeCloseTo(3.8);
    expect(sample.workerLoad).toBeCloseTo(0.72);
    expect(sample.ticksPerS).toBeCloseTo(60);
    expect(sample.applyPerPacketMs).toBeCloseTo(2);
    expect(sample.soundsRequestedPerS).toBe(10000);
    expect(sample.soundsPlayedPerS).toBe(32);
    expect(sample.enemies).toBe(5000);
  });

  it('counts no sounds backwards after a reset of the counters', () => {
    const sample = meterSample(window, { before: { requested: 50, played: 5 }, after: { requested: 0, played: 0 } },
      { fps: 60, speedSet: 1, paused: false, enemies: 0 });
    expect([sample.soundsRequestedPerS, sample.soundsPlayedPerS]).toEqual([0, 0]);
  });
});

describe('speedShort', () => {
  it('marks a speed below the one set, not a paused game or one within rounding', () => {
    expect(speedShort({ speed: 3.8, speedSet: 4, paused: false })).toBe(true);
    expect(speedShort({ speed: 3.97, speedSet: 4, paused: false })).toBe(false);
    expect(speedShort({ speed: 0, speedSet: 4, paused: true })).toBe(false);
  });
});
