import { describe, expect, it, vi } from 'vitest';
import { Injector, runInInjectionContext, signal } from '@angular/core';

// The page's renderer without WebGL: a lease reports the MSAA it was asked for
vi.mock('../../three-engine/renderer-host', () => ({
  RendererHost: class {
    acquire(_slot: HTMLElement, msaa: boolean) {
      return { renderer: {}, msaa, release: () => undefined, keep: () => undefined };
    }
  },
}));

import { RendererHostService } from './renderer-host.service';
import { RenderQualityService } from './render-quality.service';

function setup() {
  const antialias = signal<'msaa' | 'fxaa'>('msaa');
  const quality = { canvasMsaa: () => antialias() === 'msaa' };
  const injector = Injector.create({ providers: [{ provide: RenderQualityService, useValue: quality }] });
  const host = runInInjectionContext(injector, () => new RendererHostService());
  return { host, antialias, slot: {} as HTMLElement };
}

describe('RendererHostService antialiasing of the view drawing now', () => {
  it('tells a level picked in play whose antialiasing the canvas cannot switch, until the view goes', () => {
    const { host, antialias, slot } = setup();
    expect(host.antialiasPending()).toBe(false);
    const lease = host.acquire(slot, 'custom-map');
    expect(host.lent()).toEqual({ world: 'custom-map', msaa: true });
    expect(host.antialiasPending()).toBe(false);
    // Medium in play: the canvas keeps its MSAA until the next start
    antialias.set('fxaa');
    expect(host.antialiasPending()).toBe(true);
    lease.release();
    expect(host.lent()).toBeNull();
    expect(host.antialiasPending()).toBe(false);
    // The next view acquires with the level's
    host.acquire(slot, 'custom-map');
    expect(host.lent()).toEqual({ world: 'custom-map', msaa: false });
    expect(host.antialiasPending()).toBe(false);
  });

  it('keeps the later view when an earlier lease is given back late', () => {
    const { host, slot } = setup();
    const first = host.acquire(slot, 'tiles');
    host.acquire(slot, 'custom-map');
    first.release();
    expect(host.lent()?.world).toBe('custom-map');
  });
});
