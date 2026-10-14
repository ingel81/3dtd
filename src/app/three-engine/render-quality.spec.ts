import { DynamicResolution, FRAME_BUDGET_MS } from './dynamic-resolution';
import {
  QUALITY_TABLE, levelAfterMeasure, levelForGpu, lowerLevel, parseStoredQuality, pixelRatioFor, qualityFromSearch, resolveLevel,
} from './render-quality';

describe('render quality levels (E154)', () => {
  it('keeps the tiles picture of High as it was before the levels', () => {
    const high = QUALITY_TABLE.high;
    // Up to DPR 2, MSAA, errorTarget 20, fixed resolution
    expect(pixelRatioFor(high, 'tiles', 2)).toBe(2);
    expect(pixelRatioFor(high, 'tiles', 3)).toBe(2);
    expect(high.general).toMatchObject({ antialias: 'msaa', dynamic: null, bloom: true });
    expect(high.tiles.errorTarget).toBe(20);
    // The custom-map part as the renderer had it: shadows 4096, impostors from 380 m, 70 000 blades to 140 m, six lights
    expect(high.customMaps).toMatchObject({ shadowMapSize: 4096, shadowRadius: 1.5, lodBias: 1, impostorFrom: 380, grassBlades: 70_000, grassDistance: 140, pointLights: 6, particles: 1 });
    expect(high.customMaps).toMatchObject({ farSingle: 150, farFlat: 400, refraction: true, seaWaves: true, lavaGlow: true, shadowCascade: true });
  });

  it('draws custom maps at most at their own pixel ratio cap, and Low and Medium at a share of DPR 1', () => {
    expect(pixelRatioFor(QUALITY_TABLE.high, 'custom-map', 2)).toBe(1.5);
    expect(pixelRatioFor(QUALITY_TABLE.ultra, 'custom-map', 2)).toBe(2);
    expect(pixelRatioFor(QUALITY_TABLE.low, 'tiles', 2)).toBeCloseTo(0.6);
    expect(pixelRatioFor(QUALITY_TABLE.medium, 'custom-map', 1, 0.7)).toBeCloseTo(0.7);
  });

  it('plays custom maps a level lower under Auto, a chosen level as it is', () => {
    expect(resolveLevel('auto', 'high', 'tiles')).toBe('high');
    expect(resolveLevel('auto', 'high', 'custom-map')).toBe('medium');
    expect(resolveLevel('auto', 'low', 'custom-map')).toBe('low');
    expect(resolveLevel('ultra', 'low', 'custom-map')).toBe('ultra');
    expect(lowerLevel('low')).toBe('low');
  });

  it('guesses a level from the GPU name', () => {
    expect(levelForGpu('NVIDIA GeForce RTX 5080')).toBe('high');
    expect(levelForGpu('NVIDIA GeForce GTX 1650 Ti')).toBe('medium');
    expect(levelForGpu('NVIDIA GeForce RTX 3050 Laptop GPU')).toBe('medium');
    expect(levelForGpu('AMD Radeon(TM) Graphics')).toBe('low');
    expect(levelForGpu('Intel(R) UHD Graphics 620')).toBe('low');
    expect(levelForGpu('Intel(R) Arc(TM) A770 Graphics')).toBe('high');
    expect(levelForGpu('AMD Radeon RX 6700 XT')).toBe('high');
    expect(levelForGpu('AMD Radeon RX 580 Series')).toBe('medium');
    expect(levelForGpu('Apple M2 Pro')).toBe('high');
    expect(levelForGpu('Google SwiftShader')).toBe('low');
    expect(levelForGpu('')).toBe('low');
  });

  it('checks the guess by the measured GPU time', () => {
    expect(levelAfterMeasure('high', 14)).toBe('medium');
    expect(levelAfterMeasure('high', 2)).toBe('high');
    expect(levelAfterMeasure('medium', 2)).toBe('high');
    expect(levelAfterMeasure('medium', 6)).toBe('medium');
  });

  it('reads what was stored, and the level of a URL', () => {
    expect(parseStoredQuality(null)).toEqual({ setting: 'auto', auto: null });
    expect(parseStoredQuality('{"setting":"low","auto":{"gpu":"x","level":"high","measured":true}}'))
      .toEqual({ setting: 'low', auto: { gpu: 'x', level: 'high', measured: true } });
    expect(parseStoredQuality('{"setting":"insane","auto":{"gpu":1}}')).toEqual({ setting: 'auto', auto: null });
    expect(parseStoredQuality('not json')).toEqual({ setting: 'auto', auto: null });
    expect(qualityFromSearch('?world=map:x&quality=medium')).toBe('medium');
    expect(qualityFromSearch('?quality=extreme')).toBeNull();
  });
});

describe('DynamicResolution', () => {
  const second = (ms: number) => Array.from({ length: 60 }, () => ms);

  it('goes down at once on costly frames and up only after cheap seconds in a row, within the range', () => {
    const d = new DynamicResolution(0.8, { min: 0.6, max: 1 });
    expect(d.evaluate(second(FRAME_BUDGET_MS), 'gpu')).toBeCloseTo(0.7);
    expect(d.evaluate(second(FRAME_BUDGET_MS), 'gpu')).toBeCloseTo(0.6);
    expect(d.evaluate(second(FRAME_BUDGET_MS), 'gpu')).toBeNull();
    expect(d.evaluate(second(2), 'gpu')).toBeNull();
    expect(d.evaluate(second(2), 'gpu')).toBeNull();
    expect(d.evaluate(second(2), 'gpu')).toBeCloseTo(0.65);
    // A middling second breaks the run
    expect(d.evaluate(second(12), 'gpu')).toBeNull();
    expect(d.evaluate(second(2), 'gpu')).toBeNull();
  });

  it('takes frame intervals at the refresh rate as fine, and fewer than three samples as nothing', () => {
    const d = new DynamicResolution(0.8, { min: 0.6, max: 1 });
    expect(d.evaluate(second(1000 / 60), 'interval')).toBeNull();
    expect(d.evaluate(second(1000 / 30), 'interval')).toBeCloseTo(0.7);
    expect(d.evaluate([50, 50], 'interval')).toBeNull();
    // A slow GPU: three frames of a second are enough
    expect(d.evaluate([400, 400, 400], 'gpu')).toBeCloseTo(0.6);
  });
});
