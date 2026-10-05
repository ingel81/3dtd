import { describe, expect, it } from 'vitest';
import {
  PressureController,
  PRESSURE_MAX_OPEN_STEP,
  PRESSURE_MAX_STEP,
  PRESSURE_MEASURE_CAP,
  targetPressure,
} from './pressure-controller';
import { directorParams } from './director-params';

const LIMITS = { min: 0.5, max: 2 };
const START = { warmupWaves: 4, minSamples: 3 };

describe('PressureController: one wave counts at most three times the target (TODO E48)', () => {
  const first = START.warmupWaves + 1;
  const target = (wave: number) => targetPressure(wave) * directorParams().pressureTargetScale;

  /** Three waves on target, then `outlier` */
  function after(outlier: number): PressureController {
    const loop = new PressureController(LIMITS, START);
    for (let wave = first; wave < first + 3; wave++) loop.recordWave(target(wave), wave);
    loop.recordWave(outlier, first + 3);
    return loop;
  }

  it('counts a wave that cost half the HP as three times the target, no more', () => {
    const capped = after(target(first + 3) * PRESSURE_MEASURE_CAP);
    const outlier = after(0.5);
    expect(outlier.status.meanPressure).toBeCloseTo(capped.status.meanPressure!);
    expect(outlier.pressureMultiplier).toBeCloseTo(capped.pressureMultiplier);
    // Still read as too hard: the loop closes
    expect(outlier.status.lastStep).toBe('closed');
  });

  it('takes a wave under the cap as it is', () => {
    const wave = first + 3;
    expect(after(target(wave) * 2).status.meanPressure).not.toBeCloseTo(after(target(wave) * 2.9).status.meanPressure!);
  });
});

describe('PressureController: opens slower than it closes', () => {
  const gain = () => directorParams().pressureGain;

  it('opens at most by the open step per wave after waves that cost nothing', () => {
    const loop = new PressureController({ min: 0.5, max: 10 }, { warmupWaves: 0, minSamples: 1 });
    let before = loop.pressureMultiplier;
    for (let wave = 1; wave <= 6; wave++) {
      const after = loop.recordWave(0, wave);
      expect(after / before).toBeCloseTo(Math.exp(gain() * PRESSURE_MAX_OPEN_STEP), 6);
      before = after;
    }
  });

  it('closes by the full step after a wave far over the target', () => {
    const loop = new PressureController({ min: 0.1, max: 10 }, { warmupWaves: 0, minSamples: 1 });
    expect(loop.recordWave(0.5, 1)).toBeCloseTo(Math.exp(-gain() * PRESSURE_MAX_STEP), 6);
  });
});

describe('PressureController: what it tells about its last step (E113)', () => {
  it('reports the last wave, the step and the factor it moved by', () => {
    const loop = new PressureController({ min: 0.5, max: 10 }, { warmupWaves: 0, minSamples: 1 });
    const after = loop.recordWave(0, 1);
    expect(loop.status).toMatchObject({ lastPressure: 0, lastStep: 'opened' });
    expect(loop.status.lastChange).toBeCloseTo(after, 9);
  });

  it('a factor of 1 when it holds, and "blocked" when the anti-windup holds an opening', () => {
    const loop = new PressureController({ min: 0.5, max: 10 }, { warmupWaves: 0, minSamples: 1 });
    loop.recordWave(0, 1, false);
    expect(loop.status).toMatchObject({ lastStep: 'blocked', lastChange: 1, multiplier: 1 });
  });

  it('a factor of 1 at its stop, though it would open', () => {
    const loop = new PressureController({ min: 0.5, max: 1 }, { warmupWaves: 0, minSamples: 1 });
    loop.recordWave(0, 1);
    expect(loop.status).toMatchObject({ lastStep: 'opened', lastChange: 1 });
  });
});
