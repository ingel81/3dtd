/**
 * The menu's Settings page: the four volumes with mutes, the graphics preset
 * and every display switch of the former Display menu (stored through the
 * DebugFacadeService), the frame limit, fullscreen through the app's window,
 * the game speed (the host's in coop), the auto-start, "Change key", the
 * coop name and lobbies, the run upload answer. The real template is read
 * from disk; the display, the config and the coop service are fakes.
 */
// The component is partially compiled and needs the JIT compiler
import '@angular/compiler';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { UIStore } from '../../../../store/ui.store';
import { GameStore } from '../../../../store/game.store';
import { COOP } from '../../../../services/coop.token';
import { ConfigService } from '../../../../core/services/config.service';
import { DebugFacadeService } from '../../../../services/debug/debug-facade.service';
import { VFX_PRESETS, type VfxSettings } from '../../../../three-engine/vfx-settings';
import { SettingsSectionsComponent } from './settings-sections.component';

const template = readFileSync(resolve('src/app/components/main-menu/pages/settings/settings-sections.component.html'), 'utf8');

const EU = { url: 'wss://eu.example.test', name: 'EU', builtIn: true };
const MINE = { url: 'wss://mine.example.test', name: 'Mine', builtIn: false };

interface Setup {
  desktop?: boolean;
  inCoop?: boolean;
  host?: boolean;
  coop?: boolean;
}

