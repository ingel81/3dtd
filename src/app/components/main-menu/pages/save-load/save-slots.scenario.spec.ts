/**
 * The Save and Load pages of the menu (docs/SAVE_LOAD_PLAN.md), ported from
 * the game menu's scenarios: five slots and why saving is off, Overwrite
 * asked, the autosave first, a load that ends the run asked first, a file
 * picked after the question, the version note, a failed load, no load while
 * a wave runs, export and delete. The save game port is a fake; the real
 * template is read from disk.
 */
// The component is partially compiled and needs the JIT compiler
import '@angular/compiler';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Input, NO_ERRORS_SCHEMA, ViewChild, signal } from '@angular/core';
import { getTestBed, TestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { GameStore } from '../../../../store/game.store';
import { AUTOSAVE_SLOT, SAVE_GAME, manualSlotId, type LoadResult, type SaveSlotInfo } from '../../../../services/save-game/save-game.port';
import { SaveSlotsComponent } from './save-slots.component';

const template = readFileSync(resolve('src/app/components/main-menu/pages/save-load/save-slots.component.html'), 'utf8');

// The @Input annotation the JIT transform adds for every input(); plain vitest runs without it
Input({ alias: 'mode', required: true, isSignal: true } as Input)(SaveSlotsComponent.prototype, 'mode');
// Same for viewChild(): without it the file input is not found
ViewChild('importInput', { isSignal: true } as unknown as ViewChild)(SaveSlotsComponent.prototype, 'fileInput');

const slot = (id: string, name: string, wave: number, note: string | null = null): SaveSlotInfo => ({
  id, name, wave, note,
  autosave: id === AUTOSAVE_SLOT,
  location: 'Heilbronn', hq: { lat: 49.14, lon: 9.21 },
  savedAt: '2026-10-05T14:32:00Z',
  gameVersion: '0.6.0',
});
const SLOTS = [slot(manualSlotId(1), 'Mine', 7), slot(AUTOSAVE_SLOT, 'Heilbronn, wave 12', 12)];

interface Setup {
  mode: 'save' | 'load';
  canSave?: boolean;
  slots?: SaveSlotInfo[];
  started?: boolean;
  waveRunning?: boolean;
  loadResult?: LoadResult;
}

describe('Save and Load pages', () => {
  beforeAll(() => {
    getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
  });

  afterEach(() => TestBed.resetTestingModule());

  async function setup({ mode, canSave = false, slots = SLOTS, started = false, waveRunning = false, loadResult = { ok: true, note: null } }: Setup) {
    const saves = {
      canSave: signal(canSave),
      cannotSaveReason: signal(canSave ? null : 'Saving works only between waves.'),
      slots: signal(slots),
      hasAutosave: signal(slots.some((s) => s.autosave)),
      startPlace: signal(null),
      refresh: vi.fn(async () => undefined),
      save: vi.fn(async () => ({ ok: true as const })),
      load: vi.fn(async () => loadResult),
      deleteSlot: vi.fn(async () => undefined),
      exportFile: vi.fn(async () => ({ ok: true as const })),
      importFile: vi.fn(async () => loadResult),
      continueAutosave: vi.fn(async () => loadResult),
    };
    TestBed.configureTestingModule({ providers: [{ provide: SAVE_GAME, useValue: saves }] });
    TestBed.overrideComponent(SaveSlotsComponent, {
      // The icon's signal inputs need the AOT compiler; the icon is no part of this test
      set: { template, templateUrl: undefined, styleUrl: undefined, styles: [], imports: [], schemas: [NO_ERRORS_SCHEMA] },
    });
    const store = TestBed.inject(GameStore);
    if (started) store.towerCount.set(3);
    if (waveRunning) store.phase.set('wave');
    const fixture = TestBed.createComponent(SaveSlotsComponent);
    fixture.componentRef.setInput('mode', mode);
    const loaded = vi.fn();
    fixture.componentInstance.loaded.subscribe(loaded);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const byText = (text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(text));
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
    const status = () => el.querySelector('.mp-status')?.textContent?.trim() ?? null;
    return { fixture, el, saves, loaded, byText, click, settle, status };
  }

  describe('Save', () => {
    it('lists five slots and says why it cannot save now', async () => {
      const { el, saves } = await setup({ mode: 'save', slots: [slot(manualSlotId(2), 'Before the boss', 9)] });
      const rows = [...el.querySelectorAll<HTMLButtonElement>('.mp-slot')];
      expect(rows.map((r) => r.querySelector('.mp-slot-title')!.textContent!.trim())).toEqual([
        'Slot 1', 'Before the boss', 'Slot 3', 'Slot 4', 'Slot 5',
      ]);
      expect(rows.every((r) => r.disabled)).toBe(true);
      expect(el.textContent).toContain('Saving works only between waves.');
      rows[0].click();
      expect(saves.save).not.toHaveBeenCalled();
    });

    it('saves into an empty slot at once and asks before it overwrites one', async () => {
      const { el, saves, status, settle, click } = await setup({ mode: 'save', canSave: true, slots: [slot(manualSlotId(2), 'Before the boss', 9)] });
      el.querySelectorAll<HTMLButtonElement>('.mp-slot')[0].click();
      await settle();
      expect(saves.save).toHaveBeenCalledWith('slot-1');
      expect(status()).toBe('Saved.');

      el.querySelectorAll<HTMLButtonElement>('.mp-slot')[1].click();
      await settle();
      expect(el.textContent).toContain('Overwrite "Before the boss"?');
      await click('Overwrite');
      expect(saves.save).toHaveBeenLastCalledWith('slot-2');
    });
  });

  describe('Load', () => {
    it('lists the autosave first and loads at once when no run is under way', async () => {
      const { el, click, saves, loaded } = await setup({ mode: 'load' });
      expect([...el.querySelectorAll('.mp-slot-title')].map((t) => t.textContent!.trim())).toEqual(['Autosave', 'Mine']);
      expect(el.querySelector('.mp-slot-detail')!.textContent).toContain('Wave 12 · Heilbronn');
      await click('Autosave');
      expect(saves.load).toHaveBeenCalledWith(AUTOSAVE_SLOT);
      expect(loaded).toHaveBeenCalledTimes(1);
    });

    it('asks first while a run is under way', async () => {
      const { el, click, saves } = await setup({ mode: 'load', started: true });
      await click('Mine');
      expect(saves.load).not.toHaveBeenCalled();
      expect(el.textContent).toContain('Load "Mine"?');
      await click('Load');
      expect(saves.load).toHaveBeenCalledWith('slot-1');
    });

    it('asks before a file while a run is under way; the file input stays for Pick file', async () => {
      const { el, click } = await setup({ mode: 'load', started: true });
      await click('Load from a file');
      expect(el.textContent).toContain('Load a save from a file?');
      const input = el.querySelector<HTMLInputElement>('input.mp-file')!;
      const picked = vi.spyOn(input, 'click').mockImplementation(() => undefined);
      await click('Pick file');
      expect(el.textContent).not.toContain('Load a save from a file?');
      expect(picked).toHaveBeenCalledTimes(1);
    });

    it('shows the version note of a save from another version and stays', async () => {
      const note = 'Saved with version 0.5.0, values may differ.';
      const { click, loaded, status } = await setup({ mode: 'load', loadResult: { ok: true, note } });
      await click('Mine');
      expect(loaded).not.toHaveBeenCalled();
      expect(status()).toBe(`Loaded. ${note}`);
    });

    it('says why a load failed', async () => {
      const { click, status } = await setup({ mode: 'load', loadResult: { ok: false, reason: 'This save is from another format.' } });
      await click('Mine');
      expect(status()).toBe('This save is from another format.');
    });

    it('loads nothing while a wave runs', async () => {
      const { el, byText } = await setup({ mode: 'load', waveRunning: true });
      expect(el.textContent).toContain('Loads between waves.');
      expect([...el.querySelectorAll<HTMLButtonElement>('.mp-slot')].every((b) => b.disabled)).toBe(true);
      expect(byText('Load from a file')!.disabled).toBe(true);
    });

    it('exports a slot and deletes a manual one after asking; the autosave has no delete', async () => {
      const { el, click, saves, settle } = await setup({ mode: 'load' });
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

    it('says when nothing is saved yet', async () => {
      const { el } = await setup({ mode: 'load', slots: [] });
      expect(el.textContent).toContain('No saved game in this browser yet.');
    });
  });
});
