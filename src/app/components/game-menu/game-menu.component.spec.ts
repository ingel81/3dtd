/**
 * The game menu (TODO A3, E111, E112c): a classic game menu. Continue on top,
 * Save and Load alone only and between waves (the save game port, a fake
 * here), Settings with the four volumes, graphics quality and game speed,
 * More with the run log and replay as files, then Restart here, Change
 * location and Quit; what ends the run asks first, Esc steps back a page.
 * Quit only where the app can end itself; fullscreen through the app's
 * window when there is one, otherwise through the page.
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
import { UIStore } from '../../store/ui.store';
import { BenchmarkService } from '../../benchmark/benchmark.service';
import { DebugFacadeService } from '../../services/debug/debug-facade.service';
import { RunLogFacade } from '../../run-log/run-log.facade';
import { ReplayService } from '../../services/replay.service';
import { TowerDefenseFacadeService } from '../../services/facade/tower-defense-facade.service';
import { LocationChangeCoordinatorService } from '../../services/location/location-change-coordinator.service';
import { AUTOSAVE_SLOT, SAVE_GAME, manualSlotId, type LoadResult, type SaveSlotInfo } from '../../services/save-game/save-game.port';
import { VFX_PRESETS } from '../../three-engine/vfx-settings';

const template = readFileSync(resolve('src/app/components/game-menu/game-menu.component.html'), 'utf8');

interface Setup {
  desktop?: boolean;
  started?: boolean;
  inCoop?: boolean;
  host?: boolean;
  pausedBefore?: boolean;
  /** The game component's benchmark is there */
  benchmark?: boolean;
  canSave?: boolean;
  slots?: SaveSlotInfo[];
  loadResult?: LoadResult;
  waveRunning?: boolean;
  /** The replay recorded a wave */
  recorded?: boolean;
  /** A coop guest in a room's lobby: the host sets the map */
  mapLocked?: boolean;
}

const slot = (id: string, name: string, wave: number, note: string | null = null): SaveSlotInfo => ({
  id, name, wave, note,
  autosave: id === AUTOSAVE_SLOT,
  location: 'Heilbronn',
  savedAt: '2026-10-05T14:32:00Z',
  gameVersion: '0.6.0',
});

async function setup({
  desktop = true, started = false, inCoop = false, host = true, pausedBefore = false, benchmark = false,
  canSave = false, slots = [], loadResult = { ok: true, note: null }, waveRunning = false, recorded = false,
  mapLocked = false,
}: Setup = {}) {
  const bench = { start: vi.fn() };
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
  const saves = {
    canSave: signal(canSave),
    cannotSaveReason: signal(canSave ? null : 'Saves between waves'),
    slots: signal(slots),
    hasAutosave: signal(slots.some((s) => s.autosave)),
    refresh: vi.fn(async () => undefined),
    save: vi.fn(async () => ({ ok: true as const })),
    load: vi.fn(async () => loadResult),
    deleteSlot: vi.fn(async () => undefined),
    exportFile: vi.fn(async () => ({ ok: true as const })),
    importFile: vi.fn(async () => loadResult),
    continueAutosave: vi.fn(async () => loadResult),
  };
  const debugFacade = {
    vfx: signal({ ...VFX_PRESETS.high, freezeTint: true, bloodMoon: true }),
    onVfxPresetSelected: vi.fn(),
  };
  const runLog = { export: vi.fn(() => true) };
  const replay = { recordedWave: signal(recorded ? 3 : null), saveFile: vi.fn(async () => true) };
  const facade = { restartGame: vi.fn() };
  const location = { openLocationDialog: vi.fn(async () => undefined) };
  TestBed.configureTestingModule({
    providers: [
      { provide: MatDialogRef, useValue: { close } },
      { provide: MatDialog, useValue: { open: vi.fn(), openDialogs: [] } },
      { provide: WhatsNewService, useValue: { open: vi.fn() } },
      { provide: CoopService, useValue: { inGame: signal(inCoop), isHost: signal(host) } },
      { provide: SAVE_GAME, useValue: saves },
      { provide: DebugFacadeService, useValue: debugFacade },
      { provide: RunLogFacade, useValue: runLog },
      { provide: ReplayService, useValue: replay },
      { provide: TowerDefenseFacadeService, useValue: facade },
      { provide: LocationChangeCoordinatorService, useValue: location },
      ...(benchmark ? [{ provide: BenchmarkService, useValue: bench }] : []),
    ],
  });
  TestBed.overrideComponent(GameMenuComponent, {
    // The icon's signal inputs need the AOT compiler; the icon is no part of this test
    set: { template, templateUrl: undefined, styleUrl: undefined, styles: [], imports: [], schemas: [NO_ERRORS_SCHEMA] },
  });
  TestBed.inject(UIStore).coopMapLocked.set(mapLocked);
  const store = TestBed.inject(GameStore);
  if (started) store.towerCount.set(3);
  if (waveRunning) store.phase.set('wave');
  store.paused.set(pausedBefore);
  const fixture = TestBed.createComponent(GameMenuComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const buttons = () => [...el.querySelectorAll('button')];
  const labels = () => [...el.querySelectorAll('.gm-list > .gm-item .gm-label')].map((l) => l.textContent!.trim().replace(/\s+/g, ' '));
  const byText = (text: string) => buttons().find((b) => b.textContent?.includes(text));
  // The port answers in promises the zoneless fixture does not wait for: a macrotask lets them settle
  const settle = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((done) => setTimeout(done, 0));
    fixture.detectChanges();
  };
  const click = async (text: string) => {
    byText(text)!.click();
    await settle();
  };
  const escape = async () => {
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    (el.querySelector('button') ?? el).dispatchEvent(event);
    await settle();
    return event;
  };
  const status = () => el.querySelector('.gm-status')?.textContent?.trim() ?? null;
  return {
    bridge, bench, close, el, byText, click, escape, labels, status, settle, store, fixture, saves, debugFacade,
    runLog, replay, facade, location, menu: fixture.componentInstance,
  };
}

