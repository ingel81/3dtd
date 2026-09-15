// CommonModule pulls in partially compiled @angular/common, which needs the JIT compiler
import '@angular/compiler';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

// The panel's effects wire it to the window service; not under test here
vi.mock('@angular/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@angular/core')>();
  return { ...actual, effect: () => ({ destroy: () => undefined }) };
});

import { Injector, runInInjectionContext, signal, type ElementRef, type QueryList } from '@angular/core';
import { LosDebuggerComponent } from './los-debugger.component';
import { DebugWindowService } from '../../services/debug/debug-window.service';
import { LosDebugService, type HoveredPixelState } from '../../services/debug/los-debug.service';
import type { RouteCell } from '../../utils/route-cell';

/**
 * The readout under the cube faces of the LOS debugger (pixelRgb,
 * hoverCellInfo) reads the mapper's face pixels, which carry no signal. The
 * mapper renders the cube again when a tower is selected or the build
 * preview moves, and the panel repaints the faces from it every 100 ms in
 * its frame loop. The readout follows that repaint, not only the pointer.
 */
describe('LosDebuggerComponent, the readout under the faces', () => {
  const SIZE = 4;
  /** Face 0, pixel (1, 2): the one under the pointer */
  const PIXEL: HoveredPixelState = { face: 0, px: 1, py: 2, layer: 'ground' };
  const R = (PIXEL.py * SIZE + PIXEL.px) * 4;

  let frames: FrameRequestCallback[];
  let data: Uint8ClampedArray;
  let losDebug: {
    hoveredPixel: ReturnType<typeof signal<HoveredPixelState | null>>;
    hoveredCell: ReturnType<typeof signal<RouteCell | null>>;
    towerTip: ReturnType<typeof signal<{ x: number; y: number; z: number } | null>>;
  };
  let panel: LosDebuggerComponent;

  /** One frame of the panel's loop at `now` ms; from 100 ms on it repaints the faces. */
  const frame = (now: number) => {
    const due = frames;
    frames = [];
    for (const callback of due) callback(now);
  };

  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    // Nothing in front of any pixel: depth 255, the far distance
    data = new Uint8ClampedArray(SIZE * SIZE * 4).fill(255);
    const image = { width: SIZE, height: SIZE, data } as unknown as ImageData;
    const mapper = { isReady: () => true, getFaceImageData: () => image, getFarDistance: () => 100 };
    losDebug = {
      hoveredPixel: signal<HoveredPixelState | null>(null),
      hoveredCell: signal<RouteCell | null>(null),
      towerTip: signal<{ x: number; y: number; z: number } | null>(null),
    };
    const injector = Injector.create({
      providers: [
        { provide: DebugWindowService, useValue: {} },
        {
          provide: LosDebugService,
          useValue: { ...losDebug, getFaceSize: () => SIZE, getMapper: () => mapper, setEnabled: vi.fn() },
        },
      ],
    });
    panel = runInInjectionContext(injector, () => new LosDebuggerComponent());
    // The face canvases; jsdom paints nothing on them
    panel.faceCanvases = { toArray: () => [] } as unknown as QueryList<ElementRef<HTMLCanvasElement>>;
    panel.ngAfterViewInit();
  });

  afterEach(() => {
    panel.ngOnDestroy();
    vi.unstubAllGlobals();
  });

  it('shows the pixel under the resting pointer as the mapper rendered it last', () => {
    losDebug.hoveredPixel.set(PIXEL);
    expect(panel.pixelRgb()).toMatchObject({ r: 255, depth: '1.000' });

    // The cube is rendered again: something now stands in front of that pixel
    data[R] = 51;
    frame(1000);
    expect(panel.pixelRgb()).toMatchObject({ r: 51, depth: '0.200' });
  });

  it('turns the hovered cell from visible to blocked with the repaint that shows the blocker', () => {
    losDebug.towerTip.set({ x: 0, y: 10, z: 0 });
    losDebug.hoveredCell.set({ key: 7, x: 0, z: 20, terrainHeight: 0 } as unknown as RouteCell);
    losDebug.hoveredPixel.set(PIXEL);
    expect(panel.hoverCellInfo()).toMatchObject({ blockerDist: '100.0m', visible: 'visible' });

    data[R] = 0;
    frame(1000);
    expect(panel.hoverCellInfo()).toMatchObject({ blockerDist: '0.0m', visible: 'blocked' });
  });
});
