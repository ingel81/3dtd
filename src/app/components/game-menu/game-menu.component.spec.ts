/**
 * The game menu (TODO A3): Quit only where the app can end itself, and during
 * a game only after asking; fullscreen through the app's window when there is
 * one, otherwise through the page.
 */
// The component is partially compiled and needs the JIT compiler
import '@angular/compiler';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { GameMenuComponent } from './game-menu.component';
import { CoopService } from '../../services/coop.service';
import { WhatsNewService } from '../../services/onboarding/whats-new.service';
import { GameStore } from '../../store/game.store';

const template = readFileSync(resolve('src/app/components/game-menu/game-menu.component.html'), 'utf8');

interface Setup {
  desktop?: boolean;
  started?: boolean;
  inCoop?: boolean;
  pausedBefore?: boolean;
}

async function setup({ desktop = true, started = false, inCoop = false, pausedBefore = false }: Setup = {}) {
  const bridge = {
    version: '0.5.1',
    onUpdateReady: () => () => undefined,
    installUpdateNow: vi.fn(),
    saveRun: vi.fn(),
    toggleFullscreen: vi.fn(async () => true),
    isFullscreen: vi.fn(async () => false),
    quit: vi.fn(),
  };
  if (desktop) (window as unknown as { desktop?: unknown }).desktop = bridge;
  const close = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      { provide: MatDialogRef, useValue: { close } },
      { provide: MatDialog, useValue: { open: vi.fn(), openDialogs: [] } },
      { provide: WhatsNewService, useValue: { open: vi.fn() } },
      { provide: CoopService, useValue: { inGame: signal(inCoop) } },
    ],
  });
  TestBed.overrideComponent(GameMenuComponent, {
    // The icon's signal inputs need the AOT compiler; the icon is no part of this test
    set: { template, templateUrl: undefined, styleUrl: undefined, styles: [], imports: [], schemas: [NO_ERRORS_SCHEMA] },
  });
  const store = TestBed.inject(GameStore);
  if (started) store.towerCount.set(3);
  store.paused.set(pausedBefore);
  const fixture = TestBed.createComponent(GameMenuComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const buttons = () => [...el.querySelectorAll('button')];
  const byText = (text: string) => buttons().find((b) => b.textContent?.includes(text));
  const click = async (text: string) => {
    byText(text)!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  return { bridge, close, el, byText, click, store, fixture, menu: fixture.componentInstance };
}

describe('GameMenuComponent', () => {
  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    delete (window as unknown as { desktop?: unknown }).desktop;
  });

  it('has no Quit in a browser, a tab cannot close itself', async () => {
    const { byText } = await setup({ desktop: false });
    expect(byText('Quit')).toBeUndefined();
    expect(byText('Fullscreen')).toBeDefined();
  });

  it('quits at once when no game is under way', async () => {
    const { bridge, click } = await setup();
    await click('Quit 3DTD');
    expect(bridge.quit).toHaveBeenCalledTimes(1);
  });

  it('asks first during a game, and Cancel keeps the game', async () => {
    const { bridge, click, el } = await setup({ started: true });
    await click('Quit 3DTD');
    expect(bridge.quit).not.toHaveBeenCalled();
    expect(el.textContent).toContain('This ends the game under way');
    await click('Cancel');
    expect(el.textContent).toContain('Quit 3DTD');
    await click('Quit 3DTD');
    await click('Quit');
    expect(bridge.quit).toHaveBeenCalledTimes(1);
  });

  it('tells a coop player that the partners play on', async () => {
    const { click, el } = await setup({ inCoop: true });
    await click('Quit 3DTD');
    expect(el.textContent).toContain('Your partners play on without you');
  });

  it('pauses a game alone while open and lets it go on when closed', async () => {
    const { store, fixture } = await setup();
    expect(store.paused()).toBe(true);
    fixture.destroy();
    expect(store.paused()).toBe(false);
  });

  it('leaves a game paused before as it was', async () => {
    const { store, fixture } = await setup({ pausedBefore: true });
    fixture.destroy();
    expect(store.paused()).toBe(true);
  });

  it('does not pause coop, where the clock is shared, and says so', async () => {
    const { store, el } = await setup({ inCoop: true });
    expect(store.paused()).toBe(false);
    expect(el.textContent).toContain('The game runs on while you are here');
  });

  it('switches the app window to fullscreen and says so', async () => {
    const { bridge, click, byText } = await setup();
    await click('Fullscreen');
    expect(bridge.toggleFullscreen).toHaveBeenCalledTimes(1);
    expect(byText('Leave fullscreen')).toBeDefined();
  });
});
