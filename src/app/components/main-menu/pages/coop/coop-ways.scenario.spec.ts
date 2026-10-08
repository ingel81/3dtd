/**
 * The ways into a coop room on the menu's Coop page, ported from the coop
 * entry: name and lobby on top; Host online on the place loaded (none
 * without a place, "Change place"), asking first when it ends a solo run;
 * Join online by code or from the lobby's list, with why a room cannot be
 * joined, a lobby that does not answer with Retry, the list looked at every
 * few seconds; Same network in the app (scan while shown, Host on this
 * network, the host IP after a quiet while), a pointer to the app in a
 * browser; Cancel while connecting; in a room, Open the room. Real template
 * read from disk, a stand-in CoopService; icons are stubs.
 */
// The component is partially compiled and needs the JIT compiler
import '@angular/compiler';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Component, Input, input, signal } from '@angular/core';
import { getTestBed, TestBed, type ComponentFixture } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { CoopWaysComponent } from './coop-ways.component';
import { BUILD_VERSION } from '../../../../configs/build-info.config';
import { PROTOCOL_VERSION } from '../../../../coop/protocol';
import { COOP } from '../../../../services/coop.token';
import { GameStore } from '../../../../store/game.store';
import { LocationStore } from '../../../../store/location.store';
import { LocationManagementService } from '../../../../services/location/location-management.service';

const template = readFileSync(resolve('src/app/components/main-menu/pages/coop/coop-ways.component.html'), 'utf8');

@Component({ selector: 'td-icon', standalone: true, template: '' })
class IconStub {
  readonly name = input('');
  readonly size = input(16);
}
for (const name of ['name', 'size']) Input({ alias: name, isSignal: true } as Input)(IconStub.prototype, name);

const EU = { url: 'wss://eu.example.test', name: 'EU', builtIn: true };
const MINE = { url: 'wss://mine.example.test', name: 'Mine', builtIn: false };

function stubCoop(lanAvailable: boolean) {
  const lobby = signal<typeof EU | null>(EU);
  return {
    lanAvailable,
    name: 'Ann',
    roomFromUrl: null as string | null,
    status: signal<string>('idle'),
    room: signal<{ code: string } | null>(null),
    error: signal<string | null>(null),
    updateReady: signal(false),
    needsKey: signal(false),
    intent: signal<string | null>(null),
    lobbies: signal([EU, MINE]),
    lobby,
    lobbyPing: signal<number | null>(42),
    publicRooms: signal<unknown[] | null>([]),
    lanGames: signal<unknown[]>([]),
    scanLan: vi.fn(),
    refreshPublicRooms: vi.fn(async () => undefined),
    host: vi.fn(async () => undefined),
    hostLan: vi.fn(async () => undefined),
    join: vi.fn(async () => undefined),
    joinLan: vi.fn(async () => undefined),
    selectLobby: vi.fn((url: string) => lobby.set(url === MINE.url ? MINE : EU)),
    probeLan: vi.fn(async () => false),
    leave: vi.fn(),
    installUpdate: vi.fn(),
  };
}

interface Setup {
  lan?: boolean;
  place?: boolean;
  wave?: number;
  spawns?: number;
  towers?: number;
}

