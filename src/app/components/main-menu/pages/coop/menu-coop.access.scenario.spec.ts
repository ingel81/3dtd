/**
 * Coop by where the game runs (E114), on the menu's Coop page: the desktop
 * app and the dev game get the ways in; a browser on the site gets only the
 * hint to the desktop app, with the downloads, and, opened from an invite
 * link, the room to join there. Entering a room hands over to the dock: the
 * menu plays once the place stands (a guest without a place waits for the
 * host's). The ways
 * are a stub here (coop-ways.scenario.spec.ts covers them).
 */
// The components are partially compiled and need the JIT compiler
import '@angular/compiler';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Component, Input, Output, output, signal } from '@angular/core';
import { getTestBed, TestBed, type ComponentFixture } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { MenuCoopComponent } from './menu-coop.component';
import { CoopAppHintComponent, appDownloads } from './coop-app-hint.component';
import { CoopWaysComponent } from './coop-ways.component';
import { APP_DOWNLOADS, coopAccess, type CoopAccess } from '../../../../coop/coop-access';
import { COOP } from '../../../../services/coop.token';
import { UIStore } from '../../../../store/ui.store';
import { MainMenuService } from '../../main-menu.service';

@Component({ selector: 'app-coop-ways', standalone: true, template: 'WAYS' })
class WaysStub {
  readonly changePlace = output<void>();
  readonly openRoom = output<void>();
}
// The annotations the JIT transform adds for input() and output(); plain vitest runs without them
for (const name of ['changePlace', 'openRoom']) Output(name)(WaysStub.prototype, name);
Input({ alias: 'roomCode', isSignal: true } as Input)(CoopAppHintComponent.prototype, 'roomCode');
Input({ alias: 'layer', required: true, isSignal: true } as Input)(MenuCoopComponent.prototype, 'layer');

function stubCoop(access: CoopAccess, roomFromUrl: string | null) {
  return { access, roomFromUrl, room: signal<{ code: string } | null>(null) };
}

