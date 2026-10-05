/**
 * Coop by where the game runs (E114): the desktop app and the dev game get
 * the coop entry; a browser on the site gets only the hint to the desktop
 * app, with the downloads, and, opened from an invite link, the room to join
 * there. Real templates read from disk, a stand-in CoopService; the entry
 * and the room parts are stubs.
 */
// The components are partially compiled and need the JIT compiler
import '@angular/compiler';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, Input, input, signal } from '@angular/core';
import { getTestBed, TestBed, type ComponentFixture } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CoopDockComponent } from './coop-dock.component';
import { CoopAppHintComponent, appDownloads } from '../coop-entry/coop-app-hint.component';
import { APP_DOWNLOADS, coopAccess, type CoopAccess } from '../../coop/coop-access';
import { CoopService } from '../../services/coop.service';
import { UIStore } from '../../store/ui.store';
import { GameStore } from '../../store/game.store';
import { LocationManagementService } from '../../services/location/location-management.service';

const dockTemplate = readFileSync(resolve('src/app/components/coop-dock/coop-dock.component.html'), 'utf8');

@Component({ selector: 'td-icon', standalone: true, template: '' })
class IconStub {
  readonly name = input('');
  readonly size = input(16);
}
@Component({ selector: 'app-coop-entry', standalone: true, template: 'ENTRY' })
class EntryStub {
  readonly coop = input<unknown>(null);
  readonly canHost = input(true);
  readonly placeName = input('');
}
for (const name of ['name', 'size']) Input({ alias: name, isSignal: true } as Input)(IconStub.prototype, name);
for (const name of ['coop', 'canHost', 'placeName']) Input({ alias: name, isSignal: true } as Input)(EntryStub.prototype, name);
Input({ alias: 'roomCode', isSignal: true } as Input)(CoopAppHintComponent.prototype, 'roomCode');

function stubCoop(access: CoopAccess, roomFromUrl: string | null) {
  return {
    access,
    roomFromUrl,
    lanAvailable: access === 'app',
    status: signal('idle'),
    intent: signal<string | null>(null),
    room: signal(null),
    error: signal<string | null>(null),
    worldReady: signal(false),
    isHost: signal(false),
    playerId: signal<string | null>(null),
    nameOf: () => '',
  };
}

describe('Coop by where the game runs (E114)', () => {
  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  afterEach(() => TestBed.resetTestingModule());

  function openDock(access: CoopAccess, roomFromUrl: string | null = null): ComponentFixture<CoopDockComponent> {
    TestBed.configureTestingModule({
      providers: [
        { provide: CoopService, useValue: stubCoop(access, roomFromUrl) },
        { provide: UIStore, useValue: { infoOverlayBottom: signal(0), coopDockOpen: signal(true) } },
        { provide: GameStore, useValue: { waveNumber: signal(0), isGameOver: signal(false) } },
        { provide: LocationManagementService, useValue: { getLocationDisplayName: () => 'Heilbronn' } },
      ],
    });
    TestBed.overrideComponent(CoopDockComponent, {
      set: {
        template: dockTemplate,
        templateUrl: undefined,
        styleUrl: undefined,
        styles: [],
        imports: [MatTooltipModule, IconStub, EntryStub, CoopAppHintComponent],
      },
    });
    TestBed.overrideComponent(CoopAppHintComponent, { set: { styleUrl: undefined, styles: [] } });
    const fixture = TestBed.createComponent(CoopDockComponent);
    fixture.detectChanges();
    return fixture;
  }

  const text = (f: ComponentFixture<unknown>) => (f.nativeElement as HTMLElement).textContent!.replace(/\s+/g, ' ');
  const links = (f: ComponentFixture<unknown>) =>
    Array.from((f.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>('a')).map((a) => a.getAttribute('href'));

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

  it('the desktop app: the coop entry, no hint', () => {
    const fixture = openDock('app');
    expect(text(fixture)).toContain('ENTRY');
    expect(text(fixture)).not.toContain('Co-op runs in the desktop app');
  });

  it('the dev game: the coop entry for tests, no hint', () => {
    const fixture = openDock('dev');
    expect(text(fixture)).toContain('ENTRY');
    expect(text(fixture)).not.toContain('Co-op runs in the desktop app');
  });

  it('a browser on the site: only the hint with the downloads, no entry', () => {
    const fixture = openDock('hint');
    expect(text(fixture)).not.toContain('ENTRY');
    expect(text(fixture)).toContain('Co-op runs in the desktop app');
    expect(text(fixture)).not.toContain('invited');
    expect(links(fixture)).toEqual(expect.arrayContaining([APP_DOWNLOADS.windows, APP_DOWNLOADS.linux, APP_DOWNLOADS.all]));
  });

  it('a browser on the site with an invite link: the same hint, naming the room to join in the app', () => {
    const fixture = openDock('hint', 'ABC123');
    expect(text(fixture)).not.toContain('ENTRY');
    expect(text(fixture)).not.toContain('Joining');
    expect(text(fixture)).toContain('You were invited to room ABC123.');
  });

  it("the download for the player's system comes first", () => {
    expect(appDownloads('Mozilla/5.0 (X11; Linux x86_64) Chrome/140')[0].url).toBe(APP_DOWNLOADS.linux);
    expect(appDownloads('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140')[0].url).toBe(APP_DOWNLOADS.windows);
    expect(appDownloads('Mozilla/5.0 (Linux; Android 14) Chrome/140')[0].url).toBe(APP_DOWNLOADS.windows);
  });
});
