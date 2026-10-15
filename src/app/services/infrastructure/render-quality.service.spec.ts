/**
 * Auto's one measurement (RenderQualityService): it takes the frames of the
 * world that stands, not those of its load, and stores nothing when too
 * few frames came (the menu's globe covered the game, the tab was hidden).
 * The player's overrides per world: stored, drawn at once, gone when a level
 * is picked again (E156).
 */
import '@angular/compiler';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { RenderQualityService } from './render-quality.service';
import { IntroCameraFlightService } from '../world/intro-camera-flight.service';
import { QUALITY_STORAGE_KEY, readStoredQuality } from '../../three-engine/render-quality';
import type { ThreeTilesEngine } from '../../three-engine';

/** An engine whose GPU meter hands out the frames `frames` holds when read */
function fakeEngine() {
  const frames: number[] = [];
  const readers: number[] = [];
  const engine = {
    applyQuality: vi.fn(),
    gpuMeter: {
      open: () => {
        readers.push(1);
        return { take: () => frames.splice(0), close: () => readers.pop() };
      },
    },
  };
  return { engine: engine as unknown as ThreeTilesEngine, frames, readers };
}

describe('RenderQualityService Auto measurement', () => {
  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => {
    localStorage.removeItem(QUALITY_STORAGE_KEY);
    // No WebGL here: the GPU's name is empty
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
    localStorage.removeItem(QUALITY_STORAGE_KEY);
  });

  it('measures only once the world stands', async () => {
    const quality = TestBed.inject(RenderQualityService);
    const { engine, frames, readers } = fakeEngine();
    quality.attach(engine, { kind: 'custom-map', mapId: 'demo-valley' } as never);
    expect(engine.applyQuality).toHaveBeenCalledTimes(1);
    // The load draws cheap frames: nobody reads them
    await vi.advanceTimersByTimeAsync(5000);
    expect(readers).toHaveLength(0);

    quality.worldStood(engine);
    await vi.advanceTimersByTimeAsync(2000);
    expect(readers).toHaveLength(1);
    for (let k = 0; k < 120; k++) frames.push(5);
    await vi.advanceTimersByTimeAsync(500);
    expect(readers).toHaveLength(0);
    expect(quality.autoMeasured()).toBe(true);
    expect(readStoredQuality().auto?.measured).toBe(true);
  });

  it('switches to the measured level only after the intro flight, not in its middle', async () => {
    let flying = true;
    TestBed.configureTestingModule({ providers: [{ provide: IntroCameraFlightService, useValue: { isRunning: () => flying } }] });
    const quality = TestBed.inject(RenderQualityService);
    const { engine, frames } = fakeEngine();
    quality.attach(engine, { kind: 'custom-map', mapId: 'demo-valley' } as never);
    quality.worldStood(engine);
    await vi.advanceTimersByTimeAsync(2000);
    for (let k = 0; k < 120; k++) frames.push(5);
    // Measured, but the intro still flies: nothing stored, the level does not change under it
    await vi.advanceTimersByTimeAsync(5000);
    expect(quality.autoMeasured()).toBe(false);
    flying = false;
    await vi.advanceTimersByTimeAsync(500);
    expect(quality.autoMeasured()).toBe(true);
  });

  it('waits for the first frames, and stores nothing when too few came before the world went', async () => {
    const quality = TestBed.inject(RenderQualityService);
    const { engine, frames, readers } = fakeEngine();
    quality.attach(engine, { kind: 'custom-map', mapId: 'demo-valley' } as never);
    quality.worldStood(engine);
    // The menu's globe covers the game: no frames, the measurement keeps waiting
    await vi.advanceTimersByTimeAsync(20_000);
    expect(readers).toHaveLength(1);
    // A few frames, then the world goes
    frames.push(5, 5, 5);
    await vi.advanceTimersByTimeAsync(500);
    quality.detach(engine);
    await vi.advanceTimersByTimeAsync(500);
    expect(readers).toHaveLength(0);
    expect(quality.autoMeasured()).toBe(false);
    expect(readStoredQuality().auto).toBeNull();
  });

  it('keeps overrides per world on top of the level, stored and drawn at once, until a level is picked', async () => {
    const quality = TestBed.inject(RenderQualityService);
    const { engine } = fakeEngine();
    quality.set('high');
    quality.attach(engine, { kind: 'custom-map', mapId: 'demo-valley' } as never);
    const applied = () => vi.mocked(engine.applyQuality).mock.lastCall![0];

    quality.setOverride('grass', 'low');
    quality.setOverride('refraction', false);
    quality.setPlantMotion('calm');
    TestBed.tick();
    expect(applied().customMaps).toMatchObject({ grassBlades: 0, refraction: false, plantSway: 0.4, shadowMapSize: 4096 });
    expect(quality.mixed('custom-map')).toEqual(['grass', 'refraction']);
    expect(quality.mixed('tiles')).toEqual([]);
    expect(readStoredQuality()).toMatchObject({ setting: 'high', overrides: { grass: 'low', refraction: false }, plantMotion: 'calm' });

    // A new page load reads them back
    TestBed.resetTestingModule();
    const again = TestBed.inject(RenderQualityService);
    expect(again.knobsFor('custom-map').customMaps).toMatchObject({ grassBlades: 0, refraction: false, plantSway: 0.4 });
    expect(again.overrideValue('grass')).toBe('low');
    expect(again.overrideValue('shadows')).toBe('high');

    // What the level sets anyway is no override; back to the level clears only that world
    again.setOverride('refraction', true);
    again.setOverride('tileDetail', 'ultra');
    expect(again.overrides()).toEqual({ grass: 'low', tileDetail: 'ultra' });
    again.resetOverrides('custom-map');
    expect(again.overrides()).toEqual({ tileDetail: 'ultra' });

    // Picking a level sets every part again; the plant motion stays
    again.setOverride('grass', 'ultra');
    again.set('medium');
    expect(again.overrides()).toEqual({});
    expect(again.plantMotion()).toBe('calm');
  });
});
