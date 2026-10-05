/**
 * The frame of every debug panel brings a panel back into view: one stored
 * off the page (a larger screen before, or a position left or above it) on
 * opening, and one the window shrank past while it was open.
 */
// CommonModule pulls in partially compiled @angular/common, which needs the JIT compiler
import '@angular/compiler';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import { DraggableDebugPanelComponent } from './draggable-debug-panel.component';
import { DebugWindowService, type WindowPosition } from '../../services/debug/debug-window.service';

describe('DraggableDebugPanelComponent, kept in view', () => {
  let frames: FrameRequestCallback[];

  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal('innerWidth', 1000);
    vi.stubGlobal('innerHeight', 800);
    localStorage.clear();
  });

  afterEach(() => vi.unstubAllGlobals());

  /**
   * The panel `tower` (320 x 550 by default) at `position`, opened; what it
   * asks to move to. Built by hand: its signal inputs need the AOT compiler.
   */
  function panel(position: WindowPosition) {
    const windows = new DebugWindowService();
    const injector = Injector.create({ providers: [{ provide: DebugWindowService, useValue: windows }] });
    const component = runInInjectionContext(injector, () => new DraggableDebugPanelComponent());
    const inputs = component as unknown as Record<'windowId' | 'position', unknown>;
    inputs.windowId = signal('tower');
    inputs.position = signal(position);
    const moved: WindowPosition[] = [];
    component.positionChange.subscribe((p) => moved.push(p));
    component.ngAfterViewInit();
    for (const callback of frames.splice(0)) callback(0);
    return { component, moved, windows };
  }

  it('moves a panel stored off the page back on opening, left and top included', () => {
    expect(panel({ x: 2000, y: 1500 }).moved).toEqual([{ x: 680, y: 250 }]);
    expect(panel({ x: -50, y: -20 }).moved).toEqual([{ x: 0, y: 0 }]);
  });

  it('leaves a panel in view where it is', () => {
    expect(panel({ x: 20, y: 80 }).moved).toEqual([]);
  });

  it('brings an open panel back when the window shrinks past it', () => {
    const { component, moved, windows } = panel({ x: 600, y: 200 });
    expect(moved).toEqual([]);
    vi.stubGlobal('innerWidth', 700);
    component.onWindowResize();
    expect(moved).toEqual([{ x: 380, y: 200 }]);
    expect(windows.getSize('tower')).toEqual({ width: 320, height: 550 });
  });
});
