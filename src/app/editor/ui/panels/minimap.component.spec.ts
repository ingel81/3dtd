/**
 * The minimap's picture (MinimapComponent): renderTopDown gives it back
 * later (an async read of the GPU's pixels), one at a time, and the map's
 * changes meanwhile ask for one more picture once it came.
 */
import '@angular/compiler';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { MinimapComponent } from './minimap.component';
import { EditorSession } from '../editor-session.service';

function fakeSession() {
  const pending: ((canvas: HTMLCanvasElement) => void)[] = [];
  const renderTopDown = vi.fn(() => new Promise<HTMLCanvasElement>((resolve) => pending.push(resolve)));
  const session = {
    docRev: signal(1),
    viewRev: signal(1),
    cameraRev: signal(0),
    selection: signal([]),
    bookmarks: signal(Array(9).fill(null)),
    doc: { terrain: { width: 512, depth: 512 }, paths: { nodes: [], edges: [] }, spawns: [], hq: { x: 0, y: 0 } },
    viewport: { renderTopDown, dragging: false, viewFootprint: () => [], controller: { current: { target: null } } },
  };
  return { session, renderTopDown, pending };
}

describe('MinimapComponent picture', () => {
  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom has no 2D canvas: the drawing itself is left out
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  function create() {
    const fake = fakeSession();
    TestBed.configureTestingModule({ providers: [{ provide: EditorSession, useValue: fake.session }] });
    const fixture = TestBed.createComponent(MinimapComponent);
    fixture.detectChanges();
    return { ...fake, fixture };
  }

  it('renders one picture at a time and one more for the changes made while it came', async () => {
    const { session, renderTopDown, pending, fixture } = create();
    await vi.advanceTimersByTimeAsync(1300);
    expect(renderTopDown).toHaveBeenCalledTimes(1);

    // Strokes while the picture is on its way: no second render beside it
    session.docRev.set(2);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(3000);
    session.docRev.set(3);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(3000);
    expect(renderTopDown).toHaveBeenCalledTimes(1);

    pending[0](document.createElement('canvas'));
    await vi.advanceTimersByTimeAsync(1300);
    expect(renderTopDown).toHaveBeenCalledTimes(2);
    pending[1](document.createElement('canvas'));
    await vi.advanceTimersByTimeAsync(3000);
    // The map as it is now is pictured: nothing more
    expect(renderTopDown).toHaveBeenCalledTimes(2);
    fixture.destroy();
  });

  it('asks nothing more once it is gone', async () => {
    const { session, renderTopDown, pending, fixture } = create();
    await vi.advanceTimersByTimeAsync(1300);
    session.docRev.set(2);
    fixture.detectChanges();
    fixture.destroy();
    pending[0](document.createElement('canvas'));
    await vi.advanceTimersByTimeAsync(3000);
    expect(renderTopDown).toHaveBeenCalledTimes(1);
  });
});