describe('Coop page by where the game runs (E114)', () => {
  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  afterEach(() => TestBed.resetTestingModule());

  function open(access: CoopAccess, roomFromUrl: string | null = null, placed = true) {
    const coop = stubCoop(access, roomFromUrl);
    const menu = { open: vi.fn(), close: vi.fn(), requestPlay: vi.fn(), hasPlace: signal(placed) };
    TestBed.configureTestingModule({
      providers: [
        { provide: COOP, useValue: coop },
        { provide: MainMenuService, useValue: menu },
      ],
    });
    TestBed.overrideComponent(MenuCoopComponent, { remove: { imports: [CoopWaysComponent] }, add: { imports: [WaysStub] } });
    TestBed.overrideComponent(CoopAppHintComponent, { set: { styleUrl: undefined, styles: [] } });
    const fixture = TestBed.createComponent(MenuCoopComponent);
    fixture.componentRef.setInput('layer', 'pause');
    fixture.detectChanges();
    return { fixture, coop, menu };
  }

  const text = (f: ComponentFixture<unknown>) => (f.nativeElement as HTMLElement).textContent!.replace(/\s+/g, ' ');
  const links = (f: ComponentFixture<unknown>) =>
    Array.from((f.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>('a')).map((a) => a.getAttribute('href'));
  const ways = (f: ComponentFixture<unknown>) =>
    f.debugElement.query((d) => d.componentInstance instanceof WaysStub).componentInstance as WaysStub;

  it('where: the desktop app, the dev game on this machine, any other browser', () => {
    expect(coopAccess(true, '3dtd.example.test')).toBe('app');
    expect(coopAccess(true, 'localhost')).toBe('app');
    expect(coopAccess(false, 'localhost')).toBe('dev');
    expect(coopAccess(false, '127.0.0.1')).toBe('dev');
    expect(coopAccess(false, '3dtd.example.test')).toBe('hint');
  });

  it('a dev build is the dev game on any host, also over a LAN address; a production build there is not', () => {
    expect(coopAccess(false, '192.168.1.20', true)).toBe('dev');
    expect(coopAccess(false, '192.168.1.20', false)).toBe('hint');
    expect(coopAccess(false, 'localhost', false)).toBe('dev');
    expect(coopAccess(true, '192.168.1.20', true)).toBe('app');
  });

  it('the desktop app and the dev game: the ways in, no hint', () => {
    for (const access of ['app', 'dev'] as const) {
      const { fixture } = open(access);
      expect(text(fixture)).toContain('WAYS');
      expect(text(fixture)).not.toContain('Co-op runs in the desktop app');
      TestBed.resetTestingModule();
    }
  });

  it('a browser on the site: only the hint with the downloads, no ways in', () => {
    const { fixture } = open('hint');
    expect(text(fixture)).not.toContain('WAYS');
    expect(text(fixture)).toContain('Co-op runs in the desktop app');
    expect(text(fixture)).not.toContain('invited');
    expect(links(fixture)).toEqual(expect.arrayContaining([APP_DOWNLOADS.windows, APP_DOWNLOADS.linux, APP_DOWNLOADS.all]));
  });

  it('a browser on the site with an invite link: the same hint, naming the room to join in the app', () => {
    const { fixture } = open('hint', 'ABC123');
    expect(text(fixture)).toContain('You were invited to room ABC123.');
  });

  it("the download for the player's system comes first", () => {
    expect(appDownloads('Mozilla/5.0 (X11; Linux x86_64) Chrome/140')[0].url).toBe(APP_DOWNLOADS.linux);
    expect(appDownloads('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140')[0].url).toBe(APP_DOWNLOADS.windows);
    expect(appDownloads('Mozilla/5.0 (Linux; Android 14) Chrome/140')[0].url).toBe(APP_DOWNLOADS.windows);
  });

  it('a room entered with a place standing plays: the menu goes, the dock holds the room', () => {
    const { coop, menu } = open('app');
    coop.room.set({ code: 'ABC123' });
    TestBed.tick();
    expect(menu.requestPlay).toHaveBeenCalledTimes(1);
  });

  it('a guest who joined before the first place plays once the host place is chosen; the start menu stays meanwhile', () => {
    const { coop, menu } = open('app', null, false);
    coop.room.set({ code: 'ABC123' });
    TestBed.tick();
    expect(menu.requestPlay).not.toHaveBeenCalled();
    expect(menu.close).not.toHaveBeenCalled();
    menu.hasPlace.set(true);
    TestBed.tick();
    expect(menu.requestPlay).toHaveBeenCalledTimes(1);
  });

  it('a room the page found already open does not play by itself', () => {
    const coop = stubCoop('app', null);
    coop.room.set({ code: 'OLD111' });
    const menu = { open: vi.fn(), close: vi.fn(), requestPlay: vi.fn(), hasPlace: signal(true) };
    TestBed.configureTestingModule({ providers: [{ provide: COOP, useValue: coop }, { provide: MainMenuService, useValue: menu }] });
    TestBed.overrideComponent(MenuCoopComponent, { remove: { imports: [CoopWaysComponent] }, add: { imports: [WaysStub] } });
    TestBed.overrideComponent(CoopAppHintComponent, { set: { styleUrl: undefined, styles: [] } });
    const fixture = TestBed.createComponent(MenuCoopComponent);
    fixture.componentRef.setInput('layer', 'pause');
    fixture.detectChanges();
    TestBed.tick();
    expect(menu.requestPlay).not.toHaveBeenCalled();
  });

  it('"Change place" opens New game; "Open the room" opens the dock and closes the menu', () => {
    const { fixture, menu } = open('app');
    ways(fixture).changePlace.emit();
    expect(menu.open).toHaveBeenCalledWith('new-game');
    ways(fixture).openRoom.emit();
    expect(TestBed.inject(UIStore).coopDockOpen()).toBe(true);
    expect(menu.close).toHaveBeenCalledTimes(1);
  });
});
