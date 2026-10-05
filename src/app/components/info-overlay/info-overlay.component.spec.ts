/**
 * The info overlay's logic (TODO E75, E91): the caret says what the next
 * click does, the meter listens only while the numbers show, the chart rows
 * carry the newest value and the minute's range, and Enter steps the
 * overlay only where the keyboard focused it. The template is the
 * TestBed's business elsewhere; its signal inputs need the AOT compiler.
 */
// The component is partially compiled and needs the JIT compiler
import '@angular/compiler';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { InfoOverlayComponent } from './info-overlay.component';
import { SimMeterService, type MeterSample } from '../../services/debug/sim-meter.service';
import { UIStore } from '../../store/ui.store';
import { trackFocusOrigin } from '../../utils/keyboard-target';

const sample = (over: Partial<MeterSample>): MeterSample => ({
  fps: 60, speed: 1, speedSet: 1, paused: false, workerLoad: 0.5, ticksPerS: 30,
  applyPerPacketMs: 0.2, enemies: 0, soundsRequestedPerS: 0, soundsPlayedPerS: 0, ...over,
});

describe('InfoOverlayComponent', () => {
  let meter: { latest: ReturnType<typeof signal<MeterSample | null>>; history: ReturnType<typeof signal<readonly MeterSample[]>>; setActive: ReturnType<typeof vi.fn>; sharedMemory: boolean };

  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => {
    localStorage.clear();
    meter = { latest: signal(null), history: signal([]), setActive: vi.fn(), sharedMemory: true };
    TestBed.configureTestingModule({ providers: [{ provide: SimMeterService, useValue: meter }] });
  });

  afterEach(() => TestBed.resetTestingModule());

  const overlay = () => TestBed.runInInjectionContext(() => new InfoOverlayComponent());

  it('shows by its caret what the next click does, and steps collapsed, expanded, wide, collapsed', () => {
    const info = overlay();
    const ui = TestBed.inject(UIStore);
    const carets: string[] = [];
    for (let i = 0; i < 4; i++) {
      carets.push(info.caret());
      ui.toggleInfoOverlay();
    }
    expect(carets).toEqual(['caret', 'caretR', 'caretU', 'caret']);
  });

  it('lets the meter listen only while the numbers show', () => {
    overlay();
    const ui = TestBed.inject(UIStore);
    TestBed.tick();
    expect(meter.setActive).toHaveBeenLastCalledWith(false);
    ui.toggleInfoOverlay();
    TestBed.tick();
    expect(meter.setActive).toHaveBeenLastCalledWith(true);
  });

  it('puts the newest value right of each chart and the range of the minute below', () => {
    const info = overlay();
    meter.history.set([sample({ fps: 30, ticksPerS: 28, workerLoad: 0.95 }), sample({ fps: 144.4, ticksPerS: 31, workerLoad: 0.42 })]);
    expect(info.chartRows().map(({ label, now, range }) => ({ label, now, range }))).toEqual([
      { label: 'FPS', now: '144', range: 'min 30 · max 144' },
      { label: 'Packets', now: '31', range: 'min 28 · max 31' },
      { label: 'Sim', now: '42%', range: 'max 95%' },
    ]);
  });

  it('steps on Enter where the keyboard focused it, not after a click', () => {
    const info = overlay();
    const ui = TestBed.inject(UIStore);
    const box = document.createElement('aside');
    box.setAttribute('role', 'button');
    box.tabIndex = 0;
    document.body.appendChild(box);
    const enter = () => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
      box.addEventListener('keydown', (e) => info.onKey(e), { once: true });
      box.dispatchEvent(event);
      return event;
    };
    // The game sets the focus tracking up at its start
    trackFocusOrigin();
    try {
      box.focus();
      const pressed = enter();
      expect(ui.infoOverlayVisible()).toBe(true);
      expect(pressed.defaultPrevented).toBe(true);

      box.blur();
      document.dispatchEvent(new Event('pointerdown'));
      box.focus();
      expect(enter().defaultPrevented).toBe(false);
      expect(ui.infoOverlayWide()).toBe(false);
    } finally {
      box.remove();
    }
  });
});
