/**
 * Auto's one measurement (RenderQualityService): it takes the frames of the
 * world that stands, not those of its load, and stores nothing when too
 * few frames came (the menu's globe covered the game, the tab was hidden).
 */
import '@angular/compiler';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { RenderQualityService } from './render-quality.service';
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
});
