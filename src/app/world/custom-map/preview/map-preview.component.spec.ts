/**
 * The map preview page left while its map still loads builds nothing more,
 * and leaving takes its resize listener along (review 2026-10-11). Three's
 * renderer and the map view are stand-ins: no WebGL here.
 */
import '@angular/compiler';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ViewChild } from '@angular/core';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';

const load = vi.hoisted(() => ({ resolve: null as ((value: unknown) => void) | null }));
const built = vi.hoisted(() => ({ views: 0, renderers: [] as { dispose: ReturnType<typeof vi.fn> }[] }));

vi.mock('three', async (importOriginal) => {
  const three = await importOriginal<typeof import('three')>();
  class WebGLRenderer {
    capabilities = { getMaxAnisotropy: () => 1 };
    shadowMap = { enabled: false, type: 0 };
    outputColorSpace = '';
    info = { render: { calls: 0, triangles: 0 } };
    dispose = vi.fn();
    constructor() {
      built.renderers.push(this);
    }
    setPixelRatio = vi.fn();
    setSize = vi.fn();
    render = vi.fn();
  }
  return { ...three, WebGLRenderer };
});
vi.mock('three/examples/jsm/controls/OrbitControls.js', async () => {
  const { Vector3 } = await vi.importActual<typeof import('three')>('three');
  return { OrbitControls: class { target = new Vector3(); enableDamping = false; update = vi.fn(); dispose = vi.fn(); } };
});
vi.mock('../map-store', () => ({
  MapStore: class {
    load(): Promise<unknown> {
      return new Promise((resolve) => (load.resolve = resolve));
    }
  },
}));
vi.mock('../render/custom-map-view', () => ({
  CustomMapView: class {
    constructor() {
      built.views++;
    }
  },
}));

import { MapPreviewComponent } from './map-preview.component';
import { createMapDocument } from '../map-create';

// The query annotation the JIT transform adds for viewChild(); plain vitest runs without it
ViewChild('canvas', { isSignal: true } as unknown as ViewChild)(MapPreviewComponent.prototype, 'canvas');

describe('Map preview page', () => {
  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    history.replaceState(null, '', '/');
  });

  it('builds nothing when it is left while its map still loads', async () => {
    history.replaceState(null, '', '/map-preview?map=valley');
    const listen = vi.spyOn(window, 'addEventListener');
    const fixture = TestBed.createComponent(MapPreviewComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(load.resolve).not.toBeNull());
    fixture.destroy();
    expect(built.renderers.at(-1)!.dispose).toHaveBeenCalled();

    load.resolve!({ doc: createMapDocument({ id: 'valley', name: 'Valley', width: 32, depth: 32 }) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(built.views).toBe(0);
    expect(listen.mock.calls.filter(([type]) => String(type) === 'resize')).toEqual([]);
  });
});