describe('GameMenuComponent', () => {
  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    delete (window as unknown as { desktop?: unknown }).desktop;
  });

  describe('the list', () => {
    it('reads as a game menu: Continue on top, the pages, then what leaves the run', async () => {
      const { labels } = await setup();
      expect(labels()).toEqual([
        'Continue', 'Save game', 'Load game', 'Settings', 'More', 'Restart here', 'Change location', 'Quit 3DTD',
      ]);
    });

    it('offers the autosave on top while the new run has not begun, then Back to the game', async () => {
      const autosave = slot(AUTOSAVE_SLOT, 'Heilbronn, wave 12', 12);
      const { labels, click, saves, close, el } = await setup({ slots: [autosave] });
      expect(labels().slice(0, 2)).toEqual(['Continue Heilbronn, wave 12', 'Back to the game']);
      expect(el.querySelector('.gm-sub')!.textContent).toBe('Heilbronn, wave 12');
      await click('Continue');
      expect(saves.continueAutosave).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);

      TestBed.resetTestingModule();
      const underWay = await setup({ slots: [autosave], started: true });
      expect(underWay.labels()[0]).toBe('Continue');
      TestBed.resetTestingModule();
      const coop = await setup({ slots: [autosave], inCoop: true });
      expect(coop.labels()[0]).toBe('Continue');
    });

    it('Continue goes back to the game', async () => {
      const { click, close } = await setup();
      await click('Continue');
      expect(close).toHaveBeenCalledTimes(1);
    });

    it('in coop has no Save, Load, Restart or Change location', async () => {
      const { labels } = await setup({ inCoop: true });
      expect(labels()).toEqual(['Continue', 'Settings', 'More', 'Quit 3DTD']);
    });

    it('has no Quit in a browser, a tab cannot close itself', async () => {
      const { byText } = await setup({ desktop: false });
      expect(byText('Quit')).toBeUndefined();
    });

    it('Esc on a page steps back to the list; on the list it is the dialog\'s, which closes', async () => {
      const { click, escape, el } = await setup();
      await click('Settings');
      expect(el.querySelector('#td-game-menu-title')!.textContent!.trim()).toBe('Settings');
      const back = await escape();
      expect(back.defaultPrevented).toBe(true);
      expect(el.querySelector('#td-game-menu-title')!.textContent!.trim()).toBe('Menu');
      const out = await escape();
      expect(out.defaultPrevented).toBe(false);
    });
  });

  describe('Save', () => {
    it('lists five slots and says why it cannot save now', async () => {
      const { click, el, saves } = await setup({ slots: [slot(manualSlotId(2), 'Before the boss', 9)] });
      await click('Save game');
      const rows = [...el.querySelectorAll<HTMLButtonElement>('.gm-slot')];
      expect(rows.map((r) => r.querySelector('.gm-slot-title')!.textContent!.trim())).toEqual([
        'Slot 1', 'Before the boss', 'Slot 3', 'Slot 4', 'Slot 5',
      ]);
      expect(rows.every((r) => r.disabled)).toBe(true);
      expect(el.textContent).toContain('Saves between waves');
      rows[0].click();
      expect(saves.save).not.toHaveBeenCalled();
    });

    it('saves into an empty slot at once and asks before it overwrites one', async () => {
      const { click, el, saves, status, settle } = await setup({ canSave: true, slots: [slot(manualSlotId(2), 'Before the boss', 9)] });
      await click('Save game');
      el.querySelectorAll<HTMLButtonElement>('.gm-slot')[0].click();
      await settle();
      expect(saves.save).toHaveBeenCalledWith('slot-1');
      expect(status()).toBe('Saved.');

      el.querySelectorAll<HTMLButtonElement>('.gm-slot')[1].click();
      await settle();
      expect(el.textContent).toContain('Overwrite "Before the boss"?');
      await click('Overwrite');
      expect(saves.save).toHaveBeenLastCalledWith('slot-2');
    });
  });

  describe('Load', () => {
    const slots = [slot(manualSlotId(1), 'Mine', 4), slot(AUTOSAVE_SLOT, 'Heilbronn, wave 7', 7)];

    it('lists the autosave first, and loads at once when no run is under way', async () => {
      const { click, el, saves, close } = await setup({ slots });
      await click('Load game');
      const titles = [...el.querySelectorAll('.gm-slot-title')].map((t) => t.textContent!.trim());
      expect(titles).toEqual(['Autosave', 'Mine']);
      expect(el.querySelector('.gm-slot-detail')!.textContent).toContain('Wave 7 · Heilbronn');
      await click('Autosave');
      expect(saves.load).toHaveBeenCalledWith(AUTOSAVE_SLOT);
      expect(close).toHaveBeenCalledTimes(1);
    });

    it('asks first while a run is under way', async () => {
      const { click, el, saves } = await setup({ slots, started: true });
      await click('Load game');
      await click('Mine');
      expect(saves.load).not.toHaveBeenCalled();
      expect(el.textContent).toContain('Load "Mine"?');
      await click('Load');
      expect(saves.load).toHaveBeenCalledWith('slot-1');
    });

    it('shows the version note of a save from another version and stays open', async () => {
      const note = 'Saved with version 0.5.0, values may differ.';
      const { click, close, status } = await setup({ slots, loadResult: { ok: true, note } });
      await click('Load game');
      await click('Mine');
      expect(close).not.toHaveBeenCalled();
      expect(status()).toBe(`Loaded. ${note}`);
    });

    it('says why a load failed', async () => {
      const { click, status } = await setup({ slots, loadResult: { ok: false, reason: 'This save is from another format.' } });
      await click('Load game');
      await click('Mine');
      expect(status()).toBe('This save is from another format.');
    });

    it('loads nothing while a wave runs', async () => {
      const { click, el } = await setup({ slots, waveRunning: true });
      await click('Load game');
      expect(el.textContent).toContain('Loads between waves');
      expect([...el.querySelectorAll<HTMLButtonElement>('.gm-slot')].every((b) => b.disabled)).toBe(true);
      expect(byLabel(el, 'Load from a file')!.disabled).toBe(true);
    });

    it('exports a slot and deletes a manual one after asking, the autosave has no delete', async () => {
      const { click, el, saves, settle } = await setup({ slots });
      await click('Load game');
      expect(el.querySelector('[aria-label="Delete Autosave"]')).toBeNull();
      el.querySelector<HTMLButtonElement>('[aria-label="Save Mine as a file"]')!.click();
      await settle();
      expect(saves.exportFile).toHaveBeenCalledWith('slot-1');
      el.querySelector<HTMLButtonElement>('[aria-label="Delete Mine"]')!.click();
      await settle();
      expect(saves.deleteSlot).not.toHaveBeenCalled();
      await click('Delete');
      expect(saves.deleteSlot).toHaveBeenCalledWith('slot-1');
    });
  });

  describe('Restart and Change location', () => {
    it('restarts at once when nothing is under way', async () => {
      const { click, facade, close } = await setup();
      await click('Restart here');
      expect(facade.restartGame).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalled();
    });

    it('asks first during a run, and Cancel keeps it', async () => {
      const { click, facade, el } = await setup({ started: true });
      await click('Restart here');
      expect(facade.restartGame).not.toHaveBeenCalled();
      expect(el.textContent).toContain('Restart at this place?');
      await click('Cancel');
      expect(facade.restartGame).not.toHaveBeenCalled();
      await click('Restart here');
      await click('Restart');
      expect(facade.restartGame).toHaveBeenCalledTimes(1);
    });

    it('has no Change location for a coop guest in the lobby, where the host sets the map', async () => {
      const { labels } = await setup({ mapLocked: true });
      expect(labels()).not.toContain('Change location');
      expect(labels()).toContain('Restart here');
    });

    it('Change location opens the location dialog', async () => {
      const { click, close, location } = await setup();
      await click('Change location');
      expect(close).toHaveBeenCalled();
      expect(location.openLocationDialog).toHaveBeenCalledTimes(1);
    });
  });

  describe('Settings', () => {
    it('has a slider and a mute for each of master, effects, music and interface', async () => {
      const { click, el, fixture } = await setup();
      await click('Settings');
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

    it('picks the graphics preset and the game speed', async () => {
      const { click, el, debugFacade, store } = await setup();
      await click('Settings');
      const radios = (group: string) =>
        [...el.querySelectorAll<HTMLButtonElement>(`[aria-labelledby="${group}"] [role="radio"]`)];
      expect(radios('td-gm-quality').map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true']);
      radios('td-gm-quality')[0].click();
      expect(debugFacade.onVfxPresetSelected).toHaveBeenCalledWith('low');
      radios('td-gm-speed')[2].click();
      expect(store.gameSpeed()).toBe(4);
    });

    it('leaves the speed to the host in coop', async () => {
      const { click, el, store } = await setup({ inCoop: true, host: false });
      await click('Settings');
      const fast = [...el.querySelectorAll<HTMLButtonElement>('[aria-labelledby="td-gm-speed"] [role="radio"]')][2];
      expect(fast.getAttribute('aria-disabled')).toBe('true');
      fast.click();
      expect(store.gameSpeed()).toBe(1);
      expect(el.textContent).toContain('The host sets the speed');
    });

    it('switches the app window to fullscreen and says so', async () => {
      const { bridge, click, byText } = await setup();
      await click('Settings');
      await click('Fullscreen');
      expect(bridge.toggleFullscreen).toHaveBeenCalledTimes(1);
      expect(byText('Leave fullscreen')).toBeDefined();
    });
  });

  describe('More', () => {
    it('saves the run log at any time and the replay once a wave is recorded', async () => {
      const { click, runLog, replay, status } = await setup({ recorded: true });
      await click('More');
      await click('Save the run log');
      expect(runLog.export).toHaveBeenCalledTimes(1);
      expect(status()).toBe('Run log saved.');
      await click('Save the replay');
      expect(replay.saveFile).toHaveBeenCalledTimes(1);
      expect(status()).toBe('Replay saved.');
      TestBed.resetTestingModule();
      const fresh = await setup();
      await fresh.click('More');
      expect(fresh.byText('Save the replay')).toBeUndefined();
    });

    it('offers the benchmark, asks before the reload, and Cancel stays', async () => {
      const { bench, byText, click, el } = await setup({ benchmark: true });
      await click('More');
      await click('Benchmark');
      expect(bench.start).not.toHaveBeenCalled();
      expect(el.textContent).toContain('The page reloads into a test world');
      await click('Cancel');
      expect(byText('Benchmark')).toBeDefined();
      await click('Benchmark');
      await click('Run');
      expect(bench.start).toHaveBeenCalledTimes(1);
    });

    it('has no benchmark in coop or outside the game', async () => {
      const coop = await setup({ benchmark: true, inCoop: true });
      await coop.click('More');
      expect(coop.byText('Benchmark')).toBeUndefined();
      TestBed.resetTestingModule();
      const outside = await setup();
      await outside.click('More');
      expect(outside.byText('Benchmark')).toBeUndefined();
    });
  });

  describe('Quit and the pause', () => {
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
  });
});

function byLabel(el: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes(text));
}