describe('Coop page, the ways in', () => {
  let coop: ReturnType<typeof stubCoop>;

  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => localStorage.clear());

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  function open({ lan = false, place = true, wave = 0, spawns = 1, towers = 0 }: Setup = {}): ComponentFixture<CoopWaysComponent> {
    coop = stubCoop(lan);
    TestBed.configureTestingModule({
      providers: [
        { provide: COOP, useValue: coop },
        {
          provide: LocationManagementService,
          useValue: { hq: signal(place ? { lat: 49.14, lon: 9.21 } : null), getLocationDisplayName: () => 'Heilbronn' },
        },
        { provide: GameStore, useValue: { waveNumber: signal(wave), towerCount: signal(towers), isGameOver: signal(false) } },
        { provide: LocationStore, useValue: { spawnPoints: signal(Array.from({ length: spawns }, (_, i) => ({ id: `s${i}` }))) } },
      ],
    });
    TestBed.overrideComponent(CoopWaysComponent, {
      set: { template, templateUrl: undefined, styleUrl: undefined, styles: [], imports: [IconStub] },
    });
    const fixture = TestBed.createComponent(CoopWaysComponent);
    fixture.detectChanges();
    return fixture;
  }

  const el = (f: ComponentFixture<unknown>) => f.nativeElement as HTMLElement;
  const text = (f: ComponentFixture<unknown>) => el(f).textContent!.replace(/\s+/g, ' ');
  const button = (f: ComponentFixture<unknown>, label: string) =>
    Array.from(el(f).querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent!.trim() === label) ?? null;
  const click = (f: ComponentFixture<unknown>, label: string) => {
    button(f, label)!.click();
    f.detectChanges();
  };

  it('hosts online on the place loaded, with the name given', () => {
    const fixture = open();
    expect(text(fixture)).toContain('Opens a room on Heilbronn.');
    const name = el(fixture).querySelector<HTMLInputElement>('.cw-name')!;
    name.value = 'Bo';
    name.dispatchEvent(new Event('input'));
    click(fixture, 'Host a room');
    expect(coop.host).toHaveBeenCalledWith('Bo');
    expect(coop.name).toBe('Bo');
  });

  it('without a place: no hosting, "Choose a place" goes to New game', () => {
    const fixture = open({ place: false });
    expect(button(fixture, 'Host a room')!.disabled).toBe(true);
    const changes = vi.fn();
    fixture.componentInstance.changePlace.subscribe(changes);
    click(fixture, 'Choose a place');
    expect(changes).toHaveBeenCalledTimes(1);
  });

  it('hosting that would end a solo run asks first; Cancel keeps the run, Host anyway hosts', () => {
    const fixture = open({ wave: 4 });
    click(fixture, 'Host a room');
    expect(coop.host).not.toHaveBeenCalled();
    expect(text(fixture)).toContain('This ends your solo run (wave 4)');
    click(fixture, 'Cancel');
    expect(button(fixture, 'Host a room')).not.toBeNull();
    click(fixture, 'Host a room');
    click(fixture, 'Host anyway');
    expect(coop.host).toHaveBeenCalledWith('Ann');
  });

  it('towers built before the first wave are a run too: asked first', () => {
    const fixture = open({ towers: 2 });
    click(fixture, 'Host a room');
    expect(coop.host).not.toHaveBeenCalled();
    expect(text(fixture)).toContain('This ends your solo run (your towers)');
  });

  it('a map with two spawns keeps its solo run: no question', () => {
    const fixture = open({ wave: 4, spawns: 2 });
    click(fixture, 'Host a room');
    expect(coop.host).toHaveBeenCalledWith('Ann');
  });

  it('joins with a code, upper case', () => {
    const fixture = open();
    const code = el(fixture).querySelector<HTMLInputElement>('input.codein')!;
    code.value = 'abc123';
    code.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    el(fixture).querySelector('.code-row')!.querySelector('button')!.click();
    expect(coop.join).toHaveBeenCalledWith('Ann', 'ABC123');
  });

  it('a room of the list joins with its Join; one it cannot join says why and its Join does nothing', () => {
    const fixture = open();
    coop.publicRooms.set([
      { code: 'AAA111', title: "Bob's room", host: 'Bob', city: 'Paris', players: 1, started: false, wave: 0, cheats: false, gameVersion: '0.0.1' },
      { code: 'BBB222', title: 'Friday', host: 'Cy', city: 'Lyon', players: 1, started: false, wave: 0, cheats: false, gameVersion: BUILD_VERSION },
    ]);
    fixture.detectChanges();
    expect(text(fixture)).toContain(`The host plays 0.0.1, you play ${BUILD_VERSION}.`);
    const joins = Array.from(el(fixture).querySelectorAll<HTMLButtonElement>('.cw-room .btn-xs'));
    expect(joins[0].getAttribute('aria-disabled')).toBe('true');
    joins[0].click();
    expect(coop.join).not.toHaveBeenCalled();
    joins[1].click();
    expect(coop.join).toHaveBeenCalledWith('Ann', 'BBB222');
  });

  it('looks at the open rooms again every 5 s while shown, not in a room', () => {
    vi.useFakeTimers();
    const fixture = open();
    coop.refreshPublicRooms.mockClear();
    vi.advanceTimersByTime(5000);
    expect(coop.refreshPublicRooms).toHaveBeenCalledTimes(1);
    coop.room.set({ code: 'ABC123' });
    fixture.detectChanges();
    vi.advanceTimersByTime(5000);
    expect(coop.refreshPublicRooms).toHaveBeenCalledTimes(1);
  });

  it('the lobby select makes another lobby the active one; its ping stands beside it', () => {
    const fixture = open();
    expect(text(fixture)).toContain('42 ms');
    const select = el(fixture).querySelector<HTMLSelectElement>('.lobby-select')!;
    select.value = MINE.url;
    select.dispatchEvent(new Event('change'));
    expect(coop.selectLobby).toHaveBeenCalledWith(MINE.url);
  });

  it('without a lobby: points to Settings, no host, no code', () => {
    const fixture = open();
    coop.lobbies.set([]);
    coop.lobby.set(null);
    fixture.detectChanges();
    expect(text(fixture)).toContain('No online lobby is set up yet. Settings adds the address you were given.');
    expect(button(fixture, 'Host a room')!.disabled).toBe(true);
    expect(el(fixture).querySelector('input.codein')).toBeNull();
  });

  it('a lobby that does not answer: a strip with Retry; the web version names no same network there', () => {
    const fixture = open();
    coop.publicRooms.set(null);
    fixture.detectChanges();
    expect(text(fixture)).toContain('EU does not answer right now.');
    expect(text(fixture)).not.toContain('Playing on the same network still works');
    coop.refreshPublicRooms.mockClear();
    click(fixture, 'Retry');
    expect(coop.refreshPublicRooms).toHaveBeenCalledTimes(1);
  });

  it('a browser: Same network points to the desktop app; no scan', () => {
    const fixture = open();
    expect(text(fixture)).toContain('Games on the same network run in the desktop app.');
    expect(button(fixture, 'Host on this network')).toBeNull();
    expect(coop.scanLan).not.toHaveBeenCalled();
  });

  it('the app: scans while shown, hosts on this network, joins a game found, says why one cannot be joined', () => {
    const fixture = open({ lan: true });
    expect(coop.scanLan).toHaveBeenLastCalledWith(true);
    expect(text(fixture)).toContain('No game found on this network yet. Searching.');
    click(fixture, 'Host on this network');
    expect(coop.hostLan).toHaveBeenCalledWith('Ann');

    coop.lanGames.set([
      { code: 'LAN111', host: 'Dee', players: 1, protocol: PROTOCOL_VERSION, gameVersion: BUILD_VERSION },
      { code: 'LAN222', host: 'Eve', players: 1, protocol: PROTOCOL_VERSION, gameVersion: '0.0.1' },
    ]);
    fixture.detectChanges();
    const joins = Array.from(el(fixture).querySelectorAll<HTMLButtonElement>('.cw-lan .btn-xs'));
    joins[1].click();
    expect(coop.joinLan).not.toHaveBeenCalled();
    expect(text(fixture)).toContain('Both need the same version.');
    joins[0].click();
    expect(coop.joinLan).toHaveBeenCalledWith('Ann', expect.objectContaining({ code: 'LAN111' }));

    TestBed.resetTestingModule();
    expect(coop.scanLan).toHaveBeenLastCalledWith(false);
  });

  it('the app: after a quiet while the host IP field and the checklist; no answer says so', async () => {
    vi.useFakeTimers();
    const fixture = open({ lan: true });
    vi.advanceTimersByTime(4000);
    fixture.detectChanges();
    expect(text(fixture)).toContain('Guest Wi-Fi often keeps devices apart');
    fixture.componentInstance.hostIp.set('192.168.1.5');
    await fixture.componentInstance.probeLan();
    fixture.detectChanges();
    expect(coop.probeLan).toHaveBeenCalledWith('192.168.1.5');
    expect(text(fixture)).toContain('No game answered at 192.168.1.5.');
  });

  it('connecting: Cancel leaves and drops the intent', () => {
    const fixture = open();
    coop.intent.set('join');
    coop.status.set('connecting');
    fixture.detectChanges();
    click(fixture, 'Cancel');
    expect(coop.leave).toHaveBeenCalledTimes(1);
    expect(coop.intent()).toBeNull();
  });

  it('an error stands under the ways, with Update now when an update waits', () => {
    const fixture = open();
    coop.error.set('This room runs another version.');
    coop.updateReady.set(true);
    fixture.detectChanges();
    expect(text(fixture)).toContain('This room runs another version.');
    click(fixture, 'Update now');
    expect(coop.installUpdate).toHaveBeenCalledTimes(1);
  });

  it('in a room: the code and Open the room instead of the ways', () => {
    const fixture = open();
    coop.room.set({ code: 'ABC123' });
    fixture.detectChanges();
    expect(text(fixture)).toContain('You are in room ABC123.');
    expect(button(fixture, 'Host a room')).toBeNull();
    const opens = vi.fn();
    fixture.componentInstance.openRoom.subscribe(opens);
    click(fixture, 'Open the room');
    expect(opens).toHaveBeenCalledTimes(1);
  });

  it('an invite link fills the code', () => {
    coop = stubCoop(false);
    const fixture = (() => {
      TestBed.configureTestingModule({
        providers: [
          { provide: COOP, useValue: { ...coop, roomFromUrl: 'XYZ789' } },
          { provide: LocationManagementService, useValue: { hq: signal(null), getLocationDisplayName: () => '' } },
          { provide: GameStore, useValue: { waveNumber: signal(0), towerCount: signal(0), isGameOver: signal(false) } },
          { provide: LocationStore, useValue: { spawnPoints: signal([]) } },
        ],
      });
      TestBed.overrideComponent(CoopWaysComponent, {
        set: { template, templateUrl: undefined, styleUrl: undefined, styles: [], imports: [IconStub] },
      });
      const f = TestBed.createComponent(CoopWaysComponent);
      f.detectChanges();
      return f;
    })();
    expect(el(fixture).querySelector<HTMLInputElement>('input.codein')!.value).toBe('XYZ789');
  });
});
