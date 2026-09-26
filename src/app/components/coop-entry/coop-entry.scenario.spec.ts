/**
 * The coop entry after the rework (docs/COOP_UI_REWORK_PLAN.md, P4, U3):
 * one way at a time behind the Online / Same network switch, kept across
 * visits; one host button on the chosen way; the lobby as a select with
 * "Add lobby…"; why a room cannot be joined as text in its row; a lobby
 * that does not answer with Retry; Cancel while connecting. Real template
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
import { CoopEntryComponent } from './coop-entry.component';
import { BUILD_VERSION } from '../../configs/build-info.config';
import type { CoopService } from '../../services/coop.service';

const template = readFileSync(resolve('src/app/components/coop-entry/coop-entry.component.html'), 'utf8');

@Component({ selector: 'td-icon', standalone: true, template: '' })
class IconStub {
  readonly name = input('');
  readonly size = input(16);
}
for (const name of ['name', 'size']) Input({ alias: name, isSignal: true } as Input)(IconStub.prototype, name);
for (const name of ['coop', 'canHost', 'placeName']) Input({ alias: name, isSignal: true } as Input)(CoopEntryComponent.prototype, name);

const EU = { url: 'wss://eu.example.test', name: 'EU', builtIn: true };
const MINE = { url: 'wss://mine.example.test', name: 'Mine', builtIn: false };

function stubCoop(lanAvailable: boolean) {
  const lobby = signal<typeof EU | null>(EU);
  return {
    lanAvailable,
    name: 'Ann',
    roomFromUrl: null,
    status: signal<string>('idle'),
    room: signal(null),
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
    addLobby: vi.fn(() => true),
    removeLobby: vi.fn(),
    probeLobby: vi.fn(async () => ({ ok: true, text: 'This lobby answers.' })),
    probeLan: vi.fn(async () => false),
    leave: vi.fn(),
    installUpdate: vi.fn(),
  };
}

describe('Coop entry, reworked', () => {
  let coop: ReturnType<typeof stubCoop>;

  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => localStorage.clear());

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  function open(lanAvailable: boolean, canHost = true): ComponentFixture<CoopEntryComponent> {
    coop = stubCoop(lanAvailable);
    TestBed.configureTestingModule({});
    TestBed.overrideComponent(CoopEntryComponent, {
      set: { template, templateUrl: undefined, styleUrl: undefined, styles: [], imports: [IconStub] },
    });
    const fixture = TestBed.createComponent(CoopEntryComponent);
    fixture.componentRef.setInput('coop', coop as unknown as CoopService);
    fixture.componentRef.setInput('canHost', canHost);
    fixture.componentRef.setInput('placeName', 'Heilbronn');
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

  it('the web version: no switch, Online only, one "Host a room" that hosts online', () => {
    const fixture = open(false);
    expect(button(fixture, 'Same network')).toBeNull();
    expect(text(fixture)).toContain('Open rooms');
    click(fixture, 'Host a room');
    expect(coop.host).toHaveBeenCalledWith('Ann');
    expect(coop.hostLan).not.toHaveBeenCalled();
  });

  it('the app: the switch shows one way, the host button follows it, the choice is kept', () => {
    const fixture = open(true);
    expect(text(fixture)).not.toContain('Games on this network');
    click(fixture, 'Same network');
    expect(text(fixture)).toContain('Games on this network');
    expect(text(fixture)).not.toContain('Open rooms');
    expect(coop.scanLan).toHaveBeenLastCalledWith(true);
    click(fixture, 'Host a room');
    expect(coop.hostLan).toHaveBeenCalledWith('Ann');

    TestBed.resetTestingModule();
    const again = open(true);
    expect(text(again)).toContain('Games on this network');
  });

  it('the location dialog joins only: no host button', () => {
    const fixture = open(false, false);
    expect(button(fixture, 'Host a room')).toBeNull();
    expect(text(fixture)).toContain('Join with a code');
  });

  it('a room it cannot join says why in its row; its Join does nothing', () => {
    const fixture = open(false);
    coop.publicRooms.set([
      { code: 'AAA111', title: "Bob's room", host: 'Bob', city: 'Paris', players: 1, started: false, wave: 0, cheats: false, gameVersion: '0.0.1' },
    ]);
    fixture.detectChanges();
    expect(text(fixture)).toContain(`The host plays 0.0.1, you play ${BUILD_VERSION}.`);
    const join = button(fixture, 'Join')!;
    expect(join.getAttribute('aria-disabled')).toBe('true');
    join.click();
    expect(coop.join).not.toHaveBeenCalled();
  });

  it('the lobby select: another lobby becomes active, "Add lobby…" opens the fields and keeps the select on the active one', () => {
    const fixture = open(false);
    const select = el(fixture).querySelector<HTMLSelectElement>('.lobby-select')!;
    select.value = MINE.url;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(coop.selectLobby).toHaveBeenCalledWith(MINE.url);

    select.value = '__add';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(el(fixture).querySelector('[aria-label="Lobby address"]')).not.toBeNull();
    expect(select.value).toBe(MINE.url);
    expect(button(fixture, 'Remove Mine')).not.toBeNull();
  });

  it('a lobby that does not answer: a warning strip with Retry, the code field stays', () => {
    const fixture = open(false);
    coop.publicRooms.set(null);
    fixture.detectChanges();
    expect(text(fixture)).toContain('EU does not answer right now.');
    coop.refreshPublicRooms.mockClear();
    click(fixture, 'Retry');
    expect(coop.refreshPublicRooms).toHaveBeenCalledTimes(1);
    expect(el(fixture).querySelector('[aria-label="Room code"]')).not.toBeNull();
  });

  it('connecting: Cancel leaves and drops the intent', () => {
    const fixture = open(false);
    coop.intent.set('join');
    coop.status.set('connecting');
    fixture.detectChanges();
    click(fixture, 'Cancel');
    expect(coop.leave).toHaveBeenCalledTimes(1);
    expect(coop.intent()).toBeNull();
  });
});
