import '@angular/compiler';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Component, Injectable, OnDestroy, inject } from '@angular/core';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { ActivatedRoute } from '@angular/router';

const lives: string[] = [];

// The game and the editor as stand-ins: what the shell makes and takes down, and which session the page sees
vi.mock('./game-host.component', async () => {
  const { Component: C } = await import('@angular/core');
  @C({ selector: 'app-game-host', standalone: true, template: 'game' })
  class GameHostComponent implements OnDestroy {
    constructor() {
      lives.push('game');
    }
    ngOnDestroy(): void {
      lives.push('game gone');
    }
  }
  return { GameHostComponent };
});
vi.mock('./editor/ui/editor-session.service', () => {
  let made = 0;
  @Injectable()
  class EditorSession implements OnDestroy {
    readonly id = ++made;
    ngOnDestroy(): void {
      lives.push(`session ${this.id} gone`);
    }
  }
  return { EditorSession };
});
vi.mock('./editor/ui/editor-page.component', async () => {
  const { EditorSession } = await import('./editor/ui/editor-session.service');
  @Component({ selector: 'app-editor-page', standalone: true, template: 'editor' })
  class EditorPageComponent implements OnDestroy {
    private readonly session = inject(EditorSession) as unknown as { id: number };
    constructor() {
      lives.push(`editor on session ${this.session.id}`);
    }
    ngOnDestroy(): void {
      lives.push('editor gone');
    }
  }
  return { EditorPageComponent };
});

import { AppShellComponent } from './app-shell.component';
import { AppScreen } from './world/app-screen.service';
import { WorldStartService } from './world/world-start';

/**
 * The game and the map editor in one window (docs/WORLDS_NAVIGATION_PLAN.md,
 * phase 4): the route names the first screen, AppScreen switches, the
 * editor's session outlives its page and goes with the shell.
 */
describe('AppShellComponent', () => {
  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    lives.length = 0;
  });

  function shell(screen: 'game' | 'editor') {
    TestBed.configureTestingModule({
      providers: [
        { provide: ActivatedRoute, useValue: { snapshot: { data: { screen } } } },
        { provide: WorldStartService, useValue: { editorMap: 'bay' } },
      ],
    });
    return TestBed.createComponent(AppShellComponent);
  }

  it('starts on the screen of its route: the editor on the map of `?map=`', async () => {
    const fixture = shell('editor');
    const screens = TestBed.inject(AppScreen);
    expect(screens.screen()).toBe('editor');
    expect(screens.takeEditorMap()).toBe('bay');
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(lives).toEqual([expect.stringMatching(/^editor on session \d+$/)]);
    });
    expect(fixture.nativeElement.textContent).toContain('editor');
  });

  it('shows one screen at a time, the editor session kept while the game shows, gone with the shell', async () => {
    const fixture = shell('game');
    const screens = TestBed.inject(AppScreen);
    fixture.detectChanges();
    expect(lives).toEqual(['game']);

    screens.openEditor(null);
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(lives.slice(0, 2)).toEqual(['game', 'game gone']);
      expect(lives[2]).toMatch(/^editor on session \d+$/);
    });
    const editor = lives[2];
    const id = editor.split(' ').pop();
    await screens.showGame();
    fixture.detectChanges();
    screens.openEditor(null);
    fixture.detectChanges();
    // The same session: the map and its history wait while the game shows
    expect(lives.slice(3)).toEqual(['editor gone', 'game', 'game gone', editor]);
    fixture.destroy();
    expect(lives.slice(-2)).toEqual(['editor gone', `session ${id} gone`]);
  });

  it('keeps the editor when its own question says no', async () => {
    const fixture = shell('editor');
    const screens = TestBed.inject(AppScreen);
    const off = screens.guardEditor(async () => false);
    expect(await screens.showGame()).toBe(false);
    expect(screens.screen()).toBe('editor');
    off();
    expect(await screens.showGame()).toBe(true);
    fixture.destroy();
  });
});
