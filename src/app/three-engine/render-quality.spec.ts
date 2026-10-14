import { DisplayRefresh, DynamicResolution, FRAME_BUDGET_MS, REFRESH_SAMPLES } from './dynamic-resolution';
import {
  QUALITY_TABLE, knobsWith, levelAfterMeasure, levelForGpu, lowerLevel, mixedOverrides, parseStoredQuality, pixelRatioFor,
  qualityFromSearch, resolveLevel,
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
    const none = { overrides: {}, plantMotion: 'full' };
    expect(parseStoredQuality(null)).toEqual({ setting: 'auto', auto: null, ...none });
    expect(parseStoredQuality('{"setting":"low","auto":{"gpu":"x","level":"high","measured":true}}'))
      .toEqual({ setting: 'low', auto: { gpu: 'x', level: 'high', measured: true }, ...none });
    expect(parseStoredQuality('{"setting":"insane","auto":{"gpu":1}}')).toEqual({ setting: 'auto', auto: null, ...none });
    expect(parseStoredQuality('not json')).toEqual({ setting: 'auto', auto: null, ...none });
    expect(parseStoredQuality('null')).toEqual({ setting: 'auto', auto: null, ...none });
    // Overrides and plant motion: what is valid stays, the rest goes
    expect(parseStoredQuality('{"setting":"high","overrides":{"grass":"ultra","refraction":false,"shadows":"huge","lavaGlow":1,"x":true},"plantMotion":"calm"}'))
      .toEqual({ setting: 'high', auto: null, overrides: { grass: 'ultra', refraction: false }, plantMotion: 'calm' });
    expect(parseStoredQuality('{"overrides":[1],"plantMotion":"wild"}')).toEqual({ setting: 'auto', auto: null, ...none });
    expect(qualityFromSearch('?world=map:x&quality=medium')).toBe('medium');
    expect(qualityFromSearch('?quality=extreme')).toBeNull();
  });
});

describe('quality overrides per world (E156)', () => {
  it('plays the level as it is without overrides, with plants swaying fully', () => {
    const knobs = knobsWith('medium', {}, 'full');
    expect(knobs).toEqual({ ...QUALITY_TABLE.medium, customMaps: { ...QUALITY_TABLE.medium.customMaps, plantSway: 1 } });
  });

  it("takes each overridden part from that level's row, and only that part", () => {
    const knobs = knobsWith('low', { grass: 'ultra', shadows: 'high', refraction: true, tileDetail: 'ultra' }, 'full');
    const { low, ultra, high } = QUALITY_TABLE;
    expect(knobs.level).toBe('low');
    expect(knobs.general).toEqual(low.general);
    expect(knobs.customMaps).toMatchObject({ grassBlades: ultra.customMaps.grassBlades, grassDistance: ultra.customMaps.grassDistance });
    expect(knobs.customMaps).toMatchObject({ shadowMapSize: high.customMaps.shadowMapSize, shadowRadius: high.customMaps.shadowRadius });
    expect(knobs.customMaps).toMatchObject({ lodBias: low.customMaps.lodBias, farSingle: low.customMaps.farSingle, particles: low.customMaps.particles });
    expect(knobs.customMaps).toMatchObject({ refraction: true, seaWaves: false, lavaGlow: false });
    expect(knobs.tiles).toEqual(ultra.tiles);
    // The table itself stays as it was
    expect(QUALITY_TABLE.low.customMaps.grassBlades).toBe(0);
  });

  it('scales the plant sway by the plant motion, which no level changes', () => {
    expect(knobsWith('ultra', {}, 'off').customMaps.plantSway).toBe(0);
    expect(knobsWith('low', {}, 'calm').customMaps.plantSway).toBeCloseTo(0.4);
    expect(knobsWith('high', {}, 'full').customMaps.plantSway).toBe(1);
  });

  it("names an own mix per world: only overrides that differ from the world's level count", () => {
    const overrides = { grass: 'high', seaWaves: true, tileDetail: 'low' } as const;
    // High sets High grass and sea waves anyway; the tiles' Low detail is a mix on real places only
    expect(mixedOverrides('high', overrides, 'custom-map')).toEqual([]);
    expect(mixedOverrides('high', overrides, 'tiles')).toEqual(['tileDetail']);
    expect(mixedOverrides('low', overrides, 'custom-map')).toEqual(['grass', 'seaWaves']);
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

  it('measures frame intervals against a slower display, so a 30 Hz screen keeps its resolution', () => {
    const d = new DynamicResolution(0.8, { min: 0.6, max: 1 });
    // The display shows a frame every 33 ms: frames at that pace are fine, dropped ones are not
    expect(d.evaluate(second(1000 / 30), 'interval', 1000 / 30)).toBeNull();
    expect(d.evaluate(second(1000 / 15), 'interval', 1000 / 30)).toBeCloseTo(0.7);
    // A faster display still aims at 60 frames a second
    expect(d.evaluate(second(1000 / 60), 'interval', 1000 / 144)).toBeNull();
    expect(d.evaluate(second(1000 / 30), 'interval', 1000 / 144)).toBeCloseTo(0.6);
    // GPU times keep the 60-frame budget whatever the display
    expect(new DynamicResolution(0.8, { min: 0.6, max: 1 }).evaluate(second(20), 'gpu', 1000 / 30)).toBeCloseTo(0.7);
  });
});

describe('DisplayRefresh', () => {
  const feed = (r: DisplayRefresh, ms: (k: number) => number) => {
    for (let k = 0; k < REFRESH_SAMPLES; k++) r.add(ms(k));
  };

  it("finds the display's pace from frames that drew nothing, snapped to a common rate", () => {
    const r = new DisplayRefresh();
    expect(r.interval).toBeNull();
    feed(r, (k) => 33.1 + (k % 3) * 0.3);
    expect(r.interval).toBeCloseTo(1000 / 30);
  });

  it('takes no uneven run, and keeps the shortest pace it saw', () => {
    const r = new DisplayRefresh();
    // A busy load: frames all over the place
    feed(r, (k) => (k % 2 ? 16.7 : 60));
    expect(r.interval).toBeNull();
    feed(r, () => 1000 / 30);
    feed(r, () => 1000 / 60);
    feed(r, () => 1000 / 30);
    expect(r.interval).toBeCloseTo(1000 / 60);
    // Hidden tabs and stalls are no frames
    r.add(500);
    r.add(-1);
    expect(r.interval).toBeCloseTo(1000 / 60);
  });
});
