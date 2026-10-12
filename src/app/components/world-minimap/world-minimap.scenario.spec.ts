/**
 * The minimap over a stand-in engine: hidden without a picture from above,
 * its dots where towers and enemies stand, a click glides the camera.
 */
// The component is partially compiled and needs the JIT compiler
import '@angular/compiler';
import { Input } from '@angular/core';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { PerspectiveCamera } from 'three';
import { EllipsoidSync } from '../../three-engine/ellipsoid-sync';
import { CameraControlService } from '../../services/camera-control.service';
import { EngineInitializationService } from '../../services/infrastructure/engine-initialization.service';
import { SimMirror } from '../../sim/client/mirror/sim-mirror';
import { LocationStore } from '../../store/location.store';
import type { WorldMinimap } from '../../world/world-provider';
import { MINIMAP_CSS_PX, WorldMinimapComponent } from './world-minimap.component';
import { TdIconComponent } from '../icon/icon.component';

// The @Input annotation the JIT transform adds for input()
for (const name of ['name', 'size', 'strokeWidth', 'ariaLabel']) {
  Input({ alias: name, isSignal: true } as Input)(TdIconComponent.prototype, name);
}

/** The drawing calls the minimap makes, counted */
function fakeContext(): { ctx: CanvasRenderingContext2D; rects: number[][]; images: number } {
  const rects: number[][] = [];
  const state = { images: 0 };
  const ctx = new Proxy(
    {},
    {
      get: (_t, key) => {
        if (key === 'rect') return (...a: number[]) => rects.push(a);
        if (key === 'drawImage') return () => state.images++;
        return () => undefined;
      },
      set: () => true,
    },
  ) as CanvasRenderingContext2D;
  return {
    ctx,
    rects,
    get images() {
      return state.images;
    },
  };
}

describe('WorldMinimapComponent', () => {
  const sync = new EllipsoidSync(0, 0, 0);
  const camera = new PerspectiveCamera(60, 1, 1, 5000);
  camera.position.set(0, 200, -150);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  let minimap: WorldMinimap | null;
  const engine = {
    sync,
    world: { minimap: () => minimap },
    getCamera: () => camera,
    getTerrainHeightAtGeo: () => 0,
  };
  const focusGeo = vi.fn((_lat: number, _lon: number, _instant?: boolean) => true);
  const enemies = [
    { position: { lat: 0, lon: 0 }, typeConfig: {} },
    { position: { lat: 0.0001, lon: 0 }, typeConfig: { isBoss: true } },
  ];

  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => {
    minimap = null;
    focusGeo.mockClear();
    TestBed.configureTestingModule({
      providers: [
        { provide: EngineInitializationService, useValue: { getEngine: () => engine } },
        { provide: CameraControlService, useValue: { focusGeo } },
        {
          provide: SimMirror,
          useValue: {
            towers: () => [{ position: { lat: 0, lon: -0.0002 } }],
            aliveEnemies: () => enemies,
            routes: () => new Map([['s1', [{ lat: 0.0004, lon: 0.0004 }, { lat: 0, lon: 0 }]]]),
          },
        },
      ],
    });
    TestBed.overrideComponent(WorldMinimapComponent, { set: { styleUrl: undefined, styles: [] } });
    TestBed.inject(LocationStore).spawnPoints.set([{ id: 's1', name: 'North', lat: 0.0004, lon: 0.0004, color: 0xff0000 }]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('closes to a chip and opens again', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeContext().ctx);
    minimap = { picture: document.createElement('canvas'), left: 100, right: -100, top: 100, bottom: -100 };
    const fixture = TestBed.createComponent(WorldMinimapComponent);
    fixture.componentInstance.tick();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    // A custom map's own picture: no look to switch
    expect(el.querySelectorAll('.wm-tools button').length).toBe(1);
    (el.querySelector('[data-test="world-minimap-close"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('canvas')).toBeNull();
    (el.querySelector('[data-test="world-minimap-open"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('canvas')).not.toBeNull();
  });

  it('stays away in a world without a picture from above', () => {
    const fixture = TestBed.createComponent(WorldMinimapComponent);
    fixture.componentInstance.tick();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('canvas')).toBeNull();
  });

  it('draws towers and enemies and glides the camera to a clicked point', () => {
    const { ctx, rects } = fakeContext();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
    minimap = { picture: document.createElement('canvas'), left: 100, right: -100, top: 100, bottom: -100 };
    const fixture = TestBed.createComponent(WorldMinimapComponent);
    const view = fixture.componentInstance;
    view.tick();
    fixture.detectChanges();
    const canvas = fixture.nativeElement.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas).not.toBeNull();

    view.tick();
    // One tower; one enemy and one boss, each a ring and a dot
    expect(rects.length).toBe(5);
    // The tower 0.0002 deg west, about 22 m: left of the middle
    const middle = view.pixels / 2;
    expect(rects[0][0] + rects[0][2] / 2).toBeLessThan(middle);

    // A click on the middle's right edge: east of the HQ
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: MINIMAP_CSS_PX, height: MINIMAP_CSS_PX } as DOMRect);
    view.jump({ clientX: MINIMAP_CSS_PX, clientY: MINIMAP_CSS_PX / 2, currentTarget: canvas } as unknown as PointerEvent);
    const [lat, lon, instant] = focusGeo.mock.calls[0];
    expect(lat).toBeCloseTo(0, 6);
    expect(lon * 111320).toBeCloseTo(100, 0);
    expect(instant).toBe(false);

    // Held and dragged to the top edge: the camera follows at once, up to the release
    view.drag({ pointerId: 1, clientX: MINIMAP_CSS_PX / 2, clientY: 0, currentTarget: canvas } as unknown as PointerEvent);
    expect(focusGeo).toHaveBeenCalledTimes(1);
    view.release({ pointerId: 1, currentTarget: canvas } as unknown as PointerEvent);
    view.jump({ pointerId: 2, clientX: MINIMAP_CSS_PX, clientY: MINIMAP_CSS_PX / 2, currentTarget: canvas } as unknown as PointerEvent);
    view.drag({ pointerId: 2, clientX: MINIMAP_CSS_PX / 2, clientY: 0, currentTarget: canvas } as unknown as PointerEvent);
    const [northLat, , dragged] = focusGeo.mock.calls[2];
    expect(northLat * 111320).toBeCloseTo(100, 0);
    expect(dragged).toBe(true);
    view.release({ pointerId: 2, currentTarget: canvas } as unknown as PointerEvent);
    view.drag({ pointerId: 2, clientX: 0, clientY: 0, currentTarget: canvas } as unknown as PointerEvent);
    expect(focusGeo).toHaveBeenCalledTimes(3);
  });
});