describe('Settings page', () => {
  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  beforeEach(() => localStorage.clear());

  afterEach(() => {
    TestBed.resetTestingModule();
    delete (window as unknown as { desktop?: unknown }).desktop;
  });

  async function setup({ desktop = true, inCoop = false, host = true, coop = true }: Setup = {}) {
    const bridge = {
      version: '0.6.0',
      onUpdateReady: () => () => undefined,
      installUpdateNow: vi.fn(),
      saveRun: vi.fn(),
      toggleFullscreen: vi.fn(async () => true),
      isFullscreen: vi.fn(async () => false),
    };
    if (desktop) (window as unknown as { desktop?: unknown }).desktop = bridge;
    const vfx = signal<VfxSettings>({ ...VFX_PRESETS.high, freezeTint: true, bloodMoon: true });
    const display = {
      vfx,
      fpsLimit: signal(0),
      screenShakeEnabled: signal(true),
      bossIntroEnabled: signal(true),
      healthBarsVisible: signal(true),
      damageNumbersVisible: signal(true),
      onVfxPresetSelected: vi.fn(),
      onVfxSettingsChanged: vi.fn((change: Partial<VfxSettings>) => vfx.update((v) => ({ ...v, ...change }))),
      onFpsLimitChanged: vi.fn(),
      onScreenShakeToggled: vi.fn(),
      onBossIntroToggled: vi.fn(),
      onHealthBarsToggled: vi.fn(),
      onDamageNumbersToggled: vi.fn(),
    };
    const config = { tileProvider: signal<'cesium' | 'google'>('cesium'), setupRequested: signal(false) };
    const lobby = signal(EU);
    const coopService = {
      name: 'Ann',
      inGame: signal(inCoop),
      isHost: signal(host),
      lobbies: signal([EU, MINE]),
      lobby,
      addLobby: vi.fn((_name: string, url: string) => url.startsWith('ws')),
      removeLobby: vi.fn(),
      probeLobby: vi.fn(async () => ({ ok: true, text: 'This lobby answers.' })),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: DebugFacadeService, useValue: display },
        { provide: ConfigService, useValue: config },
        ...(coop ? [{ provide: COOP, useValue: coopService }] : []),
      ],
    });
    TestBed.overrideComponent(SettingsSectionsComponent, {
      // The icon's signal inputs need the AOT compiler; the icon is no part of this test
      set: { template, templateUrl: undefined, styleUrl: undefined, styles: [], imports: [], schemas: [NO_ERRORS_SCHEMA] },
    });
    const fixture = TestBed.createComponent(SettingsSectionsComponent);
    const leave = vi.fn();
    fixture.componentInstance.leave.subscribe(leave);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const settle = async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((done) => setTimeout(done, 0));
      fixture.detectChanges();
    };
    const byText = (text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
    const switchOf = (label: string) =>
      [...el.querySelectorAll<HTMLLabelElement>('label')].find((l) => l.textContent!.trim() === label)!.querySelector('input')!;
    return { fixture, el, display, config, coopService, bridge, leave, settle, byText, switchOf };
  }

  const radios = (el: HTMLElement, group: string) =>
    [...el.querySelectorAll<HTMLButtonElement>(`[role="radiogroup"][aria-label="${group}"] [role="radio"], [role="radiogroup"][aria-labelledby="${group}"] [role="radio"]`)];

  it('has a slider and a mute for each of master, effects, music and interface', async () => {
    const { el, fixture } = await setup();
    const ui = TestBed.inject(UIStore);
    const sliders = [...el.querySelectorAll<HTMLInputElement>('input[type="range"]')];
    expect(sliders.map((s) => s.getAttribute('aria-label'))).toEqual([
      'Master volume', 'Effects volume', 'Music volume', 'Interface volume',
    ]);
    ui.sfxMuted.set(true);
    sliders[1].value = '30';
    sliders[1].dispatchEvent(new Event('input'));
    expect(ui.sfxVolume()).toBeCloseTo(0.3);
    expect(ui.sfxMuted()).toBe(false);
    el.querySelector<HTMLButtonElement>('[aria-label="Mute music"]')!.click();
    fixture.detectChanges();
    expect(ui.musicMuted()).toBe(true);
  });

  it('picks the effect preset and sets every display switch of the former Display menu', async () => {
    const { el, display, switchOf, fixture } = await setup();
    expect(radios(el, 'Effect quality').map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true']);
    radios(el, 'Effect quality')[0].click();
    expect(display.onVfxPresetSelected).toHaveBeenCalledWith('low');

    switchOf('Bloom').click();
    expect(display.onVfxSettingsChanged).toHaveBeenCalledWith({ bloom: true });
    fixture.detectChanges();
    expect(el.textContent).toContain('Your own mix');
    switchOf('Freeze tint').click();
    expect(display.onVfxSettingsChanged).toHaveBeenLastCalledWith({ freezeTint: false });
    switchOf('Blood Moon').click();
    switchOf('Screen shake').click();
    switchOf('Boss intro').click();
    switchOf('Health bars').click();
    switchOf('Damage numbers').click();
    expect(display.onScreenShakeToggled).toHaveBeenCalledWith(false);
    expect(display.onBossIntroToggled).toHaveBeenCalledWith(false);
    expect(display.onHealthBarsToggled).toHaveBeenCalledWith(false);
    expect(display.onDamageNumbersToggled).toHaveBeenCalledWith(false);

    const grading = el.querySelector<HTMLSelectElement>('select')!;
    grading.value = 'noir';
    grading.dispatchEvent(new Event('change'));
    expect(display.onVfxSettingsChanged).toHaveBeenLastCalledWith({ colorGrading: 'noir' });

    radios(el, 'td-set-fps')[1].click();
    expect(display.onFpsLimitChanged).toHaveBeenCalledWith(60);
  });

  it('switches the app window to fullscreen and says so', async () => {
    const { bridge, byText, settle } = await setup();
    byText('Fullscreen')!.click();
    await settle();
    expect(bridge.toggleFullscreen).toHaveBeenCalledTimes(1);
    expect(byText('Leave fullscreen')).toBeDefined();
  });

  it('sets the game speed and the auto-start; in coop the speed is the host\'s', async () => {
    const { el, switchOf } = await setup();
    const store = TestBed.inject(GameStore);
    radios(el, 'td-set-speed')[2].click();
    expect(store.gameSpeed()).toBe(4);
    const ui = TestBed.inject(UIStore);
    const before = ui.autoStartWaves();
    switchOf('Start the next wave on its own').click();
    expect(ui.autoStartWaves()).toBe(!before);

    TestBed.resetTestingModule();
    const guest = await setup({ inCoop: true, host: false });
    const fast = radios(guest.el, 'td-set-speed')[2];
    expect(fast.getAttribute('aria-disabled')).toBe('true');
    fast.click();
    expect(TestBed.inject(GameStore).gameSpeed()).toBe(1);
    expect(guest.el.textContent).toContain('The host sets the speed.');
  });

  it('names the tile provider; Change key asks for the key step and makes way', async () => {
    const { el, byText, config, leave } = await setup();
    expect(el.textContent).toContain('Cesium ion');
    byText('Change key')!.click();
    expect(config.setupRequested()).toBe(true);
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it('keeps the coop name, lists the lobbies, adds one and removes one of the player\'s own', async () => {
    const { el, coopService, byText, settle } = await setup();
    const name = el.querySelector<HTMLInputElement>('.set-name')!;
    expect(name.value).toBe('Ann');
    name.value = 'Bo';
    name.dispatchEvent(new Event('input'));
    expect(coopService.name).toBe('Bo');

    expect(el.querySelector('[aria-label="Remove EU"]')).toBeNull();
    el.querySelector<HTMLButtonElement>('[aria-label="Remove Mine"]')!.click();
    expect(coopService.removeLobby).toHaveBeenCalledWith(MINE.url);

    const [lobbyName, lobbyUrl] = [...el.querySelectorAll<HTMLInputElement>('.set-lobby-add input')];
    lobbyName.value = 'Club';
    lobbyName.dispatchEvent(new Event('input'));
    lobbyUrl.value = 'http://nope';
    lobbyUrl.dispatchEvent(new Event('input'));
    await settle();
    byText('Add lobby')!.click();
    await settle();
    expect(el.textContent).toContain('That is no lobby address');

    lobbyUrl.value = 'wss://club.example.test';
    lobbyUrl.dispatchEvent(new Event('input'));
    await settle();
    byText('Add lobby')!.click();
    await settle();
    expect(coopService.addLobby).toHaveBeenLastCalledWith('Club', 'wss://club.example.test');
    expect(el.textContent).toContain('This lobby answers.');
  });

  it('has no Coop section without the game\'s coop service', async () => {
    const { el } = await setup({ coop: false });
    expect(el.textContent).not.toContain('Your name');
  });

  it('keeps the answer about sending coop run logs', async () => {
    const { switchOf } = await setup();
    const box = switchOf('After a coop game, send its log to the coop server, to find errors and improve the game (kept 90 days)');
    expect(box.checked).toBe(false);
    box.click();
    expect(localStorage.getItem('3dtd-run-upload')).toBe('yes');
    box.click();
    expect(localStorage.getItem('3dtd-run-upload')).toBe('no');
  });
});
