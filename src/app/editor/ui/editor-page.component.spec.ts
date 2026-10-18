// The component is partially compiled and needs the JIT compiler
import '@angular/compiler';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { EditorPageComponent } from './editor-page.component';
import { EditorSession } from './editor-session.service';
import { AppScreen } from '../../world/app-screen.service';
import { WorldsStageService } from '../../worlds/worlds-stage.service';
import type { MapMeta } from '../../world/custom-map/map-document';

/**
 * The editor's page keeps the map open in this tab for a reload
 * (sessionStorage): also when the map's id changes under it, as a shipped
 * map's first save with a change makes an own copy (MapStore.makeCopy).
 */
describe('EditorPageComponent', () => {
  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    sessionStorage.clear();
  });

  it('a reload opens the own copy a save made of a shipped map, not the shipped one', () => {
    const meta = signal<Pick<MapMeta, 'id' | 'name'> | null>({ id: 'demo-valley', name: 'Demo Valley' });
    const openMap = signal<string | null>('demo-valley');
    const session = { editor: { doc: { meta: meta() } }, state: { meta }, saves: { dirty: signal(false) }, maps: { openMap } };
    const stage = { leaveEditorTo: vi.fn(), notice: signal(null) };
    const screens = { draft: signal(null), guardEditor: () => () => undefined, takeEditorMap: () => null, takeMake: () => null };
    TestBed.configureTestingModule({
      providers: [{ provide: EditorSession, useValue: session }, { provide: AppScreen, useValue: screens }, { provide: WorldsStageService, useValue: stage }],
    });
    TestBed.overrideComponent(EditorPageComponent, { set: { template: '', imports: [] } });
    const fixture = TestBed.createComponent(EditorPageComponent);
    fixture.detectChanges();
    TestBed.tick();
    expect(sessionStorage.getItem('3dtd-editor-map')).toBe('demo-valley');

    meta.set({ id: 'demo-valley-copy', name: 'Demo Valley (copy)' });
    openMap.set('demo-valley-copy');
    TestBed.tick();
    expect(sessionStorage.getItem('3dtd-editor-map')).toBe('demo-valley-copy');
    expect(screens.draft()).toMatchObject({ mapId: 'demo-valley-copy' });
    fixture.destroy();
  });

  it('with no map open and nothing to make it goes to the Built Worlds’ menu, the one list; New map makes one there', () => {
    const run = (make: unknown) => {
      const session = { editor: null, state: { meta: signal(null) }, saves: { dirty: signal(false) }, maps: { openMap: signal(null), close: vi.fn() } };
      const stage = { leaveEditorTo: vi.fn(), notice: signal(null) };
      const screens = { draft: signal(null), guardEditor: () => () => undefined, takeEditorMap: () => null, takeMake: () => make };
      TestBed.configureTestingModule({
        providers: [{ provide: EditorSession, useValue: session }, { provide: AppScreen, useValue: screens }, { provide: WorldsStageService, useValue: stage }],
      });
      TestBed.overrideComponent(EditorPageComponent, { set: { template: '', imports: [] } });
      const fixture = TestBed.createComponent(EditorPageComponent);
      fixture.detectChanges();
      const page = fixture.componentInstance;
      fixture.destroy();
      TestBed.resetTestingModule();
      return { page, stage };
    };
    const nothing = run(null);
    expect(nothing.stage.leaveEditorTo).toHaveBeenCalledWith({ pick: null });
    const making = run({ kind: 'new' });
    expect(making.stage.leaveEditorTo).not.toHaveBeenCalled();
    expect(making.page.make()).toEqual({ kind: 'new' });
  });
});
