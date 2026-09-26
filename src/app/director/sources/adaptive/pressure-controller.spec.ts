import { describe, expect, it } from 'vitest';
import {
  PressureController,
  PRESSURE_MEASURE_CAP,
  PRESSURE_WARMUP_WAVES,
  targetPressure,
} from './pressure-controller';
import { directorParams } from '../../director-params';

describe('PressureController: one wave counts at most three times the target (TODO E48)', () => {
  const first = PRESSURE_WARMUP_WAVES + 1;
  const target = (wave: number) => targetPressure(wave) * directorParams().pressureTargetScale;

  /** Three waves on target, then `outlier` */
  function after(outlier: number): PressureController {
    const loop = new PressureController();
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
